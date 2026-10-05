import { copyFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.js';
import { selectRow } from './helpers.js';

// Spec P: the file preview panel. Clicking a row shows the file; the keyboard moves through rows.

const MEDIA = path.resolve('test/fixtures/media');

// The e2e config has no DOM types; these are the bits of the page the tests read.
interface Img {
  complete: boolean;
  naturalWidth: number;
  naturalHeight: number;
  src: string;
}
interface Media {
  readyState: number;
  duration: number;
}
interface Canvas {
  width: number;
}
interface PageGlobals {
  createImageBitmap(blob: unknown): Promise<{ width: number; height: number }>;
  OffscreenCanvas: new (
    w: number,
    h: number,
  ) => { getContext(type: '2d'): { drawImage(img: unknown, x: number, y: number): void; getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } };
}

/** A one-page PDF, small enough to write by hand. */
const PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R>>endobj
4 0 obj<</Length 35>>stream
0 0 1 rg 20 20 160 60 re f
endstream endobj
trailer<</Root 1 0 R>>
%%EOF
`;

async function addFolder(app: ElectronApplication, win: Page, dir: string, firstFile: string): Promise<void> {
  await app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths })) as typeof dialog.showOpenDialog;
  }, [dir]);
  await win.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(win.getByRole('cell', { name: firstFile, exact: true }).first()).toBeVisible();
}

const rowFor = (win: Page, name: string): Locator => win.getByRole('row').filter({ has: win.getByRole('cell', { name, exact: true }) });
const panel = (win: Page): Locator => win.getByRole('complementary', { name: 'File preview' });

/** Waits until the panel's picture has decoded, and returns its natural size. */
async function decoded(img: Locator): Promise<{ w: number; h: number }> {
  await expect.poll(() => img.evaluate((el) => (el as unknown as Img).complete && (el as unknown as Img).naturalWidth > 0)).toBe(true);
  return img.evaluate((el) => ({ w: (el as unknown as Img).naturalWidth, h: (el as unknown as Img).naturalHeight }));
}

test('clicking a row previews it, and the arrow keys move through the rows', async ({ launch, tempDir }) => {
  const dir = tempDir('renami-e2e-preview-');
  for (const name of ['photo.jpg', 'photo.heic', 'clip.mp4', 'notes.txt']) copyFileSync(path.join(MEDIA, name), path.join(dir, name));
  writeFileSync(path.join(dir, 'page.pdf'), PDF);
  const { app, win } = await launch();
  await addFolder(app, win, dir, 'photo.jpg');

  await selectRow(win, 'photo.jpg');
  await expect(panel(win)).toBeVisible();
  const jpeg = panel(win).getByRole('img', { name: 'Preview of photo.jpg' });
  expect((await decoded(jpeg)).w).toBeGreaterThan(0);
  await expect(panel(win).getByText('Size')).toBeVisible();

  // HEIC is decoded in the main process and arrives as a JPEG.
  await selectRow(win, 'photo.heic');
  const heic = panel(win).getByRole('img', { name: 'Preview of photo.heic' });
  expect(await decoded(heic)).toEqual({ w: 64, h: 48 });
  // The fixture is solid teal (0, 128, 128): red and blue swapped in the conversion would make it olive.
  const rgb = await heic.evaluate(async (el) => {
    const page = globalThis as unknown as PageGlobals;
    const bitmap = await page.createImageBitmap(await (await fetch((el as unknown as Img).src)).blob());
    const ctx = new page.OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const [r, g, b] = ctx.getImageData(bitmap.width / 2, bitmap.height / 2, 1, 1).data;
    return [r, g, b];
  });
  expect(rgb[0]).toBeLessThan(40);
  expect(rgb[1]).toBeGreaterThan(90);
  expect(rgb[2]).toBeGreaterThan(90);

  // ↑/↓ move the selection; the panel follows.
  await rowFor(win, 'photo.heic').press('ArrowDown');
  await expect(rowFor(win, 'photo.jpg')).toHaveAttribute('aria-current', 'true');
  await expect(panel(win).getByRole('img', { name: 'Preview of photo.jpg' })).toBeVisible();

  // Video plays from the scheme, and seeks: the player can read its duration.
  await selectRow(win, 'clip.mp4');
  const video = panel(win).locator('video');
  await expect.poll(() => video.evaluate((el) => (el as unknown as Media).readyState >= 1 && (el as unknown as Media).duration > 0)).toBe(true);

  // PDF pages are drawn by pdf.js.
  await selectRow(win, 'page.pdf');
  const canvas = panel(win).getByRole('img', { name: 'Page 1 of page.pdf' });
  await expect.poll(() => canvas.evaluate((el) => (el as unknown as Canvas).width)).toBeGreaterThan(0);
  await expect(panel(win).getByText("Couldn't show this file.")).toHaveCount(0);

  // A file type with no preview says so.
  await selectRow(win, 'notes.txt');
  await expect(panel(win).getByText('No preview for .txt files.')).toBeVisible();

  // Space closes the panel and opens it again; Escape closes it.
  await rowFor(win, 'notes.txt').press(' ');
  await expect(panel(win)).toHaveCount(0);
  await rowFor(win, 'notes.txt').press(' ');
  await expect(panel(win)).toBeVisible();
  await rowFor(win, 'notes.txt').press('Escape');
  await expect(panel(win)).toHaveCount(0);
});

test('Delete leaves the selected file out and moves to the next one', async ({ launch, tempDir }) => {
  const dir = tempDir('renami-e2e-preview-');
  for (const name of ['photo.jpg', 'nodate.jpg']) copyFileSync(path.join(MEDIA, name), path.join(dir, name));
  const { app, win } = await launch();
  await addFolder(app, win, dir, 'nodate.jpg');

  // photo.jpg sorts first: it was taken in 2024, and nodate.jpg only has today's file date. The
  // rows re-sort when that date arrives from ExifTool, so wait for it: pressed while photo.jpg is
  // still the last row, Delete has no next row to move to.
  await expect(rowFor(win, 'photo.jpg')).toHaveAttribute('aria-rowindex', '2');
  await selectRow(win, 'photo.jpg');
  await rowFor(win, 'photo.jpg').press('Delete');
  await expect(rowFor(win, 'photo.jpg').getByRole('checkbox')).not.toBeChecked();
  await expect(rowFor(win, 'nodate.jpg')).toHaveAttribute('aria-current', 'true');
  await expect(rowFor(win, 'nodate.jpg')).toBeFocused();

  // The panel's button puts it back.
  await selectRow(win, 'photo.jpg');
  await panel(win).getByRole('button', { name: 'Put back' }).click();
  await expect(rowFor(win, 'photo.jpg').getByRole('checkbox')).toBeChecked();
});

test('the scheme serves only files in the batch, and answers ranges', async ({ launch, tempDir }) => {
  const dir = tempDir('renami-e2e-preview-');
  copyFileSync(path.join(MEDIA, 'clip.mp4'), path.join(dir, 'clip.mp4'));
  const outside = path.join(tempDir('renami-e2e-outside-'), 'secret.jpg');
  copyFileSync(path.join(MEDIA, 'photo.jpg'), outside);
  const { app, win } = await launch();
  await addFolder(app, win, dir, 'clip.mp4');

  const status = (file: string, range?: string) =>
    win.evaluate(
      async ([p, r]) => {
        const res = await fetch(`renami-file://preview/?path=${encodeURIComponent(p!)}`, r ? { headers: { range: r } } : {});
        return { status: res.status, range: res.headers.get('content-range'), bytes: (await res.arrayBuffer()).byteLength };
      },
      [file, range] as const,
    );
  expect((await status(outside)).status).toBe(404);
  const clip = path.join(dir, 'clip.mp4');
  expect(await status(clip, 'bytes=0-99')).toEqual({ status: 206, range: `bytes 0-99/${statSync(clip).size}`, bytes: 100 });
  expect((await status(clip)).status).toBe(200);
});

test('the panel width is remembered', async ({ launch, tempDir }) => {
  const dir = tempDir('renami-e2e-preview-');
  copyFileSync(path.join(MEDIA, 'photo.jpg'), path.join(dir, 'photo.jpg'));
  const { app, win } = await launch();
  await addFolder(app, win, dir, 'photo.jpg');
  await selectRow(win, 'photo.jpg');
  const edge = win.getByRole('separator', { name: 'Resize preview panel' });
  await edge.focus();
  const width = async (): Promise<number> => (await panel(win).boundingBox())!.width;
  const initial = await width();
  for (let i = 0; i < 4; i += 1) await edge.press('ArrowLeft');
  await expect.poll(width).toBeGreaterThan(initial);
  const resized = await width();
  await win.reload();
  await addFolder(app, win, dir, 'photo.jpg');
  await selectRow(win, 'photo.jpg');
  await expect.poll(async () => Math.abs((await width()) - resized) <= 1).toBe(true);
});

test('a file being previewed can still be renamed, and the panel follows it', async ({ launch, tempDir }) => {
  const dir = tempDir('renami-e2e-preview-');
  copyFileSync(path.join(MEDIA, 'clip.mp4'), path.join(dir, 'clip.mp4'));
  const { app, win } = await launch();
  await addFolder(app, win, dir, 'clip.mp4');
  await win.getByRole('textbox', { name: 'Name pattern' }).fill('Beach');
  await selectRow(win, 'clip.mp4');
  const video = panel(win).locator('video');
  await expect.poll(() => video.evaluate((el) => (el as unknown as Media).readyState >= 1)).toBe(true);

  // Windows refuses to rename a file that is open; the app lets go of it before renaming.
  await win.getByRole('button', { name: 'Rename 1 file' }).click();
  await expect(win.getByText('Renamed 1 file.')).toBeVisible();
  await expect(panel(win).getByLabel('Preview of Beach.mp4')).toBeVisible();
});
