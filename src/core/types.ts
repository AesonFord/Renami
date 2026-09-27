export type Platform = 'darwin' | 'win32' | 'linux';

/** A calendar date and time with no time zone attached. Month is 1–12. */
export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0–999. Absent means unknown, which compares as 0 and renders as 000. */
  millisecond?: number;
}

/** Which date a date token ended up using. 'name' is a date parsed from the file name. */
export type DateSource = 'taken' | 'name' | 'created' | 'modified';

/** The three date tokens. */
export type DateKind = 'date_taken' | 'created' | 'modified';

/** One file found by the scanner. */
export interface FileEntry {
  /** Absolute path. */
  path: string;
  /** Absolute path of the parent folder. */
  dir: string;
  /** File name without the last extension. */
  stem: string;
  /** Last extension without the dot, original case; '' when there is none. */
  ext: string;
  size: number;
  mtimeMs: number;
  /** null when the filesystem has no creation time (common on Linux). */
  birthtimeMs: number | null;
  /** Device id from stat, used to detect moves to another drive. */
  dev: number;
  /** True for a folder in folder mode. Folders have the whole name as `stem` and `ext` ''. */
  isDir: boolean;
}

/** Normalized metadata for one file. Only `modified` is always present. */
export interface FileMetadata {
  dateTaken?: WallClock;
  created?: WallClock;
  modified: WallClock;
  cameraMake?: string;
  cameraModel?: string;
  lens?: string;
  iso?: number;
  focalLength?: number;
  width?: number;
  height?: number;
  gpsLat?: number;
  gpsLon?: number;
  durationSeconds?: number;
  artist?: string;
  albumArtist?: string;
  album?: string;
  title?: string;
  genre?: string;
  track?: number;
  disc?: number;
  year?: number;
  /** A date parsed from the file name, e.g. IMG_20240102_101112 (used after dateTaken). */
  nameDate?: WallClock;
  /** F-number, e.g. 2.8. */
  aperture?: number;
  /** Exposure time in seconds, e.g. 0.004. */
  exposureSeconds?: number;
  frameRate?: number;
  bitrateKbps?: number;
  composer?: string;
  /** 8 lowercase hex digits; filled on demand when the pattern uses {crc32}. */
  crc32?: string;
  /** 32 lowercase hex digits; filled on demand when the pattern uses {md5}. */
  md5?: string;
  /** Set when ExifTool could not read the file. */
  readError?: string;
}

/** 'manual' orders by the list of paths the renderer sends (drag to reorder). */
export type SortKey = 'dateTaken' | 'created' | 'modified' | 'name' | 'manual';
export type SortDirection = 'asc' | 'desc';
/** Restart numbering whenever the sort date's day, month or year changes. */
export type RestartEvery = 'never' | 'day' | 'month' | 'year';
export type CaseMode = 'none' | 'lower' | 'upper' | 'title' | 'sentence' | 'snake' | 'kebab' | 'camel';
export type ScanMode = 'files' | 'folders';
/** 'original': edits the current name before it becomes {name}. 'result': edits the rendered name. */
export type RuleScope = 'original' | 'result';

export interface FindReplaceRule {
  find: string;
  replace: string;
  regex: boolean;
  matchCase: boolean;
  /** Absent means 'original'. */
  scope?: RuleScope;
}

/** Maps one original extension to another; both lowercase without the dot. `to` '' removes it. */
export interface ExtensionRule {
  from: string;
  to: string;
}

/** Case-insensitive match on the file name; an invalid regex is matched as plain text. */
export interface NameFilter {
  text: string;
  regex: boolean;
}

/** What a scan lists. Absent optional fields mean no limit (and 'files' mode). */
export interface ScanOptions {
  includeSubfolders: boolean;
  /** Lowercase, no dot; '' = files with no extension; null = all files. */
  extensions: string[] | null;
  /** 'folders' lists the folders directly inside each dropped folder instead of files. */
  mode?: ScanMode;
  /** Case-insensitive match on the file or folder name; an invalid regex is matched as plain text. */
  name?: NameFilter;
  /** Files only; null or absent = no limit. */
  minBytes?: number | null;
  maxBytes?: number | null;
  /** 'YYYY-MM-DD' in the computer's time zone, inclusive; null or absent = no limit. */
  modifiedFrom?: string | null;
  modifiedTo?: string | null;
}

export interface RenameSettings {
  pattern: string;
  sequence: {
    sortBy: SortKey;
    direction: SortDirection;
    start: number;
    /** Counter increment, at least 1. */
    step: number;
    digits: number;
    restartPerFolder: boolean;
    restartEvery: RestartEvery;
    keepGroupsTogether: boolean;
  };
  findReplace: FindReplaceRule[];
  cleanup: {
    caseMode: CaseMode;
    spacesToUnderscores: boolean;
    lowercaseExtension: boolean;
    stripDiacritics: boolean;
    /** Implies stripDiacritics; every other non-ASCII character becomes _. */
    asciiOnly: boolean;
    extensionRules: ExtensionRule[];
  };
  /** destinationRoot null = each file's current folder. */
  move: { destinationRoot: string | null };
  dates: {
    setModified: boolean;
    setCreated: boolean;
    /** Added to dateTaken wherever it is used; negative moves it earlier. */
    shiftMinutes: number;
    /** Use a date found in the file name when there is no date taken. */
    useNameDate: boolean;
  };
  filter: Required<ScanOptions>;
}

export const DEFAULT_SETTINGS: RenameSettings = {
  pattern: '{name}',
  sequence: {
    sortBy: 'dateTaken',
    direction: 'asc',
    start: 1,
    step: 1,
    digits: 3,
    restartPerFolder: false,
    restartEvery: 'never',
    keepGroupsTogether: true,
  },
  findReplace: [],
  cleanup: {
    caseMode: 'none',
    spacesToUnderscores: false,
    lowercaseExtension: false,
    stripDiacritics: false,
    asciiOnly: false,
    extensionRules: [],
  },
  move: { destinationRoot: null },
  dates: { setModified: false, setCreated: false, shiftMinutes: 0, useNameDate: true },
  filter: {
    includeSubfolders: false,
    extensions: null,
    mode: 'files',
    name: { text: '', regex: false },
    minBytes: null,
    maxBytes: null,
    modifiedFrom: null,
    modifiedTo: null,
  },
};

export type FlagLevel = 'info' | 'warning' | 'error';

export type FlagCode =
  // info
  | 'paired'
  | 'edited'
  // warnings (never block renaming)
  | 'fallback-date'
  | 'missing-value'
  | 'suffix-added'
  | 'cross-drive'
  | 'metadata-unreadable'
  | 'no-date-taken'
  // errors (block renaming)
  | 'pattern-error'
  | 'empty-segment'
  | 'segment-too-long'
  | 'path-too-long'
  | 'destination-unwritable'
  | 'folder-cross-drive';

export interface Flag {
  level: FlagLevel;
  code: FlagCode;
  message: string;
}

/** 'excluded': the user left this file out of the batch; it stays as it is. */
export type PlanItemKind = 'rename' | 'move' | 'cross-drive-move' | 'unchanged' | 'error' | 'excluded';

/** The kinds that give a file a new path. */
export const isMoving = (kind: PlanItemKind): boolean => kind === 'rename' || kind === 'move' || kind === 'cross-drive-move';

export interface PlannedDates {
  modified?: WallClock;
  created?: WallClock;
}

export const hasPlannedDates = (d: PlannedDates): boolean => d.modified !== undefined || d.created !== undefined;

export interface PlanItem {
  source: FileEntry;
  /** Absolute target path. Equals source.path when kind is 'unchanged', 'error' or 'excluded'. */
  target: string;
  kind: PlanItemKind;
  flags: Flag[];
  seq: number;
  /** Shared by members of a same-name group of 2+ files; null for single files. */
  groupId: string | null;
  /** The date shown in the preview's "Date used" column. */
  dateUsed: { value: WallClock; source: DateSource } | null;
  /**
   * The target's file name without its extension (after any conflict suffix). For an early
   * error raised before a target was drafted, the source's own stem.
   */
  stem: string;
  /**
   * The target's extension, without the dot, after `cleanup.extensionRules` (never the source's
   * own extension when a rule changed it). '' for a directory or a name with no extension.
   */
  ext: string;
  /** Empty object when no date change is planned. */
  setDates: PlannedDates;
}

export interface Plan {
  id: string;
  /** In sequence order. */
  items: PlanItem[];
  patternError: string | null;
  errorCount: number;
  settings: RenameSettings;
}

/** What the planner may ask about the disk. Keeps the planner pure and testable. */
export interface FsView {
  /** Names in dir as stored on disk, or null when dir doesn't exist. */
  listDir(dir: string): string[] | null;
  /** The nearest existing ancestor of p (p itself when it exists). */
  nearestExisting(p: string): string;
  deviceOf(existingPath: string): number;
  isWritableDir(existingDir: string): boolean;
}

export interface FileTimes {
  atimeMs: number;
  mtimeMs: number;
  birthtimeMs: number | null;
}

export interface BatchFileRecord {
  /** Path before the batch. */
  from: string;
  /** Path after the batch (equals `from` when only dates changed). */
  to: string;
  sizeAfter: number;
  mtimeMsAfter: number;
  /** Times before the batch; null when the batch didn't change dates. */
  originalTimes: FileTimes | null;
}

export interface BatchRecord {
  id: string;
  files: BatchFileRecord[];
  /** Folders the batch created, in creation order. */
  createdDirs: string[];
  finishedAt: number;
}

export interface RollbackReport {
  complete: boolean;
  /** Files that could not be put back: where they started and where they are now. */
  stranded: { original: string; current: string }[];
  /** Files whose original dates could not be put back (only present when non-empty). */
  datesNotRestored?: string[];
}

export type BatchResult =
  | { status: 'done'; record: BatchRecord }
  | { status: 'stale'; changed: string[] }
  | { status: 'cancelled' | 'failed'; error: string | null; rollback: RollbackReport };

export interface UndoResult {
  status: 'done' | 'failed' | 'cancelled' | 'nothing-to-undo';
  restored: number;
  skipped: { path: string; reason: string }[];
  error: string | null;
  rollback: RollbackReport | null;
}

export type Progress = (done: number, total: number) => void;
