import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

// The macOS look: the files strip in the title bar beside the traffic lights.

/** The page globals this file reads; e2e is typed without the DOM lib. */
interface PageWithStyles {
  document: { querySelector(selector: string): object | null };
  getComputedStyle(element: object): Record<string, string>;
}

/** A computed style property of the first element matching selector. */
function style(win: Page, selector: string, property: string): Promise<string> {
  return win.evaluate(
    ([sel, prop]) => {
      const { document, getComputedStyle } = globalThis as unknown as PageWithStyles;
      const el = document.querySelector(sel!);
      return el ? getComputedStyle(el)[prop!]! : 'missing';
    },
    [selector, property],
  );
}

test('puts the files strip in the title bar, and makes room for the traffic lights', async ({ launch, tempDir }) => {
  test.skip(process.platform !== 'darwin', 'macOS title bar');
  const dir = tempDir('renami-e2e-mac-');
  writeFileSync(path.join(dir, 'a.txt'), 'a');
  const { app, win } = await launch();

  // The empty state has no strip, so a bar above it moves the window.
  await expect(win.getByRole('button', { name: 'Choose folder…' })).toBeVisible();
  expect(await style(win, '.drag-bar', 'height')).toBe('50px');
  expect(await style(win, '.drag-bar', 'webkitAppRegion')).toBe('drag');

  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog;
  }, dir);
  await win.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(win.getByRole('cell', { name: 'a.txt', exact: true }).first()).toBeVisible();

  expect(await style(win, '.files-strip', 'paddingLeft')).toBe('88px');
  expect(await style(win, '.files-strip', 'webkitAppRegion')).toBe('drag');
  for (const selector of ['.chip-add', '.files-strip input[type="checkbox"]', '.preset-picker select']) {
    expect(await style(win, selector, 'webkitAppRegion'), selector).toBe('no-drag');
  }
  // A control in the drag region still takes clicks.
  await win.getByRole('button', { name: '+ Add files or folders' }).click();
  await expect(win.getByRole('menuitem', { name: 'Files…' })).toBeVisible();
  await win.keyboard.press('Escape');

  // macOS hides the traffic lights in full screen, so the room for them goes too.
  const fullScreen = (on: boolean) => app.evaluate(({ BrowserWindow }, v) => BrowserWindow.getAllWindows()[0]!.setFullScreen(v), on);
  await fullScreen(true);
  await expect.poll(() => style(win, '.files-strip', 'paddingLeft'), { timeout: 10_000 }).toBe('24px');
  await fullScreen(false);
  await expect.poll(() => style(win, '.files-strip', 'paddingLeft'), { timeout: 10_000 }).toBe('88px');
});
