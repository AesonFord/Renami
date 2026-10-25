import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { expect, test } from './fixtures.js';

// The File menu runs the same actions as the buttons (src/main/menu.ts, App.tsx).

/** Clicks a File menu item by its id, which is its command name. */
function clickMenu(app: ElectronApplication, id: string): Promise<void> {
  return app.evaluate(({ Menu }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId);
    if (!item) throw new Error(`no menu item ${itemId}`);
    item.click();
  }, id);
}

test('adds a folder, renames and undoes from the File menu', async ({ launch, tempDir }) => {
  const dir = tempDir('renami-e2e-menu-');
  writeFileSync(path.join(dir, 'a.txt'), 'a');
  const { app, win } = await launch();
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog;
  }, dir);

  // The page subscribes to menu commands once it renders.
  await expect(win.getByRole('button', { name: 'Choose folder…' })).toBeVisible();
  await clickMenu(app, 'addFolder');
  await expect(win.getByRole('cell', { name: 'a.txt', exact: true }).first()).toBeVisible();

  await win.getByRole('textbox', { name: 'Name pattern' }).fill('menu_{name}');
  await expect(win.getByRole('cell', { name: 'menu_a.txt', exact: true })).toBeVisible();
  await expect(win.getByRole('button', { name: 'Rename 1 file' })).toBeEnabled();
  await clickMenu(app, 'rename');
  await expect(win.getByText('Renamed 1 file.')).toBeVisible();
  expect(readdirSync(dir)).toEqual(['menu_a.txt']);

  await clickMenu(app, 'undo');
  await expect(win.getByText(/Undid the last rename/)).toBeVisible();
  expect(readdirSync(dir)).toEqual(['a.txt']);
});
