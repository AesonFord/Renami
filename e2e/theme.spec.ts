import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

type ThemeSource = 'light' | 'dark';

/** Stands in for the OS setting: themeSource drives both prefers-color-scheme and shouldUseDarkColors. */
function setTheme(app: ElectronApplication, source: ThemeSource): Promise<void> {
  return app.evaluate(({ nativeTheme }, s) => {
    nativeTheme.themeSource = s;
  }, source);
}

/** The page globals this file reads; e2e is typed without the DOM lib. */
interface PageWithStyles {
  document: { body: object };
  getComputedStyle(element: object): { backgroundColor: string };
}

/** The page background as #rrggbb, the format BrowserWindow.getBackgroundColor() uses. */
function pageBackground(win: Page): Promise<string> {
  return win.evaluate(() => {
    const { document, getComputedStyle } = globalThis as unknown as PageWithStyles;
    const rgb = getComputedStyle(document.body).backgroundColor.match(/\d+/g)!.slice(0, 3);
    return `#${rgb.map((c) => Number(c).toString(16).padStart(2, '0')).join('')}`;
  });
}

function windowBackground(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBackgroundColor().toLowerCase());
}

/** Rec. 601 luma, 0 (black) to 255 (white). */
function luma(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r! + 0.587 * g! + 0.114 * b!;
}

test('follows the system color mode, in the page and the window behind it', async ({ launch }) => {
  const { app, win } = await launch();
  // Playwright emulates prefers-color-scheme: light by default, which would hide what Electron reports.
  await win.emulateMedia({ colorScheme: null });

  await setTheme(app, 'dark');
  await expect.poll(() => pageBackground(win).then(luma)).toBeLessThan(64);
  const dark = await pageBackground(win);
  // The window background shows before the page paints and while resizing; a light one would flash.
  await expect.poll(() => windowBackground(app)).toBe(dark);

  await setTheme(app, 'light');
  await expect.poll(() => pageBackground(win).then(luma)).toBeGreaterThan(192);
  await expect.poll(() => windowBackground(app)).toBe(await pageBackground(win));
});
