import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CancelledError,
  rollback,
  runMoves,
  type JournalStep,
  type MoveContext,
  type MoveOp,
} from '../../../src/core/executor/moves.js';

let root = '';
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'renami-moves-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const at = (...p: string[]) => path.join(root, ...p);
const put = (name: string, content = name) => writeFileSync(at(name), content);
const read = (...p: string[]) => readFileSync(at(...p), 'utf8');
const ctx = (extra: Partial<MoveContext> = {}): MoveContext => ({ batchId: 'b1', journal: [], createdDirs: [], ...extra });
const op = (from: string, to: string, crossDrive = false): MoveOp => ({ from: at(from), to: at(to), crossDrive });
const noTimes = async () => {};
const leftovers = () => readdirSync(root).filter((n) => n.startsWith('.renami-'));

describe('runMoves', () => {
  it('renames in place and leaves no temp files', async () => {
    put('a.txt');
    await runMoves([op('a.txt', 'b.txt')], ctx());
    expect(read('b.txt')).toBe('a.txt');
    expect(existsSync(at('a.txt'))).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it('swaps two files and rotates a cycle of three', async () => {
    put('a.txt'); put('b.txt'); put('c.txt');
    await runMoves([op('a.txt', 'b.txt'), op('b.txt', 'a.txt')], ctx());
    expect([read('a.txt'), read('b.txt')]).toEqual(['b.txt', 'a.txt']);
    await runMoves([op('a.txt', 'b.txt'), op('b.txt', 'c.txt'), op('c.txt', 'a.txt')], ctx({ batchId: 'b2' }));
    expect([read('a.txt'), read('b.txt'), read('c.txt')]).toEqual(['c.txt', 'b.txt', 'a.txt']);
  });

  it('changes only the case of a name', async () => {
    put('img.txt');
    await runMoves([op('img.txt', 'IMG.txt')], ctx());
    expect(readdirSync(root)).toEqual(['IMG.txt']);
  });

  it('creates missing folders and records them in order', async () => {
    put('a.txt');
    const c = ctx();
    await runMoves([op('a.txt', path.join('2024', '07', 'a.txt'))], c);
    expect(read('2024', '07', 'a.txt')).toBe('a.txt');
    expect(c.createdDirs).toEqual([at('2024'), at('2024', '07')]);
  });

  it('copies across drives, keeping the modified time', async () => {
    put('a.txt');
    const old = new Date('2024-07-04T14:30:00Z');
    utimesSync(at('a.txt'), old, old);
    const c = ctx();
    await runMoves([op('a.txt', path.join('other', 'a.txt'), true)], c);
    expect(read('other', 'a.txt')).toBe('a.txt');
    expect(existsSync(at('a.txt'))).toBe(false);
    expect(Math.abs(statSync(at('other', 'a.txt')).mtimeMs - old.getTime())).toBeLessThan(1000);
    expect(c.journal.map((s) => s.type)).toEqual(['rename', 'mkdir', 'copy', 'rename', 'delete-after-copy']);
  });

  it('never overwrites a file that is not part of the batch', async () => {
    put('a.txt'); put('taken.txt', 'keep me');
    const c = ctx();
    await expect(runMoves([op('a.txt', 'taken.txt')], c)).rejects.toThrow(/Target already exists/);
    expect(read('taken.txt')).toBe('keep me');
    await rollback(c.journal, noTimes);
    expect(read('a.txt')).toBe('a.txt');
  });
});

describe('rollback', () => {
  it('restores everything after a failure part-way through', async () => {
    put('a.txt'); put('b.txt'); put('blocker.txt');
    const c = ctx();
    const ops = [op('a.txt', path.join('new', 'a.txt')), op('b.txt', path.join('blocker.txt', 'sub', 'b.txt'))];
    await expect(runMoves(ops, c)).rejects.toThrow();
    const report = await rollback(c.journal, noTimes);
    expect(report).toEqual({ complete: true, stranded: [] });
    expect(readdirSync(root).sort()).toEqual(['a.txt', 'b.txt', 'blocker.txt']);
  });

  it('restores a cross-drive move', async () => {
    put('a.txt');
    const c = ctx();
    await runMoves([op('a.txt', path.join('other', 'a.txt'), true)], c);
    const report = await rollback(c.journal, noTimes);
    // Content is restored, but the copy back onto this drive got a new created date, so the
    // rollback is honestly reported as incomplete rather than claiming success.
    expect(read('a.txt')).toBe('a.txt');
    expect(report.stranded).toEqual([]);
    expect(report.datesNotRestored).toEqual([at('a.txt')]);
    expect(report.complete).toBe(false);
    expect(readdirSync(root)).toEqual(['a.txt']);
  });

  it('stops and rolls back when cancelled', async () => {
    put('a.txt'); put('b.txt');
    const controller = new AbortController();
    const c = ctx({ signal: controller.signal, onStep: () => controller.abort() });
    await expect(runMoves([op('a.txt', 'x.txt'), op('b.txt', 'y.txt')], c)).rejects.toBeInstanceOf(CancelledError);
    const report = await rollback(c.journal, noTimes);
    expect(report.complete).toBe(true);
    expect(readdirSync(root).sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('reports files it cannot put back, by their original path', async () => {
    put('a.txt');
    mkdirSync(at('d'));
    const journal: JournalStep[] = [
      { type: 'rename', from: at('a.txt'), to: at('.renami-b1-0.tmp') },
      { type: 'rename', from: at('.renami-b1-0.tmp'), to: at('d', 'gone.txt') },
    ];
    // Simulate: the file was renamed away, then removed by someone else.
    rmSync(at('a.txt'));
    const report = await rollback(journal, noTimes);
    expect(report.complete).toBe(false);
    expect(report.stranded).toEqual([{ original: at('a.txt'), current: at('d', 'gone.txt') }]);
  });

  it('calls the times restorer for time steps', async () => {
    put('a.txt');
    const seen: string[] = [];
    await rollback([{ type: 'times', path: at('a.txt'), before: { atimeMs: 1, mtimeMs: 2, birthtimeMs: null } }], async (p) => {
      seen.push(p);
    });
    expect(seen).toEqual([at('a.txt')]);
  });

  it('keeps the only copy when a cross-drive move cannot be undone', async () => {
    put('photo.jpg');
    put('b.txt');
    put('blocker.txt');
    const c = ctx();
    const ops = [op('photo.jpg', path.join('dst', 'photo.jpg'), true), op('b.txt', path.join('blocker.txt', 'sub', 'b.txt'))];
    await expect(runMoves(ops, c)).rejects.toThrow();
    // Before rollback, create a decoy at the phase-1 temp path so restoring the source fails
    const tempPath = at('.renami-b1-0.tmp');
    put('.renami-b1-0.tmp', 'decoy');
    const report = await rollback(c.journal, noTimes);
    expect(report.complete).toBe(false);
    expect(report.stranded).toEqual([{ original: at('photo.jpg'), current: at('dst', 'photo.jpg') }]);
    expect(read('dst', 'photo.jpg')).toBe('photo.jpg'); // content survives where reported
    expect(read('b.txt')).toBe('b.txt'); // b.txt is restored
  });

  it('finishes and reports honestly when undoing a swap partly fails', async () => {
    put('a.txt');
    put('b.txt');
    put('c.txt');
    put('blocker.txt');
    const c = ctx();
    const ops = [op('a.txt', 'b.txt'), op('b.txt', 'a.txt'), op('c.txt', path.join('blocker.txt', 'x', 'c.txt'))];
    await expect(runMoves(ops, c)).rejects.toThrow();
    // Before rollback, create a decoy at phase-2 temp name of op 1 so reversing t1->a fails
    put('.renami-b1-1.tmp', 'decoy');
    const report = await rollback(c.journal, noTimes);
    expect(report.complete).toBe(false);
    expect(report.stranded).toEqual(expect.arrayContaining([
      { original: at('b.txt'), current: at('a.txt') },
      { original: at('a.txt'), current: at('.renami-b1-0.tmp') },
    ]));
    expect(report.stranded).toHaveLength(2);
    expect(read('a.txt')).toBe('b.txt');
    expect(read('.renami-b1-0.tmp')).toBe('a.txt');
  });

  it('reports dates it could not restore', async () => {
    put('a.txt');
    const report = await rollback([{ type: 'times', path: at('a.txt'), before: { atimeMs: 1, mtimeMs: 2, birthtimeMs: null } }], async () => {
      throw new Error('locked');
    });
    expect(report).toEqual({ complete: false, stranded: [], datesNotRestored: [at('a.txt')] });
  });
});
