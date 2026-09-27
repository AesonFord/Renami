import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, rename, rmdir, stat, unlink, utimes } from 'node:fs/promises';
import path from 'node:path';
import type { FileTimes, RollbackReport } from '../types.js';

export interface MoveOp {
  from: string;
  to: string;
  crossDrive: boolean;
}

export type JournalStep =
  | { type: 'rename'; from: string; to: string }
  | { type: 'mkdir'; dir: string }
  | { type: 'copy'; to: string }
  | { type: 'delete-after-copy'; source: string; copy: string }
  | { type: 'times'; path: string; before: FileTimes };

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}

export interface MoveContext {
  batchId: string;
  /** Every completed step, appended in order. */
  journal: JournalStep[];
  /** Folders created by this run, in creation order. */
  createdDirs: string[];
  signal?: AbortSignal;
  /** Called after each completed file step (two per op). */
  onStep?: () => void;
}

export type TimesRestorer = (path: string, before: FileTimes) => Promise<void>;

export async function exists(p: string): Promise<boolean> {
  try {
    await lstat(p);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    throw e;
  }
}

export const tempName = (batchId: string, index: number, suffix = 'tmp'): string =>
  `.renami-${batchId}-${index}.${suffix}`;

function checkCancelled(ctx: MoveContext): void {
  if (ctx.signal?.aborted) throw new CancelledError();
}

async function ensureDir(dir: string, ctx: MoveContext, ensured: Set<string>): Promise<void> {
  if (ensured.has(dir)) return;
  const missing: string[] = [];
  let current = dir;
  while (!(await exists(current))) {
    missing.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const d of missing.reverse()) {
    await mkdir(d);
    ctx.journal.push({ type: 'mkdir', dir: d });
    ctx.createdDirs.push(d);
  }
  ensured.add(dir);
}

async function copyAcross(source: string, target: string, staging: string, ctx: MoveContext): Promise<void> {
  const st = await stat(source);
  await copyFile(source, staging, constants.COPYFILE_EXCL);
  ctx.journal.push({ type: 'copy', to: staging });
  await utimes(staging, st.atime, st.mtime);
  if ((await stat(staging)).size !== st.size) throw new Error(`Copy of ${source} is incomplete`);
  if (await exists(target)) throw new Error(`Target already exists: ${target}`);
  await rename(staging, target);
  ctx.journal.push({ type: 'rename', from: staging, to: target });
  await unlink(source);
  ctx.journal.push({ type: 'delete-after-copy', source, copy: target });
}

/** Moves the files in two phases. Throws on failure or cancel; the caller rolls back with ctx.journal. */
export async function runMoves(ops: readonly MoveOp[], ctx: MoveContext): Promise<void> {
  const temps: string[] = [];
  // Phase 2 only moves temps out of their folders, so a target folder, once there, stays.
  const ensured = new Set<string>();

  for (const [i, op] of ops.entries()) {
    checkCancelled(ctx);
    const tmp = path.join(path.dirname(op.from), tempName(ctx.batchId, i));
    if (await exists(tmp)) throw new Error(`Temporary name already exists: ${tmp}`);
    await rename(op.from, tmp);
    ctx.journal.push({ type: 'rename', from: op.from, to: tmp });
    temps.push(tmp);
    ctx.onStep?.();
  }

  for (const [i, op] of ops.entries()) {
    checkCancelled(ctx);
    const tmp = temps[i];
    if (tmp === undefined) throw new Error('internal: missing temp name');
    await ensureDir(path.dirname(op.to), ctx, ensured);
    if (await exists(op.to)) throw new Error(`Target already exists: ${op.to}`);
    if (op.crossDrive) {
      await copyAcross(tmp, op.to, path.join(path.dirname(op.to), tempName(ctx.batchId, i, 'copy')), ctx);
    } else {
      await rename(tmp, op.to);
      ctx.journal.push({ type: 'rename', from: tmp, to: op.to });
    }
    ctx.onStep?.();
  }
}

/** Search backwards through earlier journal steps only, so it always terminates. */
function originOf(index: number, p: string, journal: readonly JournalStep[]): string {
  let current = p;
  for (let i = index - 1; i >= 0; i -= 1) {
    const step = journal[i];
    if (step?.type === 'rename' && step.to === current) current = step.from;
  }
  return current;
}

/** Undoes journal steps in reverse. Never throws; reports what it couldn't restore. */
export async function rollback(journal: readonly JournalStep[], restoreTimes: TimesRestorer): Promise<RollbackReport> {
  const stranded: RollbackReport['stranded'] = [];
  const datesNotRestored: string[] = [];
  const dead = new Set<string>();

  for (let i = journal.length - 1; i >= 0; i -= 1) {
    const step = journal[i];
    if (!step) continue;
    try {
      switch (step.type) {
        case 'rename':
          if (dead.has(step.to)) {
            dead.add(step.from);
            break; // skip this step, the file is already lost
          }
          if ((await exists(step.from)) || !(await exists(step.to))) throw new Error('cannot restore');
          await rename(step.to, step.from);
          break;
        case 'mkdir':
          await rmdir(step.dir).catch(() => undefined); // leave it if something else is inside
          break;
        case 'copy':
          if (!dead.has(step.to)) {
            await unlink(step.to).catch(() => undefined);
          }
          break;
        case 'delete-after-copy': {
          if (dead.has(step.copy)) {
            dead.add(step.source);
            break; // skip, can't restore the source
          }
          await copyFile(step.copy, step.source, constants.COPYFILE_EXCL);
          const st = await stat(step.copy);
          await utimes(step.source, st.atime, st.mtime);
          // Content is back, but it came from a *copy*: the restored file's created date is
          // the copy's, not the original's, so this is honestly reported as not fully restored.
          datesNotRestored.push(originOf(i, step.source, journal));
          break;
        }
        case 'times':
          await restoreTimes(step.path, step.before);
          break;
      }
    } catch {
      if (step.type === 'rename') {
        stranded.push({ original: originOf(i, step.from, journal), current: step.to });
        dead.add(step.from);
      } else if (step.type === 'delete-after-copy') {
        stranded.push({ original: originOf(i, step.source, journal), current: step.copy });
        dead.add(step.copy);
        dead.add(step.source);
      } else if (step.type === 'times') {
        datesNotRestored.push(step.path);
      }
    }
  }

  const result: RollbackReport = {
    complete: stranded.length === 0 && datesNotRestored.length === 0,
    stranded,
  };
  if (datesNotRestored.length > 0) result.datesNotRestored = datesNotRestored;
  return result;
}
