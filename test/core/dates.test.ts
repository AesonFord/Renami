import { describe, expect, it } from 'vitest';
import { effectiveMetadata, fallbackMessage, fsMetadata, resolveDate, shiftWallClock, sortKeyToDateKind } from '../../src/core/dates.js';
import { makeEntry, makeMeta, wc } from './helpers.js';

const taken = wc(2024, 7, 4, 14, 30);
const created = wc(2024, 7, 10, 8, 0);
const modified = wc(2024, 8, 1, 9, 0);

describe('resolveDate', () => {
  it('uses date taken when present', () => {
    expect(resolveDate(makeMeta({ dateTaken: taken, created, modified }), 'date_taken'))
      .toEqual({ value: taken, source: 'taken', fellBack: false });
  });
  it('falls back date taken → created → modified', () => {
    expect(resolveDate(makeMeta({ created, modified }), 'date_taken'))
      .toEqual({ value: created, source: 'created', fellBack: true });
    expect(resolveDate(makeMeta({ modified }), 'date_taken'))
      .toEqual({ value: modified, source: 'modified', fellBack: true });
  });
  it('falls back created → modified, and never marks modified as a fallback', () => {
    expect(resolveDate(makeMeta({ created, modified }), 'created'))
      .toEqual({ value: created, source: 'created', fellBack: false });
    expect(resolveDate(makeMeta({ modified }), 'created'))
      .toEqual({ value: modified, source: 'modified', fellBack: true });
    expect(resolveDate(makeMeta({ dateTaken: taken, modified }), 'modified'))
      .toEqual({ value: modified, source: 'modified', fellBack: false });
  });
});

describe('fallbackMessage', () => {
  it('names what was missing and what was used', () => {
    expect(fallbackMessage('date_taken', 'created')).toBe('No date taken in this file; used created date');
    expect(fallbackMessage('created', 'modified')).toBe('No created date in this file; used modified date');
  });
});

describe('sortKeyToDateKind', () => {
  it('maps date sort keys and returns null for name', () => {
    expect(sortKeyToDateKind('dateTaken')).toBe('date_taken');
    expect(sortKeyToDateKind('name')).toBeNull();
  });
});

describe('fsMetadata', () => {
  it('converts stat times in the given zone', () => {
    const e = makeEntry('/p/a.jpg', { mtimeMs: Date.UTC(2024, 6, 5, 23, 15, 2), birthtimeMs: Date.UTC(2024, 6, 1, 0, 0, 0) });
    expect(fsMetadata(e, 'UTC')).toEqual({ modified: wc(2024, 7, 5, 23, 15, 2), created: wc(2024, 7, 1) });
  });
  it('leaves created out when the filesystem has no creation time', () => {
    expect(fsMetadata(makeEntry('/p/a.jpg', { birthtimeMs: null }), 'UTC').created).toBeUndefined();
    expect(fsMetadata(makeEntry('/p/a.jpg', { birthtimeMs: 0 }), 'UTC').created).toBeUndefined();
  });
});

describe('dates from the file name', () => {
  it('fsMetadata sets nameDate when the stem holds a date', () => {
    const entry = makeEntry('/p/IMG_20240102_101112.jpg', { mtimeMs: Date.UTC(2024, 7, 1, 9), birthtimeMs: null });
    expect(fsMetadata(entry, 'UTC')).toEqual({ modified: wc(2024, 8, 1, 9), nameDate: wc(2024, 1, 2, 10, 11, 12) });
    expect(fsMetadata(makeEntry('/p/IMG_4821.jpg', { birthtimeMs: null }), 'UTC')).not.toHaveProperty('nameDate');
  });
  it('resolves date taken → name date → created → modified', () => {
    const nameDate = wc(2024, 1, 2, 10, 11, 12);
    expect(resolveDate(makeMeta({ dateTaken: taken, nameDate, created, modified }), 'date_taken'))
      .toEqual({ value: taken, source: 'taken', fellBack: false });
    expect(resolveDate(makeMeta({ nameDate, created, modified }), 'date_taken'))
      .toEqual({ value: nameDate, source: 'name', fellBack: true });
    expect(resolveDate(makeMeta({ nameDate, created, modified }), 'created'))
      .toEqual({ value: created, source: 'created', fellBack: false });
  });
  it('explains a name-date fallback', () => {
    expect(fallbackMessage('date_taken', 'name')).toBe('No date taken in this file; used the date in its name');
  });
});

describe('shiftWallClock', () => {
  it('moves across day and month boundaries and keeps milliseconds', () => {
    expect(shiftWallClock(wc(2024, 7, 31, 23, 30), 60)).toEqual(wc(2024, 8, 1, 0, 30));
    expect(shiftWallClock(wc(2024, 1, 1, 0, 0), -1)).toEqual(wc(2023, 12, 31, 23, 59));
    expect(shiftWallClock({ ...wc(2024, 7, 4, 14, 30), millisecond: 250 }, 90)).toEqual({ ...wc(2024, 7, 4, 16, 0), millisecond: 250 });
  });
});

describe('effectiveMetadata', () => {
  const meta = makeMeta({ dateTaken: taken, nameDate: wc(2024, 1, 2), created, modified });
  it('returns the same object when nothing changes', () => {
    expect(effectiveMetadata(meta, { shiftMinutes: 0, useNameDate: true })).toBe(meta);
  });
  it('drops the name date when it is turned off', () => {
    const out = effectiveMetadata(meta, { shiftMinutes: 0, useNameDate: false });
    expect(out).not.toHaveProperty('nameDate');
    expect(out.dateTaken).toEqual(taken);
    expect(meta).toHaveProperty('nameDate');
  });
  it('shifts the date taken only', () => {
    const out = effectiveMetadata(meta, { shiftMinutes: -60, useNameDate: true });
    expect(out.dateTaken).toEqual(wc(2024, 7, 4, 13, 30));
    expect(out.created).toEqual(created);
    expect(out.nameDate).toEqual(wc(2024, 1, 2));
    expect(effectiveMetadata(makeMeta({ modified }), { shiftMinutes: -60, useNameDate: true }).dateTaken).toBeUndefined();
  });
});
