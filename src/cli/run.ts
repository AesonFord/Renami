import { lstat, rename } from 'node:fs/promises';
import path from 'node:path';
import {
  buildPlan,
  createFsView,
  executePlan,
  HashCache,
  History,
  patternUsesHash,
  readMetadata,
  scan,
  systemTimeZone,
  type BirthtimeSetter,
  type FileMetadata,
  type MetadataReader,
  type Platform,
} from '../core/index.js';
import type { Command, RenameCommand } from './args.js';
import { EXIT } from './exit.js';
import { HELP, tokensText } from './help.js';
import { JournalError, readJournal, writeJournal } from './journal.js';
import { openInApp, type LaunchDeps } from './launch.js';
import { planJson, planText, plural, resultText, rollbackText, shown, type ApplyResult } from './render.js';

export interface Output {
  write(text: string): unknown;
}

export interface RunContext {
  stdout: Output;
  stderr: Output;
  /** Aborted on Ctrl-C. */
  signal: AbortSignal;
  cwd: string;
  platform: Platform;
  version: string;
  /** Made only by commands that read metadata; ended before runCommand returns. */
  createReader: () => MetadataReader;
  launch: LaunchDeps;
  /** Tests pass a fake; defaults to this OS's setter. */
  birthtime?: BirthtimeSetter;
  /** IANA zone for dates. Defaults to the system zone. */
  timeZone?: string;
  /** Shows a progress line (null clears it). Only set when stderr is a terminal. */
  progress?: (text: string | null) => void;
}

const exists = (p: string): Promise<boolean> =>
  lstat(p).then(
    () => true,
    () => false,
  );
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const fail = (ctx: RunContext, text: string): void => {
  ctx.stderr.write(`renami: ${text}\n`);
};

export async function runCommand(command: Command, ctx: RunContext): Promise<number> {
  switch (command.kind) {
    case 'help':
      ctx.stdout.write(HELP);
      return EXIT.ok;
    case 'version':
      ctx.stdout.write(`${ctx.version}\n`);
      return EXIT.ok;
    case 'tokens':
      ctx.stdout.write(tokensText());
      return EXIT.ok;
    case 'open':
      return runOpen(command.paths, ctx);
    case 'undo':
      return runUndo(command.journal, ctx);
    case 'rename': {
      const reader = ctx.createReader();
      try {
        return await runRename(command, reader, ctx);
      } finally {
        // ExifTool runs as a child process; it would keep Node alive.
        await reader.end();
      }
    }
  }
}

async function runOpen(paths: readonly string[], ctx: RunContext): Promise<number> {
  if (await openInApp(paths, ctx.launch)) return EXIT.ok;
  const appImage = ctx.launch.platform === 'linux' ? ' (an AppImage cannot be found this way; start it with the paths instead)' : '';
  fail(ctx, `Renami desktop app not found${appImage}; to rename from the terminal use "renami rename <paths…>"`);
  return EXIT.appNotFound;
}

/** Calls ctx.progress every 25 items and at the end. */
const progressOf = (ctx: RunContext, label: string) => (done: number, total: number): void => {
  if (done === total || done % 25 === 0) ctx.progress?.(`${label} ${done}/${total}`);
};

async function runRename({ paths, settings, options }: RenameCommand, reader: MetadataReader, ctx: RunContext): Promise<number> {
  for (const p of paths) {
    if (!(await exists(p))) {
      fail(ctx, `no such file or folder: ${p}`);
      return EXIT.usage;
    }
  }
  // Checked before anything moves: a journal that can't be written would lose the undo record.
  if (options.journal !== null) {
    if (await exists(options.journal)) {
      fail(ctx, `the journal ${options.journal} already exists; pick a new file name`);
      return EXIT.usage;
    }
    if (!(await exists(path.dirname(options.journal)))) {
      fail(ctx, `the journal's folder doesn't exist: ${path.dirname(options.journal)}`);
      return EXIT.usage;
    }
  }

  const timeZone = ctx.timeZone ?? systemTimeZone();
  const { entries, unreadableFolders } = await scan(paths, settings.filter);
  for (const dir of unreadableFolders) fail(ctx, `couldn't read the folder ${dir}; its files are left out`);

  const metadata = new Map<string, FileMetadata>();
  const readProgress = progressOf(ctx, 'Reading file details');
  const read = await readMetadata(entries, reader, {
    signal: ctx.signal,
    onResult: (p, meta) => {
      metadata.set(p, meta);
      readProgress(metadata.size, entries.length);
    },
  });
  ctx.progress?.(null);
  if ('error' in read) {
    fail(ctx, `reading file details stopped: ${message(read.error)}`);
    return EXIT.failed;
  }
  if (ctx.signal.aborted) {
    fail(ctx, 'cancelled; nothing was renamed');
    return EXIT.failed;
  }
  if (read.exiftoolFailed) fail(ctx, "ExifTool isn't working, so files without details use their file system dates");

  let allMetadata = metadata;
  if (patternUsesHash(settings.pattern)) {
    const hashes = new HashCache(timeZone);
    await hashes.hashMissing(entries, ctx.signal);
    if (ctx.signal.aborted) {
      fail(ctx, 'cancelled; nothing was renamed');
      return EXIT.failed;
    }
    allMetadata = hashes.mergeInto(metadata, entries);
  }

  const plan = buildPlan({ entries, metadata: allMetadata, settings, fs: createFsView(), platform: ctx.platform, timeZone });
  if (!options.json && !options.quiet) {
    ctx.stdout.write(entries.length === 0 ? 'Nothing to rename: no files matched.\n' : planText(plan, ctx.cwd));
  }
  const showJson = (result?: ApplyResult): void => {
    if (options.json) ctx.stdout.write(planJson(plan, result));
  };

  if (plan.patternError !== null) {
    showJson();
    fail(ctx, plan.patternError);
    return EXIT.patternError;
  }
  if (plan.errorCount > 0) {
    showJson();
    fail(ctx, `${plural(plan.errorCount, 'file')} can't be renamed${options.apply ? '; nothing was renamed' : ''}`);
    return EXIT.planErrors;
  }
  if (!options.apply) {
    showJson();
    return EXIT.ok;
  }

  const batch = await executePlan(plan, {
    signal: ctx.signal,
    onProgress: progressOf(ctx, 'Renaming'),
    birthtime: ctx.birthtime,
  });
  ctx.progress?.(null);

  let result: ApplyResult;
  let journalFailed = false;
  if (batch.status === 'done') {
    const { files } = batch.record;
    let journal: string | null = null;
    if (options.journal !== null && files.length === 0) {
      fail(ctx, 'nothing changed, so no journal was written');
    } else if (options.journal !== null) {
      try {
        await writeJournal(options.journal, batch.record);
        journal = options.journal;
      } catch (e) {
        journalFailed = true;
        fail(ctx, `the files were renamed, but the journal couldn't be written: ${message(e)}`);
      }
    }
    result = {
      status: 'done',
      renamed: files.filter((f) => f.from !== f.to).length,
      datesChanged: files.filter((f) => f.originalTimes !== null).length,
      journal,
    };
  } else if (batch.status === 'stale') {
    result = { status: 'stale', changed: batch.changed };
  } else {
    result = { status: batch.status, error: batch.error, rollback: batch.rollback };
  }

  showJson(result);
  if (!options.json) {
    if (result.status !== 'done') ctx.stderr.write(resultText(result, ctx.cwd));
    else if (!options.quiet) ctx.stdout.write(resultText(result, ctx.cwd));
  }
  if (result.status === 'done') return journalFailed ? EXIT.failed : EXIT.ok;
  return result.status === 'stale' ? EXIT.stale : EXIT.failed;
}

async function runUndo(journal: string, ctx: RunContext): Promise<number> {
  if (!(await exists(journal))) {
    fail(ctx, (await exists(`${journal}.undone`)) ? `${journal} was already undone` : `no such journal: ${journal}`);
    return EXIT.usage;
  }
  let record;
  try {
    record = await readJournal(journal);
  } catch (e) {
    if (!(e instanceof JournalError)) throw e;
    fail(ctx, e.message);
    return EXIT.usage;
  }

  const history = new History();
  history.push(record);
  const result = await history.undo({ signal: ctx.signal, birthtime: ctx.birthtime });
  for (const s of result.skipped) fail(ctx, `skipped ${shown(s.path, ctx.cwd)}: ${s.reason}`);
  if (result.status === 'done') {
    await rename(journal, `${journal}.undone`);
    ctx.stdout.write(`Put back ${plural(result.restored, 'file')}.\n`);
    return result.skipped.length > 0 ? EXIT.undoSkipped : EXIT.ok;
  }
  const what = result.status === 'cancelled' ? 'undo cancelled' : `undo failed: ${result.error ?? 'unknown error'}`;
  fail(ctx, result.rollback ? `${what}. ${rollbackText(result.rollback, ctx.cwd)}` : what);
  return EXIT.failed;
}
