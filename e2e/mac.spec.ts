import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

// The macOS look: the files strip in the title bar beside the traffic lights.

/** The page globals this file reads; e2e is typed without the DOM lib. */
interface PageWithStyles {
  document: { querySelector(selector: string): object | null };
  getComputedStyle(element: object): Record<string, string>;
}

/** Each element matching selector that isn't excluded from the drag region, as tag.class. */
function draggable(win: Page, selector: string): Promise<string[]> {
  return win.evaluate((sel) => {
    const { document, getComputedStyle } = globalThis as unknown as PageWithStyles & {
      document: { querySelectorAll(s: string): ArrayLike<{ tagName: string; className: string }> };
    };
    return Array.from(document.querySelectorAll(sel))
      .filter((el) => getComputedStyle(el).webkitAppRegion !== 'no-drag')
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
  }, selector);
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

/** Gives the locked folder back its permissions, even when the test fails, so the temp folder can go. */
let unlock = (): void => {};
test.afterEach(() => {
  unlock();
  unlock = () => {};
});

test('puts the files strip in the title bar, and makes room for the traffic lights', async ({ launch, tempDir }) => {
  test.skip(process.platform !== 'darwin', 'macOS title bar');
  const dir = tempDir('renami-e2e-mac-');
  writeFileSync(path.join(dir, 'a.txt'), 'a');
  // A folder that can't be opened, so the strip shows its warning (whose folder list is a tooltip).
  const locked = path.join(dir, 'locked');
  mkdirSync(locked);
  chmodSync(locked, 0o000);
  unlock = () => chmodSync(locked, 0o755);
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

  // The system font, so text matches the OS.
  expect(await style(win, 'body', 'fontFamily')).toMatch(/^-apple-system/);
  expect(await style(win, '.pattern-input', 'fontFamily')).toMatch(/^ui-monospace/);

  expect(await style(win, '.files-strip', 'paddingLeft')).toBe('88px');
  expect(await style(win, '.files-strip', 'webkitAppRegion')).toBe('drag');
  await win.getByRole('checkbox', { name: 'Subfolders' }).check();
  await expect(win.getByText("1 folder couldn't be opened")).toBeVisible();
  // Every control, and everything with a tooltip, takes the mouse instead of moving the window.
  expect(await draggable(win, '.files-strip :is(button, input, select, label, [title])')).toEqual([]);
  // A control in the drag region still takes clicks.
  await win.getByRole('button', { name: '+ Add files or folders' }).click();
  await expect(win.getByRole('menuitem', { name: 'Files…' })).toBeVisible();
  await win.keyboard.press('Escape');

  // A dialog's backdrop covers the strip, so the window doesn't move from under it.
  await win.getByRole('button', { name: 'All tokens…' }).click();
  await expect(win.getByRole('dialog')).toBeVisible();
  expect(await style(win, '.overlay', 'webkitAppRegion')).toBe('no-drag');
  await win.keyboard.press('Escape');

  // macOS hides the traffic lights in full screen, so the room for them goes too.
  const fullScreen = (on: boolean) => app.evaluate(({ BrowserWindow }, v) => BrowserWindow.getAllWindows()[0]!.setFullScreen(v), on);
  await fullScreen(true);
  await expect.poll(() => style(win, '.files-strip', 'paddingLeft'), { timeout: 10_000 }).toBe('24px');
  await fullScreen(false);
  await expect.poll(() => style(win, '.files-strip', 'paddingLeft'), { timeout: 10_000 }).toBe('88px');
});
