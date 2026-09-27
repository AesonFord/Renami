import { describe, expect, it } from 'vitest';
import {
  compareWallClock,
  instantToWallClock,
  parseExifDateTime,
  utcWallToZone,
  wallClockToLocalDate,
} from '../../src/core/wallclock.js';

const wc = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0) => ({
  year, month, day, hour, minute, second,
});

describe('instantToWallClock', () => {
  it('converts an instant to wall-clock time in a zone', () => {
    const ms = Date.UTC(2024, 6, 5, 23, 15, 2);
    expect(instantToWallClock(ms, 'Pacific/Honolulu')).toEqual(wc(2024, 7, 5, 13, 15, 2));
    expect(instantToWallClock(ms, 'UTC')).toEqual(wc(2024, 7, 5, 23, 15, 2));
  });
  it('reports midnight as hour 0, not 24', () => {
    expect(instantToWallClock(Date.UTC(2024, 0, 1, 10, 0, 0), 'Pacific/Honolulu')).toEqual(wc(2024, 1, 1, 0));
  });
});

describe('utcWallToZone', () => {
  it('treats the wall clock as UTC and converts it', () => {
    expect(utcWallToZone(wc(2024, 7, 5, 23, 15, 2), 'Pacific/Honolulu')).toEqual(wc(2024, 7, 5, 13, 15, 2));
  });
});

describe('parseExifDateTime', () => {
  it('parses EXIF dates without an offset', () => {
    expect(parseExifDateTime('2024:07:04 14:30:00')).toEqual({ wall: wc(2024, 7, 4, 14, 30), offsetMinutes: null });
  });
  it('parses offsets in several spellings', () => {
    expect(parseExifDateTime('2024:07:04 18:42:00-10:00')?.offsetMinutes).toBe(-600);
    expect(parseExifDateTime('2024-07-04T18:42:00-1000')?.offsetMinutes).toBe(-600);
    expect(parseExifDateTime('2024:07:05 23:15:02Z')?.offsetMinutes).toBe(0);
    expect(parseExifDateTime('2024:07:04 14:30:00.123+05:30')?.offsetMinutes).toBe(330);
  });
  it('keeps the recorded wall clock when an offset is present', () => {
    expect(parseExifDateTime('2024:07:04 18:42:00-10:00')?.wall).toEqual(wc(2024, 7, 4, 18, 42));
  });
  it('rejects empty, zero and non-string values', () => {
    expect(parseExifDateTime('0000:00:00 00:00:00')).toBeNull();
    expect(parseExifDateTime('not a date')).toBeNull();
    expect(parseExifDateTime(20240704)).toBeNull();
    expect(parseExifDateTime(undefined)).toBeNull();
  });
});

describe('wallClockToLocalDate', () => {
  it('builds a local Date with the same fields', () => {
    const d = wallClockToLocalDate(wc(2024, 7, 4, 14, 30, 5));
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()])
      .toEqual([2024, 7, 4, 14, 30, 5]);
  });
});

describe('compareWallClock', () => {
  it('orders by every field', () => {
    expect(compareWallClock(wc(2024, 7, 4, 14, 30, 0), wc(2024, 7, 4, 14, 30, 1))).toBeLessThan(0);
    expect(compareWallClock(wc(2025, 1, 1), wc(2024, 12, 31, 23, 59, 59))).toBeGreaterThan(0);
    expect(compareWallClock(wc(2024, 7, 4), wc(2024, 7, 4))).toBe(0);
  });
});

describe('milliseconds', () => {
  it('parseExifDateTime keeps a fraction as milliseconds and sets nothing without one', () => {
    expect(parseExifDateTime('2024:07:04 14:30:00.123-10:00')).toEqual({
      wall: { year: 2024, month: 7, day: 4, hour: 14, minute: 30, second: 0, millisecond: 123 },
      offsetMinutes: -600,
    });
    expect(parseExifDateTime('2024:07:04 14:30:00.5')?.wall.millisecond).toBe(500);
    expect(parseExifDateTime('2024:07:04 14:30:00.123456')?.wall.millisecond).toBe(123);
    expect(parseExifDateTime('2024:07:04 14:30:00')?.wall).not.toHaveProperty('millisecond');
  });
  it('compareWallClock orders by milliseconds last, absent counting as zero', () => {
    const a = { year: 2024, month: 7, day: 4, hour: 14, minute: 30, second: 0 };
    expect(compareWallClock({ ...a, millisecond: 10 }, { ...a, millisecond: 20 })).toBeLessThan(0);
    expect(compareWallClock(a, { ...a, millisecond: 0 })).toBe(0);
    expect(compareWallClock({ ...a, millisecond: 1 }, a)).toBeGreaterThan(0);
  });
  it('utcWallToZone and wallClockToLocalDate carry milliseconds', () => {
    const a = { year: 2024, month: 7, day: 5, hour: 23, minute: 15, second: 2, millisecond: 250 };
    expect(utcWallToZone(a, 'Pacific/Honolulu')).toEqual({ year: 2024, month: 7, day: 5, hour: 13, minute: 15, second: 2, millisecond: 250 });
    expect(wallClockToLocalDate(a).getMilliseconds()).toBe(250);
    expect(utcWallToZone({ ...a, millisecond: undefined }, 'UTC')).not.toHaveProperty('millisecond');
  });
});
