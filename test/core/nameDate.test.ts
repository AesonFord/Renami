import { describe, expect, it } from 'vitest';
import { dateFromName } from '../../src/core/nameDate.js';
import { wc } from './helpers.js';

describe('dateFromName', () => {
  it.each([
    ['IMG_20240102_101112', wc(2024, 1, 2, 10, 11, 12)],
    ['PXL_20240705_231502123', wc(2024, 7, 5, 23, 15, 2)],
    ['Screenshot 2024-01-02 at 10.11.12', wc(2024, 1, 2, 10, 11, 12)],
    ['WhatsApp Image 2024-01-02 at 10.11.12', wc(2024, 1, 2, 10, 11, 12)],
    ['2024-01-02 10-11-12 beach', wc(2024, 1, 2, 10, 11, 12)],
    ['VID_2024.01.02_10h11m12', wc(2024, 1, 2, 10, 11, 12)],
    ['IMG-20240102-WA0003', wc(2024, 1, 2)],
    ['2024-01-02', wc(2024, 1, 2)],
    ['trip 2024_01_02 photos 2024_01_03', wc(2024, 1, 2)],
  ])('parses %s', (stem, expected) => {
    expect(dateFromName(stem)).toEqual(expected);
  });

  it.each([
    'IMG_4821',
    'DSC_0193',
    '12345678',
    '2024-13-02',
    '2024-01-32',
    '1999-12-31',
    '2024-0102',
    'order 123420240102',
  ])('returns null for %s', (stem) => {
    expect(dateFromName(stem)).toBeNull();
  });

  it('falls back to the date when the time part is out of range', () => {
    expect(dateFromName('2024-01-02 25.61.00')).toEqual(wc(2024, 1, 2));
  });
});
