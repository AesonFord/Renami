import { describe, expect, it } from 'vitest';
import { editableStem, moveBefore, moveBy, moveStep } from '../../src/renderer/lib/rows.js';
import { row } from './fixtures.js';

describe('editableStem', () => {
  it('takes the planned stem, not a guess from the current name', () => {
    expect(editableStem(row({ currentName: 'IMG_1.jpg', newName: 'Trip_001.jpg', stem: 'Trip_001' }))).toBe('Trip_001');
    expect(editableStem(row({ currentName: 'IMG_1.jpg', newName: '2024/07/Trip_001.jpg', stem: 'Trip_001' }))).toBe('Trip_001');
    expect(editableStem(row({ currentName: 'IMG_1.JPG', newName: 'Trip_001.jpg', stem: 'Trip_001' }))).toBe('Trip_001');
    expect(editableStem(row({ currentName: 'README', newName: 'notes', stem: 'notes', ext: '' }))).toBe('notes');
  });
  it('falls back to the current name for error rows and keeps names without an extension', () => {
    expect(editableStem(row({ currentName: 'IMG_1.jpg', newName: '', kind: 'error' }))).toBe('IMG_1');
    expect(editableStem(row({ currentName: 'README', newName: '', kind: 'error' }))).toBe('README');
  });
  // I1: a folder's dotted name isn't an extension, so it must never be stripped, whether the
  // planned stem repeats the whole name (unchanged) or the row fell back to the current name.
  it('never strips part of a folder name as if it were an extension', () => {
    expect(
      editableStem(row({ currentName: 'Trip.2024', newName: 'Trip.2024', kind: 'unchanged', isDir: true, stem: 'Trip.2024', ext: '' })),
    ).toBe('Trip.2024');
    expect(editableStem(row({ currentName: 'Trip.2024', newName: '', kind: 'error', isDir: true, ext: '' }))).toBe('Trip.2024');
  });
  // I1: an extension rule (jpeg -> jpg) changes the extension the planner used, so the stripped
  // extension must come from the row, not be re-derived from the file's original name.
  it('uses the row for its own extension when a rule changed it, not the current name', () => {
    expect(editableStem(row({ currentName: 'IMG.jpeg', newName: 'IMG.jpg', stem: 'IMG', ext: 'jpg' }))).toBe('IMG');
  });
});

describe('moveBefore', () => {
  it('drops before a later target or after an earlier one', () => {
    expect(moveBefore(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(moveBefore(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
    expect(moveBefore(['a', 'b'], 'a', 'a')).toEqual(['a', 'b']);
  });
});

describe('moveBy', () => {
  it('moves one step and stops at the ends', () => {
    expect(moveBy(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveBy(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveBy(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveBy(['a', 'b', 'c'], 'x', 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('moveStep', () => {
  it('matches moveBy when every row is visible', () => {
    expect(moveStep(['a', 'b', 'c'], ['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveStep(['a', 'b', 'c'], ['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveStep(['a', 'b', 'c'], ['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
  });
  // I4: with a filter hiding some rows, a step must move `from` past its nearest *visible*
  // neighbour without disturbing any hidden row's position in the full order.
  it('steps past the nearest visible neighbour, leaving hidden rows in place', () => {
    // b is hidden ("needs a look" off); moving d up should only swap it with c, its visible
    // neighbour, not with b.
    const full = ['a', 'b', 'c', 'd'];
    const visible = ['a', 'c', 'd'];
    expect(moveStep(full, visible, 'd', -1)).toEqual(['a', 'b', 'd', 'c']);
  });
  it('does nothing when from is already at that end of the visible order', () => {
    const full = ['a', 'b', 'c'];
    const visible = ['a', 'c'];
    expect(moveStep(full, visible, 'a', -1)).toEqual(full);
  });
  it('leaves full unchanged when from is not in visible', () => {
    expect(moveStep(['a', 'b', 'c'], ['b', 'c'], 'a', 1)).toEqual(['a', 'b', 'c']);
  });
});
