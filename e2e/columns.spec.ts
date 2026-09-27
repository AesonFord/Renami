import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

const LONG = 'a_really_long_file_name_that_will_never_fit_in_the_default_new_name_column_at_all';

/** Stubs the native folder dialog, then adds the folder the way a user would. */
async function addFolder(app: ElectronApplication, win: Page, dir: string): Promise<void> {
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as typeof dialog.showOpenDialog;
  }, dir);
  await win.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(win.getByRole('cell', { name: `${LONG}.txt` }).first()).toBeVisible();
}

/** Drags the divider on the right of `column` sideways by dx pixels, in `steps` mouse moves. */
async function dragDivider(win: Page, column: string, dx: number, steps = 5): Promise<void> {
  const box = (await win.getByRole('separator', { name: `Resize ${column} column` }).boundingBox())!;
  const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + dx, y, { steps });
  await win.mouse.up();
}

const width = async (win: Page, column: string) =>
  (await win.getByRole('columnheader', { name: column }).boundingBox())!.width;

/**
 * The column's width once the layout stops changing. On CI the OS can shrink the window to fit the
 * screen just after it opens, and the default columns shrink with it, which moves the divider.
 */
async function settledWidth(win: Page, column: string): Promise<number> {
  let last = -1;
  await expect
    .poll(async () => {
      const [prev, next] = [last, await width(win, column)];
      last = next;
      return next === prev;
    }, { intervals: [200] })
    .toBe(true);
  return last;
}

/** The page globals read below; e2e is typed without the DOM lib. */
interface Cells {
  document: { querySelectorAll(selector: string): ArrayLike<{ scrollWidth: number; clientWidth: number }> };
}

test('resizes preview columns by dragging, remembers them, and fits one to its contents', async ({ launch, tempDir }) => {
  const dir = tempDir('renami-e2e-columns-');
  for (const name of ['short.txt', `${LONG}.txt`]) writeFileSync(path.join(dir, name), 'x');
  const { app, win } = await launch();
  await addFolder(app, win, dir);

  const before = await settledWidth(win, 'New name');
  // One move: in CI, and rarely locally, the drag sometimes stopped after its first or fourth step and never
  // reached the full distance. A single move makes the width only depend on where the drag ends.
  await dragDivider(win, 'New name', 120, 1);
  // React can render the last pointermove a frame after mouse.up(), so wait for the width to catch up.
  await expect.poll(() => width(win, 'New name')).toBeGreaterThan(before + 118);
  const after = await width(win, 'New name');
  expect(Math.abs(after - (before + 120))).toBeLessThan(2);

  // Widths live in the renderer's storage, so they come back after a reload.
  await win.reload();
  await addFolder(app, win, dir);
  expect(Math.abs((await width(win, 'New name')) - after)).toBeLessThan(1);

  await win.getByRole('separator', { name: 'Resize New name column' }).dblclick();
  const cut = await win.evaluate(() => {
    const cells = Array.from((globalThis as unknown as Cells).document.querySelectorAll('[role="row"] .new'));
    return cells.filter((c) => c.scrollWidth > c.clientWidth).length;
  });
  expect(cut).toBe(0);
  // The current name shares its column with a checkbox; fitting leaves room for both.
  await win.getByRole('separator', { name: 'Resize Current name column' }).dblclick();
  const cutNames = await win.evaluate(() => {
    const cells = Array.from((globalThis as unknown as Cells).document.querySelectorAll('[role="row"] .old'));
    return cells.filter((c) => c.scrollWidth > c.clientWidth).length;
  });
  expect(cutNames).toBe(0);
});

test('scrolls the header sideways with the rows when the columns are wider than the window', async ({ launch, tempDir }) => {
  const dir = tempDir('renami-e2e-columns-');
  writeFileSync(path.join(dir, `${LONG}.txt`), 'x');
  const { app, win } = await launch();
  await addFolder(app, win, dir);

  // Playwright's mouse only supports positions inside the viewport. CI's Windows window is 1008px
  // wide, and a fixed 1200px drag that ended past its edge left the columns fitting. Stop just
  // inside the right edge instead; that's still far enough to overflow at any window size.
  const box = (await win.getByRole('separator', { name: 'Resize Current name column' }).boundingBox())!;
  const viewportWidth = await win.evaluate(() => (globalThis as unknown as { innerWidth: number }).innerWidth);
  await dragDivider(win, 'Current name', viewportWidth - 20 - (box.x + box.width / 2));
  const scrolled = await win.evaluate(() => {
    const { document } = globalThis as unknown as {
      document: { querySelector(s: string): { scrollLeft: number; scrollWidth: number; clientWidth: number } };
    };
    const body = document.querySelector('.preview-body');
    body.scrollLeft = 300;
    return { overflows: body.scrollWidth > body.clientWidth, body: body.scrollLeft };
  });
  expect(scrolled.overflows).toBe(true);
  await expect
    .poll(() =>
      win.evaluate(
        () => (globalThis as unknown as { document: { querySelector(s: string): { scrollLeft: number } } }).document.querySelector('.preview-head-scroll').scrollLeft,
      ),
    )
    .toBe(scrolled.body);
});
