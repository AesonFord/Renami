import { randomUUID } from 'node:crypto';
import { stat, utimes } from 'node:fs/promises';
import { nameKey } from '../names.js';
import { hasPlannedDates, isMoving, type BatchFileRecord, type BatchResult, type FileTimes, type Plan, type PlanItem, type Platform, type Progress } from '../types.js';
import { wallClockToLocalDate } from '../wallclock.js';
import { createBirthtimeSetter, type BirthtimeItem, type BirthtimeSetter } from './birthtime.js';
import {
  CancelledError,
  exists,
  rollback,
  runMoves,
  type JournalStep,
  type MoveContext,
  type TimesRestorer,
} from './moves.js';

export interface ExecuteOptions {
  signal?: AbortSignal;
  onProgress?: Progress;
  /** Defaults to the setter for this machine's OS. */
  birthtime?: BirthtimeSetter;
  batchId?: string;
}

export function makeTimesRestorer(birthtime: BirthtimeSetter): TimesRestorer {
  return async (p, before) => {
    const now = await timesOf(p);
    if (Math.abs(now.mtimeMs - before.mtimeMs) >= 1) {
      await utimes(p, before.atimeMs / 1000, before.mtimeMs / 1000);
    }
    // Created date last: on macOS, writing an earlier modified date drags the created date with it.
    if (before.birthtimeMs !== null && birthtime.supported) {
      const after = await timesOf(p);
      if (after.birthtimeMs === null || Math.abs(after.birthtimeMs - before.birthtimeMs) >= 1) {
        await birthtime.set([{ path: p, timeMs: before.birthtimeMs }]);
      }
    }
  };
}

export async function timesOf(p: string): Promise<FileTimes> {
  const st = await stat(p);
  return { atimeMs: st.atimeMs, mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs > 0 ? st.birthtimeMs : null };
}

export async function executePlan(plan: Plan, opts: ExecuteOptions = {}): Promise<BatchResult> {
  const noRollback = { complete: true, stranded: [] };
  if (plan.errorCount > 0 || plan.patternError !== null) {
    return { status: 'failed', error: 'The plan has errors. Fix or exclude those files first.', rollback: noRollback };
  }

  const birthtime = opts.birthtime ?? createBirthtimeSetter(process.platform as Platform);
  const batchId = opts.batchId ?? randomUUID().slice(0, 8);
  const moving = plan.items.filter((i) => isMoving(i.kind));
  const dating = plan.items.filter((i) => hasPlannedDates(i.setDates));
  const touched = new Set([...moving, ...dating]);

  // Pre-flight: nothing may have changed since the plan was built. Nothing has
  // been touched yet, so any unexpected error here (not just a missing/changed file) resolves
  // to a failed batch rather than rejecting the promise.
  const changed: string[] = [];
  try {
    for (const item of touched) {
      try {
        const st = await stat(item.source.path);
        if (st.size !== item.source.size || st.mtimeMs !== item.source.mtimeMs) changed.push(item.source.path);
      } catch {
        changed.push(item.source.path);
      }
    }
    const leaving = new Set(moving.map((i) => nameKey(i.source.path)));
    for (const item of moving) {
      if ((await exists(item.target)) && !leaving.has(nameKey(item.target))) changed.push(item.target);
    }
  } catch (e) {
    return { status: 'failed', error: e instanceof Error ? e.message : String(e), rollback: noRollback };
  }
  if (changed.length > 0) return { status: 'stale', changed };

  const journal: JournalStep[] = [];
  const createdDirs: string[] = [];
  const total = moving.length * 2 + dating.length;
  let done = 0;
  const tick = (): void => {
    done += 1;
    opts.onProgress?.(done, total);
  };
  const ctx: MoveContext = { batchId, journal, createdDirs, onStep: tick };
  if (opts.signal) ctx.signal = opts.signal;
  const originalTimes = new Map<string, FileTimes>();

  try {
    await runMoves(
      moving.map((i) => ({ from: i.source.path, to: i.target, crossDrive: i.kind === 'cross-drive-move' })),
      ctx,
    );

    // Phase 3: record original times, then set created dates, then modified dates.
    const created: BirthtimeItem[] = [];
    for (const item of dating) {
      if (opts.signal?.aborted) throw new CancelledError();
      const before = await timesOf(item.target);
      journal.push({ type: 'times', path: item.target, before });
      originalTimes.set(item.target, before);
      if (item.setDates.created) {
        created.push({ path: item.target, timeMs: wallClockToLocalDate(item.setDates.created).getTime() });
      }
    }
    if (created.length > 0) await birthtime.set(created, opts.signal);
    for (const item of dating) {
      if (opts.signal?.aborted) throw new CancelledError();
      const before = originalTimes.get(item.target);
      if (item.setDates.modified && before) {
        await utimes(item.target, before.atimeMs / 1000, wallClockToLocalDate(item.setDates.modified));
      }
      tick();
    }

    const files: BatchFileRecord[] = [];
    for (const item of plan.items) {
      if (!touched.has(item)) continue;
      const st = await stat(item.target);
      files.push({
        from: item.source.path,
        to: item.target,
        sizeAfter: st.size,
        mtimeMsAfter: st.mtimeMs,
        originalTimes: originalTimes.get(item.target) ?? null,
      });
    }
    return { status: 'done', record: { id: batchId, files, createdDirs, finishedAt: Date.now() } };
  } catch (e) {
    const report = await rollback(journal, makeTimesRestorer(birthtime));
    if (e instanceof CancelledError) return { status: 'cancelled', error: null, rollback: report };
    return { status: 'failed', error: e instanceof Error ? e.message : String(e), rollback: report };
  }
}
