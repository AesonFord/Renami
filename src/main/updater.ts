import { compareVersions, downloadUrl, isDueForAutoCheck, notesExcerpt, parseRelease, type Release, AUTO_CHECK_INTERVAL_MS } from './updateCheck.js';
import { DEFAULT_UPDATE_PREFS, loadUpdatePrefs, saveUpdatePrefs, type UpdatePrefs } from './updatePrefs.js';

/** A check that failed; its message is what the manual check shows the user. */
export class UpdateError extends Error {}

export type UpdateChoice = 'download' | 'skip' | 'later';

/** The dialogs and the browser, injected so the checker runs in tests without Electron. */
export interface UpdateUi {
  showAvailable(info: { current: string; latest: string; notes: string }): Promise<UpdateChoice>;
  showUpToDate(current: string): Promise<void>;
  showError(message: string): Promise<void>;
  openDownload(url: string): void;
}

export interface UpdateCheckerDeps {
  currentVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  isAppImage: boolean;
  feedUrl: string;
  fetch: (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;
  prefsFile: string;
  ui: UpdateUi;
  now?: () => number;
  /** The callback's promise is returned so tests can await a tick. */
  setTimer?: (fn: () => unknown, ms: number) => unknown;
}

const REQUEST_TIMEOUT_MS = 10_000;

type Outcome = { release: Release | null } | { error: UpdateError };

/**
 * Asks GitHub for the latest release and tells the user when it is newer. The automatic check
 * stays silent unless there is something to download (and the user hasn't skipped that version);
 * a manual check always answers. Checks running at the same time share one request, and only one
 * dialog is ever open.
 */
export class UpdateChecker {
  private prefs: UpdatePrefs = { ...DEFAULT_UPDATE_PREFS };
  private inFlight: Promise<Outcome> | null = null;
  private dialogOpen = false;
  /** startAuto() has run, so turning the automatic check on schedules one. */
  private started = false;
  /** Bumped to cancel a scheduled check: a timer from an older generation does nothing. */
  private generation = 0;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => unknown, ms: number) => unknown;

  constructor(private readonly deps: UpdateCheckerDeps) {
    this.now = deps.now ?? Date.now;
    // unref: a pending check must never keep the app from quitting.
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms).unref());
  }

  async init(): Promise<void> {
    this.prefs = await loadUpdatePrefs(this.deps.prefsFile);
  }

  get autoCheck(): boolean {
    return this.prefs.autoCheck;
  }

  async setAutoCheck(on: boolean): Promise<void> {
    this.prefs = { ...this.prefs, autoCheck: on };
    this.generation++;
    await saveUpdatePrefs(this.deps.prefsFile, this.prefs);
    if (on && this.started) this.schedule(0);
  }

  startAuto(delayMs: number): void {
    this.started = true;
    if (this.prefs.autoCheck) this.schedule(delayMs);
  }

  /** Never rejects. While an update dialog is open it does nothing: that dialog is the answer. */
  async checkNow(manual: boolean): Promise<void> {
    if (this.dialogOpen) return;
    try {
      this.inFlight ??= this.fetchLatest().finally(() => {
        this.inFlight = null;
      });
      await this.answer(await this.inFlight, manual);
    } catch (error) {
      console.warn('update check failed', error);
    }
  }

  /**
   * Shows one dialog, unless one is already open (two checks that shared a request), in which
   * case it returns undefined. Held only around a dialog, so a silent automatic check never
   * swallows the answer to a manual one.
   */
  private async dialog<T>(show: () => Promise<T>): Promise<T | undefined> {
    if (this.dialogOpen) return undefined;
    this.dialogOpen = true;
    try {
      return await show();
    } finally {
      this.dialogOpen = false;
    }
  }

  private async answer(outcome: Outcome, manual: boolean): Promise<void> {
    const { ui, currentVersion } = this.deps;
    if ('error' in outcome) {
      console.warn('update check failed', outcome.error);
      if (manual) await this.dialog(() => ui.showError(outcome.error.message));
      return;
    }
    const { release } = outcome;
    if (!release || compareVersions(release.version, currentVersion) <= 0) {
      if (manual) await this.dialog(() => ui.showUpToDate(currentVersion));
      return;
    }
    if (!manual && this.prefs.skippedVersion === release.version) return;
    const choice = await this.dialog(() =>
      ui.showAvailable({ current: currentVersion, latest: release.version, notes: notesExcerpt(release.notes) }),
    );
    if (choice === 'download') {
      ui.openDownload(downloadUrl(release, this.deps.platform, this.deps.arch, this.deps.isAppImage));
    } else if (choice === 'skip') {
      this.prefs = { ...this.prefs, skippedVersion: release.version };
      await saveUpdatePrefs(this.deps.prefsFile, this.prefs);
    }
  }

  /** The latest release (null when there is none yet), or what went wrong. Saves the check time on success. */
  private async fetchLatest(): Promise<Outcome> {
    let response: Response;
    try {
      response = await this.deps.fetch(this.deps.feedUrl, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Renami/${this.deps.currentVersion}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      return {
        error: new UpdateError(
          timedOut ? 'GitHub took too long to answer. Try again later.' : "Can't reach GitHub. Check your connection and try again.",
          { cause: error },
        ),
      };
    }
    let release: Release | null = null;
    if (response.status === 403 || response.status === 429) {
      return { error: new UpdateError('GitHub is limiting requests right now. Try again in an hour.') };
    }
    if (response.status !== 404) {
      if (!response.ok) return { error: new UpdateError(`GitHub answered with an error (${response.status}). Try again later.`) };
      release = parseRelease(await response.json().catch(() => null));
      if (!release) return { error: new UpdateError("GitHub's answer didn't look like a Renami release.") };
    }
    this.prefs = { ...this.prefs, lastCheckedAt: this.now() };
    await saveUpdatePrefs(this.deps.prefsFile, this.prefs);
    return { release };
  }

  private schedule(ms: number): void {
    const generation = this.generation;
    this.setTimer(() => (generation === this.generation ? this.tick() : undefined), ms);
  }

  private async tick(): Promise<void> {
    if (!this.prefs.autoCheck) return;
    const now = this.now();
    const last = this.prefs.lastCheckedAt;
    if (!isDueForAutoCheck(last, now)) {
      this.schedule(last! + AUTO_CHECK_INTERVAL_MS - now);
      return;
    }
    await this.checkNow(false);
    this.schedule(AUTO_CHECK_INTERVAL_MS);
  }
}
