import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { PreviewRow } from '../../shared/ipc.js';
import { cellText, clampWidths, COLUMNS, contentWidth, fitWidth, MAX_WIDTH, resize, template, type Widths } from '../lib/columns.js';
import { badgesFor, needsLook, rowTone, statusTitle } from '../lib/flags.js';
import { editableStem, moveBefore, moveStep } from '../lib/rows.js';
import { isSelectionKey, stepSelection } from '../lib/selection.js';
import { Popover } from './Popover.js';
import { useColumnWidths } from './useColumnWidths.js';

export const ROW_HEIGHT = 36;

/** How far one arrow key press moves a column divider. */
const KEY_STEP = 10;

/** Must match .badge and .badges in styles.css. */
const BADGE_PADDING = 16;
const BADGE_GAP = 4;

/** Must match .row-check and .name-cell in styles.css: the checkbox and its gap before the name. */
const CHECK_SPACE = 22;

const STATUS_COL = COLUMNS.length - 1;

/**
 * A click opens the preview panel only once this long has passed without a second click.
 * Opening it narrows the table, so a double-click (to type a name) would land on another cell.
 */
export const OPEN_DELAY_MS = 250;

let canvas: HTMLCanvasElement | null = null;

/** Measures text in the font `sample` uses; null where the platform can't (jsdom has no canvas). */
function textMeasurer(sample: Element | null): ((text: string) => number) | null {
  canvas ??= document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if (sample) ctx.font = getComputedStyle(sample).font;
  return (text) => ctx.measureText(text).width;
}

export interface PreviewTableProps {
  rows: PreviewRow[];
  onlyNeedsLook: boolean;
  onOnlyNeedsLook(value: boolean): void;
  /** Source paths the user unchecked. Drives the checkboxes, so they answer before the plan catches up. */
  excluded: ReadonlySet<string>;
  /** `include` true puts the files back in the batch; false leaves them out. */
  onToggle(paths: string[], include: boolean): void;
  /** Present when new names can be typed in place; null clears a typed name. */
  onEditName?(path: string, stem: string | null): void;
  /** Present when rows can be dragged (or moved with Alt+arrows); gets the visible paths in their new order. */
  onReorder?(paths: string[]): void;
  /** The row the preview panel shows. */
  selected?: string | null;
  /** Present when rows can be selected: a click (`open` true) or an arrow, Home or End key picked a row. */
  onSelect?(path: string, open: boolean): void;
  /** Space on the selected row. */
  onTogglePanel?(): void;
  /** Escape on a row. */
  onClosePanel?(): void;
}

/** The virtualized preview of every new name, with resizable columns. */
export function PreviewTable({
  rows,
  onlyNeedsLook,
  onOnlyNeedsLook,
  excluded,
  onToggle,
  onEditName,
  onReorder,
  selected = null,
  onSelect,
  onTogglePanel,
  onClosePanel,
}: PreviewTableProps) {
  const lookCount = useMemo(() => rows.filter(needsLook).length, [rows]);
  const visible = useMemo(() => (onlyNeedsLook ? rows.filter(needsLook) : rows), [rows, onlyNeedsLook]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const headScrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useColumnWidths();
  const [menuAt, setMenuAt] = useState<{ left: number; top: number } | null>(null);
  const drag = useRef<{ col: number; startX: number; base: Widths | null } | null>(null);
  /** The file last clicked, where a Shift-click range starts. */
  const anchor = useRef<string | null>(null);
  const includedShown = useMemo(() => visible.filter((r) => !excluded.has(r.path)).length, [visible, excluded]);
  const allShown = visible.length > 0 && includedShown === visible.length;
  const mixed = includedShown > 0 && !allShown;
  const [editing, setEditing] = useState<{ path: string; draft: string } | null>(null);
  /** Set before the editor closes on purpose, so the blur that follows doesn't commit again. */
  const skipBlur = useRef(false);
  const dragPath = useRef<string | null>(null);
  const editable = onEditName !== undefined;
  const reorderable = onReorder !== undefined;
  const selectable = onSelect !== undefined;
  /** A row the keyboard moved to, focused once the virtualizer has rendered it. */
  const pendingFocus = useRef<string | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelOpen = (): void => {
    if (openTimer.current !== null) clearTimeout(openTimer.current);
    openTimer.current = null;
  };
  useEffect(() => cancelOpen, []);

  const startEditing = (r: PreviewRow): void => {
    // A stale flag from an earlier Enter or Escape (blur doesn't always fire on unmount) must not swallow this edit's blur.
    skipBlur.current = false;
    setEditing({ path: r.path, draft: editableStem(r) });
  };
  const commitEditing = (): void => {
    if (!editing) return;
    const stem = editing.draft.trim();
    skipBlur.current = true;
    setEditing(null);
    onEditName?.(editing.path, stem === '' ? null : stem);
  };
  const cancelEditing = (): void => {
    skipBlur.current = true;
    setEditing(null);
  };
  const visiblePaths = (): string[] => visible.map((v) => v.path);
  /** Every row's path, in plan order: dragging or moving a row reorders against this, not just
   * the (possibly filtered) visible list, so hidden rows keep their place. */
  const allPaths = (): string[] => rows.map((v) => v.path);
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  // Runs after every render: the row may only appear once the scroll to it has rendered.
  useEffect(() => {
    const p = pendingFocus.current;
    if (p === null) return;
    const el = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>('[role="row"]') ?? []).find((e) => e.dataset.path === p);
    if (!el) return;
    pendingFocus.current = null;
    el.focus();
  });

  /** Selects a row from the keyboard, scrolls it into view and moves focus to it. */
  const moveTo = (path: string): void => {
    onSelect?.(path, false);
    pendingFocus.current = path;
    const index = visible.findIndex((v) => v.path === path);
    if (index !== -1) virtualizer.scrollToIndex(index, { align: 'auto' });
  };

  /** The widths in effect: the fixed ones, or what the default layout gives each column right now. */
  const current = (): Widths =>
    widths ?? clampWidths(Array.from(headRef.current?.children ?? [], (el) => (el as HTMLElement).offsetWidth));

  /** Sizes a column to its widest value in any row, not just the rows on screen. */
  const fit = (col: number): void => {
    const body = scrollRef.current;
    const label = headRef.current?.children[col]?.firstElementChild;
    const sizes = [label?.scrollWidth ?? 0];
    if (col === 0) {
      const measure = textMeasurer(body?.querySelector('.preview-row .old') ?? null);
      if (measure) for (const r of visible) sizes.push(measure(r.currentName));
      sizes.forEach((w, i) => (sizes[i] = w + CHECK_SPACE));
    } else if (col === STATUS_COL) {
      const measure = textMeasurer(body?.querySelector('.badge') ?? null);
      if (measure) {
        for (const r of visible) {
          const badges = badgesFor(r);
          const first = badges[0] ? measure(badges[0].label) + BADGE_PADDING : 0;
          sizes.push(badges.length > 1 ? first + BADGE_GAP + measure(`+${badges.length - 1}`) + BADGE_PADDING : first);
        }
      }
    } else {
      const measure = textMeasurer(body?.querySelector(`[role="row"] > :nth-child(${col + 1})`) ?? null);
      if (measure) for (const r of visible) sizes.push(measure(cellText(r, col)));
    }
    setWidths(resize(current(), col, fitWidth(col, sizes)));
  };

  const divider = (col: number): ReactNode => (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${COLUMNS[col]!.label} column`}
      aria-valuenow={widths?.[col]}
      aria-valuemin={COLUMNS[col]!.min}
      aria-valuemax={MAX_WIDTH}
      tabIndex={0}
      className="col-resize"
      title="Drag to resize · Double-click to fit · Right-click the header to reset"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drag.current = { col, startX: e.clientX, base: null };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || e.clientX === d.startX) return;
        // Fix the layout on the first real move, so a plain click leaves the default layout alone.
        d.base ??= current();
        setWidths(resize(d.base, d.col, d.base[d.col]! + e.clientX - d.startX));
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={() => fit(col)}
      onKeyDown={(e) => {
        const step = e.key === 'ArrowRight' ? KEY_STEP : e.key === 'ArrowLeft' ? -KEY_STEP : 0;
        if (step === 0) return;
        e.preventDefault();
        const base = current();
        setWidths(resize(base, col, base[col]! + step));
      }}
    />
  );

  /** A Shift-click sets every file from the last one clicked to this one. */
  const toggle = (path: string, include: boolean, shift: boolean): void => {
    const from = shift && anchor.current !== null ? visible.findIndex((r) => r.path === anchor.current) : -1;
    const to = visible.findIndex((r) => r.path === path);
    anchor.current = path;
    if (from === -1 || to === -1) return onToggle([path], include);
    const [lo, hi] = from < to ? [from, to] : [to, from];
    onToggle(visible.slice(lo, hi + 1).map((r) => r.path), include);
  };

  const rowWidth: CSSProperties | undefined = widths ? { minWidth: contentWidth(widths) } : undefined;

  return (
    <section className="preview" aria-label="Preview">
      <div
        ref={tableRef}
        className="preview-table"
        role="table"
        aria-label="New names"
        aria-rowcount={visible.length + 1}
        style={widths ? ({ '--cols': template(widths) } as CSSProperties) : undefined}
      >
        <div
          ref={headScrollRef}
          className="preview-head-scroll"
          role="rowgroup"
          onContextMenu={(e) => {
            e.preventDefault();
            const box = tableRef.current?.getBoundingClientRect();
            setMenuAt({ left: e.clientX - (box?.left ?? 0), top: e.clientY - (box?.top ?? 0) });
          }}
        >
          <div ref={headRef} className="cols preview-head" role="row" aria-rowindex={1} style={rowWidth}>
            <span role="columnheader" className="col-head name-cell" aria-label={COLUMNS[0].label}>
              <input
                type="checkbox"
                className="row-check"
                aria-label="Rename all files shown"
                checked={allShown}
                disabled={visible.length === 0}
                ref={(el) => {
                  if (el) el.indeterminate = mixed;
                }}
                onChange={() => onToggle(visible.map((r) => r.path), !allShown)}
              />
              <span className="col-label">{COLUMNS[0].label}</span>
              {divider(0)}
            </span>
            {COLUMNS.slice(1, STATUS_COL).map((c, i) => (
              <span key={c.label} role="columnheader" className="col-head">
                <span className="col-label">{c.label}</span>
                {divider(i + 1)}
              </span>
            ))}
            <span role="columnheader" className="col-head">
              <span className="col-label inline">
                Status
                {(lookCount > 0 || onlyNeedsLook) && (
                  <label className="check look-toggle">
                    <input type="checkbox" checked={onlyNeedsLook} onChange={(e) => onOnlyNeedsLook(e.target.checked)} />
                    Show only files that need a look ({lookCount})
                  </label>
                )}
              </span>
              {divider(STATUS_COL)}
            </span>
          </div>
        </div>
        <div
          ref={scrollRef}
          className="preview-body"
          role="rowgroup"
          onScroll={(e) => {
            // The header sits outside the scroller, so it follows sideways scrolling by hand.
            if (headScrollRef.current) headScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
          }}
        >
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative', ...rowWidth }}>
            {virtualizer.getVirtualItems().map((item) => {
              const r = visible[item.index];
              if (!r) return null;
              const badges = badgesFor(r);
              const first = badges[0];
              const title = statusTitle(r);
              const included = !excluded.has(r.path);
              // A file left out keeps its name, so there is nothing to type.
              const canEdit = editable && included;
              return (
                <div
                  key={r.path}
                  role="row"
                  aria-rowindex={item.index + 2}
                  className={`cols preview-row row-${rowTone(r)}${included ? '' : ' row-excluded'}${r.path === selected ? ' row-selected' : ''}`}
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
                  data-path={r.path}
                  // aria-selected is only for grids; a plain table marks the current row instead.
                  aria-current={selectable && r.path === selected ? 'true' : undefined}
                  tabIndex={editable || reorderable || selectable ? 0 : undefined}
                  onClick={(e) => {
                    // The checkbox and the name editor keep their clicks.
                    if ((e.target as HTMLElement).closest('input') || !onSelect) return;
                    cancelOpen();
                    onSelect(r.path, false);
                    if (e.detail > 1) return;
                    openTimer.current = setTimeout(() => {
                      openTimer.current = null;
                      onSelect(r.path, true);
                    }, OPEN_DELAY_MS);
                  }}
                  draggable={reorderable}
                  onDragStart={(e) => {
                    dragPath.current = r.path;
                    e.dataTransfer?.setData('text/plain', r.path);
                  }}
                  onDragOver={(e) => {
                    if (dragPath.current !== null) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = dragPath.current;
                    dragPath.current = null;
                    if (from === null || from === r.path) return;
                    onReorder?.(moveBefore(allPaths(), from, r.path));
                  }}
                  onDragEnd={() => {
                    dragPath.current = null;
                  }}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (reorderable && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                      e.preventDefault();
                      onReorder?.(moveStep(allPaths(), visiblePaths(), r.path, e.key === 'ArrowUp' ? -1 : 1));
                    } else if (canEdit && e.key === 'Enter') {
                      e.preventDefault();
                      startEditing(r);
                    } else if (selectable && !e.altKey && isSelectionKey(e.key)) {
                      e.preventDefault();
                      const next = stepSelection(visiblePaths(), r.path, e.key);
                      if (next !== null) moveTo(next);
                      else if (r.path !== selected) onSelect?.(r.path, false);
                    } else if (selectable && e.key === ' ') {
                      e.preventDefault();
                      if (r.path === selected) onTogglePanel?.();
                      else onSelect?.(r.path, true);
                    } else if (selectable && e.key === 'Escape') {
                      onClosePanel?.();
                    } else if (selectable && (e.key === 'Delete' || e.key === 'Backspace')) {
                      // Leaves the file out (or puts it back), then moves on, for going through shots quickly.
                      e.preventDefault();
                      onToggle([r.path], !included);
                      const next = stepSelection(visiblePaths(), r.path, 'ArrowDown');
                      if (next !== null) moveTo(next);
                      else onSelect?.(r.path, false);
                    }
                  }}
                >
                  {/* Labelled so the checkbox doesn't join the cell's name, which is how rows are found. */}
                  <span role="cell" className="name-cell" aria-label={r.currentName}>
                    <input
                      type="checkbox"
                      className="row-check"
                      aria-label={`Rename ${r.currentName}`}
                      checked={included}
                      // React fires onChange from the click, so a mouse click carries its Shift key.
                      onChange={(e) => toggle(r.path, !included, (e.nativeEvent as MouseEvent).shiftKey === true)}
                    />
                    <span className="mono ellip old" title={r.currentName}>
                      {r.currentName}
                    </span>
                  </span>
                  <span
                    role="cell"
                    className={canEdit ? 'mono ellip new editable' : 'mono ellip new'}
                    title={canEdit ? `${r.newName || '—'}\nDouble-click to type a name` : r.newName}
                    onDoubleClick={canEdit ? () => startEditing(r) : undefined}
                  >
                    {editing?.path === r.path ? (
                      <input
                        className="field mono name-edit"
                        aria-label={`New name for ${r.currentName}`}
                        value={editing.draft}
                        autoFocus
                        spellCheck={false}
                        onChange={(e) => setEditing({ path: r.path, draft: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitEditing();
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            cancelEditing();
                          }
                          e.stopPropagation();
                        }}
                        onBlur={() => {
                          if (skipBlur.current) {
                            skipBlur.current = false;
                            return;
                          }
                          commitEditing();
                        }}
                      />
                    ) : (
                      r.newName || '—'
                    )}
                  </span>
                  <span role="cell" className="ellip">
                    {r.dateUsed ?? '—'}
                    {r.dateUsed !== null && r.dateSource !== null && r.dateSource !== 'taken' && (
                      <span className="muted"> ({r.dateSource})</span>
                    )}
                  </span>
                  <span role="cell" className="ellip muted" title={r.folderPath}>
                    {r.folder}
                  </span>
                  <span role="cell" className="badges">
                    {first && (
                      <span className={`badge tone-${first.tone}`} title={title}>
                        {first.label}
                      </span>
                    )}
                    {badges.length > 1 && (
                      <span className={`badge tone-${badges[1]!.tone}`} title={title}>
                        +{badges.length - 1}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        {menuAt && (
          <Popover label="Columns" role="menu" onClose={() => setMenuAt(null)} style={menuAt}>
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              autoFocus
              onClick={() => {
                setWidths(null);
                setMenuAt(null);
              }}
            >
              Reset column widths
            </button>
          </Popover>
        )}
      </div>
      {visible.length === 0 && <p className="preview-empty">{onlyNeedsLook ? 'Nothing needs a look.' : 'No files to show.'}</p>}
    </section>
  );
}
