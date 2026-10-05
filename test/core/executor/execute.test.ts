import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fsMetadata } from '../../../src/core/dates.js';
import { createBirthtimeSetter, type BirthtimeSetter } from '../../../src/core/executor/birthtime.js';
import { executePlan, makeTimesRestorer, timesOf } from '../../../src/core/executor/execute.js';
import { createFsView } from '../../../src/core/fsview.js';
import { buildPlan } from '../../../src/core/planner.js';
import { scan } from '../../../src/core/scanner.js';
import { DEFAULT_SETTINGS, type FileMetadata, type Platform, type RenameSettings } from '../../../src/core/types.js';
import { systemTimeZone, wallClockToLocalDate } from '../../../src/core/wallclock.js';
import { wc } from '../helpers.js';

let root = '';
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'renami-exec-'));
  for (const name of ['b.txt', 'a.txt', 'c.txt']) writeFileSync(path.join(root, name), name);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const TAKEN = wc(2024, 7, 4, 14, 30);

/**
 * Tests about created dates plan as if on macOS, where the planner sets them, so they behave the same
 * on every CI runner. The Linux planner sets no created dates (it can't), and the executor under test
 * uses the fake setter either way.
 */
const CREATED_DATES_PLATFORM: Platform = 'darwin';

async function planFor(
  patch: Partial<RenameSettings>,
  metas: Record<string, Partial<FileMetadata>> = {},
  platform = process.platform as Platform,
) {
  const { entries } = await scan([root], { includeSubfolders: false, extensions: null });
  const tz = systemTimeZone();
  const metadata = new Map(entries.map((e) => [e.path, { ...fsMetadata(e, tz), ...metas[path.basename(e.path)] }]));
  const settings = { ...DEFAULT_SETTINGS, ...patch, sequence: { ...DEFAULT_SETTINGS.sequence, sortBy: 'name' as const } };
  return buildPlan({ entries, metadata, settings, fs: createFsView(), platform });
}

const fakeBirthtime = (): BirthtimeSetter & { calls: { path: string; timeMs: number }[]; batches: number } => {
  const calls: { path: string; timeMs: number }[] = [];
  const setter = {
    supported: true as const,
    calls,
    batches: 0,
    async set(items: readonly { path: string; timeMs: number }[]) {
      setter.batches += 1;
      calls.push(...items);
    },
  };
  return setter;
};

describe('executePlan', () => {
  it('renames according to the plan and returns an undo record', async () => {
    const plan = await planFor({ pattern: 'Trip_{seq:2}' });
    const progress: [number, number][] = [];
    const result = await executePlan(plan, { onProgress: (d, t) => progress.push([d, t]), batchId: 't1' });
    expect(result.status).toBe('done');
    expect(readdirSync(root).sort()).toEqual(['Trip_01.txt', 'Trip_02.txt', 'Trip_03.txt']);
    if (result.status !== 'done') return;
    expect(result.record.id).toBe('t1');
    expect(result.record.files.map((f) => [path.basename(f.from), path.basename(f.to)])).toEqual([
      ['a.txt', 'Trip_01.txt'], ['b.txt', 'Trip_02.txt'], ['c.txt', 'Trip_03.txt'],
    ]);
    expect(result.record.files[0]?.originalTimes).toBeNull();
    const [done, total] = progress.at(-1) ?? [0, 0];
    expect(total).toBeGreaterThan(0);
    expect(done).toBe(total);
  });

  it('refuses a plan with errors and touches nothing', async () => {
    const plan = await planFor({ pattern: '{nope}' });
    const result = await executePlan(plan);
    expect(result.status).toBe('failed');
    expect(readdirSync(root).sort()).toEqual(['a.txt', 'b.txt', 'c.txt']);
  });

  it('reports a stale plan when a file changed after planning', async () => {
    const plan = await planFor({ pattern: 'Trip_{seq:2}' });
    writeFileSync(path.join(root, 'a.txt'), 'changed and longer');
    const result = await executePlan(plan);
    expect(result).toEqual({ status: 'stale', changed: [path.join(root, 'a.txt')] });
    expect(readdirSync(root).sort()).toEqual(['a.txt', 'b.txt', 'c.txt']);
  });

  it('reports a stale plan when a target appeared after planning', async () => {
    const plan = await planFor({ pattern: 'Trip_{seq:2}' });
    writeFileSync(path.join(root, 'Trip_02.txt'), 'someone else');
    const result = await executePlan(plan);
    expect(result.status).toBe('stale');
  });

  it('fails cleanly when pre-flight cannot check a target', async () => {
    const plan = await planFor({ pattern: 'Trip_{seq:2}' });
    const item = plan.items[0];
    if (!item) throw new Error('expected at least one plan item');
    // A name this long makes lstat() throw ENAMETOOLONG instead of ENOENT, so the
    // pre-flight target check hits an unexpected error rather than "just missing".
    item.target = path.join(root, `${'x'.repeat(300)}.txt`);
    const result = await executePlan(plan);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.rollback).toEqual({ complete: true, stranded: [] });
    expect(readdirSync(root).sort()).toEqual(['a.txt', 'b.txt', 'c.txt']);
  });

  it('sets the modified date and records the original times', async () => {
    const plan = await planFor(
      { pattern: '{name}', dates: { ...DEFAULT_SETTINGS.dates, setModified: true } },
      { 'a.txt': { dateTaken: TAKEN } },
    );
    const result = await executePlan(plan, { birthtime: fakeBirthtime() });
    expect(result.status).toBe('done');
    expect(statSync(path.join(root, 'a.txt')).mtimeMs).toBe(wallClockToLocalDate(TAKEN).getTime());
    if (result.status !== 'done') return;
    expect(result.record.files).toHaveLength(1);
    expect(result.record.files[0]?.from).toBe(result.record.files[0]?.to);
    expect(result.record.files[0]?.originalTimes?.mtimeMs).toBeGreaterThan(wallClockToLocalDate(TAKEN).getTime());
  });

  it('sends created dates to the OS setter in one batch', async () => {
    const setter = fakeBirthtime();
    const plan = await planFor(
      { pattern: '{name}', dates: { ...DEFAULT_SETTINGS.dates, setCreated: true } },
      { 'a.txt': { dateTaken: TAKEN }, 'b.txt': { dateTaken: TAKEN } },
      CREATED_DATES_PLATFORM,
    );
    const result = await executePlan(plan, { birthtime: setter });
    expect(result.status).toBe('done');
    expect(setter.batches).toBe(1);
    expect(setter.calls.map((c) => path.basename(c.path)).sort()).toEqual(['a.txt', 'b.txt']);
    expect(setter.calls[0]?.timeMs).toBe(wallClockToLocalDate(TAKEN).getTime());
  });

  it.skipIf(process.platform !== 'darwin')(
    'restores a created date later than the modified date (macOS)',
    async () => {
      const file = path.join(root, 'restore-order.txt');
      writeFileSync(file, 'x');
      const setter = createBirthtimeSetter('darwin');

      // Set mtime before birthtime: on this filesystem, setting an *earlier* mtime after a
      // *later* birthtime drags the birthtime down to match (confirmed by hand: setting
      // birthtime=2024 then mtime=2020, as the brief's fixture recipe literally reads, leaves
      // birthtime at 2020, not 2024 — the very macOS quirk finding 2 describes, but triggered
      // while building the fixture instead of during restore). Setting birthtime after mtime
      // has no such effect, so this order captures the intended before-state intact.
      const oldMtime = new Date(Date.UTC(2020, 0, 1, 0, 0, 0));
      utimesSync(file, oldMtime, oldMtime);
      const wantBirth = Date.UTC(2024, 6, 4, 12, 0, 0);
      await setter.set([{ path: file, timeMs: wantBirth }]);

      const before = await timesOf(file);

      // Perturb both: mtime moves to now (later than the birthtime), birthtime moves to 2025.
      utimesSync(file, new Date(), new Date());
      await setter.set([{ path: file, timeMs: Date.UTC(2025, 0, 1, 0, 0, 0) }]);

      await makeTimesRestorer(setter)(file, before);

      const after = statSync(file);
      expect(Math.abs(after.birthtimeMs - wantBirth)).toBeLessThan(1000);
      expect(Math.abs(after.mtimeMs - oldMtime.getTime())).toBeLessThan(1);
    },
  );

  it('rolls back renames and dates when the created-date tool fails', async () => {
    let first = true;
    const calls: { path: string; timeMs: number }[] = [];
    const setter: BirthtimeSetter = {
      supported: true,
      async set(items) {
        if (first) {
          first = false;
          throw new Error('tool blocked');
        }
        calls.push(...items);
      },
    };
    const plan = await planFor(
      { pattern: 'Trip_{seq:2}', dates: { ...DEFAULT_SETTINGS.dates, setModified: true, setCreated: true } },
      { 'a.txt': { dateTaken: TAKEN }, 'b.txt': { dateTaken: TAKEN } },
      CREATED_DATES_PLATFORM,
    );
    const before = new Map(
      ['a.txt', 'b.txt'].map((name) => [name, statSync(path.join(root, name)).mtimeMs]),
    );

    const result = await executePlan(plan, { birthtime: setter });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error).toBe('tool blocked');
      expect(result.rollback.datesNotRestored).toBeUndefined();
    }
    expect(readdirSync(root).sort()).toEqual(['a.txt', 'b.txt', 'c.txt']);
    for (const [name, mtimeMs] of before) {
      expect(Math.abs(statSync(path.join(root, name)).mtimeMs - mtimeMs)).toBeLessThan(1);
    }
    // The created-date tool never succeeded, so rollback must not have called it again either.
    expect(calls).toEqual([]);
  });

  it('stops after the created dates when cancelled', async () => {
    const controller = new AbortController();
    const setter: BirthtimeSetter = {
      supported: true,
      async set() {
        controller.abort();
      },
    };
    const plan = await planFor(
      { pattern: 'Trip_{seq:2}', dates: { ...DEFAULT_SETTINGS.dates, setModified: true, setCreated: true } },
      { 'a.txt': { dateTaken: TAKEN } },
      CREATED_DATES_PLATFORM,
    );

    const result = await executePlan(plan, { birthtime: setter, signal: controller.signal });

    expect(result.status).toBe('cancelled');
    expect(readdirSync(root).sort()).toEqual(['a.txt', 'b.txt', 'c.txt']);
  });

  it('rolls back when a step fails part-way through', async () => {
    const plan = await planFor({ pattern: '{date_taken:YYYY}/{name}' }, {
      'a.txt': { dateTaken: TAKEN }, 'b.txt': { dateTaken: TAKEN }, 'c.txt': { dateTaken: TAKEN },
    });
    writeFileSync(path.join(root, '2024'), 'a file where the folder should go');
    const result = await executePlan(plan);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.rollback).toEqual({ complete: true, stranded: [] });
    expect(readdirSync(root).sort()).toEqual(['2024', 'a.txt', 'b.txt', 'c.txt']);
  });

  it('rolls back when cancelled', async () => {
    const plan = await planFor({ pattern: 'Trip_{seq:2}' });
    const controller = new AbortController();
    const result = await executePlan(plan, { signal: controller.signal, onProgress: () => controller.abort() });
    expect(result.status).toBe('cancelled');
    expect(readdirSync(root).sort()).toEqual(['a.txt', 'b.txt', 'c.txt']);
    expect(existsSync(path.join(root, 'Trip_01.txt'))).toBe(false);
  });
});
