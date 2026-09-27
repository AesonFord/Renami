import { describe, expect, it } from 'vitest';
import { assignSequence, sortGroups } from '../../src/core/sequencer.js';
import { buildGroups } from '../../src/core/groups.js';
import type { FileEntry, FileMetadata } from '../../src/core/types.js';
import { makeEntry, makeMeta, wc } from './helpers.js';

const metas = new Map<string, FileMetadata>();
const getMeta = (e: FileEntry) => metas.get(e.path) ?? makeMeta();

const a = makeEntry('/p/IMG_10.jpg');
const b = makeEntry('/p/IMG_2.jpg');
const c = makeEntry('/q/IMG_1.jpg');
metas.set(a.path, makeMeta({ dateTaken: wc(2024, 7, 4, 10), modified: wc(2024, 7, 1, 9) }));
metas.set(b.path, makeMeta({ dateTaken: wc(2024, 7, 4, 10), modified: wc(2024, 7, 3, 9) }));
metas.set(c.path, makeMeta({ created: wc(2024, 7, 3, 9), modified: wc(2024, 7, 2, 9) })); // no date taken: falls back to created

const groups = buildGroups([a, b, c], getMeta, true);

describe('sortGroups', () => {
  it('sorts by date taken with fallbacks, breaking ties by natural path order', () => {
    expect(sortGroups(groups, getMeta, 'dateTaken').map((g) => g.primary.path))
      .toEqual(['/q/IMG_1.jpg', '/p/IMG_2.jpg', '/p/IMG_10.jpg']);
  });
  it('sorts by name naturally', () => {
    expect(sortGroups(groups, getMeta, 'name').map((g) => g.primary.path))
      .toEqual(['/q/IMG_1.jpg', '/p/IMG_2.jpg', '/p/IMG_10.jpg']);
  });
  it('sorts by modified date', () => {
    expect(sortGroups(groups, getMeta, 'modified').map((g) => g.primary.path))
      .toEqual(['/p/IMG_10.jpg', '/q/IMG_1.jpg', '/p/IMG_2.jpg']);
  });
});

describe('assignSequence', () => {
  const sorted = sortGroups(groups, getMeta, 'dateTaken');
  it('numbers continuously from the start value', () => {
    const seq = assignSequence(sorted, { start: 5, restartPerFolder: false });
    expect(sorted.map((g) => seq.get(g.id))).toEqual([5, 6, 7]);
  });
  it('restarts in each source folder', () => {
    const seq = assignSequence(sorted, { start: 1, restartPerFolder: true });
    expect(sorted.map((g) => seq.get(g.id))).toEqual([1, 1, 2]);
  });
});

describe('sortGroups: direction and manual order', () => {
  it('reverses the whole order, ties included, for desc', () => {
    const asc = sortGroups(groups, getMeta, 'dateTaken', 'asc').map((g) => g.primary.path);
    const desc = sortGroups(groups, getMeta, 'dateTaken', 'desc').map((g) => g.primary.path);
    expect(desc).toEqual([...asc].reverse());
    expect(sortGroups(groups, getMeta, 'name', 'desc').map((g) => g.primary.path))
      .toEqual(['/p/IMG_10.jpg', '/p/IMG_2.jpg', '/q/IMG_1.jpg']);
  });
  it('follows the manual list and appends the rest in natural order', () => {
    expect(sortGroups(groups, getMeta, 'manual', 'asc', ['/p/IMG_10.jpg']).map((g) => g.primary.path))
      .toEqual(['/p/IMG_10.jpg', '/p/IMG_2.jpg', '/q/IMG_1.jpg']);
    expect(sortGroups(groups, getMeta, 'manual', 'asc', ['/p/IMG_2.jpg', '/p/IMG_10.jpg', '/q/IMG_1.jpg']).map((g) => g.primary.path))
      .toEqual(['/p/IMG_2.jpg', '/p/IMG_10.jpg', '/q/IMG_1.jpg']);
  });
  it('ranks a same-name group by any member the list names', () => {
    const nef = makeEntry('/p/DSC_1.NEF');
    const jpg = makeEntry('/p/DSC_1.JPG');
    const other = makeEntry('/p/A.jpg');
    const gs = buildGroups([nef, jpg, other], getMeta, true);
    expect(sortGroups(gs, getMeta, 'manual', 'asc', ['/p/DSC_1.JPG', '/p/A.jpg']).map((g) => g.primary.path))
      .toEqual(['/p/DSC_1.NEF', '/p/A.jpg']);
  });
});

describe('assignSequence: step and restarts', () => {
  const sorted = sortGroups(groups, getMeta, 'dateTaken');
  const dateOf = (g: ReturnType<typeof buildGroups>[number]) =>
    metas.get(g.primary.path)?.dateTaken ?? metas.get(g.primary.path)?.created ?? null;
  it('counts in steps', () => {
    const seq = assignSequence(sorted, { start: 10, step: 5, restartPerFolder: false });
    expect(sorted.map((g) => seq.get(g.id))).toEqual([10, 15, 20]);
  });
  it('restarts each day using the date the caller supplies', () => {
    // /q/IMG_1 is 2024-07-03 (created), the two /p files are 2024-07-04.
    const seq = assignSequence(sorted, { start: 1, restartPerFolder: false, restartEvery: 'day' }, dateOf);
    expect(sorted.map((g) => seq.get(g.id))).toEqual([1, 1, 2]);
  });
  it('does not restart within the same month or year', () => {
    expect([...assignSequence(sorted, { start: 1, restartPerFolder: false, restartEvery: 'month' }, dateOf).values()]).toEqual([1, 2, 3]);
    expect([...assignSequence(sorted, { start: 1, restartPerFolder: false, restartEvery: 'year' }, dateOf).values()]).toEqual([1, 2, 3]);
  });
  it('combines folder and day restarts', () => {
    const seq = assignSequence(sorted, { start: 1, restartPerFolder: true, restartEvery: 'day' }, dateOf);
    expect(sorted.map((g) => seq.get(g.id))).toEqual([1, 1, 2]);
  });
  it('ignores restartEvery when no date is supplied', () => {
    const seq = assignSequence(sorted, { start: 1, restartPerFolder: false, restartEvery: 'day' });
    expect(sorted.map((g) => seq.get(g.id))).toEqual([1, 2, 3]);
  });
});
