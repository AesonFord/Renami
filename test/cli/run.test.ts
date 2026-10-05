import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MetadataReader, type ExifToolLike, type Platform } from '../../src/core/index.js';
import { parseCommand, type Command } from '../../src/cli/args.js';
import { EXIT } from '../../src/cli/exit.js';
import type { LaunchDeps } from '../../src/cli/launch.js';
import { runCommand, type RunContext } from '../../src/cli/run.js';

const PATTERN = 'Hawaii_{date_taken:YYYY-MM-DD}_{seq:3}';
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tempDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'renami-cli-'));
  dirs.push(d);
  return d;
}
function mediaDir(): string {
  const dir = tempDir();
  for (const name of ['photo.jpg', 'clip.mp4', 'nodate.jpg']) copyFileSync(path.join('test/fixtures/media', name), path.join(dir, name));
  return dir;
}

function capture() {
  let text = '';
  return {
    write(s: string) {
      text += s;
      return true;
    },
    get text() {
      return text;
    },
  };
}

const launch = (opens: boolean): LaunchDeps => ({
  platform: 'linux',
  env: {},
  exists: async () => opens,
  installLocation: async () => null,
  start: async () => opens,
  run: async () => (opens ? 0 : 1),
});

function context(cwd: string, extra: Partial<RunContext> & { exiftool?: ExifToolLike } = {}) {
  const stdout = capture();
  const stderr = capture();
  let readersEnded = 0;
  let readersMade = 0;
  const { exiftool, ...rest } = extra;
  const ctx: RunContext = {
    stdout,
    stderr,
    signal: new AbortController().signal,
    cwd,
    platform: process.platform as Platform,
    version: '9.9.9',
    createReader: () => {
      readersMade += 1;
      const reader = new MetadataReader({ timeZone: 'Pacific/Honolulu', ...(exiftool ? { exiftool } : {}) });
      const end = reader.end.bind(reader);
      reader.end = async () => {
        readersEnded += 1;
        await end();
      };
      return reader;
    },
    launch: launch(false),
    timeZone: 'Pacific/Honolulu',
    ...rest,
  };
  return { ctx, stdout, stderr, ended: () => readersEnded, made: () => readersMade };
}

async function run(argv: string[], cwd: string, extra: Partial<RunContext> & { exiftool?: ExifToolLike } = {}) {
  const command: Command = await parseCommand(argv, cwd);
  const c = context(cwd, extra);
  const code = await runCommand(command, c.ctx);
  return { code, stdout: c.stdout.text, stderr: c.stderr.text, ended: c.ended(), made: c.made() };
}

describe('renami rename', () => {
  it('prints the plan and changes nothing without --apply', async () => {
    const dir = mediaDir();
    const r = await run(['rename', '.', '-p', PATTERN], dir);
    expect(r.code).toBe(EXIT.ok);
    expect(r.stdout).toContain('photo.jpg -> Hawaii_2024-07-04_001.jpg');
    expect(r.stdout).toContain('3 to rename');
    expect(readdirSync(dir).sort()).toEqual(['clip.mp4', 'nodate.jpg', 'photo.jpg']);
    expect(r.ended).toBe(r.made);
  });

  it('renames with --apply, writes a journal, and undo puts everything back once', async () => {
    const dir = mediaDir();
    const r = await run(['rename', '.', '-p', PATTERN, '--apply', '--journal', 'undo.json'], dir);
    expect(r.code).toBe(EXIT.ok);
    expect(r.stdout).toContain('Renamed 3 files.');
    expect(r.stdout).toContain('Undo with: renami undo "undo.json"');
    expect(readdirSync(dir).filter((n) => n.startsWith('Hawaii_'))).toHaveLength(3);

    const undo = await run(['undo', 'undo.json'], dir);
    expect(undo.code).toBe(EXIT.ok);
    expect(undo.stdout).toBe('Put back 3 files.\n');
    expect(readdirSync(dir).sort()).toEqual(['clip.mp4', 'nodate.jpg', 'photo.jpg', 'undo.json.undone']);

    const again = await run(['undo', 'undo.json'], dir);
    expect(again.code).toBe(EXIT.usage);
    expect(again.stderr).toContain('was already undone');
  });

  it('prints one JSON object with --json, including the result after --apply', async () => {
    const dir = mediaDir();
    const dry = await run(['rename', '.', '-p', PATTERN, '--json'], dir);
    const plan = JSON.parse(dry.stdout);
    expect(plan.plan).toHaveLength(3);
    expect(plan.summary.toRename).toBe(3);
    expect(plan.plan[0].dateUsed.value).toMatch(/^2024-07-04T/);

    const applied = JSON.parse((await run(['rename', '.', '-p', PATTERN, '--json', '--apply'], dir)).stdout);
    expect(applied.result).toMatchObject({ status: 'done', renamed: 3, journal: null });
  });

  it('exits 2 for an invalid pattern', async () => {
    const r = await run(['rename', mediaDir(), '-p', '{nope}'], tempDir());
    expect(r.code).toBe(EXIT.patternError);
    expect(r.stderr).toMatch(/^renami: .*nope/m);
  });

  it('exits 3 and renames nothing when files have errors, even with --apply', async () => {
    const dir = mediaDir();
    const r = await run(['rename', '.', '-p', 'a'.repeat(300), '--apply'], dir);
    expect(r.code).toBe(EXIT.planErrors);
    expect(r.stderr).toContain("3 files can't be renamed; nothing was renamed");
    expect(readdirSync(dir).sort()).toEqual(['clip.mp4', 'nodate.jpg', 'photo.jpg']);
  });

  it('exits 4 when a file changes between the plan and the rename', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'a.txt'), 'a');
    writeFileSync(path.join(dir, 'b.txt'), 'b');
    let touched = false;
    const exiftool = {
      // Runs after the scan recorded each file's size: growing b.txt now makes the plan stale.
      readRaw: async () => {
        if (!touched) {
          touched = true;
          appendFileSync(path.join(dir, 'b.txt'), 'more');
        }
        return {};
      },
      end: async () => {},
      version: async () => '12.0',
    } as unknown as ExifToolLike;
    const r = await run(['rename', '.', '-p', '{name}_x', '--apply'], dir, { exiftool });
    expect(r.code).toBe(EXIT.stale);
    expect(r.stderr).toContain('b.txt');
    expect(r.stderr).toMatch(/^renami: Nothing was renamed/m);
    for (const line of r.stderr.split('\n').filter(Boolean)) expect(line).toMatch(/^(renami: | {2})/);
    expect(readdirSync(dir).sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('hashes files when the pattern asks for it', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'a.txt'), 'abc');
    const r = await run(['rename', '.', '-p', '{crc32}'], dir);
    expect(r.stdout).toContain('a.txt -> 352441c2.txt');
  });

  // Review focus 1
  it('exits 1 for a path that does not exist, instead of finding nothing', async () => {
    const dir = tempDir();
    const r = await run(['rename', 'Phtos'], dir);
    expect(r.code).toBe(EXIT.usage);
    expect(r.stderr).toBe(`renami: no such file or folder: ${path.join(dir, 'Phtos')}\n`);
  });

  // Review focus 2
  it('refuses a journal that already exists or whose folder is missing, before renaming', async () => {
    const dir = mediaDir();
    writeFileSync(path.join(dir, 'taken.json'), '{}');
    const taken = await run(['rename', '.', '-p', PATTERN, '--only-ext', 'jpg,mp4', '--apply', '--journal', 'taken.json'], dir);
    expect(taken.code).toBe(EXIT.usage);
    expect(taken.stderr).toContain('already exists');
    const missing = await run(['rename', '.', '-p', PATTERN, '--only-ext', 'jpg,mp4', '--apply', '--journal', 'no/undo.json'], dir);
    expect(missing.code).toBe(EXIT.usage);
    expect(missing.stderr).toContain("doesn't exist");
    expect(readdirSync(dir).filter((n) => n.startsWith('Hawaii_'))).toEqual([]);
  });

  // Review focus 4
  it('says there is nothing to rename for an empty folder, and writes no journal', async () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, 'empty'));
    const dry = await run(['rename', 'empty'], dir);
    expect(dry.code).toBe(EXIT.ok);
    expect(dry.stdout).toBe('Nothing to rename: no files matched.\n');
    const applied = await run(['rename', 'empty', '--apply', '--journal', 'undo.json'], dir);
    expect(applied.code).toBe(EXIT.ok);
    expect(applied.stderr).toContain('nothing changed, so no journal was written');
    expect(existsSync(path.join(dir, 'undo.json'))).toBe(false);
  });

  // Review focus 5
  it('exits 5 without touching files when cancelled, and still ends the reader', async () => {
    const dir = mediaDir();
    const controller = new AbortController();
    controller.abort();
    const r = await run(['rename', '.', '-p', PATTERN, '--apply'], dir, { signal: controller.signal });
    expect(r.code).toBe(EXIT.failed);
    expect(r.stderr).toContain('cancelled; nothing was renamed');
    for (const line of r.stderr.split('\n').filter(Boolean)) expect(line).toMatch(/^(renami: | {2})/);
    expect(readdirSync(dir).sort()).toEqual(['clip.mp4', 'nodate.jpg', 'photo.jpg']);
    expect(r.made).toBe(1);
    expect(r.ended).toBe(1);
  });

  it('prints only errors with --quiet', async () => {
    const r = await run(['rename', mediaDir(), '-p', PATTERN, '-q'], tempDir());
    expect(r.code).toBe(EXIT.ok);
    expect(r.stdout).toBe('');
  });
});

describe('renami undo', () => {
  it('exits 6 and lists the files it skipped', async () => {
    const dir = mediaDir();
    await run(['rename', '.', '-p', PATTERN, '--apply', '--journal', 'undo.json'], dir);
    appendFileSync(path.join(dir, 'Hawaii_2024-07-04_001.jpg'), 'edited');
    const r = await run(['undo', 'undo.json'], dir);
    expect(r.code).toBe(EXIT.undoSkipped);
    expect(r.stderr).toContain('renami: skipped Hawaii_2024-07-04_001.jpg: Changed since the rename');
    expect(readdirSync(dir)).toContain('clip.mp4');
    expect(existsSync(path.join(dir, 'undo.json.undone'))).toBe(true);
  });

  it('exits 1 for a missing or invalid journal', async () => {
    const dir = tempDir();
    expect((await run(['undo', 'none.json'], dir)).stderr).toContain('no such journal');
    writeFileSync(path.join(dir, 'bad.json'), '{}');
    const bad = await run(['undo', 'bad.json'], dir);
    expect(bad.code).toBe(EXIT.usage);
    expect(bad.stderr).toContain('is not a renami journal');
  });
});

describe('other commands', () => {
  it('prints help, the version and the tokens without starting ExifTool', async () => {
    const dir = tempDir();
    const help = await run([], dir);
    expect(help.stdout).toContain('Usage:');
    expect((await run(['--version'], dir)).stdout).toBe('9.9.9\n');
    const tokens = await run(['tokens'], dir);
    expect(tokens.stdout).toContain('{date_taken}');
    expect(tokens.made).toBe(0);
  });

  it('opens the desktop app, or exits 7 when it is not installed', async () => {
    const dir = tempDir();
    expect((await run(['a.jpg'], dir, { launch: launch(true) })).code).toBe(EXIT.ok);
    const missing = await run(['a.jpg'], dir, { launch: launch(false) });
    expect(missing.code).toBe(EXIT.appNotFound);
    expect(missing.stderr).toContain('Renami desktop app not found');
  });
});
