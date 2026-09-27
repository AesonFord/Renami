import type {
  DateSource,
  Flag,
  Platform,
  PlanItemKind,
  RenameSettings,
  RollbackReport,
  ScanOptions,
  UndoResult,
} from '../core/types.js';
import type { TokenName } from '../core/template/tokens.js';

/** Request channels: renderer → main via ipcRenderer.invoke. */
export const INVOKE = {
  platform: 'app:platform',
  scan: 'files:scan',
  buildPlan: 'plan:build',
  tokenValues: 'plan:token-values',
  execute: 'batch:execute',
  cancel: 'batch:cancel',
  undo: 'batch:undo',
  canUndo: 'batch:can-undo',
  listPresets: 'presets:list',
  savePreset: 'presets:save',
  deletePreset: 'presets:delete',
  pickPaths: 'dialog:pick-paths',
  pickFolder: 'dialog:pick-folder',
  copyText: 'app:copy-text',
  clear: 'files:clear',
  saveText: 'app:save-text',
  readText: 'app:read-text',
  takeOpenPaths: 'app:take-open-paths',
  fileDetails: 'preview:file-details',
  showInFolder: 'preview:show-in-folder',
  openFile: 'preview:open-file',
} as const;

/** Event channels: main → renderer via webContents.send. */
export const EVENTS = {
  metadataProgress: 'metadata:progress',
  executeProgress: 'batch:progress',
  openPaths: 'app:open-paths',
} as const;

export type ScanFilter = ScanOptions;

export interface SourceSummary {
  /** Exactly as the renderer passed it to scan(). */
  path: string;
  /** Last path segment, for the chip. */
  name: string;
  isFolder: boolean;
  /**
   * Files from this source in the batch, after the extension filter. Sources can overlap (a
   * folder and a file inside it); `FilesSummary.total` counts each file once.
   */
  count: number;
}

export interface FilesSummary {
  sources: SourceSummary[];
  total: number;
  /** Every extension found before filtering: lowercase, no dot, '' for none. Sorted. */
  extensionsFound: string[];
  unreadableFolders: string[];
}

/**
 * Background metadata reading progress. A read replaced by a newer scan, or stopped by an undo,
 * sends no final event. The next scan's first event (`done: 0`) replaces it.
 */
export interface MetadataStatus {
  done: number;
  total: number;
  /** True once reading has stopped, whether it read everything or gave up. */
  finished: boolean;
  /** ExifTool kept failing, so the rest of the files use filesystem dates. */
  exiftoolFailed: boolean;
}

export interface ProgressView {
  done: number;
  total: number;
}

/** One preview row. Slimmer than PlanItem so thousands of rows cross IPC cheaply. */
export interface PreviewRow {
  /** Source path; unique within a plan. */
  path: string;
  currentName: string;
  /** New name, with the folder path relative to the destination when moving. '' for error rows. */
  newName: string;
  kind: PlanItemKind;
  /** e.g. "2024-07-04 14:30"; null when the pattern uses no date. */
  dateUsed: string | null;
  dateSource: DateSource | null;
  /** Name of the file's current folder. */
  folder: string;
  /** Full path of the file's current folder, for the tooltip. */
  folderPath: string;
  flags: Flag[];
  groupId: string | null;
  /** True when the batch will change this file's dates. */
  setsDates: boolean;
  /** True for a folder in folder mode; it has no extension to strip from its name. */
  isDir: boolean;
  /**
   * The file name shown in `newName` without its extension (after any conflict suffix), for the
   * inline editor. For an error row (no `newName`), the source's own stem.
   */
  stem: string;
  /** The extension `newName` ends with, without the dot, after any extension rule; '' for none. */
  ext: string;
}

export interface PlanView {
  planId: string;
  rows: PreviewRow[];
  patternError: string | null;
  errorCount: number;
  /** False when metadata was still being read as this plan was built; such a plan can't run. */
  complete: boolean;
}

export interface PlanRequest {
  settings: RenameSettings;
  /** Source paths the user unchecked in the preview, or took out with "Exclude these files". They stay in the preview as excluded rows. */
  excluded: string[];
  /** New name stems the user typed or imported, by source path. */
  overrides?: Record<string, string>;
  /** Source paths in the order the user arranged them, for sortBy 'manual'. */
  manualOrder?: string[];
}

/** One file's path before and after a batch. */
export interface FileChange {
  from: string;
  to: string;
}

export type ExecuteOutcome =
  | {
      status: 'done';
      renamed: number;
      datesChanged: number;
      sourcesAfter: string[];
      /** Every file whose path changed, for the export of a finished batch. */
      changes: FileChange[];
    }
  | { status: 'stale'; changed: string[] }
  | { status: 'cancelled' | 'failed'; error: string | null; rollback: RollbackReport }
  | { status: 'not-ready'; reason: string };

/**
 * sourcesAfter: the sources list with moved files swapped for their new paths.
 * not-ready: another rename or undo is running, so nothing was touched.
 */
export type UndoOutcome =
  | (UndoResult & { sourcesAfter: string[] })
  | { status: 'not-ready'; reason: string; sourcesAfter: string[] };

export interface TokenValues {
  fileName: string;
  values: Record<TokenName, string | null>;
}

/** What the preview panel shows about a file besides its names. */
export interface FileDetails {
  size: number;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

export interface PresetView {
  name: string;
  settings: RenameSettings;
}

export type PickKind = 'files' | 'folder';

/** Everything the renderer can ask of the main process: `window.api`. */
export interface Api {
  platform(): Promise<Platform>;
  /** Resolves null when a newer scan replaced this one before it finished. */
  scan(paths: string[], filter: ScanFilter): Promise<FilesSummary | null>;
  buildPlan(req: PlanRequest): Promise<PlanView>;
  /** Token values for the first file of the current plan; null when there is no plan. */
  tokenValues(): Promise<TokenValues | null>;
  execute(planId: string): Promise<ExecuteOutcome>;
  cancel(): Promise<void>;
  undo(): Promise<UndoOutcome>;
  canUndo(): Promise<boolean>;
  listPresets(): Promise<PresetView[]>;
  /** Resolves to the updated list. */
  savePreset(name: string, settings: RenameSettings): Promise<PresetView[]>;
  deletePreset(name: string): Promise<PresetView[]>;
  /** Native open dialog. Resolves [] when cancelled. */
  pickPaths(kind: PickKind): Promise<string[]>;
  /** Native folder dialog for the destination. Resolves null when cancelled. */
  pickFolder(): Promise<string | null>;
  copyText(text: string): Promise<void>;
  /** Forgets the current files and stops reading them. Called when the last source is removed. */
  clear(): Promise<void>;
  /** Save dialog, then writes the text. Resolves false when the dialog was cancelled. */
  saveText(suggestedName: string, text: string): Promise<boolean>;
  /** Open dialog for a .txt or .csv file (at most 5 MB). Resolves null when cancelled. */
  readText(): Promise<{ name: string; text: string } | null>;
  /** Paths the OS handed the app before the page was ready. Call once on start-up. */
  takeOpenPaths(): Promise<string[]>;
  /** Null for a path that isn't in the current batch. */
  fileDetails(path: string): Promise<FileDetails | null>;
  /** Shows a batch file in Finder, Explorer or the file manager. */
  showInFolder(path: string): Promise<void>;
  /** Opens a batch file in its default app. Resolves an error message, or null when it opened. */
  openFile(path: string): Promise<string | null>;
  /** The real path of a dropped file (Electron removed File.path). */
  pathForFile(file: File): string;
  /** Returns an unsubscribe function. */
  onMetadataProgress(cb: (status: MetadataStatus) => void): () => void;
  onExecuteProgress(cb: (progress: ProgressView) => void): () => void;
  /** Paths the OS hands the app after start-up (dock drop, "Open with", a second launch). */
  onOpenPaths(cb: (paths: string[]) => void): () => void;
}
