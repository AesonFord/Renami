import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './fixtures.js';

// Captures site/screenshot.png for the download page. Skipped unless asked for:
// `npm run build`, then `RENAMI_SCREENSHOT=1 npx playwright test screenshot`.

const NAMES = ['IMG_4821.jpg', 'IMG_4822.jpg', 'IMG_4823.jpg', 'IMG_4824.jpg', 'IMG_4825.jpg', 'IMG_4826.jpg'];

test('captures the main window for the site', async ({ launch, tempDir }) => {
  test.skip(process.env.RENAMI_SCREENSHOT !== '1', 'Run `npm run build`, then set RENAMI_SCREENSHOT=1');
  const dir = path.join(tempDir('renami-e2e-screenshot-'), 'Hawaii');
  mkdirSync(dir);
  for (const name of NAMES) copyFileSync(path.resolve('test/fixtures/media/photo.jpg'), path.join(dir, name));

  const { app, win } = await launch();
  await win.emulateMedia({ colorScheme: 'light' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1200, 760));
  await app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths })) as typeof dialog.showOpenDialog;
  }, [dir]);

  await win.getByRole('button', { name: 'Choose folder…' }).click();
  await win.getByRole('textbox', { name: 'Name pattern' }).fill('Hawaii_{date_taken:YYYY-MM-DD}_{seq:3}');
  // photo.jpg was taken 2024-07-04 (scripts/make-fixtures.mjs); sequences start at 1.
  await expect(win.getByRole('cell', { name: 'Hawaii_2024-07-04_006.jpg', exact: true })).toBeVisible();

  await win.screenshot({ path: 'site/screenshot.png' });
});
