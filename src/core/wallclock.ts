import type { WallClock } from './types.js';

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function instantToWallClock(ms: number, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Reads a wall clock as UTC and returns the wall clock in `timeZone`. Used for UTC-only video dates. */
export function utcWallToZone(wall: WallClock, timeZone: string): WallClock {
  const ms = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const out = instantToWallClock(ms, timeZone);
  if (wall.millisecond !== undefined) out.millisecond = wall.millisecond;
  return out;
}

/** Interprets a wall clock in the computer's local time zone. Only for writing file times. */
export function wallClockToLocalDate(wc: WallClock): Date {
  return new Date(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, wc.second, wc.millisecond ?? 0);
}

export function compareWallClock(a: WallClock, b: WallClock): number {
  return (
    a.year - b.year ||
    a.month - b.month ||
    a.day - b.day ||
    a.hour - b.hour ||
    a.minute - b.minute ||
    a.second - b.second ||
    (a.millisecond ?? 0) - (b.millisecond ?? 0)
  );
}

export interface ParsedExifDate {
  wall: WallClock;
  /** Minutes east of UTC; null when the value carried no offset. */
  offsetMinutes: number | null;
}

const EXIF_DATE =
  /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?\s*(Z|[+-]\d{2}:?\d{2})?$/;

/** Parses "2024:07:04 14:30:00", optionally with fractional seconds (kept as milliseconds) and an offset. */
export function parseExifDateTime(raw: unknown): ParsedExifDate | null {
  if (typeof raw !== 'string') return null;
  const m = EXIF_DATE.exec(raw.trim());
  if (!m) return null;
  const n = (i: number): number => Number(m[i]);
  const wall: WallClock = { year: n(1), month: n(2), day: n(3), hour: n(4), minute: n(5), second: n(6) };
  if (
    wall.year === 0 || wall.month < 1 || wall.month > 12 || wall.day < 1 || wall.day > 31 ||
    wall.hour > 23 || wall.minute > 59 || wall.second > 59
  ) {
    return null;
  }
  const fraction = m[7];
  if (fraction !== undefined) wall.millisecond = Number(fraction.padEnd(3, '0').slice(0, 3));
  const tz = m[8];
  let offsetMinutes: number | null = null;
  if (tz === 'Z') {
    offsetMinutes = 0;
  } else if (tz) {
    const sign = tz.startsWith('-') ? -1 : 1;
    const digits = tz.slice(1).replace(':', '');
    offsetMinutes = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
  }
  return { wall, offsetMinutes };
}
