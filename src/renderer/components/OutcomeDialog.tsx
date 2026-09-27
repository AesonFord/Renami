import { useRef } from 'react';
import { dialogTitle, reportText } from '../lib/outcome.js';
import type { Outcome } from '../state/useSession.js';
import { useEscapeKey, useFocusTrap } from './useDialogKeys.js';

interface OutcomeDialogProps {
  outcome: Outcome;
  onCopy(text: string): void;
  onClose(): void;
}

/** Failure state: what failed, whether it was rolled back, and a copyable report. */
export function OutcomeDialog({ outcome, onCopy, onClose }: OutcomeDialogProps) {
  const rollback = outcome.kind === 'failed' || outcome.kind === 'cancelled' ? outcome.rollback : null;
  const skipped = outcome.kind === 'failed' || outcome.kind === 'undone' ? outcome.skipped : [];
  const error = outcome.kind === 'failed' ? outcome.error : null;
  const dialogRef = useRef<HTMLDivElement>(null);
  useEscapeKey(onClose);
  useFocusTrap(dialogRef);
  return (
    <div className="overlay">
      <div ref={dialogRef} className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="outcome-title">
        <h2 id="outcome-title">{dialogTitle(outcome)}</h2>
        <div className="dialog-body">
          {error && <p>{error}</p>}
          {rollback?.complete && <p>Every file was put back where it was.</p>}
          {rollback && rollback.stranded.length > 0 && (
            <>
              <p>These files couldn't be put back:</p>
              <ul className="report-list">
                {rollback.stranded.map((s) => (
                  <li key={s.original}>
                    <span className="mono">{s.original}</span> is now at <span className="mono">{s.current}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {rollback?.datesNotRestored && rollback.datesNotRestored.length > 0 && (
            <>
              <p>These files are back, but their dates couldn't be restored:</p>
              <ul className="report-list">
                {rollback.datesNotRestored.map((p) => (
                  <li key={p} className="mono">
                    {p}
                  </li>
                ))}
              </ul>
            </>
          )}
          {skipped.length > 0 && (
            <>
              <p>These files were left where they are:</p>
              <ul className="report-list">
                {skipped.map((s) => (
                  <li key={s.path}>
                    <span className="mono">{s.path}</span>: {s.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => onCopy(reportText(outcome))}>
            Copy report
          </button>
          <button type="button" className="btn btn-primary" autoFocus onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
