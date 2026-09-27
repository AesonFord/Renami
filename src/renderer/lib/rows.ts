import type { PreviewRow } from '../../shared/ipc.js';

/**
 * What the inline editor starts with: the planned stem when there is one (the planner already
 * split it from its extension, so a dotted folder name or an extension rule can't confuse this).
 * For an error row (no `newName`), the current name with its own extension stripped, if any.
 */
export function editableStem(row: PreviewRow): string {
  if (row.newName) return row.stem;
  const base = row.currentName;
  if (row.isDir) return base;
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? base : base.slice(0, dot);
}

/** `paths` with `from` dropped on `target`: before it when dragged up, after it when dragged down. */
export function moveBefore(paths: readonly string[], from: string, target: string): string[] {
  const i = paths.indexOf(from);
  const j = paths.indexOf(target);
  if (i === -1 || j === -1 || i === j) return [...paths];
  const rest = paths.filter((p) => p !== from);
  const at = rest.indexOf(target) + (j > i ? 1 : 0);
  return [...rest.slice(0, at), from, ...rest.slice(at)];
}

/** `paths` with `path` moved `delta` places (negative = up), clamped to the ends. */
export function moveBy(paths: readonly string[], path: string, delta: number): string[] {
  const i = paths.indexOf(path);
  const next = [...paths];
  if (i === -1) return next;
  const j = Math.max(0, Math.min(paths.length - 1, i + delta));
  next.splice(i, 1);
  next.splice(j, 0, path);
  return next;
}

/**
 * `full` with `from` moved one step toward `delta` within `visible` (a possibly-filtered order:
 * every path in `visible` must appear in `full`, in the same relative order). Rows in `full` but
 * not in `visible` keep their place; only `from`'s position relative to the row it stepped past
 * changes. `full` unchanged when `from` is already at that end of `visible`.
 */
export function moveStep(full: readonly string[], visible: readonly string[], from: string, delta: number): string[] {
  const i = visible.indexOf(from);
  if (i === -1) return [...full];
  const j = Math.max(0, Math.min(visible.length - 1, i + delta));
  if (j === i) return [...full];
  const neighbor = visible[j];
  return neighbor === undefined ? [...full] : moveBefore(full, from, neighbor);
}
