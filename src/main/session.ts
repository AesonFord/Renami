import { lstat } from 'node:fs/promises';
import path from 'node:path';
import {
  applyFindReplace,
  buildPlan,
  createFsView,
  effectiveMetadata,
  executePlan,
  EXIFTOOL_FAILURE_LIMIT,
  fsMetadata,
  HASH_CONCURRENCY,
  HashCache,
  History,
  MetadataReader,
  patternUsesHash,
  PresetStore,
  readMetadata,
  rulesFor,
  scan,
  systemTimeZone,
  tokenValues,
  validateRules,
  withDefaults,
  type BirthtimeSetter,
  type EmbeddedJpeg,
  type FileEntry,
  type FileMetadata,
  type Plan,
  type Platform,
  type RenameSettings,
} from '../core/index.js';
import type {
  ExecuteOutcome,
  FileDetails,
  FilesSummary,
  MetadataStatus,
  PlanRequest,
  PlanView,
  PresetView,
  ProgressView,
  ScanFilter,
  SourceSummary,
  TokenValues,
  UndoOutcome,
} from '../shared/ipc.js';
import { remapSources, toPlanView } from './rows.js';

// Moved to core so the command line shares them; re-exported for existing importers.
export { EXIFTOOL_FAILURE_LIMIT, HASH_CONCURRENCY, patternUsesHash };
/** Progress events are sent at most this often. */
export const PROGRESS_INTERVAL_MS = 200;
/** Why a rename, undo, scan or plan can't start while another rename or undo runs. */
export const BUSY_MESSAGE = 'A rename or undo is already running.';
/** How long undo waits for a stopped background read to let go of its files before going ahead. */
export const UNDO_READ_WAIT_MS = 5000;

export interface SessionEvents {
  metadataProgress(status: MetadataStatus): void;
  executeProgress(progress: ProgressView): void;
}

export interface SessionOptions {
  platform: Platform;
  /** Where presets are stored: <userData>/presets.json in the app. */
  presetsFile: string;
  events: SessionEvents;
  /** Tests pass their own reader; the app lets the session create one. */
  reader?: MetadataReader;
  /** Tests pass a fake; defaults to this OS's setter. */
  birthtime?: BirthtimeSetter;
  /** IANA zone for filesystem dates. Defaults to the system zone. */
  timeZone?: string;
}

export interface Throttled<T> {
  (value: T, force?: boolean): void;
  /** Drops the call waiting for the interval to end, if any. */
  cancel(): void;
}

/**
 * Calls fn at most once per interval. A call inside the interval waits, and when the interval
 * ends fn runs once with the latest value it was given. `force` runs fn at once and drops the
 * waiting call.
 */
export function throttle<T>(fn: (value: T) => void, intervalMs: number): Throttled<T> {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let waiting: { value: T } | null = null;
  const cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    waiting = null;
  };
  const run = (value: T): void => {
    last = Date.now();
    fn(value);
  };
  const call = (value: T, force = false): void => {
    const now = Date.now();
    if (force || now - last >= intervalMs) {
      cancel();
      run(value);
      return;
    }
    waiting = { value };
    timer ??= setTimeout(() => {
      const next = waiting;
      timer = null;
      waiting = null;
      if (next) run(next.value);
    }, last + intervalMs - now);
  };
  return Object.assign(call, { cancel });
}

/** A timer as a promise. cancel() clears the timer so it can't keep the process alive. */
function delay(ms: number): { promise: Promise<void>; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

async function summarizeSource(
  source: string,
  entries: readonly FileEntry[],
  entryPaths: ReadonlySet<string>,
): Promise<SourceSummary> {
  const abs = path.resolve(source);
  // lstat, like the scanner: a symlinked folder source isn't followed, so it isn't a folder here.
  const isFolder = await lstat(abs).then(
    (s) => s.isDirectory(),
    () => false,
  );
  const prefix = abs.endsWith(path.sep) ? abs : abs + path.sep;
  const count = isFolder
    ? entries.filter((e) => e.path.startsWith(prefix)).length
    : Number(entryPaths.has(abs));
  return { path: source, name: path.basename(abs) || abs, isFolder, count };
}

/** Everything the main process knows about the current batch. Electron-free, so tests run it in Node. */
export class Session {
  protected readonly reader: MetadataReader;
  protected readonly presets: PresetStore;
  protected readonly history = new History();
  protected readonly timeZone: string;
  /** Sources from the last requested scan, exactly as passed in. */
  protected sources: string[] = [];
  protected entries: FileEntry[] = [];
  /** `entries` by path, built on first use after they change. */
  private byPath: Map<string, FileEntry> | null = null;
  protected metadata = new Map<string, FileMetadata>();
  /** Hashes read on demand, checked against size + mtime. Kept until clear(). */
  protected hashes: HashCache;
  protected plan: Plan | null = null;
  /** Whether reading had finished when the current plan was built. */
  protected planComplete = false;
  protected readingFinished = true;
  private generation = 0;
  private readController: AbortController | null = null;
  /** Drops the background read's waiting progress event. */
  private stopReporting: (() => void) | null = null;
  private reading: Promise<void> = Promise.resolve();
  /** Set while a rename or undo runs; aborting it cancels. */
  private batch: AbortController | null = null;
  /** Settles (never rejects) when the running rename or undo, rollback included, has finished. */
  private batchDone: Promise<void> = Promise.resolve();
  /**
   * Bumped before a buildPlan's await, so a slower (hashing) build finishing after a faster,
   * later one can tell it has been superseded and must not overwrite the newer stored plan.
   */
  private latestBuild = 0;
  /** The in-flight build's hash phase, aborted the moment a newer buildPlan call starts. */
  private buildAbort: AbortController | null = null;

  constructor(protected readonly opts: SessionOptions) {
    this.timeZone = opts.timeZone ?? systemTimeZone();
    this.hashes = new HashCache(this.timeZone);
    this.reader = opts.reader ?? new MetadataReader({ timeZone: this.timeZone });
    this.presets = new PresetStore(opts.presetsFile);
  }

  platform(): Platform {
    return this.opts.platform;
  }

  /**
   * Scans the sources, then starts reading metadata in the background. Resolves null,
   * changing nothing, while a rename or undo runs, and when a newer scan or a batch replaced it.
   */
  async scan(paths: readonly string[], filter: ScanFilter): Promise<FilesSummary | null> {
    if (this.batch) return null;
    this.generation += 1;
    const gen = this.generation;
    this.stopReading();
    this.buildAbort?.abort();
    // The old plan stops being runnable now, not when the walk ends. The sources change now
    // too: an undo during the walk drops this scan, and must map the list the user asked for.
    this.plan = null;
    this.planComplete = false;
    this.readingFinished = false;
    this.sources = [...paths];

    const result = await scan(paths, filter);
    const entryPaths = new Set(result.entries.map((e) => e.path));
    const sources = await Promise.all(paths.map((p) => summarizeSource(p, result.entries, entryPaths)));
    if (gen !== this.generation || this.batch) return null;

    this.entries = result.entries;
    this.byPath = null;
    this.metadata = new Map();
    this.startReading(gen);
    return {
      sources,
      total: result.entries.length,
      extensionsFound: result.extensionsFound,
      unreadableFolders: result.unreadableFolders,
    };
  }

  /**
   * Forgets the files, their details and the plan, and drops a read in flight. Sends no events.
   * Does nothing while a rename or undo runs. Undo history is kept.
   */
  clear(): void {
    if (this.batch) return;
    this.generation += 1;
    this.stopReading();
    this.buildAbort?.abort();
    this.sources = [];
    this.entries = [];
    this.byPath = null;
    this.metadata = new Map();
    this.hashes = new HashCache(this.timeZone);
    this.plan = null;
    this.planComplete = false;
    this.readingFinished = true;
  }

  /** Resolves when the current background metadata read has stopped. */
  whenRead(): Promise<void> {
    return this.reading;
  }

  /**
   * Stops the background read from starting more files, and drops its waiting progress event.
   * Files already open still finish. Callers bump the generation first, so it sends nothing more.
   */
  private stopReading(): void {
    this.stopReporting?.();
    this.stopReporting = null;
    this.readController?.abort();
  }

  private startReading(gen: number): void {
    const controller = new AbortController();
    this.readController = controller;
    const total = this.entries.length;
    const report = throttle((s: MetadataStatus) => this.opts.events.metadataProgress(s), PROGRESS_INTERVAL_MS);
    this.stopReporting = report.cancel;
    let done = 0;
    /** Set once reading has stopped: results from files still open are ignored. */
    let ended = false;

    this.readingFinished = false;
    report({ done, total, finished: false, exiftoolFailed: false }, true);

    const afterRead = async (): Promise<void> => {
      const result = await readMetadata(this.entries, this.reader, {
        signal: controller.signal,
        onResult: (p, meta, { exiftoolFailed }) => {
          if (ended || gen !== this.generation) return;
          this.metadata.set(p, meta);
          done += 1;
          report({ done, total, finished: false, exiftoolFailed });
        },
      });
      ended = true;
      // Something in handling a result threw (reading a file never throws: it records a
      // readError). That is our bug, not a broken ExifTool, so it isn't reported as one.
      if ('error' in result && gen === this.generation) console.error('Reading metadata stopped:', result.error);
      if (gen !== this.generation) return;
      this.readingFinished = true;
      report({ done, total, finished: true, exiftoolFailed: result.exiftoolFailed }, true);
    };
    this.reading = afterRead();
  }

  /**
   * Builds the plan the preview shows and the executor will run. Hashes are read
   * first when the pattern needs them, so a plan may take a while; a plan built for files that a
   * newer scan, clear or batch replaced in the meantime is answered but never kept. Two builds
   * can be in flight together (a debounced settings change firing before a slower, hashing build
   * answers): each is given a build id before its await, and only the newest one's result is
   * ever stored, whichever finishes last.
   */
  async buildPlan(req: PlanRequest): Promise<PlanView> {
    if (this.batch) throw new Error(BUSY_MESSAGE);
    const settings = withDefaults(req.settings);
    const excluded = new Set(req.excluded);
    // Excluded files stay in the plan, in their place, but are never renamed, so they need no hash.
    const included = this.entries.filter((e) => !excluded.has(e.path));
    const gen = this.generation;

    this.buildAbort?.abort();
    const controller = new AbortController();
    this.buildAbort = controller;
    this.latestBuild += 1;
    const buildId = this.latestBuild;

    const usesHash = patternUsesHash(settings.pattern);
    if (usesHash) await this.hashes.hashMissing(included, controller.signal);
    const stale = gen !== this.generation || this.batch !== null || buildId !== this.latestBuild;
    const plan = buildPlan({
      entries: this.entries,
      excluded,
      metadata: usesHash ? this.hashes.mergeInto(this.metadata, included) : this.metadata,
      settings,
      fs: createFsView(),
      platform: this.opts.platform,
      timeZone: this.timeZone,
      overrides: new Map(Object.entries(req.overrides ?? {})),
      manualOrder: req.manualOrder ?? [],
    });
    if (stale) return toPlanView(plan, false);
    if (this.buildAbort === controller) this.buildAbort = null;
    this.plan = plan;
    this.planComplete = this.readingFinished;
    return toPlanView(plan, this.planComplete);
  }

  /** Every token's value for the first file the current plan renames, for "All tokens…". */
  tokenValues(): TokenValues | null {
    const item = this.plan?.items.find((i) => i.kind !== 'excluded');
    if (!this.plan || !item) return null;
    const { settings } = this.plan;
    const entry = item.source;
    const meta = effectiveMetadata(
      this.hashes.withHash(entry, this.metadata) ?? this.metadata.get(entry.path) ?? fsMetadata(entry, this.timeZone),
      settings.dates,
    );
    const rules = rulesFor(settings.findReplace, 'original');
    const name = validateRules(rules) === null ? applyFindReplace(entry.stem, rules) : entry.stem;
    return {
      fileName: path.basename(entry.path),
      values: tokenValues({ entry, meta, name, seq: item.seq, defaultDigits: settings.sequence.digits }),
    };
  }

  private entry(p: string): FileEntry | undefined {
    this.byPath ??= new Map(this.entries.map((e) => [e.path, e]));
    return this.byPath.get(p);
  }

  /** Whether the preview may show this path: a file (not a folder) in the current batch. */
  hasFile(p: string): boolean {
    const e = this.entry(p);
    return e !== undefined && !e.isDir;
  }

  /** Size, dimensions and duration for the preview panel; null for a path not in the batch. */
  fileDetails(p: string): FileDetails | null {
    const e = this.entry(p);
    if (!e) return null;
    const meta = this.metadata.get(p);
    return {
      size: e.size,
      width: meta?.width ?? null,
      height: meta?.height ?? null,
      durationSeconds: meta?.durationSeconds ?? null,
    };
  }

  /** The largest JPEG a RAW file in the batch carries, through the reader's ExifTool. */
  embeddedJpeg(p: string): Promise<EmbeddedJpeg | null> {
    return this.hasFile(p) ? this.reader.embeddedJpeg(p) : Promise.resolve(null);
  }

  /** True while a rename or undo is running. The quit guard uses this. */
  isBusy(): boolean {
    return this.batch !== null;
  }

  /**
   * Resolves at once when no rename or undo runs; otherwise once the running one has finished,
   * including the rollback a cancel or failure starts. Never rejects.
   */
  whenIdle(): Promise<void> {
    return this.batch ? this.batchDone : Promise.resolve();
  }

  /** Claims the batch for `run` and records when it settles, for whenIdle() and dispose(). */
  private startBatch<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    this.batch = controller;
    // Set before run() starts, so whenIdle() never hands out the last batch's settled promise
    // while this one is busy. The outcome, or a rejection, reaches the caller through `running`.
    let settle = (): void => {};
    this.batchDone = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const running = (async () => {
      try {
        return await run(controller.signal);
      } finally {
        this.batch = null;
        settle();
      }
    })();
    return running;
  }

  canUndo(): boolean {
    return this.history.canUndo();
  }

  /** Runs the plan the preview is showing. */
  async execute(planId: string): Promise<ExecuteOutcome> {
    if (this.batch) return { status: 'not-ready', reason: BUSY_MESSAGE };
    if (!this.readingFinished) return { status: 'not-ready', reason: 'File details are still loading.' };
    const plan = this.plan;
    if (!plan || plan.id !== planId) {
      return { status: 'not-ready', reason: 'The preview changed. Check it and try again.' };
    }
    // Built while some files still had only filesystem dates; the rebuild with every file's
    // details is on its way (Rename waits for reading to finish).
    if (!this.planComplete) {
      return { status: 'not-ready', reason: 'The preview is still catching up. Try again in a moment.' };
    }

    return this.startBatch(async (signal) => {
      // Drops a scan whose folder walk is still running. No read can be running here: see above.
      this.generation += 1;
      const report = throttle((p: ProgressView) => this.opts.events.executeProgress(p), PROGRESS_INTERVAL_MS);
      try {
        const result = await executePlan(plan, {
          signal,
          onProgress: (done, total) => report({ done, total }, done === total),
          birthtime: this.opts.birthtime,
        });
        if (result.status !== 'done') return result;

        const { files } = result.record;
        // A batch that changed nothing has nothing to undo.
        if (files.length > 0) this.history.push(result.record);
        if (this.plan === plan) this.plan = null;
        const changes = files.filter((f) => f.from !== f.to).map((f) => ({ from: f.from, to: f.to }));
        return {
          status: 'done',
          renamed: changes.length,
          datesChanged: files.filter((f) => f.originalTimes !== null).length,
          changes,
          sourcesAfter: remapSources(this.sources, files.map((f) => [f.from, f.to] as const)),
        };
      } finally {
        // A cancelled or failed batch can leave a progress event waiting; it must not arrive late.
        report.cancel();
      }
    });
  }

  /** Cancels the running rename or undo; it rolls back. */
  cancel(): void {
    this.batch?.abort();
  }

  /** Undoes the most recent batch. */
  async undo(): Promise<UndoOutcome> {
    if (this.batch) return { status: 'not-ready', reason: BUSY_MESSAGE, sourcesAfter: [...this.sources] };
    // Checked before claiming the batch or touching the read: with nothing to undo there is
    // nothing to roll back, so a background read in progress is left alone (it finishes and
    // sends its own final event; the renderer does not rescan after this outcome).
    if (!this.history.canUndo()) {
      return { status: 'nothing-to-undo', restored: 0, skipped: [], error: null, rollback: null, sourcesAfter: [...this.sources] };
    }
    return this.startBatch(async (signal) => {
      // The rescan after a rename has ExifTool reading the renamed files, and Windows won't
      // rename a file another process has open. Drop that scan (even one still walking the
      // folder), stop its read, and wait for the files it has open and for any ExifTool check
      // in flight before touching anything. A hung ExifTool gets UNDO_READ_WAIT_MS, not its
      // full task timeout. The stopped read sends no final event: every outcome from here on
      // has the renderer rescan afterward, and that scan reads the files again.
      this.generation += 1;
      this.stopReading();
      const wait = delay(UNDO_READ_WAIT_MS);
      try {
        await Promise.race([this.reading, wait.promise]);
      } finally {
        wait.cancel();
      }

      const record = this.history.peek();
      const result = await this.history.undo({ signal, birthtime: this.opts.birthtime });
      if (result.status !== 'done' || !record) return { ...result, sourcesAfter: [...this.sources] };

      this.plan = null;
      const skipped = new Set(result.skipped.map((s) => s.path));
      const moves = record.files.filter((f) => !skipped.has(f.to)).map((f) => [f.to, f.from] as const);
      return { ...result, sourcesAfter: remapSources(this.sources, moves) };
    });
  }

  listPresets(): Promise<PresetView[]> {
    return this.presets.list();
  }

  async savePreset(name: string, settings: RenameSettings): Promise<PresetView[]> {
    await this.presets.save(name, withDefaults(settings));
    return this.presets.list();
  }

  async deletePreset(name: string): Promise<PresetView[]> {
    await this.presets.remove(name);
    return this.presets.list();
  }

  /**
   * Stops background work and ExifTool. Called when the app quits. A running rename or undo is
   * cancelled and waited for, rollback included: quitting halfway through one could leave files
   * under temporary names with the undo history gone.
   */
  async dispose(): Promise<void> {
    this.generation += 1;
    this.stopReading();
    // A loop, not one wait: a batch started while the last one was settling is cancelled too.
    while (this.batch) {
      this.batch.abort();
      await this.whenIdle();
    }
    await this.reader.end();
  }
}
