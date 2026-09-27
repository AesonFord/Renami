import { useRef, useState, type ReactNode } from 'react';
import type { ProgressView } from '../../shared/ipc.js';
import { noticeText } from '../lib/outcome.js';
import { renameLabel, summaryParts, type Summary } from '../lib/summary.js';
import type { Busy, Outcome } from '../state/useSession.js';
import { UndoIcon, XIcon } from './icons.js';
import { Popover } from './Popover.js';

export interface ActionBarProps {
  summary: Summary;
  busy: Busy;
  progress: ProgressView | null;
  /** Why Rename is disabled; null when it is enabled. */
  blockedReason: string | null;
  canUndo: boolean;
  /** Error rows exist and the pattern itself is valid, so excluding them helps. */
  canExclude: boolean;
  excludedCount: number;
  /** An outcome to show inline. Dialog outcomes are shown by OutcomeDialog instead. */
  notice: Outcome | null;
  onRename(): void;
  onCancel(): void;
  onUndo(): void;
  onExcludeErrors(): void;
  onIncludeExcluded(): void;
  onDismiss(): void;
  /** Opens a text or CSV file with new names (T24). Hidden until given. */
  onImportNames?(): void;
  /** Saves the preview as CSV. Hidden until given; brings the Export menu with it. */
  onExportPreview?(): void;
  /** Saves the last finished rename as CSV. */
  onExportLast?(): void;
  /** Whether a rename has finished in this session, so onExportLast has something to save. */
  hasLastBatch?: boolean;
}

const TONE_CLASS = { strong: undefined, neutral: 'muted', accent: undefined, warn: 'text-warn', suffix: 'text-suffix', error: 'text-error' };

/** The action bar: summary counts, Undo last rename, and Rename N files. */
export function ActionBar(props: ActionBarProps) {
  const { summary, busy, progress, notice } = props;
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const [exportOpen, setExportOpen] = useState(false);
  const exportAnchor = useRef<HTMLDivElement>(null);
  const exportButton = useRef<HTMLButtonElement>(null);
  const closeExport = (): void => {
    setExportOpen(false);
    exportButton.current?.focus();
  };
  const pick = (action: (() => void) | undefined): void => {
    closeExport();
    action?.();
  };

  let left: ReactNode;
  if (busy) {
    left = (
      <div className="notice" role="status">
        <span>
          {busy === 'renaming' ? 'Renaming' : 'Undoing'}
          {progress ? ` ${progress.done} of ${progress.total}` : '…'}
        </span>
        {progress && (
          <span className="progress" aria-hidden="true">
            <span style={{ width: `${pct}%` }} />
          </span>
        )}
        <button type="button" className="btn btn-small" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    );
  } else if (notice) {
    left = (
      <div className="notice" role="status">
        <span>{noticeText(notice)}</span>
        {notice.kind === 'renamed' && props.canUndo && (
          <button type="button" className="btn-link" onClick={props.onUndo}>
            Undo
          </button>
        )}
        <button type="button" className="icon-btn" aria-label="Dismiss" onClick={props.onDismiss}>
          <XIcon />
        </button>
      </div>
    );
  } else {
    left = (
      <div className="summary">
        {summaryParts(summary).map((part) => (
          <span key={part.text} className={TONE_CLASS[part.tone]}>
            {part.tone === 'strong' ? <strong>{part.count}</strong> : part.count} <span>{part.text}</span>
          </span>
        ))}
        {props.canExclude && (
          <button type="button" className="btn btn-small" onClick={props.onExcludeErrors}>
            Exclude these files
          </button>
        )}
        {props.excludedCount > 0 && (
          <button type="button" className="btn-link" onClick={props.onIncludeExcluded}>
            Put back {props.excludedCount} excluded {props.excludedCount === 1 ? 'file' : 'files'}
          </button>
        )}
      </div>
    );
  }

  return (
    <footer className="action-bar">
      {left}
      <span className="spacer" />
      {props.onImportNames && (
        <button type="button" className="btn" disabled={busy !== null} onClick={props.onImportNames}>
          Import names…
        </button>
      )}
      {props.onExportPreview && (
        <div className="menu-anchor" ref={exportAnchor}>
          <button
            ref={exportButton}
            type="button"
            className="btn"
            aria-haspopup="menu"
            aria-expanded={exportOpen}
            disabled={busy !== null}
            onClick={() => setExportOpen((open) => !open)}
          >
            Export…
          </button>
          {exportOpen && (
            <Popover label="Export" role="menu" anchor={exportAnchor} onClose={closeExport} style={{ bottom: 'calc(100% + 4px)', right: 0 }}>
              <button type="button" role="menuitem" className="menu-item" autoFocus onClick={() => pick(props.onExportPreview)}>
                Preview as CSV…
              </button>
              <button type="button" role="menuitem" className="menu-item" disabled={!props.hasLastBatch} onClick={() => pick(props.onExportLast)}>
                Last rename as CSV…
              </button>
            </Popover>
          )}
        </div>
      )}
      <button type="button" className="btn" disabled={!props.canUndo || busy !== null} onClick={props.onUndo}>
        <UndoIcon />
        Undo last rename
      </button>
      <button
        type="button"
        className="btn btn-primary"
        disabled={props.blockedReason !== null || busy !== null}
        title={props.blockedReason ?? undefined}
        onClick={props.onRename}
      >
        {renameLabel(summary)}
      </button>
    </footer>
  );
}
