import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS } from '../src/core/types.js';
import { expect, test } from './fixtures.js';
import { scanAndPlan, selectRow } from './helpers.js';

// Where `npm run pack` puts the app on each OS.
const CANDIDATES = [
  'dist/mac-arm64/Renami.app/Contents/MacOS/Renami',
  'dist/mac/Renami.app/Contents/MacOS/Renami',
  'dist/win-unpacked/Renami.exe',
  'dist/linux-unpacked/renami-app',
];

test('the packaged app reads photo metadata with its bundled ExifTool', async ({ launch, tempDir }) => {
  test.skip(process.env.RENAMI_PACKAGED !== '1', 'Run `npm run pack`, then set RENAMI_PACKAGED=1');
  const executablePath = CANDIDATES.map((p) => path.resolve(p)).find((p) => existsSync(p));
  expect(executablePath, `no packaged app at any of: ${CANDIDATES.join(', ')}`).toBeDefined();

  const dir = tempDir('renami-e2e-packaged-');
  copyFileSync(path.resolve('test/fixtures/media/photo.jpg'), path.join(dir, 'photo.jpg'));
  const { win } = await launch({ executablePath: executablePath! });
  await expect(win).toHaveTitle('Renami');

  const plan = await scanAndPlan(win, dir, { ...DEFAULT_SETTINGS, pattern: '{camera_model}' });
  expect(plan.rows.map((r) => r.newName)).toEqual(['EOS R5.jpg']);
  expect(plan.rows[0]?.flags.map((f) => f.code)).not.toContain('metadata-unreadable');
});

test('the packaged app previews HEIC and PDF files from inside its archive', async ({ launch, tempDir }) => {
  test.skip(process.env.RENAMI_PACKAGED !== '1', 'Run `npm run pack`, then set RENAMI_PACKAGED=1');
  const executablePath = CANDIDATES.map((p) => path.resolve(p)).find((p) => existsSync(p));
  expect(executablePath, `no packaged app at any of: ${CANDIDATES.join(', ')}`).toBeDefined();

  const dir = tempDir('renami-e2e-packaged-');
  copyFileSync(path.resolve('test/fixtures/media/photo.heic'), path.join(dir, 'photo.heic'));
  // A one-page PDF: pdf.js and its worker must load from the packaged renderer.
  writeFileSync(
    path.join(dir, 'page.pdf'),
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  );
  const { app, win } = await launch({ executablePath: executablePath! });
  await app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths })) as typeof dialog.showOpenDialog;
  }, [dir]);
  await win.getByRole('button', { name: 'Choose folder…' }).click();

  const panel = win.getByRole('complementary', { name: 'File preview' });
  await selectRow(win, 'photo.heic');
  const img = panel.getByRole('img', { name: 'Preview of photo.heic' });
  await expect.poll(() => img.evaluate((el) => (el as unknown as { naturalWidth: number }).naturalWidth)).toBe(64);

  await selectRow(win, 'page.pdf');
  const page = panel.getByRole('img', { name: 'Page 1 of page.pdf' });
  await expect.poll(() => page.evaluate((el) => (el as unknown as { width: number }).width)).toBeGreaterThan(0);
});
