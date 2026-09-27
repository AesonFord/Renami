import type { PickKind } from '../../shared/ipc.js';
import { FolderIcon, UndoIcon } from './icons.js';

export interface EmptyStateProps {
  onPick(kind: PickKind): void;
  /** Offered while the last rename can still be undone, after every source was removed. */
  onUndo?: () => void;
  busy?: boolean;
  /** The last outcome's text, e.g. "Undid the last rename." */
  notice?: string | null;
}

/** Empty state: the whole window is a drop zone (App handles the drop). */
export function EmptyState({ onPick, onUndo, busy, notice }: EmptyStateProps) {
  return (
    <section className="empty" aria-label="Add files">
      <FolderIcon />
      <h1>Drop files or folders here</h1>
      <p>Or choose them:</p>
      <div className="inline">
        <button type="button" className="btn" onClick={() => onPick('files')}>
          Choose files…
        </button>
        <button type="button" className="btn" onClick={() => onPick('folder')}>
          Choose folder…
        </button>
      </div>
      {onUndo && (
        <button type="button" className="btn" disabled={busy} onClick={onUndo}>
          <UndoIcon />
          Undo last rename
        </button>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
