import { mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

// Covers sort direction and restarts, typing a name into
// the preview, CSV export, importing a name list, and folder mode.

/** Points the native open dialog at `paths` for every pick that follows. */
async function stubOpenDialog(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths })) as typeof dialog.showOpenDialog;
  }, paths);
}

/** Points the native save dialog at `filePath`. */
async function stubSaveDialog(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as typeof dialog.showSaveDialog;
  }, filePath);
}

/** Adds dir from the empty state, then waits for `firstFile` to show in the preview. */
async function addFolder(app: ElectronApplication, win: Page, dir: string, firstFile: string): Promise<void> {
  await stubOpenDialog(app, [dir]);
  await win.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(win.getByRole('cell', { name: firstFile, exact: true }).first()).toBeVisible();
}

/** Writes small text files with the given modified dates, and returns dir. */
function writeDated(dir: string, files: Record<string, Date>): string {
  for (const [name, when] of Object.entries(files)) {
    const p = path.join(dir, name);
    writeFileSync(p, name);
    utimesSync(p, when, when);
  }
  return dir;
}

const pattern = (win: Page): Locator => win.getByRole('textbox', { name: 'Name pattern' });
const rowFor = (win: Page, text: string): Locator => win.getByRole('row').filter({ hasText: text });
const tab = (win: Page, label: string): Locator => win.getByRole('tab', { name: new RegExp(`^${label.replace(/[&]/g, '\\$&')}`) });
const cell = (row: Locator, name: string): Locator => row.getByRole('cell', { name, exact: true });

test('numbers newest first, and restarts the count each day', async ({ launch, tempDir }) => {
  const dir = writeDated(tempDir('renami-e2e-features-'), {
    'old.txt': new Date(2024, 0, 1, 10),
    'mid.txt': new Date(2024, 0, 1, 12),
    'new.txt': new Date(2024, 0, 2, 10),
  });
  const { app, win } = await launch();
  await addFolder(app, win, dir, 'old.txt');

  await pattern(win).fill('{seq}');
  await tab(win, 'Sequence').click();
  const panel = win.getByRole('tabpanel');
  await panel.getByLabel('Sort by').selectOption('modified');
  await expect(cell(rowFor(win, 'old.txt'), '001.txt')).toBeVisible();
  await expect(cell(rowFor(win, 'new.txt'), '003.txt')).toBeVisible();

  // getByLabel would also see the "Sort by" select (its "Manual order" option contains "order");
  // the accessible name from the combobox role itself is just "Order".
  await panel.getByRole('combobox', { name: 'Order', exact: true }).selectOption('desc');
  await expect(cell(rowFor(win, 'new.txt'), '001.txt')).toBeVisible();
  await expect(cell(rowFor(win, 'old.txt'), '003.txt')).toBeVisible();

  // getByLabel would also see the "Restart numbering in each folder" checkbox.
  await panel.getByRole('combobox', { name: 'Restart', exact: true }).selectOption('day');
  // new.txt is alone on its day; mid.txt and old.txt share the other day and restart at 001.
  await expect(cell(rowFor(win, 'new.txt'), '001.txt')).toBeVisible();
  await expect(cell(rowFor(win, 'mid.txt'), '001_2.txt')).toBeVisible();
  await expect(cell(rowFor(win, 'old.txt'), '002.txt')).toBeVisible();
});

test('types a name into the preview and renames with it', async ({ launch, tempDir }) => {
  const dir = tempDir('renami-e2e-features-');
  writeFileSync(path.join(dir, 'a.txt'), 'a');
  writeFileSync(path.join(dir, 'b.txt'), 'b');
  const { app, win } = await launch();
  await addFolder(app, win, dir, 'a.txt');

  await rowFor(win, 'a.txt').getByRole('cell').nth(1).dblclick();
  const editor = win.getByRole('textbox', { name: 'New name for a.txt' });
  await expect(editor).toHaveValue('a');
  await editor.fill('beach');
  await editor.press('Enter');
  await expect(cell(rowFor(win, 'a.txt'), 'beach.txt')).toBeVisible();
  await expect(rowFor(win, 'a.txt').getByText('Edited')).toBeVisible();
  // b.txt is untouched, so its current-name and new-name cells both read "b.txt"; the new-name
  // cell is the second one in the row.
  await expect(rowFor(win, 'b.txt').getByRole('cell').nth(1)).toHaveText('b.txt');

  const rename = win.getByRole('button', { name: 'Rename 1 file' });
  await expect(rename).toBeEnabled();
  await rename.click();
  await expect(win.getByText('Renamed 1 file.')).toBeVisible();
  expect(readdirSync(dir).sort()).toEqual(['b.txt', 'beach.txt']);
});

test('exports the preview as CSV through the save dialog', async ({ launch, tempDir }) => {
  const dir = tempDir('renami-e2e-features-');
  writeFileSync(path.join(dir, 'a.txt'), 'a');
  const out = path.join(tempDir('renami-e2e-export-'), 'preview.csv');
  const { app, win } = await launch();
  await addFolder(app, win, dir, 'a.txt');
  await pattern(win).fill('Trip_{seq}');
  await expect(cell(rowFor(win, 'a.txt'), 'Trip_001.txt')).toBeVisible();

  await stubSaveDialog(app, out);
  await win.getByRole('button', { name: 'Export…' }).click();
  await win.getByRole('menuitem', { name: 'Preview as CSV…' }).click();
  await expect(win.getByText('Saved the preview.')).toBeVisible();
  const lines = readFileSync(out, 'utf8').split('\r\n');
  expect(lines[0]).toBe('Current name,New name,Status,Date used,From folder,Path');
  expect(lines[1]).toContain('a.txt,Trip_001.txt,Ready,');
});

test('imports a name list, one name per line, in preview order', async ({ launch, tempDir }) => {
  const dir = tempDir('renami-e2e-features-');
  writeFileSync(path.join(dir, 'a.txt'), 'a');
  writeFileSync(path.join(dir, 'b.txt'), 'b');
  const names = path.join(tempDir('renami-e2e-names-'), 'names.txt');
  writeFileSync(names, 'beach\nsunset\n');
  const { app, win } = await launch();
  await addFolder(app, win, dir, 'a.txt');
  await tab(win, 'Sequence').click();
  await win.getByRole('tabpanel').getByLabel('Sort by').selectOption('name');

  await stubOpenDialog(app, [names]);
  await win.getByRole('button', { name: 'Import names…' }).click();
  await expect(win.getByText('Imported 2 names from names.txt.')).toBeVisible();
  await expect(cell(rowFor(win, 'a.txt'), 'beach.txt')).toBeVisible();
  await expect(cell(rowFor(win, 'b.txt'), 'sunset.txt')).toBeVisible();
});

test('renames the folders inside a source in folder mode, and undo puts them back', async ({ launch, tempDir }) => {
  const dir = tempDir('renami-e2e-features-');
  mkdirSync(path.join(dir, 'beach'));
  mkdirSync(path.join(dir, 'city'));
  writeFileSync(path.join(dir, 'notes.txt'), 'x');
  const { app, win } = await launch();
  await addFolder(app, win, dir, 'notes.txt');

  await win.getByRole('button', { name: /^Files/ }).click();
  await win.getByRole('dialog', { name: 'Filters' }).getByLabel('Folders').click();
  await win.keyboard.press('Escape');
  await expect(win.getByLabel('Subfolders')).toBeDisabled();
  await expect(win.getByRole('cell', { name: 'beach', exact: true }).first()).toBeVisible();

  await pattern(win).fill('Album_{seq}');
  await tab(win, 'Sequence').click();
  await win.getByRole('tabpanel').getByLabel('Sort by').selectOption('name');
  await expect(cell(rowFor(win, 'beach'), 'Album_001')).toBeVisible();
  await expect(cell(rowFor(win, 'city'), 'Album_002')).toBeVisible();

  const rename = win.getByRole('button', { name: 'Rename 2 files' });
  await expect(rename).toBeEnabled();
  await rename.click();
  await expect(win.getByText('Renamed 2 files.')).toBeVisible();
  expect(readdirSync(dir).sort()).toEqual(['Album_001', 'Album_002', 'notes.txt']);

  await win.getByRole('button', { name: 'Undo last rename' }).click();
  await expect(win.getByText(/Undid the last rename/)).toBeVisible();
  expect(readdirSync(dir).sort()).toEqual(['beach', 'city', 'notes.txt']);
});

test('hashes files for {crc32} and shows the size token', async ({ launch, tempDir }) => {
  const dir = tempDir('renami-e2e-features-');
  writeFileSync(path.join(dir, 'abc.txt'), 'abc');
  const { app, win } = await launch();
  await addFolder(app, win, dir, 'abc.txt');
  await pattern(win).fill('{crc32}_{size}');
  await expect(cell(rowFor(win, 'abc.txt'), '352441c2_3B.txt')).toBeVisible();
});
