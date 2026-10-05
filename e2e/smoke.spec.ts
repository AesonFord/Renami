import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { expect, test } from './fixtures.js';
// The raw helper, not the fixture's tracking wrapper: this file's second test checks launch()'s
// own failure-cleanup, which the fixture would otherwise paper over by cleaning up on its behalf.
import { launch as launchDirect } from './helpers.js';

test('opens the window with a sandboxed renderer and a working bridge', async ({ launch }) => {
  const { win } = await launch();
  await expect(win).toHaveTitle('Renami');
  expect(await win.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined');
  expect(await win.evaluate(() => (globalThis as unknown as { api: { platform(): Promise<string> } }).api.platform())).toBe(
    process.platform,
  );
});

test('removes its temp user data folder when launch fails before a window opens', async () => {
  // On Windows, Playwright starts Electron through a shell, so a bad path starts the shell, which then
  // exits. Playwright's Electron launcher (playwright-core electron.ts) then rejects four internal
  // waitForLine() promises but awaits only one; the others surface as unhandled rejections that fail
  // the test even though launch() itself rejects and cleans up correctly. On macOS and Linux the spawn
  // fails before those promises exist. launch()'s cleanup is the same code on every OS, so it's covered there.
  test.skip(process.platform === 'win32', "a bad executablePath trips unhandled rejections inside Playwright's Windows launcher");
  const before = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith('renami-e2e-user-')));

  await expect(launchDirect({ executablePath: '/nonexistent/Renami' })).rejects.toThrow();

  // This test relies on playwright.config.ts's `workers: 1`: with a single worker, no other
  // test's launch() is ever mid-flight while this one runs, so any renami-e2e-user-* folder that
  // shows up here was made by *this* call. If `workers` is ever raised above 1, this test needs
  // revisiting (e.g. capture the exact temp path launch() creates instead of diffing the directory).
  const leaked = readdirSync(tmpdir())
    .filter((name) => name.startsWith('renami-e2e-user-') && !before.has(name));

  expect(leaked).toEqual([]);
});
