import { useCallback, useEffect, useRef, useState } from 'react';
import { nameKey } from '../../core/names.js';
import { DEFAULT_SETTINGS, type Platform, type RenameSettings, type RollbackReport, type UndoResult } from '../../core/types.js';
import type {
  Api,
  FileChange,
  FilesSummary,
  MetadataStatus,
  PickKind,
  PlanView,
  PresetView,
  ProgressView,
  TokenValues,
} from '../../shared/ipc.js';
import { changesCsv, previewCsv } from '../lib/csv.js';
import { overridesFrom, parseNameList } from '../lib/importNames.js';

/** Preview rebuilds wait this long after the last change. */
export const PLAN_DEBOUNCE_MS = 100;

export type Busy = 'renaming' | 'undoing' | null;

type Skipped = UndoResult['skipped'];

/** True when p is the source itself or inside it, for / and \ separators, root sources included. */
function isInside(p: string, source: string): boolean {
  if (source.endsWith('/') || source.endsWith('\\')) return p.startsWith(source);
  return p === source || p.startsWith(`${source}/`) || p.startsWith(`${source}\\`);
}

/** What happened last, for the action bar notice or the failure dialog. */
export type Outcome =
  | { kind: 'renamed'; renamed: number; datesChanged: number }
  | { kind: 'undone'; restored: number; skipped: Skipped }
  | { kind: 'stale'; changed: string[] }
  | { kind: 'cancelled'; action: 'rename' | 'undo'; rollback: RollbackReport }
  | { kind: 'failed'; action: 'rename' | 'undo'; error: string | null; rollback: RollbackReport | null; skipped: Skipped }
  | { kind: 'message'; text: string };

export interface SessionState {
  platform: Platform | null;
  /** Dropped or picked paths, in the order they were added. */
  sources: string[];
  settings: RenameSettings;
  /** Source paths taken out of the batch with "Exclude these files". */
  excluded: string[];
  files: FilesSummary | null;
  scanning: boolean;
  metadata: MetadataStatus | null;
  plan: PlanView | null;
  /**
   * True from the moment a preview rebuild is due (files, settings, exclusions or metadata
   * changed) until its result is in `plan`. Main already holds the newer inputs, so the plan on
   * screen is not one it would run.
   */
  planPending: boolean;
  busy: Busy;
  progress: ProgressView | null;
  outcome: Outcome | null;
  canUndo: boolean;
  presets: PresetView[];
  /** The preset last loaded or saved; null for none. */
  presetName: string | null;
  /** New name stems the user typed or imported, by source path. */
  overrides: Record<string, string>;
  /** Source paths in the order the user arranged them (sortBy 'manual'). */
  manualOrder: string[];
  /** Every path change of the last finished rename, for "Last rename as CSV". */
  lastChanges: FileChange[];
}

export interface SessionActions {
  addPaths(paths: string[]): void;
  pick(kind: PickKind): Promise<void>;
  removeSource(path: string): void;
  updateSettings(update: (s: RenameSettings) => RenameSettings): void;
  exclude(paths: string[]): void;
  /** Puts these files back in the batch. */
  include(paths: string[]): void;
  includeExcluded(): void;
  rename(): Promise<void>;
  cancel(): void;
  undo(): Promise<void>;
  dismissOutcome(): void;
  loadPreset(name: string): void;
  savePreset(name: string): Promise<void>;
  deletePreset(name: string): Promise<void>;
  chooseDestination(): Promise<void>;
  tokenValues(): Promise<TokenValues | null>;
  copyText(text: string): void;
  pathForFile(file: File): string;
  /** null clears the typed name. */
  setOverride(path: string, stem: string | null): void;
  /** The visible rows' paths in their new order; switches Sort by to Manual order. */
  reorder(paths: string[]): void;
  exportPreview(): Promise<void>;
  exportLastBatch(): Promise<void>;
  importNames(): Promise<void>;
}

/** Electron wraps errors thrown in the main process: "Error invoking remote method 'x': Error: msg". */
export function ipcMessage(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  return text.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}

export function useSession(api: Api): [SessionState, SessionActions] {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [sources, setSources] = useState<string[]>([]);
  const [settings, setSettings] = useState<RenameSettings>(DEFAULT_SETTINGS);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [files, setFiles] = useState<FilesSummary | null>(null);
  const [scanning, setScanning] = useState(false);
  const [metadata, setMetadata] = useState<MetadataStatus | null>(null);
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [planPending, setPlanPending] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState<ProgressView | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [presets, setPresets] = useState<PresetView[]>([]);
  const [presetName, setPresetName] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [manualOrder, setManualOrder] = useState<string[]>([]);
  const [lastChanges, setLastChanges] = useState<FileChange[]>([]);
  /** Bumped to force the plan effect to run again for a preview request the busy guard skipped. */
  const [planNonce, setPlanNonce] = useState(0);
  const scanSeq = useRef(0);
  const planSeq = useRef(0);
  const busyRef = useRef<Busy>(null);
  /** Set when the debounce timer fires while a batch is busy, so its request never reached main. */
  const planSkipped = useRef(false);
  /** Forces a rebuild for a request `planSkipped` remembers. Callers only call this on exits that don't rescan. */
  const refreshSkippedPlan = () => {
    if (planSkipped.current) {
      planSkipped.current = false;
      setPlanNonce((n) => n + 1);
    }
  };
  /** Updates the guards at once, not at the next render, so no action slips in during a batch. */
  const markBusy = useCallback((next: Busy) => {
    busyRef.current = next;
    setBusy(next);
  }, []);

  const showError = (e: unknown) => setOutcome({ kind: 'message', text: ipcMessage(e) });

  /** Combines start-up failures into one message instead of letting the last one win. */
  const addMessage = (text: string) =>
    setOutcome((prev) => (prev?.kind === 'message' ? { kind: 'message', text: `${prev.text} ${text}` } : { kind: 'message', text }));

  // Start-up answers and main-process events.
  useEffect(() => {
    void api.platform().then(setPlatform).catch((e: unknown) => addMessage(ipcMessage(e)));
    void api.listPresets().then(setPresets).catch((e: unknown) => addMessage(ipcMessage(e)));
    void api.canUndo().then(setCanUndo).catch((e: unknown) => addMessage(ipcMessage(e)));
    const offMetadata = api.onMetadataProgress(setMetadata);
    const offProgress = api.onExecuteProgress(setProgress);
    return () => {
      offMetadata();
      offProgress();
    };
  }, [api]);

  // Rescan whenever the sources or the file filter change.
  const filterKey = JSON.stringify(settings.filter);
  const hadSources = useRef(false);
  useEffect(() => {
    scanSeq.current += 1;
    const seq = scanSeq.current;
    if (sources.length === 0) {
      setFiles(null);
      setPlan(null);
      setMetadata(null);
      setScanning(false);
      if (hadSources.current) {
        hadSources.current = false;
        void api.clear().catch(showError);
      }
      return;
    }
    hadSources.current = true;
    setScanning(true);
    const filter = JSON.parse(filterKey) as RenameSettings['filter'];
    api.scan(sources, filter).then(
      (summary) => {
        if (seq !== scanSeq.current) return;
        if (summary === null) {
          setScanning(false);
          return;
        }
        setFiles(summary);
        setScanning(false);
      },
      (e: unknown) => {
        if (seq !== scanSeq.current) return;
        setScanning(false);
        setOutcome({ kind: 'message', text: `Couldn't list the files: ${ipcMessage(e)}` });
      },
    );
  }, [api, sources, filterKey]);

  // Prunes exclusions, typed names and the manual order in one place, whenever the source list
  // changes: an entry stays only while some current source still covers its path. A rename
  // remaps `sources` to the renamed paths (afterBatch), but excluded files were never renamed,
  // and typed names and the order are cleared by afterBatch anyway.
  useEffect(() => {
    const covered = (p: string): boolean => sources.some((s) => isInside(p, s));
    setExcluded((prev) => {
      const kept = prev.filter(covered);
      return kept.length === prev.length ? prev : kept;
    });
    setManualOrder((prev) => {
      const kept = prev.filter(covered);
      return kept.length === prev.length ? prev : kept;
    });
    setOverrides((prev) => {
      const kept = Object.fromEntries(Object.entries(prev).filter(([p]) => covered(p)));
      return Object.keys(kept).length === Object.keys(prev).length ? prev : kept;
    });
  }, [sources]);

  // Rebuild the preview after anything it depends on changes, debounced.
  const metadataDone = metadata?.done ?? 0;
  const metadataFinished = metadata?.finished ?? false;
  useEffect(() => {
    planSeq.current += 1;
    const seq = planSeq.current;
    if (files === null) {
      setPlanPending(false);
      return;
    }
    setPlanPending(true);
    const timer = setTimeout(() => {
      // Still pending: every exit from a batch either rescans or calls refreshSkippedPlan.
      if (busyRef.current !== null) {
        planSkipped.current = true;
        return;
      }
      api.buildPlan({ settings, excluded, overrides, manualOrder }).then(
        (view) => {
          if (seq !== planSeq.current) return;
          setPlan(view);
          setPlanPending(false);
        },
        (e: unknown) => {
          if (seq !== planSeq.current) return;
          setOutcome({ kind: 'message', text: `Couldn't build the preview: ${ipcMessage(e)}` });
          setPlanPending(false);
        },
      );
    }, PLAN_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [api, files, settings, excluded, overrides, manualOrder, metadataDone, metadataFinished, planNonce]);

  /**
   * A new array always triggers a rescan, so the preview shows the files as they are now.
   * `clearTyped`: only a batch that actually changed something on disk (a finished rename or
   * undo) forgets typed names and the manual order; a stale, cancelled or failed batch rolls
   * back, so the user's work in progress is kept (cleared after a batch or undo).
   */
  const afterBatch = useCallback(
    async (nextSources: readonly string[], clearTyped: boolean) => {
      if (clearTyped) {
        setOverrides({});
        setManualOrder([]);
      }
      setSources([...nextSources]);
      try {
        setCanUndo(await api.canUndo());
      } catch {
        // Keep the batch's outcome; canUndo is asked again after the next batch.
      }
    },
    [api],
  );

  const addPaths = useCallback((paths: string[]) => {
    if (busyRef.current !== null || paths.length === 0) return;
    setSources((prev) => {
      const next = new Set(prev);
      for (const p of paths) next.add(p);
      return next.size === prev.length ? prev : [...next];
    });
  }, []);

  const pick = useCallback(
    async (kind: PickKind) => {
      if (busyRef.current !== null) return;
      try {
        addPaths(await api.pickPaths(kind));
      } catch (e) {
        showError(e);
      }
    },
    [api, addPaths],
  );

  const removeSource = useCallback((path: string) => {
    if (busyRef.current !== null) return;
    // Exclusions are pruned by the effect above, keyed on the resulting `sources`.
    setSources((prev) => prev.filter((p) => p !== path));
  }, []);

  const updateSettings = useCallback((update: (s: RenameSettings) => RenameSettings) => {
    if (busyRef.current !== null) return;
    setSettings(update);
  }, []);

  const exclude = useCallback((paths: string[]) => {
    if (busyRef.current !== null) return;
    setExcluded((prev) => [...new Set([...prev, ...paths])]);
  }, []);

  const include = useCallback((paths: string[]) => {
    if (busyRef.current !== null) return;
    const back = new Set(paths);
    setExcluded((prev) => {
      const kept = prev.filter((p) => !back.has(p));
      return kept.length === prev.length ? prev : kept;
    });
  }, []);

  const includeExcluded = useCallback(() => {
    if (busyRef.current !== null) return;
    setExcluded([]);
  }, []);

  const rename = useCallback(async () => {
    if (!plan || busyRef.current !== null) return;
    markBusy('renaming');
    planSkipped.current = false;
    setProgress(null);
    setOutcome(null);
    try {
      const r = await api.execute(plan.planId);
      switch (r.status) {
        case 'done':
          setOutcome({ kind: 'renamed', renamed: r.renamed, datesChanged: r.datesChanged });
          setLastChanges(r.changes);
          await afterBatch(r.sourcesAfter, true);
          break;
        case 'stale':
          setOutcome({ kind: 'stale', changed: r.changed });
          await afterBatch(sources, false);
          break;
        case 'cancelled':
          setOutcome({ kind: 'cancelled', action: 'rename', rollback: r.rollback });
          await afterBatch(sources, false);
          break;
        case 'failed':
          setOutcome({ kind: 'failed', action: 'rename', error: r.error, rollback: r.rollback, skipped: [] });
          await afterBatch(sources, false);
          break;
        case 'not-ready':
          setOutcome({ kind: 'message', text: r.reason });
          refreshSkippedPlan();
          break;
      }
    } catch (e) {
      setOutcome({ kind: 'failed', action: 'rename', error: ipcMessage(e), rollback: null, skipped: [] });
      refreshSkippedPlan();
    } finally {
      markBusy(null);
      setProgress(null);
    }
  }, [api, plan, sources, afterBatch, markBusy]);

  const cancel = useCallback(() => {
    void api.cancel().catch(showError);
  }, [api]);

  const undo = useCallback(async () => {
    if (busyRef.current !== null) return;
    markBusy('undoing');
    planSkipped.current = false;
    setProgress(null);
    setOutcome(null);
    try {
      const r = await api.undo();
      switch (r.status) {
        case 'nothing-to-undo':
          setOutcome({ kind: 'message', text: 'There is nothing to undo.' });
          setCanUndo(false);
          refreshSkippedPlan();
          break;
        case 'not-ready':
          setOutcome({ kind: 'message', text: r.reason });
          refreshSkippedPlan();
          break;
        case 'done':
          setOutcome({ kind: 'undone', restored: r.restored, skipped: r.skipped });
          await afterBatch(r.sourcesAfter, true);
          break;
        case 'cancelled':
          setOutcome({ kind: 'cancelled', action: 'undo', rollback: r.rollback ?? { complete: true, stranded: [] } });
          await afterBatch(r.sourcesAfter, false);
          break;
        case 'failed':
          setOutcome({ kind: 'failed', action: 'undo', error: r.error, rollback: r.rollback, skipped: r.skipped });
          await afterBatch(r.sourcesAfter, false);
          break;
        default: {
          const _exhaustive: never = r;
          void _exhaustive;
        }
      }
    } catch (e) {
      setOutcome({ kind: 'failed', action: 'undo', error: ipcMessage(e), rollback: null, skipped: [] });
      // Main may have stopped the background read before the call failed, and only a rescan
      // starts it again. afterBatch doesn't throw.
      await afterBatch(sources, false);
    } finally {
      markBusy(null);
      setProgress(null);
    }
  }, [api, sources, afterBatch, markBusy]);

  const dismissOutcome = useCallback(() => setOutcome(null), []);

  const loadPreset = useCallback(
    (name: string) => {
      if (busyRef.current !== null) return;
      const preset = presets.find((p) => nameKey(p.name) === nameKey(name));
      if (!preset) {
        setPresetName(null);
        return;
      }
      setSettings(preset.settings);
      setPresetName(preset.name);
    },
    [presets],
  );

  const savePreset = useCallback(
    async (name: string) => {
      if (busyRef.current !== null) return;
      try {
        const list = await api.savePreset(name, settings);
        setPresets(list);
        setPresetName(list.find((p) => nameKey(p.name) === nameKey(name.trim()))?.name ?? name.trim());
      } catch (e) {
        showError(e);
      }
    },
    [api, settings],
  );

  const deletePreset = useCallback(
    async (name: string) => {
      if (busyRef.current !== null) return;
      try {
        setPresets(await api.deletePreset(name));
        setPresetName((current) => (current !== null && nameKey(current) === nameKey(name) ? null : current));
      } catch (e) {
        showError(e);
      }
    },
    [api],
  );

  const chooseDestination = useCallback(async () => {
    if (busyRef.current !== null) return;
    try {
      const dir = await api.pickFolder();
      if (dir !== null) setSettings((s) => ({ ...s, move: { destinationRoot: dir } }));
    } catch (e) {
      showError(e);
    }
  }, [api]);

  const tokenValues = useCallback(
    () =>
      api.tokenValues().catch((e: unknown) => {
        showError(e);
        return null;
      }),
    [api],
  );
  const copyText = useCallback(
    (text: string) => void api.copyText(text).catch(showError),
    [api],
  );
  const pathForFile = useCallback((file: File) => api.pathForFile(file), [api]);

  const setOverride = useCallback((p: string, stem: string | null) => {
    if (busyRef.current !== null) return;
    setOverrides((prev) => {
      if (stem === null) {
        if (!(p in prev)) return prev;
        const { [p]: _gone, ...rest } = prev;
        return rest;
      }
      return prev[p] === stem ? prev : { ...prev, [p]: stem };
    });
  }, []);

  const reorder = useCallback((paths: string[]) => {
    if (busyRef.current !== null) return;
    setManualOrder(paths);
    setSettings((s) => (s.sequence.sortBy === 'manual' ? s : { ...s, sequence: { ...s.sequence, sortBy: 'manual' } }));
  }, []);

  const saveCsv = useCallback(
    async (fileName: string, text: string, done: string) => {
      try {
        if (await api.saveText(fileName, text)) setOutcome({ kind: 'message', text: done });
      } catch (e) {
        showError(e);
      }
    },
    [api],
  );
  const exportPreview = useCallback(async () => {
    if (!plan) return;
    await saveCsv('renami-preview.csv', previewCsv(plan.rows), 'Saved the preview.');
  }, [plan, saveCsv]);
  const exportLastBatch = useCallback(async () => {
    if (lastChanges.length === 0) return;
    await saveCsv('renami-renamed.csv', changesCsv(lastChanges), 'Saved the last rename.');
  }, [lastChanges, saveCsv]);

  const importNames = useCallback(async () => {
    if (busyRef.current !== null || !plan) return;
    try {
      const file = await api.readText();
      if (!file) return;
      const list = parseNameList(file.text, plan.rows.map((r) => r.currentName));
      const { overrides: found, matched, unmatched } = overridesFrom(list, plan.rows);
      setOverrides((prev) => ({ ...prev, ...found }));
      const names = `${matched} ${matched === 1 ? 'name' : 'names'}`;
      setOutcome({
        kind: 'message',
        text: unmatched > 0 ? `Imported ${names} from ${file.name}; ${unmatched} didn't match a file.` : `Imported ${names} from ${file.name}.`,
      });
    } catch (e) {
      showError(e);
    }
  }, [api, plan]);

  // Paths the OS handed the app: those queued before the page was ready, then later ones.
  useEffect(() => {
    void api.takeOpenPaths().then(addPaths).catch(showError);
    return api.onOpenPaths(addPaths);
  }, [api, addPaths]);

  const state: SessionState = {
    platform,
    sources,
    settings,
    excluded,
    files,
    scanning,
    metadata,
    plan,
    planPending,
    busy,
    progress,
    outcome,
    canUndo,
    presets,
    presetName,
    overrides,
    manualOrder,
    lastChanges,
  };
  const actions: SessionActions = {
    addPaths,
    pick,
    removeSource,
    updateSettings,
    exclude,
    include,
    includeExcluded,
    rename,
    cancel,
    undo,
    dismissOutcome,
    loadPreset,
    savePreset,
    deletePreset,
    chooseDestination,
    tokenValues,
    copyText,
    pathForFile,
    setOverride,
    reorder,
    exportPreview,
    exportLastBatch,
    importNames,
  };
  return [state, actions];
}
