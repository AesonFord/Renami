/** Keys that move the preview panel's selection through the rows. */
export type SelectionKey = 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

export function isSelectionKey(key: string): key is SelectionKey {
  return key === 'ArrowUp' || key === 'ArrowDown' || key === 'Home' || key === 'End';
}

/** The row a key moves to from `current`, or null when it stays put (already at that end). */
export function stepSelection(paths: readonly string[], current: string, key: SelectionKey): string | null {
  if (paths.length === 0) return null;
  const at = paths.indexOf(current);
  const to =
    key === 'Home' ? 0 : key === 'End' ? paths.length - 1 : key === 'ArrowUp' ? Math.max(0, at - 1) : Math.min(paths.length - 1, at + 1);
  const next = paths[to] ?? null;
  return next === current ? null : next;
}

/**
 * Where the selection goes when the selected row is no longer shown: the row now at the
 * position it had, or the last row. Null when nothing was selected or there are no rows.
 */
export function reselect(paths: readonly string[], selected: string | null, lastIndex: number): string | null {
  if (selected === null || paths.includes(selected)) return selected;
  if (paths.length === 0) return null;
  return paths[Math.min(Math.max(0, lastIndex), paths.length - 1)] ?? null;
}
