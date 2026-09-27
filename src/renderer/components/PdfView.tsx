import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useEffect, useRef, useState } from 'react';

GlobalWorkerOptions.workerSrc = workerUrl;

/** The page is drawn at the panel's width times this, so it stays sharp on high-DPI screens. */
const MAX_SCALE = 3;

export interface PdfViewProps {
  url: string;
  name: string;
  onError(): void;
}

/** Spec P3: one page of a PDF at a time, drawn by pdf.js from the batch file's bytes. */
export function PdfView({ url, name, onError }: PdfViewProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let live = true;
    let task: ReturnType<typeof getDocument> | null = null;
    // Fetched here and handed over as data, so the worker never makes a request of its own.
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((data) => {
        if (!live) return null;
        task = getDocument({ data, useWasm: false });
        return task.promise;
      })
      .then((d) => {
        if (live && d) setDoc(d);
      })
      .catch(() => live && onError());
    return () => {
      live = false;
      void task?.destroy();
    };
  }, [url, onError]);

  useEffect(() => {
    const el = canvas.current;
    if (!doc || !el) return;
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | null = null;
    let live = true;
    void doc.getPage(page).then((p) => {
      if (!live) return;
      const base = p.getViewport({ scale: 1 });
      const scale = Math.min(MAX_SCALE, ((el.parentElement?.clientWidth || base.width) / base.width) * window.devicePixelRatio);
      const viewport = p.getViewport({ scale });
      el.width = Math.floor(viewport.width);
      el.height = Math.floor(viewport.height);
      task = p.render({ canvas: el, viewport });
      task.promise.catch(() => {
        // Cancelled by a page change or unmount.
      });
    }, onError);
    return () => {
      live = false;
      task?.cancel();
    };
  }, [doc, page, onError]);

  const pages = doc?.numPages ?? 0;
  return (
    <div className="pdf-view">
      <canvas ref={canvas} className="panel-image" role="img" aria-label={`Page ${page} of ${name}`} />
      {pages > 1 && (
        <div className="pdf-pager">
          <button type="button" className="icon-btn" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ‹
          </button>
          <span className="muted">
            Page {page} of {pages}
          </span>
          <button type="button" className="icon-btn" aria-label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            ›
          </button>
        </div>
      )}
    </div>
  );
}
