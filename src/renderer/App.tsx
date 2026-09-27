import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { Api, PreviewRow } from '../shared/ipc.js';
import { ActionBar } from './components/ActionBar.js';
import { EmptyState } from './components/EmptyState.js';
import { FilesStrip } from './components/FilesStrip.js';
import { OptionTabs } from './components/OptionTabs.js';
import { OutcomeDialog } from './components/OutcomeDialog.js';
import { PatternBar } from './components/PatternBar.js';
import { PresetPicker } from './components/PresetPicker.js';
import { PreviewPanel } from './components/PreviewPanel.js';
import { PreviewTable } from './components/PreviewTable.js';
import { usePanelWidth } from './components/usePanelWidth.js';
import { hasError, needsLook } from './lib/flags.js';
import { isDialogOutcome, noticeText } from './lib/outcome.js';
import { reselect } from './lib/selection.js';
import { renameBlockedReason, summarize } from './lib/summary.js';
import { useSession } from './state/useSession.js';

const NO_ROWS: PreviewRow[] = [];

/** ".heic" from the first row's new name, or from its current name when it has none. */
function extensionOf(rows: readonly PreviewRow[]): string {
  const first = rows[0];
  if (!first) return '';
  const name = first.newName || first.currentName;
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot) : '';
}

/** The window: files strip, pattern bar, option tabs, preview, action bar. */
export function App({ api }: { api: Api }) {
  const [state, actions] = useSession(api);
  const [onlyNeedsLook, setOnlyNeedsLook] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  /** Counts nested drag-enter/leave pairs, so crossing a child element doesn't hide the overlay. */
  const dragCounter = useRef(0);
  /** The row the preview panel shows, kept while the panel is closed. */
  const [selected, setSelected] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelWidth, setPanelWidth] = usePanelWidth();
  /** Where the selected row was, so a selection that disappears lands on its neighbor. */
  const selectedIndex = useRef(0);

  const rows = state.plan?.rows ?? NO_ROWS;
  const summary = useMemo(() => summarize(rows), [rows]);
  const excluded = useMemo(() => new Set(state.excluded), [state.excluded]);
  const visiblePaths = useMemo(() => (onlyNeedsLook ? rows.filter(needsLook) : rows).map((r) => r.path), [rows, onlyNeedsLook]);
  const shown = reselect(visiblePaths, selected, selectedIndex.current);
  const panelRow = panelOpen && shown !== null ? (rows.find((r) => r.path === shown) ?? null) : null;
  const blockedReason = renameBlockedReason({
    plan: state.plan,
    scanning: state.scanning,
    metadata: state.metadata,
    summary,
    planPending: state.planPending,
  });
  const exiftoolFailed = state.metadata?.exiftoolFailed ?? false;
  const dialogOutcome = state.outcome && isDialogOutcome(state.outcome) ? state.outcome : null;

  useEffect(() => {
    if (shown !== selected) setSelected(shown);
    if (shown === null) setPanelOpen(false);
    else selectedIndex.current = visiblePaths.indexOf(shown);
  }, [shown, selected, visiblePaths]);

  // A later read that fails again brings the banner back.
  useEffect(() => {
    if (!exiftoolFailed) setBannerDismissed(false);
  }, [exiftoolFailed]);

  const { updateSettings, addPaths, pathForFile, include, exclude } = actions;
  const toggleFiles = useCallback(
    (paths: string[], back: boolean) => (back ? include(paths) : exclude(paths)),
    [include, exclude],
  );
  const select = useCallback((path: string, open: boolean) => {
    setSelected(path);
    if (open) setPanelOpen(true);
  }, []);
  const setPattern = useCallback((pattern: string) => updateSettings((s) => ({ ...s, pattern })), [updateSettings]);

  const dropProps = {
    onDragEnter: () => {
      dragCounter.current += 1;
      if (state.busy === null) setDragging(true);
    },
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = state.busy === null ? 'copy' : 'none';
    },
    onDragLeave: () => {
      dragCounter.current = Math.max(0, dragCounter.current - 1);
      if (dragCounter.current === 0) setDragging(false);
    },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragCounter.current = 0;
      setDragging(false);
      if (state.busy !== null) return;
      addPaths(Array.from(e.dataTransfer.files, (f) => pathForFile(f)).filter((p) => p !== ''));
    },
  };

  if (state.sources.length === 0) {
    return (
      <div className={dragging ? 'app dragging' : 'app'} {...dropProps}>
        <EmptyState
          onPick={(kind) => void actions.pick(kind)}
          onUndo={state.canUndo ? () => void actions.undo() : undefined}
          busy={state.busy !== null}
          notice={state.outcome && !isDialogOutcome(state.outcome) ? noticeText(state.outcome) : null}
        />
        {dialogOutcome && <OutcomeDialog outcome={dialogOutcome} onCopy={actions.copyText} onClose={actions.dismissOutcome} />}
      </div>
    );
  }

  return (
    <div className="app" {...dropProps}>
      <div className="panes" inert={state.busy !== null}>
        <FilesStrip
          sources={state.sources}
          files={state.files}
          scanning={state.scanning}
          metadata={state.metadata}
          filter={state.settings.filter}
          onFilter={(patch) => updateSettings((s) => ({ ...s, filter: { ...s.filter, ...patch } }))}
          onPick={(kind) => void actions.pick(kind)}
          onRemoveSource={actions.removeSource}
        >
          <PresetPicker
            presets={state.presets}
            current={state.presetName}
            onLoad={actions.loadPreset}
            onSave={actions.savePreset}
            onDelete={actions.deletePreset}
          />
        </FilesStrip>
        {exiftoolFailed && !bannerDismissed && (
          <div className="banner" role="alert">
            <span>
              Couldn't read photo, video and audio details, so the rest of these files use their file dates. Names built from
              camera or audio tags may be missing values.
            </span>
            <button type="button" className="btn-link" aria-label="Dismiss warning" onClick={() => setBannerDismissed(true)}>
              Dismiss
            </button>
          </div>
        )}
        <PatternBar
          pattern={state.settings.pattern}
          onChange={setPattern}
          extension={extensionOf(rows)}
          error={state.plan?.patternError ?? null}
          loadTokenValues={actions.tokenValues}
        />
        <OptionTabs
          settings={state.settings}
          onChange={updateSettings}
          platform={state.platform}
          onChooseDestination={() => void actions.chooseDestination()}
        />
        <div className="preview-split">
          <PreviewTable
            rows={rows}
            onlyNeedsLook={onlyNeedsLook}
            onOnlyNeedsLook={setOnlyNeedsLook}
            excluded={excluded}
            onToggle={toggleFiles}
            onEditName={actions.setOverride}
            onReorder={actions.reorder}
            selected={shown}
            onSelect={select}
            onTogglePanel={() => setPanelOpen((open) => !open)}
            onClosePanel={() => setPanelOpen(false)}
          />
          {panelRow && (
            <PreviewPanel
              api={api}
              row={panelRow}
              platform={state.platform}
              included={!excluded.has(panelRow.path)}
              busy={state.busy !== null}
              width={panelWidth}
              onWidth={setPanelWidth}
              onToggle={(include) => toggleFiles([panelRow.path], include)}
              onClose={() => {
                setPanelOpen(false);
                // Back to the row, so the arrow keys keep working after × or Escape.
                Array.from(document.querySelectorAll<HTMLElement>('.preview-row'))
                  .find((el) => el.dataset.path === panelRow.path)
                  ?.focus();
              }}
            />
          )}
        </div>
      </div>
      <ActionBar
        summary={summary}
        busy={state.busy}
        progress={state.progress}
        blockedReason={blockedReason}
        canUndo={state.canUndo}
        canExclude={summary.errors > 0 && state.plan?.patternError === null}
        excludedCount={state.excluded.length}
        notice={dialogOutcome ? null : state.outcome}
        onRename={() => void actions.rename()}
        onCancel={actions.cancel}
        onUndo={() => void actions.undo()}
        onExcludeErrors={() => actions.exclude(rows.filter(hasError).map((r) => r.path))}
        onIncludeExcluded={actions.includeExcluded}
        onDismiss={actions.dismissOutcome}
        hasLastBatch={state.lastChanges.length > 0}
        onExportPreview={() => void actions.exportPreview()}
        onExportLast={() => void actions.exportLastBatch()}
        onImportNames={() => void actions.importNames()}
      />
      {dragging && <div className="drop-overlay" aria-hidden="true" />}
      {dialogOutcome && <OutcomeDialog outcome={dialogOutcome} onCopy={actions.copyText} onClose={actions.dismissOutcome} />}
    </div>
  );
}
