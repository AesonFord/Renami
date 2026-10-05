import { chmodSync, copyFileSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

// What the user can do in the window that app.spec.ts and columns.spec.ts don't drive: editing
// tokens, the All tokens list, presets, the files strip, every option tab, errors and warnings in
// the action bar, a stale batch, the done notice, and the keyboard side of column resizing.

const MEDIA = path.resolve('test/fixtures/media');

/** Points the native open dialog at `paths` for every pick that follows (files, folders, destinations). */
async function stubOpenDialog(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths })) as typeof dialog.showOpenDialog;
  }, paths);
}

/** Adds dir from the empty state the way a user would, then waits for `firstFile` to show in the preview. */
async function addFolder(app: ElectronApplication, win: Page, dir: string, firstFile: string): Promise<void> {
  await stubOpenDialog(app, [dir]);
  await win.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(win.getByRole('cell', { name: firstFile, exact: true }).first()).toBeVisible();
}

/** Makes small text files named `names` in dir, and returns dir. */
function writeFiles(dir: string, names: string[]): string {
  for (const name of names) writeFileSync(path.join(dir, name), name);
  return dir;
}

/** Copies the named test media into dir, and returns dir. */
function copyMedia(dir: string, names: string[]): string {
  for (const name of names) copyFileSync(path.join(MEDIA, name), path.join(dir, name));
  return dir;
}

const pattern = (win: Page): Locator => win.getByRole('textbox', { name: 'Name pattern' });
const renameButton = (win: Page): Locator => win.getByRole('button', { name: /^(Rename|Change dates on)/ });
const summary = (win: Page): Locator => win.locator('.summary');
const rowFor = (win: Page, text: string): Locator => win.getByRole('row').filter({ hasText: text });
const tab = (win: Page, label: string): Locator => win.getByRole('tab', { name: new RegExp(`^${label.replace(/[&]/g, '\\$&')}`) });

/** Puts the caret `fromEnd` characters before the end of the pattern and presses Enter, which opens that token's editor. */
async function openTokenAt(win: Page, fromEnd: number): Promise<void> {
  const input = pattern(win);
  await input.press('End');
  for (let i = 0; i < fromEnd; i += 1) await input.press('ArrowLeft');
  await input.press('Enter');
}

test('edits a token in place: a default, a date format, seq digits, and removing it', async ({ launch, tempDir }) => {
  const dir = copyMedia(tempDir('renami-e2e-ui-'), ['photo.jpg', 'notes.txt']);
  const { app, win } = await launch();
  await addFolder(app, win, dir, 'photo.jpg');

  // A default fills in for files that have no value.
  await pattern(win).fill('{camera_model}');
  await expect(win.getByRole('cell', { name: 'EOS R5.jpg', exact: true })).toBeVisible();
  await openTokenAt(win, 2);
  const cameraEditor = win.getByRole('dialog', { name: 'Edit {camera_model}' });
  await cameraEditor.getByLabel('Default').fill('Unknown');
  await cameraEditor.getByRole('button', { name: 'Apply' }).click();
  await expect(cameraEditor).toHaveCount(0);
  await expect(pattern(win)).toHaveValue('{camera_model|Unknown}');
  await expect(win.getByRole('cell', { name: 'Unknown.txt', exact: true })).toBeVisible();

  // A date format picked from the suggestions.
  await pattern(win).fill('{date_taken}');
  await openTokenAt(win, 2);
  const dateEditor = win.getByRole('dialog', { name: 'Edit {date_taken}' });
  await dateEditor.getByRole('button', { name: 'YYYY', exact: true }).click();
  await expect(dateEditor.getByLabel('Format')).toHaveValue('YYYY');
  await dateEditor.getByRole('button', { name: 'Apply' }).click();
  await expect(pattern(win)).toHaveValue('{date_taken:YYYY}');
  await expect(win.getByRole('cell', { name: '2024.jpg', exact: true })).toBeVisible();

  // Reserved characters are refused; Remove token takes the whole token out.
  await openTokenAt(win, 2);
  await dateEditor.getByLabel('Format').fill('YYYY|MM');
  await dateEditor.getByRole('button', { name: 'Apply' }).click();
  await expect(dateEditor.getByRole('alert')).toHaveText("Formats and defaults can't contain {, } or |");
  await dateEditor.getByRole('button', { name: 'Remove token' }).click();
  await expect(dateEditor).toHaveCount(0);
  await expect(pattern(win)).toHaveValue('');

  // {seq}'s digits must be 1 to 10.
  await pattern(win).fill('{seq}');
  await openTokenAt(win, 2);
  const seqEditor = win.getByRole('dialog', { name: 'Edit {seq}' });
  await seqEditor.getByLabel('Digits').fill('11');
  await seqEditor.getByRole('button', { name: 'Apply' }).click();
  await expect(seqEditor.getByRole('alert')).toHaveText('Digits must be a whole number from 1 to 10');
  await seqEditor.getByLabel('Digits').fill('2');
  await seqEditor.getByRole('button', { name: 'Apply' }).click();
  await expect(pattern(win)).toHaveValue('{seq:2}');
  await expect(win.getByRole('cell', { name: '01.jpg', exact: true })).toBeVisible();

  // Enter outside a token opens nothing.
  await pattern(win).fill('plain');
  await pattern(win).press('Enter');
  await expect(win.getByRole('dialog')).toHaveCount(0);
});

test('inserts tokens from the palette and from the searchable All tokens list', async ({ launch, tempDir }) => {
  const dir = copyMedia(tempDir('renami-e2e-ui-'), ['photo.jpg']);
  const { app, win } = await launch();
  await addFolder(app, win, dir, 'photo.jpg');

  await pattern(win).fill('shot_');
  await pattern(win).press('End');
  await win.getByRole('toolbar', { name: 'Insert a token' }).getByRole('button', { name: 'Camera', exact: true }).click();
  await expect(pattern(win)).toHaveValue('shot_{camera_model}');
  await expect(win.getByRole('cell', { name: 'shot_EOS R5.jpg', exact: true })).toBeVisible();

  await win.getByRole('button', { name: 'All tokens…' }).click();
  const dialog = win.getByRole('dialog', { name: 'All tokens' });
  await expect(dialog.getByText('Values for photo.jpg')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^\{camera_model\}/ })).toContainText('EOS R5');
  await expect(dialog.getByRole('button', { name: /^\{artist\}/ })).toContainText('No value');
  await dialog.getByRole('searchbox', { name: 'Search tokens' }).fill('lens');
  await expect(dialog.getByRole('listitem')).toHaveCount(1);
  await dialog.getByRole('button', { name: /^\{lens\}/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(pattern(win)).toHaveValue('shot_{camera_model}{lens}');
  await expect(win.getByRole('cell', { name: /RF24-70mm/ })).toBeVisible();

  await win.getByRole('button', { name: 'All tokens…' }).click();
  await expect(dialog).toBeVisible();
  await win.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('saves, loads and deletes presets from the strip, and keeps them across a reload', async ({ launch, tempDir }) => {
  const dir = writeFiles(tempDir('renami-e2e-ui-'), ['alpha.txt', 'bravo.txt']);
  const { app, win } = await launch();
  await addFolder(app, win, dir, 'alpha.txt');
  const preset = win.getByRole('combobox', { name: 'Preset' });

  await pattern(win).fill('Trip_{seq}');
  await win.getByRole('button', { name: 'Save', exact: true }).click();
  const saveDialog = win.getByRole('dialog', { name: 'Save preset' });
  await expect(saveDialog.getByRole('button', { name: 'Save preset' })).toBeDisabled();
  await saveDialog.getByRole('textbox').fill('Trip');
  await saveDialog.getByRole('button', { name: 'Save preset' }).click();
  await expect(saveDialog).toHaveCount(0);
  await expect(preset).toHaveValue('Trip');

  // Loading a preset brings its pattern back.
  await preset.selectOption({ label: 'None' });
  await pattern(win).fill('{name}');
  await expect(win.getByRole('cell', { name: 'alpha.txt', exact: true })).toHaveCount(2);
  await preset.selectOption('Trip');
  await expect(pattern(win)).toHaveValue('Trip_{seq}');
  await expect(win.getByRole('cell', { name: 'Trip_001.txt', exact: true })).toBeVisible();

  // Saving under a name that exists says it will replace it.
  await win.getByRole('button', { name: 'Save', exact: true }).click();
  await saveDialog.getByRole('textbox').fill('Trip');
  await expect(saveDialog.getByText('This replaces the saved preset "Trip".')).toBeVisible();
  await saveDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(saveDialog).toHaveCount(0);

  // Presets live in the user data folder, so they survive a reload of the page.
  await win.reload();
  await addFolder(app, win, dir, 'alpha.txt');
  await expect(preset.getByRole('option', { name: 'Trip' })).toHaveCount(1);
  await preset.selectOption('Trip');
  await expect(pattern(win)).toHaveValue('Trip_{seq}');

  await win.getByRole('button', { name: 'Delete preset Trip' }).click();
  const deleteDialog = win.getByRole('dialog', { name: 'Delete preset' });
  await expect(deleteDialog).toContainText('Delete the preset "Trip"?');
  await deleteDialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(deleteDialog).toHaveCount(0);
  await expect(preset).toHaveValue('');
  await expect(preset.getByRole('option', { name: 'Trip' })).toHaveCount(0);
  await expect(win.getByRole('button', { name: 'Delete preset Trip' })).toHaveCount(0);
});

test('adds and removes sources, includes subfolders, and filters by file type', async ({ launch, tempDir }) => {
  const dir = writeFiles(tempDir('renami-e2e-ui-'), ['alpha.txt']);
  copyMedia(dir, ['photo.jpg']);
  mkdirSync(path.join(dir, 'nested'));
  writeFiles(path.join(dir, 'nested'), ['deep.txt']);
  const extra = writeFiles(tempDir('renami-e2e-ui-extra-'), ['extra.txt']);
  const { app, win } = await launch();
  await addFolder(app, win, dir, 'alpha.txt');

  const folderChip = win.locator('.chip-source').filter({ hasText: path.basename(dir) });
  await expect(folderChip.locator('.count')).toHaveText('2');

  await win.getByRole('checkbox', { name: 'Subfolders' }).check();
  await expect(win.getByRole('cell', { name: 'deep.txt', exact: true }).first()).toBeVisible();
  await expect(folderChip.locator('.count')).toHaveText('3');

  // Unchecking a type hides those files; the button says which types are left.
  await win.getByRole('button', { name: /^All types/ }).click();
  const types = win.getByRole('dialog', { name: 'File types' });
  await types.getByRole('checkbox', { name: '.txt', exact: true }).uncheck();
  await expect(win.getByRole('button', { name: /^Only: \.jpg/ })).toBeVisible();
  await expect(win.getByRole('cell', { name: 'alpha.txt', exact: true })).toHaveCount(0);
  await expect(folderChip.locator('.count')).toHaveText('1');
  await types.getByRole('button', { name: 'Show all types' }).click();
  await expect(win.getByRole('button', { name: /^All types/ })).toBeVisible();
  await expect(win.getByRole('cell', { name: 'alpha.txt', exact: true }).first()).toBeVisible();
  await win.keyboard.press('Escape');
  await expect(types).toHaveCount(0);

  // The add menu works from the keyboard and gives focus back to its button.
  const add = win.getByRole('button', { name: '+ Add files or folders' });
  await add.click();
  const menu = win.getByRole('menu', { name: 'Add' });
  const filesItem = menu.getByRole('menuitem', { name: 'Files…' });
  const folderItem = menu.getByRole('menuitem', { name: 'Folder…' });
  await expect(filesItem).toBeFocused();
  await win.keyboard.press('ArrowDown');
  await expect(folderItem).toBeFocused();
  await win.keyboard.press('ArrowDown');
  await expect(filesItem).toBeFocused();
  await win.keyboard.press('End');
  await expect(folderItem).toBeFocused();
  await win.keyboard.press('Home');
  await expect(filesItem).toBeFocused();
  await win.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(add).toBeFocused();

  // A single file is a source of its own.
  await stubOpenDialog(app, [path.join(extra, 'extra.txt')]);
  await add.click();
  await filesItem.click();
  await expect(win.getByRole('cell', { name: 'extra.txt', exact: true }).first()).toBeVisible();
  const fileChip = win.locator('.chip-source').filter({ hasText: 'extra.txt' });
  await expect(fileChip.locator('.count')).toHaveText('1');

  await win.getByRole('button', { name: 'Remove extra.txt' }).click();
  await expect(fileChip).toHaveCount(0);
  await expect(win.getByRole('cell', { name: 'extra.txt', exact: true })).toHaveCount(0);
  await win.getByRole('button', { name: `Remove ${path.basename(dir)}` }).click();
  await expect(win.getByRole('heading', { name: 'Drop files or folders here' })).toBeVisible();
});

test("warns when a subfolder can't be opened", async ({ launch, tempDir }) => {
  test.skip(process.platform === 'win32', 'chmod does not lock a folder on Windows');
  test.skip(process.getuid?.() === 0, 'root can open any folder');
  const dir = writeFiles(tempDir('renami-e2e-ui-'), ['alpha.txt']);
  const locked = path.join(dir, 'locked');
  mkdirSync(locked);
  chmodSync(locked, 0o000);
  try {
    const { app, win } = await launch();
    await addFolder(app, win, dir, 'alpha.txt');
    await win.getByRole('checkbox', { name: 'Subfolders' }).check();
    const warning = win.getByText("1 folder couldn't be opened");
    await expect(warning).toBeVisible();
    await expect(warning).toHaveAttribute('title', locked);
  } finally {
    chmodSync(locked, 0o755);
  }
});

test('the Sequence tab numbers files, and points out when the numbers go unused', async ({ launch, tempDir }) => {
  const dir = writeFiles(tempDir('renami-e2e-ui-'), ['alpha.txt', 'bravo.txt', 'charlie.txt']);
  const { app, win } = await launch();
  await addFolder(app, win, dir, 'alpha.txt');
  const sequence = tab(win, 'Sequence');
  const panel = win.getByRole('tabpanel');

  await expect(sequence).toHaveAttribute('aria-selected', 'true');
  await expect(sequence.locator('.tab-count')).toHaveCount(0);
  await panel.getByLabel('Sort by').selectOption('name');
  await panel.getByLabel('Digits').fill('2');
  await expect(sequence.locator('.tab-count')).toHaveText('2');

  // With no {seq} in the pattern, the tab offers to add one.
  await expect(panel.getByText("The pattern has no {seq}, so these numbers aren't used.")).toBeVisible();
  await panel.getByRole('button', { name: 'Add {seq}' }).click();
  await expect(pattern(win)).toHaveValue('{name}_{seq}');
  await expect(win.getByRole('cell', { name: 'alpha_01.txt', exact: true })).toBeVisible();
  await expect(win.getByRole('cell', { name: 'charlie_03.txt', exact: true })).toBeVisible();

  await panel.getByLabel('Start at').fill('7');
  await expect(win.getByRole('cell', { name: 'bravo_08.txt', exact: true })).toBeVisible();
  await expect(sequence.locator('.tab-count')).toHaveText('3');

  // A {seq} with its own digits ignores the tab's Digits.
  await pattern(win).fill('{name}_{seq:4}');
  await expect(panel.getByText("The pattern's {seq:4} sets its own digits, so Digits isn't used.")).toBeVisible();
  await expect(win.getByRole('cell', { name: 'alpha_0007.txt', exact: true })).toBeVisible();
});

test('find & replace rewrites {name} and reports a bad regex; case & cleanup change the letters', async ({ launch, tempDir }) => {
  const dir = writeFiles(tempDir('renami-e2e-ui-'), ['Holiday Snap.txt', 'beach day.TXT']);
  const { app, win } = await launch();
  await addFolder(app, win, dir, 'Holiday Snap.txt');
  const panel = win.getByRole('tabpanel');

  const findReplace = tab(win, 'Find & replace');
  await findReplace.click();
  await expect(panel.getByText(/^Rules change each file's current name/)).toBeVisible();
  await panel.getByRole('button', { name: '+ Add rule' }).click();
  const rule = panel.getByRole('group', { name: 'Rule 1' });
  await rule.getByLabel('Find', { exact: true }).fill('Snap');
  await rule.getByLabel('Replace with').fill('Pic');
  await expect(win.getByRole('cell', { name: 'Holiday Pic.txt', exact: true })).toBeVisible();
  await expect(findReplace.locator('.tab-count')).toHaveText('1');

  await rule.getByRole('checkbox', { name: 'Regex' }).check();
  await rule.getByLabel('Find', { exact: true }).fill('[');
  await expect(win.getByRole('alert')).toContainText('Find & replace rule 1:');
  await expect(renameButton(win)).toBeDisabled();
  await rule.getByRole('button', { name: 'Remove rule 1' }).click();
  await expect(rule).toHaveCount(0);
  await expect(win.getByRole('alert')).toHaveCount(0);
  await expect(findReplace.locator('.tab-count')).toHaveCount(0);

  const cleanup = tab(win, 'Case & cleanup');
  await cleanup.click();
  // getByLabel would see the wrapping label's text, options included; the accessible name is just "Case".
  await panel.getByRole('combobox', { name: 'Case', exact: true }).selectOption('upper');
  await expect(win.getByRole('cell', { name: 'HOLIDAY SNAP.txt', exact: true })).toBeVisible();
  await panel.getByRole('checkbox', { name: 'Spaces to underscores' }).check();
  await expect(win.getByRole('cell', { name: 'HOLIDAY_SNAP.txt', exact: true })).toBeVisible();
  await panel.getByRole('checkbox', { name: 'Lowercase extension' }).check();
  await expect(win.getByRole('cell', { name: 'BEACH_DAY.txt', exact: true })).toBeVisible();
  await expect(cleanup.locator('.tab-count')).toHaveText('3');
});

test('moves every file into one chosen folder, and undo brings them back', async ({ launch, tempDir }) => {
  const dir = copyMedia(tempDir('renami-e2e-ui-'), ['photo.jpg', 'notes.txt']);
  const dest = tempDir('renami-e2e-ui-dest-');
  const { app, win } = await launch();
  await addFolder(app, win, dir, 'photo.jpg');
  const move = tab(win, 'Move into folders');
  const panel = win.getByRole('tabpanel');

  await move.click();
  await expect(panel.getByRole('radio', { name: "Each file's current folder" })).toBeChecked();
  await stubOpenDialog(app, [dest]);
  await panel.getByRole('button', { name: 'Choose destination…' }).click();
  await expect(panel.getByRole('radio', { name: 'One folder' })).toBeChecked();
  await expect(panel.getByTitle(dest)).toBeVisible();
  await expect(move.locator('.tab-count')).toHaveText('1');

  await expect(rowFor(win, 'notes.txt').locator('.badge').first()).toHaveText('Will move');
  await expect(summary(win)).toContainText('2 will be renamed');
  const rename = win.getByRole('button', { name: 'Rename 2 files' });
  await expect(rename).toBeEnabled();
  await rename.click();
  await expect(win.getByText('Renamed 2 files.')).toBeVisible();
  expect(readdirSync(dest).sort()).toEqual(['notes.txt', 'photo.jpg']);
  expect(readdirSync(dir)).toEqual([]);

  await win.getByRole('button', { name: 'Undo last rename' }).click();
  await expect(win.getByText('Undid the last rename (2 files).')).toBeVisible();
  expect(readdirSync(dir).sort()).toEqual(['notes.txt', 'photo.jpg']);
  expect(readdirSync(dest)).toEqual([]);

  await panel.getByRole('radio', { name: "Each file's current folder" }).check();
  await expect(move.locator('.tab-count')).toHaveCount(0);
});

test('the File dates tab changes only the dates of files with a date taken, and undo restores them', async ({ launch, tempDir }) => {
  const dir = copyMedia(tempDir('renami-e2e-ui-'), ['photo.jpg', 'notes.txt']);
  const photo = path.join(dir, 'photo.jpg');
  const before = statSync(photo).mtimeMs;
  const { app, win } = await launch();
  await addFolder(app, win, dir, 'photo.jpg');
  const dates = tab(win, 'File dates');
  const panel = win.getByRole('tabpanel');

  await dates.click();
  if (process.platform === 'linux') {
    await expect(panel.getByRole('checkbox', { name: 'Set created date to date taken' })).toBeDisabled();
    await expect(panel.getByText("Linux doesn't let apps change a file's created date.")).toBeVisible();
  }
  await panel.getByRole('checkbox', { name: 'Set modified date to date taken' }).check();
  await expect(dates.locator('.tab-count')).toHaveText('1');
  await expect(rowFor(win, 'photo.jpg').locator('.badge').first()).toHaveText('Dates only');
  await expect(rowFor(win, 'notes.txt').locator('.badge').first()).toHaveText('No date taken');
  await expect(summary(win)).toContainText('1 will only get new dates');
  await expect(summary(win)).toContainText('1 has no date taken');

  const change = win.getByRole('button', { name: 'Change dates on 1 file' });
  await expect(change).toBeEnabled();
  await change.click();
  await expect(win.getByText('Changed dates on 1 file.')).toBeVisible();
  const changed = new Date(statSync(photo).mtimeMs);
  expect([changed.getFullYear(), changed.getMonth() + 1, changed.getDate()]).toEqual([2024, 7, 4]);
  expect(readdirSync(dir).sort()).toEqual(['notes.txt', 'photo.jpg']);

  await win.getByRole('button', { name: 'Undo last rename' }).click();
  await expect(win.getByText('Undid the last rename (1 file).')).toBeVisible();
  expect(Math.abs(statSync(photo).mtimeMs - before)).toBeLessThan(1000);
});

test('errors block renaming until those files are excluded, and they can be put back', async ({ launch, tempDir }) => {
  const dir = copyMedia(tempDir('renami-e2e-ui-'), ['photo.jpg', 'notes.txt']);
  const { app, win } = await launch();
  await addFolder(app, win, dir, 'photo.jpg');

  // notes.txt has no camera, so its whole name is empty: an error on top of the missing-value warning.
  await pattern(win).fill('{camera_model}');
  await expect(win.getByRole('cell', { name: 'EOS R5.jpg', exact: true })).toBeVisible();
  const notes = rowFor(win, 'notes.txt');
  await expect(notes.locator('.badge').first()).toHaveText('Empty name');
  await expect(notes.locator('.badge').first()).toHaveAttribute('title', /The new name is empty/);
  await expect(notes.locator('.badge').nth(1)).toHaveText('+1');
  await expect(summary(win)).toContainText('1 is missing a value');
  await expect(summary(win)).toContainText('1 has errors');
  await expect(renameButton(win)).toBeDisabled();
  await expect(renameButton(win)).toHaveAttribute('title', 'Fix or exclude the files with errors');

  // Excluded files stay in the preview, unchecked and left out.
  await win.getByRole('button', { name: 'Exclude these files' }).click();
  await expect(notes.locator('.badge').first()).toHaveText('Left out');
  await expect(notes.getByRole('checkbox')).not.toBeChecked();
  await expect(summary(win)).toContainText('1 is left out');
  await expect(win.getByRole('button', { name: 'Rename 1 file' })).toBeEnabled();

  await win.getByRole('button', { name: 'Put back 1 excluded file' }).click();
  await expect(notes.locator('.badge').first()).toHaveText('Empty name');
  await expect(notes.getByRole('checkbox')).toBeChecked();
  await expect(renameButton(win)).toBeDisabled();
});

test('renames only the files left checked, numbering them without the rest', async ({ launch, tempDir }) => {
  const dir = writeFiles(tempDir('renami-e2e-ui-'), ['a.txt', 'b.txt', 'c.txt', 'd.txt']);
  const { app, win } = await launch();
  await addFolder(app, win, dir, 'a.txt');
  await tab(win, 'Sequence').click();
  await win.getByLabel('Sort by').selectOption('name');
  await pattern(win).fill('Trip_{seq:3}');
  await expect(win.getByRole('cell', { name: 'Trip_004.txt', exact: true })).toBeVisible();

  await win.getByRole('checkbox', { name: 'Rename b.txt' }).click();
  // Shift-click takes the range from b.txt down to c.txt.
  await win.getByRole('checkbox', { name: 'Rename c.txt' }).click({ modifiers: ['Shift'] });
  await expect(rowFor(win, 'c.txt').locator('.badge').first()).toHaveText('Left out');
  await expect(win.getByRole('checkbox', { name: 'Rename all files shown' })).not.toBeChecked();
  await expect(summary(win)).toContainText('2 are left out');
  await expect(win.getByRole('cell', { name: 'Trip_002.txt', exact: true })).toBeVisible();

  await win.getByRole('button', { name: 'Rename 2 files' }).click();
  await expect(win.getByText('Renamed 2 files.')).toBeVisible();
  expect(readdirSync(dir).sort()).toEqual(['Trip_001.txt', 'Trip_002.txt', 'b.txt', 'c.txt']);
});

test('warns about suffixes and missing values, and can show only the files that need a look', async ({ launch, tempDir }) => {
  const dir = copyMedia(tempDir('renami-e2e-ui-'), ['photo.jpg']);
  writeFiles(dir, ['alpha.txt', 'bravo.txt']);
  const { app, win } = await launch();
  await addFolder(app, win, dir, 'photo.jpg');

  // Two .txt files can't both become same.txt; the second gets a suffix.
  await pattern(win).fill('same');
  await expect(win.getByRole('cell', { name: 'same_2.txt', exact: true })).toBeVisible();
  await expect(rowFor(win, 'same_2.txt').locator('.badge').first()).toHaveText('Suffix added');
  await expect(summary(win)).toContainText('1 got a suffix');

  await pattern(win).fill('{artist}_{name}');
  await expect(summary(win)).toContainText('3 are missing a value');
  await expect(win.locator('.badge').filter({ hasText: 'Missing value' })).toHaveCount(3);

  await win.getByRole('checkbox', { name: 'Show only files that need a look (3)' }).check();
  await expect(win.getByRole('row')).toHaveCount(4);
  await pattern(win).fill('{name}');
  const toggle = win.getByRole('checkbox', { name: 'Show only files that need a look (0)' });
  await expect(toggle).toBeChecked();
  await expect(win.getByText('Nothing needs a look.')).toBeVisible();
  await expect(win.getByRole('row')).toHaveCount(1);
  // click(), not uncheck(): with nothing left to look at, the toggle disappears as soon as it's off,
  // and uncheck() would keep retrying while it looks for the box to verify.
  await toggle.click();
  await expect(win.getByRole('cell', { name: 'alpha.txt', exact: true }).first()).toBeVisible();
  await expect(toggle).toHaveCount(0);
});

test('refuses to rename when a file changed after the preview, then refreshes the preview', async ({ launch, tempDir }) => {
  const dir = writeFiles(tempDir('renami-e2e-ui-'), ['alpha.txt', 'bravo.txt']);
  const { app, win } = await launch();
  await addFolder(app, win, dir, 'alpha.txt');

  await pattern(win).fill('x_{seq}');
  const rename = win.getByRole('button', { name: 'Rename 2 files' });
  await expect(rename).toBeEnabled();
  writeFileSync(path.join(dir, 'alpha.txt'), 'changed after the preview was built');
  await rename.click();
  await expect(
    win.getByText('Some files changed since the preview, so nothing was renamed. The preview is up to date now; check it and try again.'),
  ).toBeVisible();
  expect(readdirSync(dir).sort()).toEqual(['alpha.txt', 'bravo.txt']);
  await expect(rename).toBeEnabled();

  await win.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(summary(win)).toContainText('2 will be renamed');
});

test('the done notice offers Undo and Dismiss, and the empty state still offers undo once every source is gone', async ({
  launch,
  tempDir,
}) => {
  const dir = writeFiles(tempDir('renami-e2e-ui-'), ['alpha.txt', 'bravo.txt']);
  const { app, win } = await launch();
  await addFolder(app, win, dir, 'alpha.txt');

  await pattern(win).fill('x_{seq}');
  const rename = win.getByRole('button', { name: 'Rename 2 files' });
  await expect(rename).toBeEnabled();
  await rename.click();
  await expect(win.getByText('Renamed 2 files.')).toBeVisible();
  await win.locator('.action-bar').getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(win.getByText('Undid the last rename (2 files).')).toBeVisible();
  expect(readdirSync(dir).sort()).toEqual(['alpha.txt', 'bravo.txt']);
  await win.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(win.getByText('Undid the last rename (2 files).')).toHaveCount(0);
  await expect(summary(win)).toContainText('2 will be renamed');

  // Removing the last source after a rename keeps the undo available in the empty state.
  await expect(rename).toBeEnabled();
  await rename.click();
  await expect(win.getByText('Renamed 2 files.')).toBeVisible();
  await win.getByRole('button', { name: `Remove ${path.basename(dir)}` }).click();
  await expect(win.getByRole('heading', { name: 'Drop files or folders here' })).toBeVisible();
  const undo = win.getByRole('button', { name: 'Undo last rename' });
  await undo.click();
  await expect(win.getByText('Undid the last rename (2 files).')).toBeVisible();
  expect(readdirSync(dir).sort()).toEqual(['alpha.txt', 'bravo.txt']);
  await expect(undo).toHaveCount(0);
});

test('an undo that skips a changed file explains itself in a dialog with a copyable report', async ({ launch, tempDir }) => {
  const dir = writeFiles(tempDir('renami-e2e-ui-'), ['alpha.txt', 'bravo.txt']);
  const { app, win } = await launch();
  await addFolder(app, win, dir, 'alpha.txt');

  await pattern(win).fill('x_{seq}');
  const rename = win.getByRole('button', { name: 'Rename 2 files' });
  await expect(rename).toBeEnabled();
  await rename.click();
  await expect(win.getByText('Renamed 2 files.')).toBeVisible();
  expect(readdirSync(dir).sort()).toEqual(['x_001.txt', 'x_002.txt']);
  const edited = path.join(dir, 'x_001.txt');
  writeFileSync(edited, 'edited after the rename');

  // Undo puts back the untouched file, leaves the edited one alone, and says so.
  await win.getByRole('button', { name: 'Undo last rename' }).click();
  const dialog = win.getByRole('alertdialog', { name: "Some files weren't put back" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('These files were left where they are:');
  await expect(dialog).toContainText(`${edited}: Changed since the rename`);
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();

  await dialog.getByRole('button', { name: 'Copy report' }).click();
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe(["Some files weren't put back", '', 'These files were left where they are:', `${edited}: Changed since the rename`].join('\n'));

  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
  const after = readdirSync(dir).sort();
  expect(after).toContain('x_001.txt');
  expect(after.filter((n) => n !== 'x_001.txt')).toEqual([expect.stringMatching(/^(alpha|bravo)\.txt$/)]);
});

test('resizes a column with the arrow keys, and the header menu resets the widths', async ({ launch, tempDir }) => {
  const dir = writeFiles(tempDir('renami-e2e-ui-'), ['alpha.txt']);
  const { app, win } = await launch();
  await addFolder(app, win, dir, 'alpha.txt');
  const header = win.getByRole('columnheader', { name: 'New name' });
  const divider = win.getByRole('separator', { name: 'Resize New name column' });
  const width = async (): Promise<number> => (await header.boundingBox())!.width;
  const before = await width();

  await expect(divider).not.toHaveAttribute('aria-valuenow');
  await divider.focus();
  for (let i = 0; i < 3; i += 1) await win.keyboard.press('ArrowRight');
  await expect.poll(() => width()).toBeGreaterThan(before);
  await expect(divider).toHaveAttribute('aria-valuenow', /^\d+$/);

  await win.locator('.preview-head-scroll').click({ button: 'right' });
  await win.getByRole('menu', { name: 'Columns' }).getByRole('menuitem', { name: 'Reset column widths' }).click();
  await expect.poll(async () => Math.abs((await width()) - before) < 1).toBe(true);
  await expect(divider).not.toHaveAttribute('aria-valuenow');
});
