import type { WallClock } from './types.js';

export const DEFAULT_DATE_FORMAT = 'YYYY-MM-DD';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Longest codes first so "YYYY" wins over "YY", "MMM" over "MM" and "SSS" over "ss".
const CODES = ['YYYY', 'MMM', 'SSS', 'ddd', 'YY', 'MM', 'DD', 'HH', 'hh', 'mm', 'ss', 'A'] as const;
type Code = (typeof CODES)[number];

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** 0 = Sunday … 6 = Saturday, for the calendar date of `wc`. */
export function dayOfWeek(wc: WallClock): number {
  return new Date(Date.UTC(wc.year, wc.month - 1, wc.day)).getUTCDay();
}

function renderCode(code: Code, wc: WallClock): string {
  switch (code) {
    case 'YYYY': return pad(wc.year, 4);
    case 'YY': return pad(wc.year % 100);
    case 'MMM': return MONTHS[wc.month - 1] ?? '';
    case 'MM': return pad(wc.month);
    case 'DD': return pad(wc.day);
    case 'ddd': return DAYS[dayOfWeek(wc)] ?? '';
    case 'HH': return pad(wc.hour);
    case 'hh': return pad(wc.hour % 12 || 12);
    case 'A': return wc.hour < 12 ? 'AM' : 'PM';
    case 'mm': return pad(wc.minute);
    case 'ss': return pad(wc.second);
    case 'SSS': return pad(wc.millisecond ?? 0, 3);
  }
}

/** Formats a wall clock with the date format codes. Any other character is kept as-is. */
export function formatWallClock(wc: WallClock, format: string): string {
  let out = '';
  let i = 0;
  while (i < format.length) {
    const code = CODES.find((c) => format.startsWith(c, i));
    if (code) {
      out += renderCode(code, wc);
      i += code.length;
    } else {
      out += format.charAt(i);
      i += 1;
    }
  }
  return out;
}
