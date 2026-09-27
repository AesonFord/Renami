import type { Outcome } from '../state/useSession.js';

const files = (n: number): string => `${n} ${n === 1 ? 'file' : 'files'}`;

/** Failures, incomplete rollbacks and skipped undo files get a dialog; everything else is a notice. */
export function isDialogOutcome(o: Outcome): boolean {
  switch (o.kind) {
    case 'failed':
      return true;
    case 'cancelled':
      return !o.rollback.complete;
    case 'undone':
      return o.skipped.length > 0;
    default:
      return false;
  }
}

/** One line for the action bar (Done is a confirmation). */
export function noticeText(o: Outcome): string {
  switch (o.kind) {
    case 'renamed':
      if (o.renamed === 0) return `Changed dates on ${files(o.datesChanged)}.`;
      return o.datesChanged > 0
        ? `Renamed ${files(o.renamed)} and changed dates on ${o.datesChanged}.`
        : `Renamed ${files(o.renamed)}.`;
    case 'undone':
      return `Undid the last rename (${files(o.restored)}).`;
    case 'stale':
      return 'Some files changed since the preview, so nothing was renamed. The preview is up to date now; check it and try again.';
    case 'cancelled':
      return o.action === 'rename' ? 'Cancelled. Every file is back where it was.' : 'Undo cancelled. Nothing changed.';
    case 'failed':
      return dialogTitle(o);
    case 'message':
      return o.text;
  }
}

export function dialogTitle(o: Outcome): string {
  if (o.kind === 'failed') return o.action === 'rename' ? "The rename didn't finish" : "The undo didn't finish";
  if (o.kind === 'cancelled') return o.action === 'rename' ? 'The rename was cancelled' : 'The undo was cancelled';
  if (o.kind === 'undone') return "Some files weren't put back";
  return noticeText(o);
}

/** Plain text for "Copy report": every file's original path and where it is now. */
export function reportText(o: Outcome): string {
  const lines = [dialogTitle(o)];
  if (o.kind === 'failed' && o.error) lines.push(o.error);
  const rollback = o.kind === 'failed' || o.kind === 'cancelled' ? o.rollback : null;
  if (rollback?.complete) lines.push('', 'Every file was put back where it was.');
  if (rollback && rollback.stranded.length > 0) {
    lines.push('', "These files couldn't be put back:");
    for (const s of rollback.stranded) lines.push(`${s.original} -> now at ${s.current}`);
  }
  if (rollback?.datesNotRestored && rollback.datesNotRestored.length > 0) {
    lines.push('', "These files are back, but their dates couldn't be restored:", ...rollback.datesNotRestored);
  }
  const skipped = o.kind === 'failed' || o.kind === 'undone' ? o.skipped : [];
  if (skipped.length > 0) {
    lines.push('', 'These files were left where they are:');
    for (const s of skipped) lines.push(`${s.path}: ${s.reason}`);
  }
  return lines.join('\n');
}
