import { describe, expect, it } from 'vitest';
import { dayOfWeek, formatWallClock } from '../../src/core/dateFormat.js';

const t = { year: 2024, month: 7, day: 4, hour: 14, minute: 30, second: 5 };

describe('formatWallClock', () => {
  it('renders every code', () => {
    expect(formatWallClock(t, 'YYYY-MM-DD_HHmmss')).toBe('2024-07-04_143005');
    expect(formatWallClock(t, 'YY MMM DD')).toBe('24 Jul 04');
  });
  it('keeps other characters literally', () => {
    expect(formatWallClock(t, 'HH:mm')).toBe('14:30');
    expect(formatWallClock(t, 'Photo YYYY')).toBe('Photo 2024');
  });
  it('renders milliseconds, zero when unknown', () => {
    expect(formatWallClock({ ...t, millisecond: 7 }, 'ss.SSS')).toBe('05.007');
    expect(formatWallClock(t, 'ss.SSS')).toBe('05.000');
  });
  it('renders the day of the week and the 12-hour clock', () => {
    expect(formatWallClock(t, 'ddd')).toBe('Thu');
    expect(formatWallClock(t, 'hh:mm A')).toBe('02:30 PM');
    expect(formatWallClock({ ...t, hour: 0 }, 'hh A')).toBe('12 AM');
    expect(formatWallClock({ ...t, hour: 12 }, 'hh A')).toBe('12 PM');
  });
  it('prefers the longest code at each position', () => {
    expect(formatWallClock({ ...t, millisecond: 42 }, 'ssSSS')).toBe('05042');
    expect(formatWallClock(t, 'DDddd')).toBe('04Thu');
  });
});

describe('dayOfWeek', () => {
  it('is 0 for Sunday', () => {
    expect(dayOfWeek({ year: 2024, month: 7, day: 7, hour: 0, minute: 0, second: 0 })).toBe(0);
    expect(dayOfWeek(t)).toBe(4);
  });
});
