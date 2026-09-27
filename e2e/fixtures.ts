import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test as base, type ElectronApplication } from '@playwright/test';
import { exited, launch as launchApp, type Launched } from './helpers.js';

export { expect } from '@playwright/test';

/** How long teardown waits for the app to quit before killing it. */
const QUIT_TIMEOUT_MS = 10_000;

/**
 * Quits an app the test left running. When a test fails after a rename, the rename can still be
 * undone, so quitting opens the native "Quit Renami?" dialog and nobody is there to answer
 * it. Answer it with Quit first. If the app still won't go (a rename is running, or it hung), kill it.
 */
async function shutDown(app: ElectronApplication): Promise<void> {
  const proc = app.process();
  const quit = (async () => {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync;
    });
    await app.close();
  })().then(
    () => true,
    () => false,
  );
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), QUIT_TIMEOUT_MS);
  });
  const quitCleanly = await Promise.race([quit, timedOut]);
  clearTimeout(timer);
  if (!quitCleanly) {
    const gone = exited(proc);
    proc.kill('SIGKILL');
    await gone;
  }
}

export interface Fixtures {
  /** Makes a temp folder. It is removed after the test, pass or fail, once every app has quit. */
  tempDir: (prefix: string) => string;
  /**
   * Starts the app (see `launch` in helpers.ts). Every app started this way is shut down after
   * the test, pass or fail, and its user data folder removed. A test may still call close()
   * itself when quitting is part of what it checks.
   */
  launch: (opts?: { executablePath?: string }) => Promise<Launched>;
}

export const test = base.extend<Fixtures>({
  tempDir: async ({}, use) => {
    const dirs: string[] = [];
    await use((prefix) => {
      const dir = mkdtempSync(path.join(tmpdir(), prefix));
      dirs.push(dir);
      return dir;
    });
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  },

  // Asks for tempDir only so that tempDir is torn down after this: apps quit before folders go.
  launch: async ({ tempDir: _tempDir }, use) => {
    const started: { launched: Launched; closed: boolean }[] = [];
    await use(async (opts) => {
      const entry = { launched: await launchApp(opts), closed: false };
      started.push(entry);
      return {
        ...entry.launched,
        close: async () => {
          await entry.launched.close();
          entry.closed = true;
        },
      };
    });
    for (const { launched, closed } of started) {
      if (!closed) await shutDown(launched.app);
      rmSync(launched.userData, { recursive: true, force: true });
    }
  },
});
