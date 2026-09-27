import { describe, expect, it } from 'vitest';
import { overridesFrom, parseNameList, stemFor } from '../../src/renderer/lib/importNames.js';

const current = ['IMG_1.jpg', 'IMG_2.jpg', 'IMG_3.jpg'];
const rows = current.map((name) => ({ path: `/p/${name}`, currentName: name, ext: 'jpg', isDir: false }));

describe('parseNameList', () => {
  it('reads one name per line, ignoring blank lines and a BOM', () => {
    expect(parseNameList('﻿beach\n\nsunset  \r\n', current)).toEqual({ kind: 'list', names: ['beach', 'sunset'] });
  });
  it('reads tab-separated pairs and drops a header', () => {
    expect(parseNameList('Current name\tNew name\nIMG_1.jpg\tbeach\nIMG_3.jpg\tsunset\n', current)).toEqual({
      kind: 'pairs',
      pairs: [['IMG_1.jpg', 'beach'], ['IMG_3.jpg', 'sunset']],
    });
  });
  it('reads comma-separated pairs when the first column names current files, with quotes', () => {
    expect(parseNameList('img_2.jpg,"day, one"\nIMG_1.jpg,beach', current)).toEqual({
      kind: 'pairs',
      pairs: [['img_2.jpg', 'day, one'], ['IMG_1.jpg', 'beach']],
    });
  });
  it('treats comma lines as plain names when the first column is not a current file', () => {
    expect(parseNameList('Trip, day 1\n"Trip, day 2"', current)).toEqual({ kind: 'list', names: ['Trip, day 1', 'Trip, day 2'] });
  });
});

describe('stemFor', () => {
  it('strips the row extension when the new name repeats it, whatever the case', () => {
    expect(stemFor('beach.JPG', 'jpg', false)).toBe('beach');
    expect(stemFor('beach.jpeg', 'jpg', false)).toBe('beach.jpeg');
    expect(stemFor('beach', 'jpg', false)).toBe('beach');
    expect(stemFor('beach', '', false)).toBe('beach');
    expect(stemFor('  beach ', 'jpg', false)).toBe('beach');
  });
  // I1: the row's extension must come from the planner (post extension-rules), not be re-derived
  // from the current name, or an active rule doubles the extension (IMG.jpeg -> IMG.jpg.jpg).
  it('strips the extension the row actually plans to use, not the original one', () => {
    expect(stemFor('IMG.jpg', 'jpg', false)).toBe('IMG');
  });
  // I1: a folder's dotted name is never an extension to strip.
  it('never strips a folder name as if it had an extension', () => {
    expect(stemFor('Trip.2024', '', true)).toBe('Trip.2024');
  });
});

describe('overridesFrom', () => {
  it('applies a list in row order and counts what was left over', () => {
    const r = overridesFrom({ kind: 'list', names: ['beach', 'sunset.jpg', 'extra', 'more'] }, rows);
    expect(r).toEqual({ overrides: { '/p/IMG_1.jpg': 'beach', '/p/IMG_2.jpg': 'sunset', '/p/IMG_3.jpg': 'extra' }, matched: 3, unmatched: 1 });
  });
  it('matches pairs by current name, ignoring case, and skips unknown or empty ones', () => {
    const r = overridesFrom({ kind: 'pairs', pairs: [['img_3.jpg', 'sunset'], ['nope.jpg', 'x'], ['IMG_1.jpg', '   ']] }, rows);
    expect(r).toEqual({ overrides: { '/p/IMG_3.jpg': 'sunset' }, matched: 1, unmatched: 2 });
  });
});
