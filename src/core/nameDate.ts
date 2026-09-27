import type { WallClock } from './types.js';

/** Cameras and phones started stamping names around 2000; anything earlier is a serial number. */
const YEAR_MIN = 2000;
const YEAR_MAX = 2099;

/**
 * A full timestamp: date, a separator (or " at "), then hh mm ss with optional separators and an
 * optional 3-digit millisecond run (Pixel: PXL_20240705_231502123). The date's separator must
 * repeat (\2), so 2024-0102 is not a date. Digits on either side rule out longer numbers.
 */
const TIMESTAMP =
  /(?<!\d)(\d{4})([-_.:]?)(\d{2})\2(\d{2})(?:[ T_\-.]| at )(\d{2})[-_.:h]?(\d{2})[-_.:m]?(\d{2})(?:\d{3})?(?!\d)/;
const DATE_ONLY = /(?<!\d)(\d{4})([-_.]?)(\d{2})\2(\d{2})(?!\d)/;

const n = (s: string | undefined): number => Number(s ?? NaN);

function validDate(year: number, month: number, day: number): boolean {
  return year >= YEAR_MIN && year <= YEAR_MAX && month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/** The first date in a file name (without its extension), or null. A date alone is midnight. */
export function dateFromName(stem: string): WallClock | null {
  const full = TIMESTAMP.exec(stem);
  if (full) {
    const [year, month, day, hour, minute, second] = [n(full[1]), n(full[3]), n(full[4]), n(full[5]), n(full[6]), n(full[7])];
    if (validDate(year, month, day) && hour <= 23 && minute <= 59 && second <= 59) {
      return { year, month, day, hour, minute, second };
    }
  }
  const date = DATE_ONLY.exec(stem);
  if (date) {
    const [year, month, day] = [n(date[1]), n(date[3]), n(date[4])];
    if (validDate(year, month, day)) return { year, month, day, hour: 0, minute: 0, second: 0 };
  }
  return null;
}
