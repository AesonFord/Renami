import { randomUUID } from 'node:crypto';
import { rmdir, stat, utimes } from 'node:fs/promises';
import path from 'node:path';
import { createBirthtimeSetter, type BirthtimeItem, type BirthtimeSetter } from './executor/birthtime.js';
import { makeTimesRestorer, timesOf } from './executor/execute.js';
import {
  CancelledError,
  exists,
  rollback,
  runMoves,
  type JournalStep,
  type MoveContext,
  type MoveOp,
} from './executor/moves.js';
import { nameKey } from './names.js';
import type { BatchFileRecord, BatchRecord, Platform, UndoResult } from './types.js';

export interface UndoOptions {
  birthtime?: BirthtimeSetter;
  signal?: AbortSignal;
}

async function crossesDrive(from: string, to: string): Promise<boolean> {
  const source = await stat(from);
  let dir = path.dirname(to);
  while (!(await exists(dir))) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return (await stat(dir)).dev !== source.dev;
}

/** The session's undo stack. Lost when the app quits. */
export class History {
  private readonly stack: BatchRecord[] = [];
  private running = false;

  push(record: BatchRecord): void {
    this.stack.push(record);
  }

  canUndo(): boolean {
    return this.stack.length > 0;
  }

  peek(): BatchRecord | undefined {
    return this.stack[this.stack.length - 1];
  }

  get size(): number {
    return this.stack.length;
  }

  async undo(opts: UndoOptions = {}): Promise<UndoResult> {
    if (this.running) {
      return { status: 'failed', restored: 0, skipped: [], error: 'An undo is already running', rollback: null };
    }
    this.running = true;
    try {
      const record = this.peek();
      if (!record) return { status: 'nothing-to-undo', restored: 0, skipped: [], error: null, rollback: null };

      const birthtime = opts.birthtime ?? createBirthtimeSetter(process.platform as Platform);
      const restoreTimes = makeTimesRestorer(birthtime);
      const skipped: UndoResult['skipped'] = [];
      let restorable: BatchFileRecord[];
      let ops: MoveOp[];

      // Pre-checks: nothing here has moved anything yet, so any unexpected error resolves to
      // a failed batch rather than rejecting the promise.
      try {
        const unchanged: BatchFileRecord[] = [];
        for (const f of record.files) {
          try {
            const st = await stat(f.to);
            if (st.size !== f.sizeAfter || st.mtimeMs !== f.mtimeMsAfter) {
              skipped.push({ path: f.to, reason: 'Changed since the rename' });
              continue;
            }
          } catch (e) {
            const code = (e as NodeJS.ErrnoException).code;
            const reason =
              code === 'ENOENT' || code === 'ENOTDIR'
                ? 'No longer at its new location'
                : `Couldn't check it: ${e instanceof Error ? e.message : String(e)}`;
            skipped.push({ path: f.to, reason });
            continue;
          }
          unchanged.push(f);
        }

        // A file skipped for one reason can free up the name another file needs, and vice
        // versa, so repeat the name-taken filter until a pass changes nothing.
        restorable = unchanged;
        for (;;) {
          const leaving = new Set(restorable.filter((f) => f.from !== f.to).map((f) => nameKey(f.to)));
          const kept: BatchFileRecord[] = [];
          for (const f of restorable) {
            if (f.from !== f.to && (await exists(f.from)) && !leaving.has(nameKey(f.from))) {
              skipped.push({ path: f.to, reason: 'Its original name is taken by another file' });
            } else {
              kept.push(f);
            }
          }
          if (kept.length === restorable.length) break;
          restorable = kept;
        }

        ops = [];
        for (const f of restorable) {
          if (f.from !== f.to) ops.push({ from: f.to, to: f.from, crossDrive: await crossesDrive(f.to, f.from) });
        }
      } catch (e) {
        return {
          status: 'failed',
          restored: 0,
          skipped,
          error: e instanceof Error ? e.message : String(e),
          rollback: { complete: true, stranded: [] },
        };
      }

      const journal: JournalStep[] = [];
      // A random suffix keeps this run's temp names from colliding with leftovers an earlier,
      // interrupted undo of this same record may have left behind (same deterministic id).
      const ctx: MoveContext = { batchId: `undo-${record.id}-${randomUUID().slice(0, 8)}`, journal, createdDirs: [] };
      if (opts.signal) ctx.signal = opts.signal;

      try {
        // Checked up front too, so an already-aborted signal on a date-only batch (no moves
        // at all) still cancels instead of silently completing.
        if (opts.signal?.aborted) throw new CancelledError();
        await runMoves(ops, ctx);

        // Modified times first, then created dates in one batched call (one process instead
        // of one per file), mirroring executePlan.
        const created: BirthtimeItem[] = [];
        for (const f of restorable) {
          if (!f.originalTimes) continue;
          if (opts.signal?.aborted) throw new CancelledError();
          const now = await timesOf(f.from);
          journal.push({ type: 'times', path: f.from, before: now });
          if (Math.abs(now.mtimeMs - f.originalTimes.mtimeMs) >= 1) {
            await utimes(f.from, f.originalTimes.atimeMs / 1000, f.originalTimes.mtimeMs / 1000);
          }
          const wanted = f.originalTimes.birthtimeMs;
          if (wanted !== null && birthtime.supported) {
            const after = await timesOf(f.from);
            if (after.birthtimeMs === null || Math.abs(after.birthtimeMs - wanted) >= 1) {
              created.push({ path: f.from, timeMs: wanted });
            }
          }
        }
        if (created.length > 0) await birthtime.set(created, opts.signal);
      } catch (e) {
        const report = await rollback(journal, restoreTimes);
        if (e instanceof CancelledError) {
          return { status: 'cancelled', restored: 0, skipped, error: null, rollback: report };
        }
        return { status: 'failed', restored: 0, skipped, error: e instanceof Error ? e.message : String(e), rollback: report };
      }

      // Deepest first; rmdir refuses non-empty folders, which is what we want.
      for (const dir of [...record.createdDirs].sort((a, b) => b.length - a.length)) {
        await rmdir(dir).catch(() => undefined);
      }
      const i = this.stack.lastIndexOf(record);
      if (i !== -1) this.stack.splice(i, 1);
      return { status: 'done', restored: restorable.length, skipped, error: null, rollback: null };
    } finally {
      this.running = false;
    }
  }
}
