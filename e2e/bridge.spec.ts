import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { MenuItem } from 'electron';
import { DEFAULT_SETTINGS } from '../src/core/types.js';
import type { Api } from '../src/shared/ipc.js';
import { expect, test } from './fixtures.js';
import { scanAndPlan } from './helpers.js';

const API_METHODS = [
  'buildPlan', 'canUndo', 'cancel', 'clear', 'copyText', 'deletePreset', 'execute', 'fileDetails', 'listPresets',
  'onExecuteProgress', 'onMetadataProgress', 'onOpenPaths', 'openFile', 'pathForFile', 'pickFolder', 'pickPaths',
  'platform', 'readText', 'savePreset', 'saveText', 'scan', 'showInFolder', 'takeOpenPaths', 'tokenValues', 'undo',
];

/** Copies the test photo and a text file into dir, and returns dir. */
function mediaCopy(dir: string): string {
  copyFileSync(path.resolve('test/fixtures/media/photo.jpg'), path.join(dir, 'photo.jpg'));
  copyFileSync(path.resolve('test/fixtures/media/notes.txt'), path.join(dir, 'notes.txt'));
  return dir;
}

test('the preload exposes every Api method', async ({ launch }) => {
  const { win } = await launch();
  const keys = await win.evaluate(() => Object.keys((globalThis as unknown as { api: object }).api).sort());
  expect(keys).toEqual([...API_METHODS].sort());
});

/** The little of the page's DOM the pathForFile test uses: e2e compiles without DOM types. */
interface FileInput {
  id: string;
  type: string;
  files: ArrayLike<File> | null;
}
interface PageWithInput {
  api: Api;
  document: {
    body: { append(node: FileInput): void };
    createElement(tag: 'input'): FileInput;
    getElementById(id: string): FileInput | null;
  };
}

test('pathForFile gives the absolute path of a file picked in a file input', async ({ launch }) => {
  const fixture = path.resolve('test/fixtures/media/notes.txt');
  const { win } = await launch();
  await win.evaluate(() => {
    const { document } = globalThis as unknown as PageWithInput;
    const input = document.createElement('input');
    input.id = 'path-for-file';
    input.type = 'file';
    document.body.append(input);
  });
  await win.locator('#path-for-file').setInputFiles(fixture);

  const seen = await win.evaluate(() => {
    const { api, document } = globalThis as unknown as PageWithInput;
    const files = document.getElementById('path-for-file')?.files;
    const file = files?.[0];
    // The count shows the input really holds the file, so a wrong path is pathForFile's doing.
    return { count: files?.length ?? 0, path: file ? api.pathForFile(file) : null };
  });
  expect(seen).toEqual({ count: 1, path: fixture });
});

test('scans, previews, renames and undoes through IPC, and saves presets in the user data folder', async ({ launch, tempDir }) => {
  const dir = mediaCopy(tempDir('renami-e2e-files-'));
  const { win, userData } = await launch();
  const settings = { ...DEFAULT_SETTINGS, pattern: 'Trip_{date_taken}' };

  const plan = await scanAndPlan(win, dir, settings);
  expect(plan.rows.map((r) => r.newName)).toContain('Trip_2024-07-04.jpg');

  const result = await win.evaluate(
    async ({ planId, settings }) => {
      const api = (globalThis as unknown as { api: Api }).api;
      const outcome = await api.execute(planId);
      const canUndo = await api.canUndo();
      const undone = await api.undo();
      await api.savePreset('Trip', settings);
      return { outcome: outcome.status, canUndo, undone: undone.status };
    },
    { planId: plan.planId, settings },
  );

  expect(result).toEqual({ outcome: 'done', canUndo: true, undone: 'done' });
  expect(readdirSync(dir).sort()).toEqual(['notes.txt', 'photo.jpg']);
  expect(existsSync(path.join(userData, 'presets.json'))).toBe(true);
});

test('rejects a preset name that is not text', async ({ launch }) => {
  const { win } = await launch();
  const settings = DEFAULT_SETTINGS;
  await expect(
    win.evaluate(
      ({ settings }) => (globalThis as unknown as { api: Api }).api.savePreset(42 as unknown as string, settings),
      { settings },
    ),
  ).rejects.toThrow(/A preset name must be text/);
});

test('clear forgets the current files', async ({ launch, tempDir }) => {
  const dir = mediaCopy(tempDir('renami-e2e-files-'));
  const { win } = await launch();
  const settings = DEFAULT_SETTINGS;
  await scanAndPlan(win, dir, settings);

  await win.evaluate(() => (globalThis as unknown as { api: Api }).api.clear());
  const tokens = await win.evaluate(() => (globalThis as unknown as { api: Api }).api.tokenValues());
  expect(tokens).toBeNull();
});

test('picks the right native dialog for each pick kind, and returns empties on cancel', async ({ launch }) => {
  const { app, win } = await launch();
  await app.evaluate(({ dialog }) => {
    const g = globalThis as { seen?: unknown[][] };
    g.seen = [];
    dialog.showOpenDialog = (async (...args: unknown[]) => {
      const options = args.at(-1) as { properties?: string[] };
      g.seen?.push(options.properties ?? []);
      return { canceled: false, filePaths: ['/picked'] };
    }) as typeof dialog.showOpenDialog;
  });

  expect(await win.evaluate(() => (globalThis as unknown as { api: Api }).api.pickPaths('folder'))).toEqual(['/picked']);
  expect(await win.evaluate(() => (globalThis as unknown as { api: Api }).api.pickPaths('files'))).toEqual(['/picked']);
  expect(await win.evaluate(() => (globalThis as unknown as { api: Api }).api.pickFolder())).toBe('/picked');

  const seen = await app.evaluate(() => (globalThis as { seen?: string[][] }).seen ?? []);
  expect(seen[0]).toContain('openDirectory');
  expect(seen[1]).toContain('openFile');
  expect(seen[2]).toEqual(expect.arrayContaining(['openDirectory', 'createDirectory']));

  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = (async () => ({ canceled: true, filePaths: [] })) as typeof dialog.showOpenDialog;
  });
  expect(await win.evaluate(() => (globalThis as unknown as { api: Api }).api.pickPaths('files'))).toEqual([]);
  expect(await win.evaluate(() => (globalThis as unknown as { api: Api }).api.pickFolder())).toBeNull();
});

test('rejects IPC calls from a window other than the app main window', async ({ launch }) => {
  const { app } = await launch();
  const preloadPath = path.resolve('out/preload/index.cjs');
  const rendererPath = path.resolve('out/renderer/index.html');

  const roguePagePromise = app.waitForEvent('window');
  await app.evaluate(
    ({ BrowserWindow }, args: { preloadPath: string; rendererPath: string }) => {
      const rogue = new BrowserWindow({
        show: false,
        webPreferences: { preload: args.preloadPath, sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      void rogue.loadFile(args.rendererPath);
    },
    { preloadPath, rendererPath },
  );
  const roguePage = await roguePagePromise;
  await roguePage.waitForLoadState('domcontentloaded');

  await expect(roguePage.evaluate(() => (globalThis as unknown as { api: Api }).api.platform())).rejects.toThrow(
    /Unexpected sender/,
  );

  await roguePage.close();
});

test('exercises presets, clipboard, token values, cancel and execute progress', async ({ launch, tempDir }) => {
  const dir = mediaCopy(tempDir('renami-e2e-files-'));
  const { app, win } = await launch();
  const settings = { ...DEFAULT_SETTINGS, pattern: 'x_{seq}' };
  const plan = await scanAndPlan(win, dir, settings);

  await win.evaluate(
    ({ settings }) => (globalThis as unknown as { api: Api }).api.savePreset('Trip', settings),
    { settings },
  );
  let names = (await win.evaluate(() => (globalThis as unknown as { api: Api }).api.listPresets())).map((p) => p.name);
  expect(names).toContain('Trip');
  await win.evaluate(() => (globalThis as unknown as { api: Api }).api.deletePreset('Trip'));
  names = (await win.evaluate(() => (globalThis as unknown as { api: Api }).api.listPresets())).map((p) => p.name);
  expect(names).not.toContain('Trip');

  await win.evaluate(() => (globalThis as unknown as { api: Api }).api.copyText('x'));
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('x');

  const tokens = await win.evaluate(() => (globalThis as unknown as { api: Api }).api.tokenValues());
  expect(tokens?.fileName).toBeTruthy();

  // Nothing is running, so this just resolves.
  await win.evaluate(() => (globalThis as unknown as { api: Api }).api.cancel());

  const events = await win.evaluate((planId) => {
    const api = (globalThis as unknown as { api: Api }).api;
    const seen: { done: number; total: number }[] = [];
    const off = api.onExecuteProgress((p) => seen.push(p));
    return api.execute(planId).then(() => {
      off();
      return seen;
    });
  }, plan.planId);
  expect(events.length).toBeGreaterThan(0);
  const last = events.at(-1);
  expect(last).toBeDefined();
  expect(last?.done).toBe(last?.total);
});

test('the production menu has no reload or developer tools, but keeps quit and edit', async ({ launch }) => {
  const { app } = await launch();
  // Electron reports MenuItem.role lowercased at runtime (e.g. "toggledevtools"), even though
  // the TypeScript union for the option is camelCase ("toggleDevTools"): lowercase both sides.
  const roles = await app.evaluate(({ Menu }) => {
    const result: string[] = [];
    const walk = (items: MenuItem[]): void => {
      for (const item of items) {
        if (item.role) result.push(String(item.role).toLowerCase());
        if (item.submenu) walk(item.submenu.items);
      }
    };
    const menu = Menu.getApplicationMenu();
    if (menu) walk(menu.items);
    return result;
  });
  const forbidden = ['reload', 'forcereload', 'toggledevtools'];
  for (const role of forbidden) expect(roles).not.toContain(role);
  expect(roles.includes('quit') || roles.includes('appmenu')).toBe(true);
  expect(roles.includes('editmenu') || roles.includes('copy') || roles.includes('paste')).toBe(true);
});

test('asks before quitting while a rename can still be undone', async ({ launch, tempDir }) => {
  const dir = mediaCopy(tempDir('renami-e2e-files-'));
  const { app, win, close } = await launch();
  const plan = await scanAndPlan(win, dir, { ...DEFAULT_SETTINGS, pattern: 'x_{seq}' });
  await win.evaluate((planId) => (globalThis as unknown as { api: Api }).api.execute(planId), plan.planId);

  // The user picks Cancel: the app keeps running. The prompt runs synchronously inside
  // app.quit() (before-quit fires and is handled before quit() returns), so trigger and read
  // the counter in the same evaluate() call rather than risk a race between two round trips.
  await app.evaluate(({ dialog }) => {
    const g = globalThis as { asked?: number };
    g.asked = 0;
    dialog.showMessageBoxSync = (() => {
      g.asked = (g.asked ?? 0) + 1;
      return 1;
    }) as typeof dialog.showMessageBoxSync;
  });
  const askedAfterCancel = await app.evaluate(({ app }) => {
    app.quit();
    return (globalThis as { asked?: number }).asked;
  });
  expect(askedAfterCancel).toBe(1);
  expect(await win.title()).toBe('Renami');

  // The user picks Quit: exactly one more prompt, then the app actually exits. The app is
  // about to go away, so the count can't be read back with app.evaluate() after the fact; count
  // via the main process's console output instead, which the inspector connection delivers
  // independently of app.evaluate.
  let prompts = 0;
  app.on('console', (message) => {
    if (message.text() === 'quit-prompt') prompts += 1;
  });
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = (() => {
      console.log('quit-prompt');
      return 0;
    }) as typeof dialog.showMessageBoxSync;
  });
  await close(); // resolves once the app has actually quit
  await expect.poll(() => prompts).toBeGreaterThanOrEqual(1);
  // Give any further (unwanted) prompt a moment to arrive before checking it stayed at exactly 1.
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(prompts).toBe(1);
});

test('closing the window (not just quitting the app) asks too, and Cancel keeps it open', async ({ launch, tempDir }) => {
  const dir = mediaCopy(tempDir('renami-e2e-files-'));
  const { app, win } = await launch();
  const plan = await scanAndPlan(win, dir, { ...DEFAULT_SETTINGS, pattern: 'x_{seq}' });
  await win.evaluate((planId) => (globalThis as unknown as { api: Api }).api.execute(planId), plan.planId);

  // BrowserWindow.close() emits 'close' synchronously the same way app.quit() emits
  // 'before-quit' (see the analogous comment above): trigger and read the counter together.
  await app.evaluate(({ dialog }) => {
    const g = globalThis as { asked?: number };
    g.asked = 0;
    dialog.showMessageBoxSync = (() => {
      g.asked = (g.asked ?? 0) + 1;
      return 1; // Cancel
    }) as typeof dialog.showMessageBoxSync;
  });
  const asked = await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close();
    return (globalThis as { asked?: number }).asked;
  });
  expect(asked).toBe(1);
  expect(await win.title()).toBe('Renami');
});
