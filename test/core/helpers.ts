import path from 'node:path';
import { splitName } from '../../src/core/names.js';
import type { FileEntry, FileMetadata, WallClock } from '../../src/core/types.js';

export const wc = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0): WallClock => ({
  year, month, day, hour, minute, second,
});

/** A FileEntry for pure tests. Paths are POSIX-style; planner tests pass `path.posix`. */
export function makeEntry(p: string, overrides: Partial<FileEntry> = {}): FileEntry {
  const { stem, ext } = splitName(path.posix.basename(p));
  return {
    path: p,
    dir: path.posix.dirname(p),
    stem,
    ext,
    size: 100,
    mtimeMs: 1_700_000_000_000,
    birthtimeMs: 1_600_000_000_000,
    dev: 1,
    isDir: false,
    ...overrides,
  };
}

export function makeMeta(overrides: Partial<FileMetadata> = {}): FileMetadata {
  return { modified: wc(2024, 8, 1, 9, 0, 0), ...overrides };
}
