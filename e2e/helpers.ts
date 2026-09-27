import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import type { RenameSettings } from '../src/core/types.js';
import type { Api } from '../src/shared/ipc.js';

export interface Launched {
  app: ElectronApplication;
  win: Page;
  /** Temp user data folder; presets.json lands here. */
  userData: string;
  close(): Promise<void>;
}

/** How long launch's failure cleanup waits for a half-started app to close before killing it. */
const CLEANUP_TIMEOUT_MS = 5_000;

/** Resolves once proc has exited, at once if it already has. */
export function exited(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  return once(proc, 'exit').then(() => undefined);
}

/** Closes a half-started app. If it won't close in CLEANUP_TIMEOUT_MS, kills it and waits for it to exit. */
async function closeBounded(app: ElectronApplication): Promise<void> {
  const proc = app.process();
  let timer: NodeJS.Timeout | undefined;
  const closed = await Promise.race([
    app.close().then(
      () => true,
      () => false,
    ),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), CLEANUP_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(timer);
  if (!closed) {
    const gone = exited(proc);
    proc.kill('SIGKILL');
    await gone;
  }
}

/**
 * Starts the app with its own temp user data folder. By default it runs the build in out/
 * (run `npm run build` first); pass executablePath to start a packaged app instead.
 */
export async function launch(opts: { executablePath?: string } = {}): Promise<Launched> {
  const userData = mkdtempSync(path.join(tmpdir(), 'renami-e2e-user-'));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    // Hosts such as VS Code set ELECTRON_RUN_AS_NODE, which makes Electron start as plain Node.
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  env.RENAMI_USER_DATA_DIR = userData;
  let app: ElectronApplication | undefined;
  try {
    app = opts.executablePath
      ? await electron.launch({ executablePath: opts.executablePath, env })
      : await electron.launch({ args: [path.resolve('out/main/index.mjs')], env });
    const started = app;
    const win = await started.firstWindow();
    return {
      app: started,
      win,
      userData,
      close: async () => {
        await started.close();
        rmSync(userData, { recursive: true, force: true });
      },
    };
  } catch (err) {
    // The window never opened (a bad executablePath, a crash before firstWindow()); leave no
    // orphaned process or temp folder behind.
    if (app) await closeBounded(app);
    rmSync(userData, { recursive: true, force: true });
    throw err;
  }
}

/** Scans dir through the bridge, waits for metadata, and returns the preview. Runs in the page. */
export function scanAndPlan(win: Page, dir: string, settings: RenameSettings) {
  return win.evaluate(
    async ({ dir, settings }) => {
      const api = (globalThis as unknown as { api: Api }).api;
      const finished = new Promise<void>((resolve) => {
        const off = api.onMetadataProgress((s) => {
          if (s.finished) {
            off();
            resolve();
          }
        });
      });
      await api.scan([dir], { includeSubfolders: false, extensions: null });
      await finished;
      return api.buildPlan({ settings, excluded: [] });
    },
    { dir, settings },
  );
}
