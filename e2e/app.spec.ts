import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

const MEDIA = path.resolve('test/fixtures/media');
const ORIGINALS = ['nodate.jpg', 'notes.txt', 'photo.heic', 'photo.jpg'];

/** Copies the test media into dir, and returns dir. */
function tripFolder(dir: string): string {
  for (const name of ORIGINALS) copyFileSync(path.join(MEDIA, name), path.join(dir, name));
  return dir;
}

/** Stubs the native folder dialog, then adds the folder the way a user would. */
async function addFolder(app: ElectronApplication, win: Page, dir: string): Promise<void> {
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as typeof dialog.showOpenDialog;
  }, dir);
  await win.getByRole('button', { name: 'Choose folder…' }).click();
  // With the default {name} pattern, photo.jpg is both the current and the new name.
  await expect(win.getByRole('cell', { name: 'photo.jpg', exact: true }).first()).toBeVisible();
}

test('adds a folder, previews a pattern, renames and undoes', async ({ launch, tempDir }) => {
  const dir = tripFolder(tempDir('renami-e2e-trip-'));
  const { app, win } = await launch();
  await addFolder(app, win, dir);

  await win.getByRole('textbox', { name: 'Name pattern' }).fill('Trip_{date_taken:YYYY-MM-DD}_{seq:3}');
  await expect(win.getByRole('cell', { name: 'Trip_2024-07-05_001.heic', exact: true })).toBeVisible();
  await expect(win.getByRole('cell', { name: 'Trip_2024-07-05_001.jpg', exact: true })).toBeVisible();
  await expect(win.getByText('Paired').first()).toBeVisible();
  await win.screenshot({ path: 'test-results/layout-b.png' });

  const rename = win.getByRole('button', { name: 'Rename 4 files' });
  await expect(rename).toBeEnabled();
  await rename.click();
  await expect(win.getByText('Renamed 4 files.')).toBeVisible();
  const renamed = readdirSync(dir);
  expect(renamed).toContain('Trip_2024-07-05_001.heic');
  expect(renamed).toContain('Trip_2024-07-05_001.jpg');
  expect(renamed.filter((n) => ORIGINALS.includes(n))).toEqual([]);

  await win.getByRole('button', { name: 'Undo last rename' }).click();
  await expect(win.getByText(/Undid the last rename/)).toBeVisible();
  expect(readdirSync(dir).sort()).toEqual(ORIGINALS);
});

test('moves files into folders from the pattern, and undo removes the folder', async ({ launch, tempDir }) => {
  const dir = tripFolder(tempDir('renami-e2e-trip-'));
  const { app, win } = await launch();
  await addFolder(app, win, dir);

  await win.getByRole('textbox', { name: 'Name pattern' }).fill('{date_taken:YYYY}/{name}');
  await expect(win.getByRole('cell', { name: path.join('2024', 'photo.jpg'), exact: true })).toBeVisible();
  const rename = win.getByRole('button', { name: 'Rename 4 files' });
  await expect(rename).toBeEnabled();
  await rename.click();
  await expect(win.getByText('Renamed 4 files.')).toBeVisible();
  expect(readdirSync(path.join(dir, '2024')).sort()).toEqual(['photo.heic', 'photo.jpg']);

  await win.getByRole('button', { name: 'Undo last rename' }).click();
  await expect(win.getByText(/Undid the last rename/)).toBeVisible();
  expect(existsSync(path.join(dir, '2024'))).toBe(false);
  expect(readdirSync(dir).sort()).toEqual(ORIGINALS);
});

test('blocks renaming while the pattern has an error', async ({ launch, tempDir }) => {
  const dir = tripFolder(tempDir('renami-e2e-trip-'));
  const { app, win } = await launch();
  await addFolder(app, win, dir);

  await win.getByRole('textbox', { name: 'Name pattern' }).fill('Trip_{nope}');
  await expect(win.getByRole('alert')).toHaveText('Unknown token "{nope}"');
  await expect(win.getByRole('button', { name: /^Rename/ })).toBeDisabled();
});

/** The page globals this test reads; e2e is typed without the DOM lib. */
interface FullscreenElement {
  requestFullscreen(): Promise<void>;
  remove(): void;
}
interface PageWithFullscreen {
  Notification: { permission: string };
  document: {
    createElement(tag: 'div'): FullscreenElement;
    body: { append(node: FullscreenElement): void };
    fullscreenElement: unknown;
  };
}

test('chromium permissions are denied, except video fullscreen', async ({ launch }) => {
  const { app, win } = await launch();
  expect(await app.evaluate(({ session }) => session.defaultSession.spellCheckerEnabled)).toBe(false);
  // The permission check handler answers Notification.permission synchronously.
  expect(await win.evaluate(() => (globalThis as unknown as PageWithFullscreen).Notification.permission)).toBe('denied');
  // The preview panel's <video controls> fullscreen button calls requestFullscreen (the
  // 'fullscreen' permission); it must stay allowed while everything else is denied.
  const fullscreen = await win.evaluate(async () => {
    const { document } = globalThis as unknown as PageWithFullscreen;
    const el = document.createElement('div');
    document.body.append(el);
    try {
      await el.requestFullscreen();
      return document.fullscreenElement === el;
    } catch {
      return false;
    } finally {
      el.remove();
    }
  });
  expect(fullscreen).toBe(true);
});

test('the window reloads after a renderer crash', async ({ launch }) => {
  const { app } = await launch();
  // Emits the event a crash raises instead of really killing the renderer: on the Windows and
  // Linux CI runners Playwright's own crashed-page handling rejects main-process evaluate calls
  // ("Target crashed") and hangs teardown, which says nothing about the app.
  const recovered = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0]!.webContents;
    // launch() returns once the window exists; let the first load finish, or it would count as the reload.
    if (wc.isLoading()) await new Promise<void>((loaded) => wc.once('did-finish-load', () => loaded()));
    return new Promise<boolean>((resolve) => {
      wc.once('did-finish-load', () => resolve(true));
      wc.emit('render-process-gone', { preventDefault: () => {} }, { reason: 'crashed', exitCode: 1 });
      setTimeout(() => resolve(false), 10_000);
    });
  });
  expect(recovered).toBe(true);
  // The reloaded page is usable, not just loaded: the preload bridge reaches main over IPC.
  const platform = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript('window.api.platform()'),
  );
  expect(platform).toBe(await app.evaluate(() => process.platform));
  // And React rendered the UI again.
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript(
          "[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Choose folder'))",
        ),
      ),
    )
    .toBe(true);
});
