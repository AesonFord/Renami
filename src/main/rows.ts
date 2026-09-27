import path from 'node:path';
import { formatWallClock, hasPlannedDates, isMoving, type Plan, type PlanItem } from '../core/index.js';
import type { PlanView, PreviewRow } from '../shared/ipc.js';

export const DATE_USED_FORMAT = 'YYYY-MM-DD HH:mm';

/** One preview row. The new name includes the folder path relative to where files land. */
export function toPreviewRow(item: PlanItem, destinationRoot: string | null): PreviewRow {
  const { source } = item;
  const currentName = path.basename(source.path);
  let newName = '';
  if (item.kind === 'unchanged') newName = currentName;
  else if (isMoving(item.kind)) {
    const base = destinationRoot === null ? source.dir : path.resolve(destinationRoot);
    newName = path.relative(base, item.target);
  }
  return {
    path: source.path,
    currentName,
    newName,
    kind: item.kind,
    dateUsed: item.dateUsed ? formatWallClock(item.dateUsed.value, DATE_USED_FORMAT) : null,
    dateSource: item.dateUsed?.source ?? null,
    folder: path.basename(source.dir),
    folderPath: source.dir,
    flags: item.flags,
    groupId: item.groupId,
    setsDates: hasPlannedDates(item.setDates),
    isDir: source.isDir,
    stem: item.stem,
    ext: item.ext,
  };
}

/** `complete`: whether metadata reading had finished when the plan was built. */
export function toPlanView(plan: Plan, complete: boolean): PlanView {
  const root = plan.settings.move.destinationRoot;
  return {
    planId: plan.id,
    rows: plan.items.map((i) => toPreviewRow(i, root)),
    patternError: plan.patternError,
    errorCount: plan.errorCount,
    complete,
  };
}

/**
 * After a batch, files the user added one by one have new paths. Swap those in so the next
 * scan still finds them. Folders never move, so they stay as they are.
 */
export function remapSources(
  sources: readonly string[],
  moves: ReadonlyArray<readonly [from: string, to: string]>,
): string[] {
  const byFrom = new Map(moves);
  return sources.map((s) => byFrom.get(path.resolve(s)) ?? s);
}
