import { dateFromName } from './nameDate.js';
import { instantToWallClock } from './wallclock.js';
import type { DateKind, DateSource, FileEntry, FileMetadata, SortKey, WallClock } from './types.js';

export interface ResolvedDate {
  value: WallClock;
  source: DateSource;
  fellBack: boolean;
}

/** Fallback chains: date taken → name → created → modified; created → modified. */
export function resolveDate(meta: FileMetadata, kind: DateKind): ResolvedDate {
  if (kind === 'date_taken' && meta.dateTaken) {
    return { value: meta.dateTaken, source: 'taken', fellBack: false };
  }
  if (kind === 'date_taken' && meta.nameDate) {
    return { value: meta.nameDate, source: 'name', fellBack: true };
  }
  if (kind !== 'modified' && meta.created) {
    return { value: meta.created, source: 'created', fellBack: kind !== 'created' };
  }
  return { value: meta.modified, source: 'modified', fellBack: kind !== 'modified' };
}

export function sortKeyToDateKind(key: SortKey): DateKind | null {
  switch (key) {
    case 'dateTaken': return 'date_taken';
    case 'created': return 'created';
    case 'modified': return 'modified';
    case 'name': return null;
    case 'manual': return null;
  }
}

export function fallbackMessage(kind: DateKind, source: DateSource): string {
  const missing = kind === 'date_taken' ? 'No date taken' : 'No created date';
  const used = source === 'name' ? 'the date in its name' : source === 'created' ? 'created date' : 'modified date';
  return `${missing} in this file; used ${used}`;
}

/** Filesystem-only metadata. Used before ExifTool has read a file, and as the base for normalized metadata. */
export function fsMetadata(entry: FileEntry, timeZone: string): FileMetadata {
  const meta: FileMetadata = { modified: instantToWallClock(entry.mtimeMs, timeZone) };
  if (entry.birthtimeMs !== null && entry.birthtimeMs > 0) {
    meta.created = instantToWallClock(entry.birthtimeMs, timeZone);
  }
  const nameDate = dateFromName(entry.stem);
  if (nameDate) meta.nameDate = nameDate;
  return meta;
}

/** The wall clock `minutes` later (earlier when negative). Milliseconds are kept. */
export function shiftWallClock(wc: WallClock, minutes: number): WallClock {
  const ms = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, wc.second) + minutes * 60_000;
  const d = new Date(ms);
  const out: WallClock = {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
  if (wc.millisecond !== undefined) out.millisecond = wc.millisecond;
  return out;
}

/** The File dates settings that change what a file's metadata says. */
export interface DateAdjustments {
  shiftMinutes: number;
  useNameDate: boolean;
}

/**
 * Metadata as the user wants it read: the date taken shifted, and the name date dropped when
 * turned off. Returns `meta` itself when nothing changes, so callers can compare by identity.
 */
export function effectiveMetadata(meta: FileMetadata, adjust: DateAdjustments): FileMetadata {
  if (adjust.shiftMinutes === 0 && adjust.useNameDate) return meta;
  const out: FileMetadata = { ...meta };
  if (!adjust.useNameDate) delete out.nameDate;
  if (adjust.shiftMinutes !== 0 && out.dateTaken) out.dateTaken = shiftWallClock(out.dateTaken, adjust.shiftMinutes);
  return out;
}
