import type { PreviewRow } from '../../shared/ipc.js';

/** The preview table's columns, in order. `min` keeps a column from collapsing. */
export const COLUMNS = [
  { label: 'Current name', min: 80 },
  { label: 'New name', min: 80 },
  { label: 'Date used', min: 80 },
  { label: 'From folder', min: 60 },
  { label: 'Status', min: 90 },
] as const;

export const MAX_WIDTH = 2000;

/** The layout before anyone resizes a column: the names share whatever room the window has. */
export const DEFAULT_TEMPLATE = 'minmax(0, 1.2fr) minmax(0, 1.4fr) 190px 140px 300px';

/** Must match .cols in styles.css. */
const GAP = 16;
const SIDE_PADDING = 24;

/** Room past the measured content, so rounding never tips a fitted value into an ellipsis. */
const FIT_SLACK = 4;

export const WIDTHS_KEY = 'previewColumnWidths';

/** Pixel width per column, or null for the default layout. */
export type Widths = readonly number[];

export function template(widths: Widths | null): string {
  return widths ? widths.map((w) => `${w}px`).join(' ') : DEFAULT_TEMPLATE;
}

/** The width of a whole row: every column, the gaps between them and the padding on each side. */
export function contentWidth(widths: Widths): number {
  return widths.reduce((sum, w) => sum + w, 0) + GAP * (widths.length - 1) + 2 * SIDE_PADDING;
}

const clamp = (col: number, width: number): number => Math.min(MAX_WIDTH, Math.max(COLUMNS[col]!.min, Math.round(width)));

/** Widths read off the screen, each kept within its column's limits. */
export function clampWidths(widths: Widths): number[] {
  return widths.map((w, i) => clamp(i, w));
}

/** A copy of `widths` with one column set to `width`, kept within its limits. */
export function resize(widths: Widths, col: number, width: number): number[] {
  return widths.map((w, i) => (i === col ? clamp(col, width) : w));
}

/** The width that shows the widest of `contentWidths` without cutting it off. */
export function fitWidth(col: number, contentWidths: Iterable<number>): number {
  let widest = 0;
  for (const w of contentWidths) if (w > widest) widest = w;
  return clamp(col, Math.ceil(widest + FIT_SLACK));
}

/** The text a row shows in one of the text columns (0 to 3), for measuring. */
export function cellText(r: PreviewRow, col: number): string {
  switch (col) {
    case 0: return r.currentName;
    case 1: return r.newName || '—';
    case 2: return r.dateUsed === null ? '—' : r.dateSource !== null && r.dateSource !== 'taken' ? `${r.dateUsed} (${r.dateSource})` : r.dateUsed;
    default: return r.folder;
  }
}

type WidthStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Saved widths, or null when there are none or they don't fit the current columns. */
export function loadWidths(storage: WidthStorage | null): number[] | null {
  try {
    const value: unknown = JSON.parse(storage?.getItem(WIDTHS_KEY) ?? 'null');
    if (!Array.isArray(value) || value.length !== COLUMNS.length) return null;
    const ok = value.every((w, i) => typeof w === 'number' && Number.isFinite(w) && w >= COLUMNS[i]!.min && w <= MAX_WIDTH);
    return ok ? (value as number[]) : null;
  } catch {
    return null;
  }
}

/** Remembers widths across launches; null forgets them. Storage can be missing or blocked. */
export function saveWidths(storage: WidthStorage | null, widths: Widths | null): void {
  try {
    if (widths) storage?.setItem(WIDTHS_KEY, JSON.stringify(widths));
    else storage?.removeItem(WIDTHS_KEY);
  } catch {
    // Not remembering widths is no reason to break the table.
  }
}
