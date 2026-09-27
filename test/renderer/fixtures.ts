import type { Flag, FlagCode, FlagLevel } from '../../src/core/types.js';
import type { PreviewRow } from '../../src/shared/ipc.js';

export function flag(code: FlagCode, level: FlagLevel, message = `${code} message`): Flag {
  return { code, level, message };
}

/** A preview row for tests; override what the test cares about. */
export function row(over: Partial<PreviewRow> = {}): PreviewRow {
  return {
    path: '/photos/IMG_1.jpg',
    currentName: 'IMG_1.jpg',
    newName: 'Trip_001.jpg',
    kind: 'rename',
    dateUsed: '2024-07-04 14:30',
    dateSource: 'taken',
    folder: 'photos',
    folderPath: '/photos',
    flags: [],
    groupId: null,
    setsDates: false,
    isDir: false,
    stem: 'Trip_001',
    ext: 'jpg',
    ...over,
  };
}
