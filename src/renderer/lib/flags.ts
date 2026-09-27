import type { FlagCode, FlagLevel } from '../../core/types.js';
import type { PreviewRow } from '../../shared/ipc.js';

export type Tone = 'neutral' | 'accent' | 'warn' | 'suffix' | 'error';

/** Badge text for each flag (errors vs warnings). */
export const FLAG_LABELS: Record<FlagCode, string> = {
  paired: 'Paired',
  edited: 'Edited',
  'fallback-date': 'Fallback date',
  'missing-value': 'Missing value',
  'suffix-added': 'Suffix added',
  'cross-drive': 'Other drive',
  'metadata-unreadable': "Couldn't read metadata",
  'no-date-taken': 'No date taken',
  'pattern-error': 'Pattern error',
  'empty-segment': 'Empty name',
  'segment-too-long': 'Name too long',
  'path-too-long': 'Path too long',
  'destination-unwritable': "Can't write there",
  'folder-cross-drive': "Can't move a folder there",
};

export interface Badge {
  label: string;
  tone: Tone;
}

const SEVERITY: Record<FlagLevel, number> = { error: 0, warning: 1, info: 2 };

function toneOf(code: FlagCode, level: FlagLevel): Tone {
  if (level === 'error') return 'error';
  if (code === 'suffix-added') return 'suffix';
  return level === 'warning' ? 'warn' : 'accent';
}

/** Status badges for a row, most serious first. Rows without flags get one badge saying what will happen. */
export function badgesFor(row: PreviewRow): Badge[] {
  if (row.flags.length === 0) {
    if (row.kind === 'excluded') return [{ label: 'Left out', tone: 'neutral' }];
    if (row.kind === 'unchanged') return [{ label: row.setsDates ? 'Dates only' : 'Unchanged', tone: 'neutral' }];
    if (row.kind === 'move' || row.kind === 'cross-drive-move') return [{ label: 'Will move', tone: 'neutral' }];
    return [{ label: 'Ready', tone: 'neutral' }];
  }
  return [...row.flags]
    .sort((a, b) => SEVERITY[a.level] - SEVERITY[b.level])
    .map((f) => ({ label: FLAG_LABELS[f.code], tone: toneOf(f.code, f.level) }));
}

/** Hover text for the status badge: every flag's message. */
export function statusTitle(row: PreviewRow): string {
  if (row.flags.length > 0) return row.flags.map((f) => f.message).join('\n');
  if (row.kind === 'excluded') return 'Left out of this rename; the file stays as it is';
  if (row.kind === 'unchanged') return row.setsDates ? 'The name stays; its dates will change' : 'The name stays the same';
  if (row.kind === 'move' || row.kind === 'cross-drive-move') return 'Will be moved';
  return 'Will be renamed';
}

export type RowTone = 'none' | 'warn' | 'error';

export const hasError = (row: PreviewRow): boolean => row.flags.some((f) => f.level === 'error');

export function rowTone(row: PreviewRow): RowTone {
  if (hasError(row)) return 'error';
  return row.flags.some((f) => f.level === 'warning') ? 'warn' : 'none';
}

/** "Show only files that need a look": warnings and errors, not information like Paired. */
export const needsLook = (row: PreviewRow): boolean => rowTone(row) !== 'none';
