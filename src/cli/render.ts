import path from 'node:path';
import { formatWallClock, isMoving, type Plan, type RollbackReport, type WallClock } from '../core/index.js';

export interface PlanSummary {
  total: number;
  toRename: number;
  unchanged: number;
  /** Files with at least one warning. */
  warnings: number;
  errors: number;
}

export type ApplyResult =
  | { status: 'done'; renamed: number; datesChanged: number; journal: string | null }
  | { status: 'stale'; changed: string[] }
  | { status: 'failed' | 'cancelled'; error: string | null; rollback: RollbackReport };

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A path relative to cwd when it is inside it, otherwise as given. */
export function shown(p: string, cwd: string): string {
  const rel = path.relative(cwd, p);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : p;
}

export const wallClockText = (w: WallClock): string => formatWallClock(w, 'YYYY-MM-DDTHH:mm:ss');

export function summarize(plan: Plan): PlanSummary {
  let toRename = 0;
  let unchanged = 0;
  let warnings = 0;
  for (const item of plan.items) {
    if (isMoving(item.kind)) toRename += 1;
    else if (item.kind === 'unchanged') unchanged += 1;
    if (item.flags.some((f) => f.level === 'warning')) warnings += 1;
  }
  return { total: plan.items.length, toRename, unchanged, warnings, errors: plan.errorCount };
}

export function summaryLine(s: PlanSummary): string {
  const parts = [`${s.toRename} to rename`, `${s.unchanged} unchanged`];
  if (s.warnings > 0) parts.push(plural(s.warnings, 'warning'));
  parts.push(plural(s.errors, 'error'));
  return parts.join(', ');
}

export function planText(plan: Plan, cwd: string): string {
  const lines: string[] = [];
  for (const item of plan.items) {
    const from = shown(item.source.path, cwd);
    if (isMoving(item.kind)) lines.push(`${from} -> ${shown(item.target, cwd)}`);
    else if (item.kind === 'error') lines.push(`${from} (not renamed)`);
    else lines.push(`${from} (unchanged)`);
    for (const f of item.flags) if (f.level !== 'info') lines.push(`    ${f.level}: ${f.message}`);
  }
  lines.push(summaryLine(summarize(plan)));
  return `${lines.join('\n')}\n`;
}

export function planJson(plan: Plan, result?: ApplyResult): string {
  const body = {
    plan: plan.items.map((i) => ({
      source: i.source.path,
      target: i.target,
      kind: i.kind,
      flags: i.flags.map(({ level, code, message }) => ({ level, code, message })),
      dateUsed: i.dateUsed ? { value: wallClockText(i.dateUsed.value), source: i.dateUsed.source } : null,
    })),
    patternError: plan.patternError,
    summary: summarize(plan),
    ...(result ? { result } : {}),
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

export function rollbackText(report: RollbackReport, cwd: string): string {
  if (report.complete) return 'Every file was put back.';
  const lines = report.stranded.map((s) => `  ${shown(s.current, cwd)} (was ${shown(s.original, cwd)})`);
  return `These files could not be put back:\n${lines.join('\n')}`;
}

export function resultText(result: ApplyResult, cwd: string): string {
  switch (result.status) {
    case 'done': {
      const dates = result.datesChanged > 0 ? `, set dates on ${plural(result.datesChanged, 'file')}` : '';
      const undo = result.journal ? `\nUndo with: renami undo "${shown(result.journal, cwd)}"` : '';
      return `Renamed ${plural(result.renamed, 'file')}${dates}.${undo}\n`;
    }
    case 'stale':
      return `Nothing was renamed: these files changed after the plan was made. Run it again.\n${result.changed
        .map((p) => `  ${shown(p, cwd)}`)
        .join('\n')}\n`;
    case 'cancelled':
      return `Cancelled. ${rollbackText(result.rollback, cwd)}\n`;
    case 'failed':
      return `The rename failed: ${result.error ?? 'unknown error'}. ${rollbackText(result.rollback, cwd)}\n`;
  }
}
