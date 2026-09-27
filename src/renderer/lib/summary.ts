import { isMoving, type FlagCode } from '../../core/types.js';
import type { MetadataStatus, PlanView, PreviewRow } from '../../shared/ipc.js';
import { hasError, type Tone } from './flags.js';

export interface Summary {
  total: number;
  /** Rows that will be renamed or moved. */
  toChange: number;
  /** Rows whose name stays but whose dates will change. */
  datesOnly: number;
  /** Rows the user left out of the batch. */
  excluded: number;
  /** Rows with at least one error. */
  errors: number;
  /** Rows carrying each flag. */
  counts: Partial<Record<FlagCode, number>>;
}

export function summarize(rows: readonly PreviewRow[]): Summary {
  const s: Summary = { total: rows.length, toChange: 0, datesOnly: 0, excluded: 0, errors: 0, counts: {} };
  for (const r of rows) {
    if (isMoving(r.kind)) s.toChange += 1;
    if (r.kind === 'unchanged' && r.setsDates) s.datesOnly += 1;
    if (r.kind === 'excluded') s.excluded += 1;
    if (hasError(r)) s.errors += 1;
    for (const code of new Set(r.flags.map((f) => f.code))) s.counts[code] = (s.counts[code] ?? 0) + 1;
  }
  return s;
}

export interface SummaryPart {
  count: number;
  text: string;
  tone: Tone | 'strong';
}

const files = (n: number): string => (n === 1 ? 'file' : 'files');
const verb = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** The action bar's summary, e.g. "248 will be renamed · 2 used a fallback date · 1 got a suffix". */
export function summaryParts(s: Summary): SummaryPart[] {
  const parts: SummaryPart[] = [];
  const add = (count: number | undefined, text: (n: number) => string, tone: SummaryPart['tone']): void => {
    if (count) parts.push({ count, text: text(count), tone });
  };
  add(s.toChange, () => 'will be renamed', 'strong');
  add(s.datesOnly, () => 'will only get new dates', 'neutral');
  add(s.excluded, (n) => `${verb(n, 'is', 'are')} left out`, 'neutral');
  add(s.counts['fallback-date'], () => 'used a fallback date', 'warn');
  add(s.counts['missing-value'], (n) => `${verb(n, 'is', 'are')} missing a value`, 'warn');
  add(s.counts['suffix-added'], () => 'got a suffix', 'suffix');
  add(s.counts['cross-drive'], (n) => `${verb(n, 'moves', 'move')} to another drive`, 'warn');
  add(s.counts['metadata-unreadable'], () => "couldn't be read", 'warn');
  add(s.counts['no-date-taken'], (n) => `${verb(n, 'has', 'have')} no date taken`, 'warn');
  add(s.errors, (n) => `${verb(n, 'has', 'have')} errors`, 'error');
  return parts;
}

/** "Rename N files", or what the batch will do when no name changes. */
export function renameLabel(s: Summary): string {
  if (s.toChange > 0) return `Rename ${s.toChange} ${files(s.toChange)}`;
  if (s.datesOnly > 0) return `Change dates on ${s.datesOnly} ${files(s.datesOnly)}`;
  return 'Rename files';
}

/** Why the Rename button is disabled, or null when it isn't. Errors block renaming. */
export function renameBlockedReason(input: {
  plan: PlanView | null;
  scanning: boolean;
  metadata: MetadataStatus | null;
  summary: Summary;
  /** A rebuild is due or in flight, so `plan` is not the plan main would run. */
  planPending: boolean;
}): string | null {
  const { plan, scanning, metadata, summary, planPending } = input;
  if (!plan) return 'Add files first';
  if (scanning) return 'Looking for files…';
  // An incomplete plan was built before reading finished; the rebuild with every file's details is coming.
  if ((metadata && !metadata.finished) || !plan.complete) return 'Reading file details…';
  // Main drops its plan the moment its inputs change; the one on screen would only get "The
  // preview changed" (the preview, and so Rename, catches up within the debounce).
  if (planPending) return 'Updating the preview…';
  if (plan.patternError !== null) return 'Fix the pattern first';
  if (summary.errors > 0) return 'Fix or exclude the files with errors';
  if (summary.toChange === 0 && summary.datesOnly === 0) return 'Nothing to rename';
  return null;
}
