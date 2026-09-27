import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fsMetadata } from '../../src/core/dates.js';
import type { BirthtimeSetter } from '../../src/core/executor/birthtime.js';
import { executePlan } from '../../src/core/executor/execute.js';
import { createFsView } from '../../src/core/fsview.js';
import { History } from '../../src/core/history.js';
import { buildPlan } from '../../src/core/planner.js';
import { scan } from '../../src/core/scanner.js';
import {
  DEFAULT_SETTINGS,
  type BatchRecord,
  type FileMetadata,
  type Platform,
  type RenameSettings,
} from '../../src/core/types.js';
import { systemTimeZone } from '../../src/core/wallclock.js';
import { wc } from './helpers.js';

// Pass-through hooks on the two filesystem calls the undo pre-checks lean on. A test sets one
// to answer a call itself (a rejection, a stubbed answer, a side effect); otherwise the real
// call runs. Every other test in this file sees the real filesystem.
const hooks = vi.hoisted(() => ({
  stat: undefined as ((p: string) => Promise<never> | undefined) | undefined,
  exists: undefined as ((p: string) => Promise<boolean> | undefined) | undefined,
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const stat = ((p: Parameters<typeof actual.stat>[0], opts?: never) =>
    (typeof p === 'string' && hooks.stat?.(p)) || actual.stat(p, opts)) as typeof actual.stat;
  return { ...actual, stat };
});
vi.mock('../../src/core/executor/moves.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/executor/moves.js')>();
  const exists: typeof actual.exists = (p) => hooks.exists?.(p) ?? actual.exists(p);
  return { ...actual, exists };
});

let root = '';
let history = new History();
const birthtime: BirthtimeSetter = { supported: false, async set() {} };
const TAKEN = wc(2024, 7, 4, 14, 30);

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'renami-history-'));
  for (const name of ['a.txt', 'b.txt']) writeFileSync(path.join(root, name), name);
  history = new History();
});
afterEach(() => {
  hooks.stat = undefined;
  hooks.exists = undefined;
  rmSync(root, { recursive: true, force: true });
});

async function runBatch(
  scanRoot: string,
  patch: Partial<RenameSettings>,
  metas: Record<string, Partial<FileMetadata>> = {},
  setter: BirthtimeSetter = birthtime,
) {
  const { entries } = await scan([scanRoot], { includeSubfolders: false, extensions: null });
  const tz = systemTimeZone();
  const metadata = new Map(entries.map((e) => [e.path, { ...fsMetadata(e, tz), ...metas[path.basename(e.path)] }]));
  const settings = { ...DEFAULT_SETTINGS, ...patch, sequence: { ...DEFAULT_SETTINGS.sequence, sortBy: 'name' as const } };
  const plan = buildPlan({ entries, metadata, settings, fs: createFsView(), platform: process.platform as Platform });
  const result = await executePlan(plan, { birthtime: setter });
  if (result.status !== 'done') throw new Error(`batch did not finish: ${JSON.stringify(result)}`);
  history.push(result.record);
  return result.record;
}

describe('History', () => {
  it('has nothing to undo at first', async () => {
    expect(history.canUndo()).toBe(false);
    expect((await history.undo({ birthtime })).status).toBe('nothing-to-undo');
  });

  it('puts renamed files back and pops the batch', async () => {
    await runBatch(root, { pattern: 'Trip_{seq:2}' });
    const result = await history.undo({ birthtime });
    expect(result).toMatchObject({ status: 'done', restored: 2, skipped: [] });
    expect(readdirSync(root).sort()).toEqual(['a.txt', 'b.txt']);
    expect(history.canUndo()).toBe(false);
  });

  it('walks back through several batches in order', async () => {
    await runBatch(root, { pattern: 'One_{seq:1}' });
    await runBatch(root, { pattern: 'Two_{seq:1}' });
    expect(history.size).toBe(2);
    await history.undo({ birthtime });
    expect(readdirSync(root).sort()).toEqual(['One_1.txt', 'One_2.txt']);
    await history.undo({ birthtime });
    expect(readdirSync(root).sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('moves files back and removes the folders the batch created', async () => {
    await runBatch(root, { pattern: '{date_taken:YYYY}/{date_taken:MM}/{name}' }, {
      'a.txt': { dateTaken: TAKEN }, 'b.txt': { dateTaken: TAKEN },
    });
    expect(existsSync(path.join(root, '2024', '07', 'a.txt'))).toBe(true);
    await history.undo({ birthtime });
    expect(readdirSync(root).sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('recreates an original folder that was removed after the batch', async () => {
    const sub = path.join(root, 'sub');
    mkdirSync(sub);
    writeFileSync(path.join(sub, 'c.txt'), 'c');
    await runBatch(sub, { pattern: '{name}', move: { destinationRoot: path.join(root, 'out') } });
    rmdirSync(sub);
    await history.undo({ birthtime });
    expect(existsSync(path.join(sub, 'c.txt'))).toBe(true);
  });

  it('skips files changed since the batch and restores the rest', async () => {
    await runBatch(root, { pattern: 'Trip_{seq:2}' });
    writeFileSync(path.join(root, 'Trip_01.txt'), 'edited after renaming');
    const result = await history.undo({ birthtime });
    expect(result.status).toBe('done');
    expect(result.restored).toBe(1);
    expect(result.skipped).toEqual([{ path: path.join(root, 'Trip_01.txt'), reason: 'Changed since the rename' }]);
    expect(readdirSync(root).sort()).toEqual(['Trip_01.txt', 'b.txt']);
  });

  it('skips a file whose original name is now taken', async () => {
    await runBatch(root, { pattern: 'Trip_{seq:2}' });
    writeFileSync(path.join(root, 'a.txt'), 'a newcomer');
    const result = await history.undo({ birthtime });
    expect(result.skipped.map((s) => s.reason)).toEqual(['Its original name is taken by another file']);
    expect(readdirSync(root).sort()).toEqual(['Trip_01.txt', 'a.txt', 'b.txt']);
  });

  it('restores the original modified date', async () => {
    const before = statSync(path.join(root, 'a.txt')).mtimeMs;
    await runBatch(root, { pattern: '{name}', dates: { ...DEFAULT_SETTINGS.dates, setModified: true } }, { 'a.txt': { dateTaken: TAKEN } });
    expect(statSync(path.join(root, 'a.txt')).mtimeMs).not.toBe(before);
    await history.undo({ birthtime });
    // utimes works in whole milliseconds; the original may have had a fraction.
    expect(Math.abs(statSync(path.join(root, 'a.txt')).mtimeMs - before)).toBeLessThan(1);
  });

  it('skips a rename chain when an original name is taken, without failing', async () => {
    const aPath = path.join(root, 'a.txt');
    const bPath = path.join(root, 'b.txt');
    const cPath = path.join(root, 'c.txt');
    writeFileSync(bPath, 'was a');
    writeFileSync(cPath, 'was b');
    const bStat = statSync(bPath);
    const cStat = statSync(cPath);
    history.push({
      id: 'chain',
      files: [
        { from: aPath, to: bPath, sizeAfter: bStat.size, mtimeMsAfter: bStat.mtimeMs, originalTimes: null },
        { from: bPath, to: cPath, sizeAfter: cStat.size, mtimeMsAfter: cStat.mtimeMs, originalTimes: null },
      ],
      createdDirs: [],
      finishedAt: 0,
    });
    writeFileSync(aPath, 'newcomer'); // a.txt taken again after the batch

    const result = await history.undo({ birthtime });

    expect(result.status).toBe('done');
    expect(result.restored).toBe(0);
    expect(result.skipped).toHaveLength(2);
    expect(readFileSync(aPath, 'utf8')).toBe('newcomer');
    expect(readFileSync(bPath, 'utf8')).toBe('was a');
    expect(readFileSync(cPath, 'utf8')).toBe('was b');
  });

  it('undoes a swap', async () => {
    const aPath = path.join(root, 'a.txt');
    const bPath = path.join(root, 'b.txt');
    writeFileSync(aPath, 'was b');
    writeFileSync(bPath, 'was a');
    const aStat = statSync(aPath);
    const bStat = statSync(bPath);
    history.push({
      id: 'swap',
      files: [
        { from: aPath, to: bPath, sizeAfter: bStat.size, mtimeMsAfter: bStat.mtimeMs, originalTimes: null },
        { from: bPath, to: aPath, sizeAfter: aStat.size, mtimeMsAfter: aStat.mtimeMs, originalTimes: null },
      ],
      createdDirs: [],
      finishedAt: 0,
    });

    const result = await history.undo({ birthtime });

    expect(result).toMatchObject({ status: 'done', restored: 2 });
    expect(readFileSync(aPath, 'utf8')).toBe('was a');
    expect(readFileSync(bPath, 'utf8')).toBe('was b');
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'keeps the batch and the files when undo fails',
    async () => {
      await runBatch(root, { pattern: 'Trip_{seq:2}' });
      chmodSync(root, 0o555);
      try {
        const result = await history.undo({ birthtime });
        expect(result.status).toBe('failed');
        expect(history.size).toBe(1);
        expect(readdirSync(root).sort()).toEqual(['Trip_01.txt', 'Trip_02.txt']);
      } finally {
        chmodSync(root, 0o755);
      }

      const result = await history.undo({ birthtime });
      expect(result.status).toBe('done');
      expect(readdirSync(root).sort()).toEqual(['a.txt', 'b.txt']);
    },
  );

  it('cancels before changing anything', async () => {
    await runBatch(
      root,
      { pattern: '{name}', dates: { ...DEFAULT_SETTINGS.dates, setModified: true } },
      { 'a.txt': { dateTaken: TAKEN } },
    );
    const mtimeAfterBatch = statSync(path.join(root, 'a.txt')).mtimeMs;
    const controller = new AbortController();
    controller.abort();

    const result = await history.undo({ birthtime, signal: controller.signal });

    expect(result.status).toBe('cancelled');
    expect(history.size).toBe(1);
    expect(statSync(path.join(root, 'a.txt')).mtimeMs).toBe(mtimeAfterBatch);
  });

  it('does not collide with a leftover temp file from an earlier failed undo', async () => {
    const record = await runBatch(root, { pattern: 'Trip_{seq:2}' });
    // A previous undo of this same batch used a deterministic temp name and was interrupted
    // (crash, killed process) before cleanup, leaving this file behind.
    const leftover = path.join(root, `.renami-undo-${record.id}-0.tmp`);
    writeFileSync(leftover, 'leftover from a previous failed undo attempt');

    const result = await history.undo({ birthtime });

    expect(result.status).toBe('done');
    expect(existsSync(leftover)).toBe(true);
    expect(readdirSync(root).sort()).toEqual([path.basename(leftover), 'a.txt', 'b.txt']);
  });

  it('refuses a second undo while one is running', async () => {
    await runBatch(root, { pattern: 'Trip_{seq:2}' });

    const first = history.undo({ birthtime });
    const second = await history.undo({ birthtime });

    expect(second.status).toBe('failed');
    expect(second.error).toBe('An undo is already running');

    const firstResult = await first;
    expect(firstResult.status).toBe('done');
  });
});

describe('History edge cases', () => {
  it('skips a file that is no longer where the rename put it, and restores the rest', async () => {
    await runBatch(root, { pattern: 'Trip_{seq:2}' });
    rmSync(path.join(root, 'Trip_01.txt'));
    const result = await history.undo({ birthtime });
    expect(result.status).toBe('done');
    expect(result.restored).toBe(1);
    expect(result.skipped).toEqual([{ path: path.join(root, 'Trip_01.txt'), reason: 'No longer at its new location' }]);
    expect(readdirSync(root).sort()).toEqual(['b.txt']);
    expect(history.canUndo()).toBe(false);
  });

  it('skips a file whose new path now runs through a plain file', async () => {
    await runBatch(root, { pattern: 'out/{name}' });
    // The folder the batch made is replaced by a file of the same name, so its files can't be looked up.
    rmSync(path.join(root, 'out'), { recursive: true });
    writeFileSync(path.join(root, 'out'), 'not a folder');
    const result = await history.undo({ birthtime });
    expect(result.status).toBe('done');
    expect(result.restored).toBe(0);
    expect(result.skipped.map((s) => s.reason)).toEqual(['No longer at its new location', 'No longer at its new location']);
  });

  it('leaves a folder the batch created when something else is in it now', async () => {
    await runBatch(root, { pattern: '{date_taken:YYYY}/{date_taken:MM}/{name}' }, {
      'a.txt': { dateTaken: TAKEN }, 'b.txt': { dateTaken: TAKEN },
    });
    const month = path.join(root, '2024', '07');
    writeFileSync(path.join(month, 'newcomer.txt'), 'x');
    const result = await history.undo({ birthtime });
    expect(result.status).toBe('done');
    expect(existsSync(path.join(root, 'a.txt'))).toBe(true);
    expect(readdirSync(month)).toEqual(['newcomer.txt']);
  });

  it('fails with a complete rollback when a file cannot be moved back', async () => {
    const sub = path.join(root, 'sub');
    mkdirSync(sub);
    writeFileSync(path.join(sub, 'c.txt'), 'c');
    await runBatch(sub, { pattern: '{name}', move: { destinationRoot: path.join(root, 'out') } });
    // The original folder is now a plain file, so nothing can be put inside it.
    rmdirSync(sub);
    writeFileSync(sub, 'in the way');
    const result = await history.undo({ birthtime });
    expect(result.status).toBe('failed');
    // The rename's own error, in Node's errno form: ENOTDIR on macOS and Linux, EINVAL on Windows.
    expect(result.error).toMatch(/^E[A-Z]+: .*rename/);
    expect(result.rollback).toEqual({ complete: true, stranded: [] });
    expect(existsSync(path.join(root, 'out', 'c.txt'))).toBe(true);
    // The batch stays on the stack for another try.
    expect(history.canUndo()).toBe(true);
  });

  const mac = process.platform === 'darwin';
  it.skipIf(!mac)('puts the created date back through the setter when restoring the modified date moved it', async () => {
    const calls: { path: string; timeMs: number }[][] = [];
    const recording: BirthtimeSetter = {
      supported: true,
      async set(items) {
        calls.push(items.map((it) => ({ ...it })));
      },
    };
    const file = path.join(root, 'a.txt');
    const originalCreated = statSync(file).birthtimeMs;
    await runBatch(root, { pattern: '{name}', dates: { ...DEFAULT_SETTINGS.dates, setModified: true } }, { 'a.txt': { dateTaken: TAKEN } }, recording);
    // macOS drags the created date along when the modified date moves earlier.
    expect(statSync(file).birthtimeMs).toBeLessThan(originalCreated);
    calls.length = 0;

    const result = await history.undo({ birthtime: recording });
    expect(result.status).toBe('done');
    const restored = calls.flat().find((c) => c.path === file);
    expect(restored).toBeDefined();
    expect(Math.abs(restored!.timeMs - originalCreated)).toBeLessThan(1);
  });

  it('cancels a date-only undo before touching anything when the signal is already aborted', async () => {
    await runBatch(root, { pattern: '{name}', dates: { ...DEFAULT_SETTINGS.dates, setModified: true } }, { 'a.txt': { dateTaken: TAKEN } });
    const changed = statSync(path.join(root, 'a.txt')).mtimeMs;
    const controller = new AbortController();
    controller.abort();
    const result = await history.undo({ birthtime, signal: controller.signal });
    expect(result.status).toBe('cancelled');
    expect(result.rollback).toEqual({ complete: true, stranded: [] });
    expect(statSync(path.join(root, 'a.txt')).mtimeMs).toBe(changed);
    expect(history.canUndo()).toBe(true);
  });
});

describe('History defensive branches', () => {
  const a = () => path.join(root, 'a.txt');
  const dated = () =>
    runBatch(root, { pattern: '{name}', dates: { ...DEFAULT_SETTINGS.dates, setModified: true } }, {
      'a.txt': { dateTaken: TAKEN }, 'b.txt': { dateTaken: TAKEN },
    });
  /** Runs `effect` on the nth stat of `target`, letting the real stat answer. */
  const onStat = (target: string, nth: number, effect: () => Promise<never> | undefined) => {
    let seen = 0;
    hooks.stat = (p) => {
      if (p !== target) return undefined;
      seen += 1;
      return seen === nth ? effect() : undefined;
    };
  };

  it('walks up to the filesystem root when no ancestor of the original path can be found', async () => {
    await runBatch(root, { pattern: 'Trip_{seq:2}' });
    // Nothing exists as far as the undo can tell, not even the temp folder or /, so the
    // drive check climbs until the path stops changing.
    hooks.exists = async () => false;
    const result = await history.undo({ birthtime });
    expect(result).toMatchObject({ status: 'done', restored: 2, skipped: [] });
    expect(readdirSync(root).sort()).toEqual(['a.txt', 'b.txt']);
  });

  const unprivileged = process.platform !== 'win32' && process.getuid?.() !== 0;
  it.skipIf(!unprivileged)('skips a file it is not allowed to check, saying why', async () => {
    const sub = path.join(root, 'sub');
    mkdirSync(sub);
    writeFileSync(path.join(sub, 'c.txt'), 'c');
    await runBatch(sub, { pattern: 'Renamed_{name}' });
    chmodSync(sub, 0o000);
    let result;
    try {
      result = await history.undo({ birthtime });
    } finally {
      chmodSync(sub, 0o755);
    }
    expect(result.status).toBe('done');
    expect(result.restored).toBe(0);
    expect(result.skipped).toEqual([{ path: path.join(sub, 'Renamed_c.txt'), reason: expect.stringMatching(/^Couldn't check it: .*EACCES/) }]);
    expect(readdirSync(sub)).toEqual(['Renamed_c.txt']);
  });

  it('words a check failure that is not an Error object', async () => {
    await runBatch(root, { pattern: 'Trip_{seq:2}' });
    const renamed = path.join(root, 'Trip_01.txt');
    onStat(renamed, 1, () => Promise.reject('stat exploded'));
    const result = await history.undo({ birthtime });
    expect(result.status).toBe('done');
    expect(result.skipped).toEqual([{ path: renamed, reason: "Couldn't check it: stat exploded" }]);
    expect(readdirSync(root).sort()).toEqual(['Trip_01.txt', 'b.txt']);
  });

  it('fails before moving anything when a pre-check throws an Error', async () => {
    await runBatch(root, { pattern: 'Trip_{seq:2}' });
    hooks.exists = (p) => (p === a() ? Promise.reject(new Error('lstat blew up')) : undefined);
    const result = await history.undo({ birthtime });
    expect(result).toEqual({ status: 'failed', restored: 0, skipped: [], error: 'lstat blew up', rollback: { complete: true, stranded: [] } });
    expect(readdirSync(root).sort()).toEqual(['Trip_01.txt', 'Trip_02.txt']);
    expect(history.canUndo()).toBe(true);
  });

  it('fails before moving anything when a pre-check throws something that is not an Error', async () => {
    await runBatch(root, { pattern: 'Trip_{seq:2}' });
    hooks.exists = (p) => (p === a() ? Promise.reject('no lstat for you') : undefined);
    const result = await history.undo({ birthtime });
    expect(result).toMatchObject({ status: 'failed', error: 'no lstat for you' });
    expect(readdirSync(root).sort()).toEqual(['Trip_01.txt', 'Trip_02.txt']);
  });

  it('cancels between files while restoring dates, rolling back the dates already restored', async () => {
    await dated();
    const changed = statSync(a()).mtimeMs;
    const controller = new AbortController();
    // The pre-check stats a.txt once; the second stat is the undo reading its times before
    // restoring them, so the cancel lands between the first file and the second.
    onStat(a(), 2, () => {
      controller.abort();
      return undefined;
    });
    const result = await history.undo({ birthtime, signal: controller.signal });
    expect(result.status).toBe('cancelled');
    expect(result.rollback).toEqual({ complete: true, stranded: [] });
    expect(Math.abs(statSync(a()).mtimeMs - changed)).toBeLessThan(1);
    expect(history.canUndo()).toBe(true);
  });

  it('reports a failure while restoring dates whose cause is not an Error object', async () => {
    await dated();
    onStat(a(), 2, () => Promise.reject('times exploded'));
    const result = await history.undo({ birthtime });
    expect(result).toMatchObject({ status: 'failed', error: 'times exploded', rollback: { complete: true, stranded: [] } });
    expect(history.canUndo()).toBe(true);
  });

  it('finishes cleanly when its batch has left the stack while it ran', async () => {
    await dated();
    // Nothing public removes a record mid-undo (a second undo is refused), so the guard on the
    // final pop is reached only by clearing the stack from underneath it.
    onStat(a(), 2, () => {
      (history as unknown as { stack: BatchRecord[] }).stack.length = 0;
      return undefined;
    });
    const result = await history.undo({ birthtime });
    expect(result).toMatchObject({ status: 'done', restored: 2 });
    expect(history.canUndo()).toBe(false);
  });
});

describe('History with dates already in place', () => {
  it('uses the created-date setter for this OS when none is given', async () => {
    await runBatch(root, { pattern: 'Trip_{seq:2}' });
    // A plain rename has no dates to restore, so the setter is picked but never called.
    const result = await history.undo();
    expect(result).toMatchObject({ status: 'done', restored: 2 });
    expect(readdirSync(root).sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('leaves the modified and created dates alone when the batch did not actually move them', async () => {
    const calls: unknown[] = [];
    const recording: BirthtimeSetter = {
      supported: true,
      async set(items) {
        calls.push(items);
      },
    };
    const file = path.join(root, 'a.txt');
    // TAKEN is 2024-07-04 14:30 local time; a whole second, so the batch writes the same value back.
    const already = new Date(2024, 6, 4, 14, 30, 0);
    utimesSync(file, already, already);
    const created = statSync(file).birthtimeMs;
    await runBatch(root, { pattern: '{name}', dates: { ...DEFAULT_SETTINGS.dates, setModified: true } }, { 'a.txt': { dateTaken: TAKEN } }, recording);
    expect(statSync(file).mtimeMs).toBe(already.getTime());
    expect(statSync(file).birthtimeMs).toBe(created);
    calls.length = 0;

    const result = await history.undo({ birthtime: recording });
    expect(result).toMatchObject({ status: 'done' });
    expect(statSync(file).mtimeMs).toBe(already.getTime());
    expect(calls).toEqual([]);
  });
});
