import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { normalizeExtension } from '../core/extensions.js';
import { withDefaults } from '../core/presets.js';
import type { CaseMode, RenameSettings, RestartEvery, SortKey } from '../core/types.js';

export interface RenameOptions {
  apply: boolean;
  /** Absolute path of the undo journal to write, or null. */
  journal: string | null;
  json: boolean;
  quiet: boolean;
}

export type Command =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'tokens' }
  | { kind: 'open'; paths: string[] }
  | { kind: 'undo'; journal: string }
  | { kind: 'rename'; paths: string[]; settings: RenameSettings; options: RenameOptions };

export type RenameCommand = Extract<Command, { kind: 'rename' }>;

/** A mistake in the command line or in a file it names. Exit code 1. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

const SORTS: readonly SortKey[] = ['dateTaken', 'created', 'modified', 'name'];
const RESTARTS: readonly RestartEvery[] = ['never', 'day', 'month', 'year'];
const CASES: readonly CaseMode[] = ['none', 'lower', 'upper', 'title', 'sentence', 'snake', 'kebab', 'camel'];

const RENAME_OPTIONS = {
  settings: { type: 'string' },
  pattern: { type: 'string', short: 'p' },
  sort: { type: 'string' },
  desc: { type: 'boolean' },
  start: { type: 'string' },
  step: { type: 'string' },
  digits: { type: 'string' },
  restart: { type: 'string' },
  'restart-per-folder': { type: 'boolean' },
  replace: { type: 'string', multiple: true },
  regex: { type: 'boolean' },
  'match-case': { type: 'boolean' },
  case: { type: 'string' },
  'spaces-to-underscores': { type: 'boolean' },
  ascii: { type: 'boolean' },
  'strip-accents': { type: 'boolean' },
  ext: { type: 'string', multiple: true },
  dest: { type: 'string' },
  shift: { type: 'string' },
  'use-name-date': { type: 'boolean' },
  'set-modified': { type: 'boolean' },
  'set-created': { type: 'boolean' },
  recursive: { type: 'boolean', short: 'r' },
  'only-ext': { type: 'string' },
  folders: { type: 'boolean' },
  name: { type: 'string' },
  apply: { type: 'boolean' },
  journal: { type: 'string' },
  json: { type: 'boolean' },
  quiet: { type: 'boolean', short: 'q' },
  help: { type: 'boolean', short: 'h' },
} as const;

const UNDO_OPTIONS = { help: { type: 'boolean', short: 'h' } } as const;

/** Runs parseArgs, turning its errors into usage errors. */
function parsed<T>(run: () => T): T {
  try {
    return run();
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS')) {
      throw new UsageError((e as Error).message.replace(/\s*\n\s*/g, ' '));
    }
    throw e;
  }
}

const parseRenameArgs = (args: readonly string[]) =>
  parsed(() => parseArgs({ args: [...args], options: RENAME_OPTIONS, allowPositionals: true, strict: true }));
type RenameValues = ReturnType<typeof parseRenameArgs>['values'];

/** Reads argv (without the node and script paths). Relative paths resolve against cwd. */
export async function parseCommand(
  argv: readonly string[],
  cwd: string,
  readText: (file: string) => Promise<string> = (file) => readFile(file, 'utf8'),
): Promise<Command> {
  const [first, ...rest] = argv;
  if (first === undefined) return { kind: 'help' };
  if (first === 'rename') return parseRename(rest, cwd, readText);
  if (first === 'undo') return parseUndo(rest, cwd);
  if (first === 'tokens') {
    if (rest[0] !== undefined) throw new UsageError(`tokens takes no arguments, got "${rest[0]}"`);
    return { kind: 'tokens' };
  }
  if (argv.length === 1 && (first === '--help' || first === '-h')) return { kind: 'help' };
  if (argv.length === 1 && (first === '--version' || first === '-v')) return { kind: 'version' };
  const flag = argv.find((a) => a.startsWith('-'));
  if (flag !== undefined) {
    throw new UsageError(`"${flag}" needs a command; to rename from the terminal use "renami rename <paths…> ${flag}"`);
  }
  return { kind: 'open', paths: argv.map((p) => path.resolve(cwd, p)) };
}

function parseUndo(args: readonly string[], cwd: string): Command {
  const { values, positionals } = parsed(() =>
    parseArgs({ args: [...args], options: UNDO_OPTIONS, allowPositionals: true, strict: true }),
  );
  if (values.help) return { kind: 'help' };
  const [journal] = positionals;
  if (journal === undefined || positionals.length !== 1) {
    throw new UsageError('undo needs exactly one journal file: renami undo <journal.json>');
  }
  return { kind: 'undo', journal: path.resolve(cwd, journal) };
}

async function parseRename(
  args: readonly string[],
  cwd: string,
  readText: (file: string) => Promise<string>,
): Promise<Command> {
  const { values, positionals } = parseRenameArgs(args);
  if (values.help) return { kind: 'help' };
  if (positionals.length === 0) throw new UsageError('rename needs at least one file or folder');
  if (values.journal !== undefined && !values.apply) throw new UsageError('--journal only works with --apply');
  const settings =
    values.settings === undefined ? withDefaults({}) : await readSettings(path.resolve(cwd, values.settings), readText);
  applyFlags(settings, values, cwd);
  return {
    kind: 'rename',
    paths: positionals.map((p) => path.resolve(cwd, p)),
    settings,
    options: {
      apply: values.apply === true,
      journal: values.journal === undefined ? null : path.resolve(cwd, values.journal),
      json: values.json === true,
      quiet: values.quiet === true,
    },
  };
}

async function readSettings(file: string, readText: (file: string) => Promise<string>): Promise<RenameSettings> {
  let data: unknown;
  try {
    data = JSON.parse(await readText(file));
  } catch (e) {
    throw new UsageError(`can't read the settings file ${file}: ${(e as Error).message}`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new UsageError(`the settings file ${file} must hold a JSON object`);
  }
  const sequence = (data as { sequence?: unknown }).sequence;
  if (typeof sequence === 'object' && sequence !== null && (sequence as { sortBy?: unknown }).sortBy === 'manual') {
    throw new UsageError('sortBy "manual" only works in the desktop app');
  }
  return withDefaults(data);
}

function applyFlags(s: RenameSettings, v: RenameValues, cwd: string): void {
  if (v.pattern !== undefined) s.pattern = v.pattern;
  if (v.sort !== undefined) s.sequence.sortBy = choice('--sort', v.sort, SORTS);
  if (v.desc) s.sequence.direction = 'desc';
  if (v.start !== undefined) s.sequence.start = integer('--start', v.start, 0, 999_999_999);
  if (v.step !== undefined) s.sequence.step = integer('--step', v.step, 1, 1_000_000);
  if (v.digits !== undefined) s.sequence.digits = integer('--digits', v.digits, 1, 10);
  if (v.restart !== undefined) s.sequence.restartEvery = choice('--restart', v.restart, RESTARTS);
  if (v['restart-per-folder']) s.sequence.restartPerFolder = true;
  for (const pair of v.replace ?? []) {
    const [find, replace] = split('--replace', pair, 'FIND=REPL');
    s.findReplace.push({ find, replace, regex: v.regex === true, matchCase: v['match-case'] === true });
  }
  if (v.case !== undefined) s.cleanup.caseMode = choice('--case', v.case, CASES);
  if (v['spaces-to-underscores']) s.cleanup.spacesToUnderscores = true;
  if (v.ascii) s.cleanup.asciiOnly = true;
  if (v['strip-accents']) s.cleanup.stripDiacritics = true;
  for (const pair of v.ext ?? []) {
    const [from, to] = split('--ext', pair, 'FROM=TO');
    s.cleanup.extensionRules.push({ from: normalizeExtension(from), to: normalizeExtension(to) });
  }
  if (v.dest !== undefined) s.move.destinationRoot = path.resolve(cwd, v.dest);
  if (v.shift !== undefined) s.dates.shiftMinutes = integer('--shift', v.shift, -1_000_000, 1_000_000);
  if (v['use-name-date']) s.dates.useNameDate = true;
  if (v['set-modified']) s.dates.setModified = true;
  if (v['set-created']) s.dates.setCreated = true;
  if (v.recursive) s.filter.includeSubfolders = true;
  if (v['only-ext'] !== undefined) {
    const extensions = v['only-ext'].split(',').map(normalizeExtension).filter((e) => e !== '');
    if (extensions.length === 0) throw new UsageError('--only-ext needs at least one extension');
    s.filter.extensions = extensions;
  }
  if (v.folders) s.filter.mode = 'folders';
  if (v.name !== undefined) s.filter.name = { text: v.name, regex: false };
}

function split(flag: string, value: string, shape: string): [string, string] {
  const i = value.indexOf('=');
  if (i <= 0) throw new UsageError(`${flag} needs ${shape}, got "${value}"`);
  return [value.slice(0, i), value.slice(i + 1)];
}

function integer(flag: string, value: string, min: number, max: number): number {
  const n = Number(value);
  if (!/^[+-]?\d+$/.test(value.trim()) || n < min || n > max) {
    throw new UsageError(`${flag} needs a whole number from ${min} to ${max}, got "${value}"`);
  }
  return n;
}

function choice<T extends string>(flag: string, value: string, options: readonly T[]): T {
  const match = options.find((o) => o === value);
  if (match === undefined) throw new UsageError(`${flag} must be one of ${options.join(', ')}; got "${value}"`);
  return match;
}
