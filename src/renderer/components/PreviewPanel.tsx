import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { extensionOf, previewKind, previewUrl } from '../../core/preview.js';
import type { Platform } from '../../core/types.js';
import type { Api, FileDetails, PreviewRow } from '../../shared/ipc.js';
import { formatBytes, formatDuration, showInFolderLabel } from '../lib/fileInfo.js';
import { ipcMessage } from '../state/useSession.js';
import { XIcon } from './icons.js';
import { clampPanelWidth } from './usePanelWidth.js';

// pdf.js is large; it loads the first time a PDF is shown.
const PdfView = lazy(() => import('./PdfView.js').then((m) => ({ default: m.PdfView })));

/** How far one arrow key press moves the panel's edge. */
const KEY_STEP = 10;

export interface PreviewPanelProps {
  api: Pick<Api, 'fileDetails' | 'showInFolder' | 'openFile'>;
  row: PreviewRow;
  platform: Platform | null;
  included: boolean;
  /** A rename or undo is running: the media is unloaded so no file is held open. */
  busy: boolean;
  width: number;
  onWidth(width: number): void;
  onToggle(include: boolean): void;
  onClose(): void;
}

/** Shown when the preview can't be: a message in the media area. */
const Note = ({ children }: { children: ReactNode }) => <p className="panel-note">{children}</p>;

/** The file itself: a picture, a player, a PDF page, or why there is none. */
function Media({ row, busy }: { row: PreviewRow; busy: boolean }) {
  const [failed, setFailed] = useState(false);
  const media = useRef<HTMLMediaElement | null>(null);
  const kind = previewKind(row.currentName, row.isDir);
  const url = previewUrl(row.path);
  const fail = useCallback(() => setFailed(true), []);

  useEffect(() => {
    // Removing a <video> from the page doesn't always stop its download; clearing src does.
    const el = media.current;
    return () => {
      if (!el) return;
      el.removeAttribute('src');
      el.load();
    };
  }, [url, busy]);

  if (row.isDir) return <Note>Folders have no preview.</Note>;
  if (kind === null) {
    const ext = extensionOf(row.currentName);
    return <Note>{ext ? `No preview for .${ext} files.` : 'No preview for this file.'}</Note>;
  }
  if (busy) return <Note>The preview is paused while files are renamed.</Note>;
  if (failed) return <Note>{kind === 'video' ? "Couldn't play this video." : "Couldn't show this file."}</Note>;

  switch (kind) {
    case 'image':
    case 'raw':
    case 'heic':
      return <img className="panel-image" src={url} alt={`Preview of ${row.currentName}`} decoding="async" onError={fail} />;
    case 'video':
      return (
        <video ref={(el) => void (media.current = el)} className="panel-video" src={url} controls muted preload="metadata" aria-label={`Preview of ${row.currentName}`} onError={fail} />
      );
    case 'audio':
      return <audio ref={(el) => void (media.current = el)} className="panel-audio" src={url} controls preload="metadata" aria-label={`Preview of ${row.currentName}`} onError={fail} />;
    case 'pdf':
      return (
        <Suspense fallback={<Note>Loading…</Note>}>
          <PdfView url={url} name={row.currentName} onError={fail} />
        </Suspense>
      );
  }
}

/** Spec P2: the file preview beside the table, for the selected row. */
export function PreviewPanel({ api, row, platform, included, busy, width, onWidth, onToggle, onClose }: PreviewPanelProps) {
  const [details, setDetails] = useState<FileDetails | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const drag = useRef<{ startX: number; base: number } | null>(null);

  useEffect(() => {
    let live = true;
    setDetails(null);
    setActionError(null);
    api.fileDetails(row.path).then(
      (d) => live && setDetails(d),
      () => live && setDetails(null),
    );
    return () => {
      live = false;
    };
  }, [api, row.path]);

  const act = (run: () => Promise<string | null | void>) => {
    setActionError(null);
    run().then(
      (error) => setActionError(typeof error === 'string' ? error : null),
      (e: unknown) => setActionError(ipcMessage(e)),
    );
  };

  const setWidth = (w: number) => onWidth(clampPanelWidth(w, window.innerWidth));
  const facts: [string, ReactNode][] = [];
  if (details?.width && details.height) facts.push(['Dimensions', `${details.width} × ${details.height}`]);
  if (details?.durationSeconds) facts.push(['Duration', formatDuration(details.durationSeconds)]);
  if (details) facts.push(['Size', formatBytes(details.size)]);
  if (row.dateUsed) facts.push(['Date used', row.dateSource ? `${row.dateUsed} (${row.dateSource})` : row.dateUsed]);
  facts.push(['Folder', <span title={row.folderPath}>{row.folderPath}</span>]);

  return (
    <aside className="file-panel" aria-label="File preview" style={{ width }}>
      <span
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize preview panel"
        aria-valuenow={width}
        tabIndex={0}
        className="panel-resize"
        title="Drag to resize"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          drag.current = { startX: e.clientX, base: width };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          // The edge is on the panel's left, so dragging left widens it.
          if (d) setWidth(d.base - (e.clientX - d.startX));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={(e) => {
          const step = e.key === 'ArrowLeft' ? KEY_STEP : e.key === 'ArrowRight' ? -KEY_STEP : 0;
          if (step === 0) return;
          e.preventDefault();
          setWidth(width + step);
        }}
      />
      <div
        className="panel-scroll"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
      >
        <div className="panel-head">
          <span className="label">Preview</span>
          <button type="button" className="icon-btn" aria-label="Close preview" onClick={onClose}>
            <XIcon />
          </button>
        </div>
        <div className="panel-media">
          {/* Keyed by busy too: a video cut off by a rename that was then cancelled loads again. */}
          <Media key={`${row.path}\n${busy}`} row={row} busy={busy} />
        </div>
        <div className="panel-names">
          <div className="mono old">{row.currentName}</div>
          <div className="mono new">
            <span className="muted" aria-hidden="true">
              →{' '}
            </span>
            {included ? row.newName || '—' : <span className="muted">Left out, keeps its name</span>}
          </div>
        </div>
        <div className="panel-actions">
          <button type="button" className="btn btn-small" onClick={() => onToggle(!included)} disabled={busy}>
            {included ? 'Leave out' : 'Put back'}
          </button>
          <button type="button" className="btn btn-small" onClick={() => act(() => api.showInFolder(row.path))}>
            {showInFolderLabel(platform)}
          </button>
          <button type="button" className="btn btn-small" onClick={() => act(() => api.openFile(row.path))}>
            Open
          </button>
        </div>
        {actionError && (
          <p className="panel-error" role="alert">
            {actionError}
          </p>
        )}
        <dl className="panel-facts">
          {facts.map(([term, value]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </aside>
  );
}
