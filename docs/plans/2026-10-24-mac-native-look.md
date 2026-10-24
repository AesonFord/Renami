# Mac Native Look Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On macOS, Renami puts its files strip in the title bar beside the traffic lights, uses the system font, has a File menu with the app's commands and their ⌘ shortcuts, and a proper About panel. Windows and Linux keep their current look, and gain the same File menu.

**Architecture:** The renderer learns the platform synchronously from a plain property on the preload bridge and marks `<html data-platform>` before React renders, so every macOS-only style is a `:root[data-platform='darwin']` rule with no flash. The window gets `titleBarStyle: 'hiddenInset'` on macOS only; the files strip (and a drag bar in the empty state) becomes the drag region, and a new `EVENTS.fullScreen` event lets the page drop the traffic-light padding in full screen. Menu commands go main → renderer over a new `EVENTS.menuCommand` channel; `App.tsx` dispatches them to the existing session actions behind the same guards the buttons use. `menu.ts` stays a pure template builder, so the File menu and About panel options are unit-tested.

**Tech Stack:** Electron 44 (`BrowserWindow` title bar options, `Menu`, `app.setAboutPanelOptions`), React 19, CSS custom properties, vitest (`node` and `renderer` projects), Playwright e2e. No new dependencies.

**Spec:** None was written. This plan follows the recommendations list from the 2026-10-24 conversation, items 1 (title bar), 2 (system font), 3 (menus) and 5 (About panel). The decisions below are the spec.

**Out of scope, and why:**
- **Dock progress bar.** Already done: `liveWindow()?.setProgressBar(...)` at `src/main/index.ts:449`.
- **System accent color.** `accent-color: var(--accent)` on checkboxes and radios already exists (`src/renderer/styles.css:137`). Swapping the brand teal for the system accent needs a derived palette per color mode, and Electron's `accent-color-changed` event is Windows-only, so there is no clean live update on macOS. Leave the teal.
- **Vibrancy.** It needs a translucent `--bg` in both modes and fights the solid window `backgroundColor` that `e2e/theme.spec.ts` pins. Not worth it.
- **Right-click menu on preview rows, and syncing menu item enabled state to main.** Follow-ups if wanted. Menu commands that don't apply are ignored in the renderer instead.

## Global Constraints

- No new runtime or dev dependencies.
- No Prettier: the repo has no config and running it rewrites to double quotes. Match the existing style (single quotes, long lines, `.js` import suffixes).
- Everything macOS-specific in the renderer is scoped by `:root[data-platform='darwin']`; nothing changes on other platforms except the File menu.
- The platform attribute comes from the preload bridge synchronously: `Api.platformSync: Platform`, set from `process.platform` (available in sandboxed preloads). The async `INVOKE.platform` stays as it is.
- Window options on `darwin` only: `titleBarStyle: 'hiddenInset'`, `trafficLightPosition: { x: 20, y: 19 }`. The lights span x 20–72 and sit centered in the strip's 50px minimum height. Keep `title: 'Renami'`.
- Files strip on darwin: `padding-left: 88px`, `-webkit-app-region: drag`. Every interactive descendant is `no-drag`: `button, input, select, label, .chip, .popover, .preset-picker`.
- Empty state on darwin: a `<div class="drag-bar" aria-hidden="true">` renders above `<EmptyState>` on every platform; CSS gives it `height: 50px; -webkit-app-region: drag; flex: none` under `:root[data-platform='darwin']` and `display: none` otherwise. (The empty drop zone itself is never a drag region: a drag region would swallow the file drop.)
- Full screen on darwin: `<html data-fullscreen="true">` while the window is full screen. Then the strip's `padding-left` returns to `24px` and `.drag-bar` is `display: none`. Main sends `EVENTS.fullScreen` (`'window:full-screen'`, payload `boolean`) on `enter-full-screen` and `leave-full-screen`.
- Fonts on darwin: `--font-sans: -apple-system, system-ui, sans-serif;` and `--font-mono: ui-monospace, 'SF Mono', Menlo, monospace;`. The IBM Plex imports in `main.tsx` stay (other platforms use them).
- Menu commands: `type MenuCommand = 'addFiles' | 'addFolder' | 'importNames' | 'exportPreview' | 'exportLast' | 'rename' | 'undo'` in `src/shared/ipc.ts`. Channel `EVENTS.menuCommand = 'menu:command'`. Each menu item's `id` is its command name.
- File menu (every platform), in order, label → accelerator:
  - `Add Files…` → `CmdOrCtrl+O`
  - `Add Folder…` → `Shift+CmdOrCtrl+O`
  - separator
  - `Import Names…` → `CmdOrCtrl+I`
  - `Export Preview…` → `Shift+CmdOrCtrl+E`
  - `Export Last Rename…` → none
  - separator
  - `Rename Files` → `CmdOrCtrl+Return`
  - `Undo Last Rename` → `Alt+CmdOrCtrl+Z` (not `Shift+CmdOrCtrl+Z`: that is Edit › Redo in text fields)
  - separator
  - `{ role: 'close' }` on darwin, `{ role: 'quit' }` elsewhere.
  - When `menuTemplate` is called without `commands`, the File menu stays `{ role: 'fileMenu' }` so the existing tests hold.
- Renderer guards for a menu command (in `App.tsx`): ignored while `state.busy !== null` or a dialog outcome is showing. `importNames` needs `state.sources.length > 0`; `exportPreview` needs `rows.length > 0`; `exportLast` needs `state.lastChanges.length > 0`; `rename` needs `blockedReason === null`; `undo` needs `state.canUndo`. `addFiles`, `addFolder` and `undo` work in the empty state.
- About panel: `app.setAboutPanelOptions({ applicationName: 'Renami', applicationVersion: app.getVersion(), website: 'https://github.com/AesonFord/Renami' })`. No copyright line (the LICENSE header is GPL boilerplate, not the project's holder).
- Verification commands: `npm run typecheck`, `npm test`, then `npx electron-vite build && npx playwright test`. Darwin-only e2e tests use `test.skip(process.platform !== 'darwin', ...)`.
- Commits use Conventional Commits with no AI attribution. One commit per task, one PR for the whole plan.

## Review Focus

1. **Traffic lights over the content.** With the title bar hidden, the lights must never cover the first source chip or the empty state's dashed border. (Task 2: `mac.spec.ts` asserts the strip's `padding-left` is `88px` and the drag bar is 50px tall in the empty state.)
2. **A drag region swallowing a click.** A control inside the strip that isn't `no-drag` starts a window drag instead of working. (Task 2: `mac.spec.ts` asserts `no-drag` on the Add button, the Subfolders checkbox and the preset select, and that the Add button still opens its menu.)
3. **A menu command while the app is busy or a dialog is up.** ⌘↩ during a rename, or ⌘O behind the outcome dialog, must do nothing. (Task 4: `App.test.tsx` `ignores menu commands while renaming` and `ignores menu commands while a dialog is open`.)
4. **Accelerator collisions with the Edit menu.** A File accelerator equal to Undo, Redo, Cut, Copy, Paste or Select All would fire in the pattern field. (Task 4: `menu.test.ts` `uses no Edit menu accelerator`.)
5. **Full screen leaving dead padding.** macOS hides the lights in full screen; 88px of empty space would remain. (Task 2: `mac.spec.ts` toggles `setFullScreen` and asserts the padding changes to `24px` and back.)

Known trade-off, no test: a mouse-down on empty strip space starts a window drag on macOS, so it no longer closes an open popover. Escape and clicks elsewhere still do.

---

### Task 1: The page knows its platform before React renders

**Files:**
- Modify: `src/shared/ipc.ts` (the `Api` interface)
- Modify: `src/preload/index.ts`
- Create: `src/renderer/lib/platform.ts`
- Modify: `src/renderer/main.tsx`
- Modify: `test/renderer/fakeApi.ts`
- Test: `test/renderer/platform.test.ts`
- Test: `e2e/smoke.spec.ts` (the existing bridge test)

**Interfaces:**
- Produces: `Api.platformSync: Platform` (a plain property, not a method). `markPlatform(root: HTMLElement, platform: Platform): void` in `src/renderer/lib/platform.ts`, which sets `root.dataset.platform`. Later tasks rely on `<html data-platform="darwin">` being present before the first render.

- [ ] **Step 1: Write the failing unit test**

```ts
// test/renderer/platform.test.ts
import { describe, expect, it } from 'vitest';
import { markPlatform } from '../../src/renderer/lib/platform.js';

describe('markPlatform', () => {
  it('writes the platform onto the element for CSS to scope on', () => {
    const root = document.createElement('html');
    markPlatform(root, 'darwin');
    expect(root.dataset.platform).toBe('darwin');
    markPlatform(root, 'win32');
    expect(root.dataset.platform).toBe('win32');
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/renderer/platform.test.ts`
Expected: FAIL, cannot find module `platform.js`.

- [ ] **Step 3: Add `platformSync` to the bridge**

In `src/shared/ipc.ts`, add to `Api` next to `platform()`: `/** The OS, known before the first render; platform() answers the same from main. */ platformSync: Platform;`. In `src/preload/index.ts`, add `platformSync: process.platform as Platform` to the `api` object (import `Platform` from `../core/types.js`). In `test/renderer/fakeApi.ts`, add `platformSync: 'darwin' as const` to the fake.

- [ ] **Step 4: Implement `markPlatform` and call it in `main.tsx`**

`src/renderer/lib/platform.ts` exports `markPlatform(root: HTMLElement, platform: Platform): void`. In `src/renderer/main.tsx`, call `markPlatform(document.documentElement, window.api.platformSync)` before `createRoot(root).render(...)`.

- [ ] **Step 5: Run the unit test and the type check**

Run: `npx vitest run test/renderer/platform.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Extend the smoke e2e test**

In `e2e/smoke.spec.ts`, inside `opens the window with a sandboxed renderer and a working bridge`, add an assertion that the page's `document.documentElement.dataset.platform` equals `process.platform`. e2e is typed without the DOM lib; read the attribute through a cast on `globalThis` the way `e2e/theme.spec.ts:13-26` does.

- [ ] **Step 7: Run the e2e test**

Run: `npx electron-vite build && npx playwright test e2e/smoke.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/renderer/lib/platform.ts src/renderer/main.tsx test/renderer/fakeApi.ts test/renderer/platform.test.ts e2e/smoke.spec.ts
git commit -m "feat: mark the page with its platform before the first render"
```

---

### Task 2: Title bar and drag regions on macOS

**Files:**
- Modify: `src/main/index.ts:330-345` (`createWindow`)
- Modify: `src/shared/ipc.ts` (`EVENTS`, `Api`)
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css` (files strip, empty state)
- Modify: `test/renderer/fakeApi.ts`
- Test: `test/renderer/App.test.tsx`
- Test: `e2e/mac.spec.ts` (new)

**Interfaces:**
- Consumes: `<html data-platform>` from Task 1.
- Produces: `EVENTS.fullScreen = 'window:full-screen'`; `Api.onFullScreen(cb: (on: boolean) => void): () => void`; `FakeApi.emitFullScreen(on: boolean)`; `<html data-fullscreen="true">` while full screen. CSS class `.drag-bar`.

- [ ] **Step 1: Write the failing App test**

```tsx
// test/renderer/App.test.tsx, inside describe('App')
it('marks the page while the window is full screen', () => {
  const api = createFakeApi();
  render(<App api={api} />);
  act(() => api.emitFullScreen(true));
  expect(document.documentElement.dataset.fullscreen).toBe('true');
  act(() => api.emitFullScreen(false));
  expect(document.documentElement.dataset.fullscreen).toBeUndefined();
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/renderer/App.test.tsx -t "full screen"`
Expected: FAIL, `api.emitFullScreen is not a function`.

- [ ] **Step 3: Add the channel end to end**

`src/shared/ipc.ts`: `fullScreen: 'window:full-screen'` in `EVENTS`; `onFullScreen(cb: (on: boolean) => void): () => void` in `Api`. `src/preload/index.ts`: `onFullScreen: (cb) => subscribe<boolean>(EVENTS.fullScreen, cb)`. `test/renderer/fakeApi.ts`: a listener set, `onFullScreen` and `emitFullScreen` following the `onOpenPaths`/`emitOpenPaths` pattern; add `emitFullScreen(on: boolean): void` to the `FakeApi` type. `src/main/index.ts` in `createWindow`: `win.on('enter-full-screen', () => send(EVENTS.fullScreen, true))` and `win.on('leave-full-screen', () => send(EVENTS.fullScreen, false))`.

- [ ] **Step 4: Subscribe in App**

In `App.tsx`, above the early return, a `useEffect` on `[api]` that returns `api.onFullScreen((on) => { if (on) document.documentElement.dataset.fullscreen = 'true'; else delete document.documentElement.dataset.fullscreen; })`.

- [ ] **Step 5: Run the unit tests and the IPC channel test**

Run: `npx vitest run test/renderer/App.test.tsx test/main/ipc.test.ts`
Expected: PASS (ipc.test checks `EVENTS.fullScreen` appears in both main and preload).

- [ ] **Step 6: Window options and the drag bar**

`src/main/index.ts` `createWindow`: spread `...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 20, y: 19 } } : {})` into the `BrowserWindow` options. `App.tsx` empty branch: render `<div className="drag-bar" aria-hidden="true" />` as the first child of the `.app` div, before `<EmptyState>`.

- [ ] **Step 7: CSS**

In `src/renderer/styles.css`, after the `.files-strip` block:

```css
/* macOS: the strip sits in the title bar beside the traffic lights (hiddenInset in src/main/index.ts). */
.drag-bar { display: none; }
:root[data-platform='darwin'] .files-strip { padding-left: 88px; -webkit-app-region: drag; }
:root[data-platform='darwin'] .files-strip :is(button, input, select, label, .chip, .popover, .preset-picker) { -webkit-app-region: no-drag; }
:root[data-platform='darwin'] .drag-bar { display: block; flex: none; height: 50px; -webkit-app-region: drag; }
:root[data-platform='darwin'][data-fullscreen='true'] .files-strip { padding-left: 24px; }
:root[data-platform='darwin'][data-fullscreen='true'] .drag-bar { display: none; }
```

- [ ] **Step 8: Write the darwin e2e test**

Create `e2e/mac.spec.ts`. One test, `test.skip(process.platform !== 'darwin', 'macOS title bar')`, using the `launch`/`tempDir` fixtures and the `addFolder`/`writeFiles` approach from `e2e/ui.spec.ts:20-30`. Read computed styles through a `globalThis` cast as in `e2e/theme.spec.ts:13-26`. Assertions, in order:
1. In the empty state, `.drag-bar` has computed `height` `50px` and `webkitAppRegion` `drag`.
2. After adding a folder, `.files-strip` has `padding-left` `88px` and `webkitAppRegion` `drag`; the `+ Add files or folders` button, the `Subfolders` checkbox and the `Preset` select each have `webkitAppRegion` `no-drag`.
3. Clicking `+ Add files or folders` shows the `Files…` menu item (the click reached the button).
4. `app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setFullScreen(true))`, then `expect.poll` (timeout 10 000 ms) that the strip's `padding-left` is `24px`; `setFullScreen(false)`, then poll for `88px` again.

- [ ] **Step 9: Run the e2e test**

Run: `npx electron-vite build && npx playwright test e2e/mac.spec.ts`
Expected: PASS on macOS (skipped elsewhere).

- [ ] **Step 10: Run everything, then look at it**

Run: `npm run typecheck && npm test && npx playwright test`
Expected: all pass. Then `npm run dev` (or the built app) on macOS: traffic lights sit inside the strip, dragging the strip moves the window, the empty state has clear space above the dashed box.

- [ ] **Step 11: Commit**

```bash
git add src/main/index.ts src/shared/ipc.ts src/preload/index.ts src/renderer/App.tsx src/renderer/styles.css test/renderer/fakeApi.ts test/renderer/App.test.tsx e2e/mac.spec.ts
git commit -m "feat: put the files strip in the macOS title bar"
```

---

### Task 3: System font on macOS

**Files:**
- Modify: `src/renderer/styles.css:48-49` (the font tokens)
- Test: `e2e/mac.spec.ts`

**Interfaces:**
- Consumes: `<html data-platform>` from Task 1.

- [ ] **Step 1: Write the failing e2e assertion**

In the `e2e/mac.spec.ts` test from Task 2, after launch, assert the computed `fontFamily` of `document.body` starts with `-apple-system` and that of the pattern textbox (`getByRole('textbox', { name: 'Name pattern' })`, visible once files are added) starts with `ui-monospace`.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx playwright test e2e/mac.spec.ts`
Expected: FAIL, body font starts with `"IBM Plex Sans"`.

- [ ] **Step 3: Add the override**

In `src/renderer/styles.css`, right after the `:root { … }` token block (before the dark-mode block):

```css
/* macOS: the system font, so controls match the OS. Other platforms keep IBM Plex. */
:root[data-platform='darwin'] {
  --font-sans: -apple-system, system-ui, sans-serif;
  --font-mono: ui-monospace, 'SF Mono', Menlo, monospace;
}
```

- [ ] **Step 4: Run the e2e test and look at it**

Run: `npx electron-vite build && npx playwright test e2e/mac.spec.ts`
Expected: PASS. Open the app: the pattern field's token highlight (`.pattern-mirror` over `.pattern-input`) still lines up, since both use `--font-mono`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/styles.css e2e/mac.spec.ts
git commit -m "feat: use the system font on macOS"
```

---

### Task 4: File menu with the app's commands

**Files:**
- Modify: `src/shared/ipc.ts` (`MenuCommand`, `EVENTS`, `Api`)
- Modify: `src/preload/index.ts`
- Modify: `src/main/menu.ts`
- Modify: `src/main/index.ts:417-427` (`buildMenu`)
- Modify: `src/renderer/App.tsx`
- Modify: `test/renderer/fakeApi.ts`
- Test: `test/main/menu.test.ts`
- Test: `test/renderer/App.test.tsx`
- Test: `e2e/menu.spec.ts` (new)

**Interfaces:**
- Produces: in `src/shared/ipc.ts`, `export type MenuCommand = 'addFiles' | 'addFolder' | 'importNames' | 'exportPreview' | 'exportLast' | 'rename' | 'undo'`, `EVENTS.menuCommand = 'menu:command'`, `Api.onMenuCommand(cb: (command: MenuCommand) => void): () => void`. In `src/main/menu.ts`, `export interface MenuCommands { run(command: MenuCommand): void }` and the signature `menuTemplate(platform: NodeJS.Platform, isDev: boolean, updates?: UpdateMenu, commands?: MenuCommands)`. `FakeApi.emitMenuCommand(command: MenuCommand)`.

- [ ] **Step 1: Write the failing menu tests**

Add to `test/main/menu.test.ts` a `describe('menuTemplate file menu')` using the file's `findLabel` helper plus a `findId(items, id)` helper of the same shape:

```ts
const commands = () => ({ run: vi.fn() });
const FILE_LABELS = ['Add Files…', 'Add Folder…', 'Import Names…', 'Export Preview…', 'Export Last Rename…', 'Rename Files', 'Undo Last Rename'];

it('lists the commands with their shortcuts, then Close on macOS and Quit elsewhere', () => {
  const file = (platform: NodeJS.Platform) => menuTemplate(platform, false, undefined, commands()).find((m) => m.label === 'File')!;
  const shape = (platform: NodeJS.Platform) => (file(platform).submenu as MenuItemConstructorOptions[]).map((s) => s.role ?? s.label ?? s.type);
  expect(shape('darwin')).toEqual([...FILE_LABELS.slice(0, 2), 'separator', ...FILE_LABELS.slice(2, 5), 'separator', ...FILE_LABELS.slice(5), 'separator', 'close']);
  expect(shape('win32').at(-1)).toBe('quit');
  const accel = (label: string) => findLabel(menuTemplate('darwin', false, undefined, commands()), label)!.accelerator;
  expect(accel('Add Files…')).toBe('CmdOrCtrl+O');
  expect(accel('Add Folder…')).toBe('Shift+CmdOrCtrl+O');
  expect(accel('Import Names…')).toBe('CmdOrCtrl+I');
  expect(accel('Export Preview…')).toBe('Shift+CmdOrCtrl+E');
  expect(accel('Export Last Rename…')).toBeUndefined();
  expect(accel('Rename Files')).toBe('CmdOrCtrl+Return');
  expect(accel('Undo Last Rename')).toBe('Alt+CmdOrCtrl+Z');
});

it('gives every command item its command as id, and clicking runs it', () => {
  const c = commands();
  const template = menuTemplate('darwin', false, undefined, c);
  for (const id of ['addFiles', 'addFolder', 'importNames', 'exportPreview', 'exportLast', 'rename', 'undo'] as const) {
    const item = findId(template, id)!;
    (item.click as unknown as () => void)();
    expect(c.run).toHaveBeenLastCalledWith(id);
  }
});

it('uses no Edit menu accelerator', () => {
  const edit = ['CmdOrCtrl+Z', 'Shift+CmdOrCtrl+Z', 'CmdOrCtrl+X', 'CmdOrCtrl+C', 'CmdOrCtrl+V', 'CmdOrCtrl+A'];
  const file = menuTemplate('darwin', false, undefined, commands()).find((m) => m.label === 'File')!;
  for (const item of file.submenu as MenuItemConstructorOptions[]) if (item.accelerator) expect(edit).not.toContain(item.accelerator);
});

it('keeps the fileMenu role without commands', () => {
  expect(menuTemplate('darwin', false).some((m) => m.role === 'fileMenu')).toBe(true);
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run test/main/menu.test.ts`
Expected: the new tests FAIL (no `File` label; `findId` finds nothing). The existing ones still pass.

- [ ] **Step 3: Implement the File menu in `menu.ts`**

Add `MenuCommands` and the fourth parameter. With `commands`, the File menu is `{ label: 'File', submenu: [...] }` in the order and with the ids, labels and accelerators from Global Constraints; each item's `click` calls `commands.run(id)`. Without `commands`, keep `{ role: 'fileMenu' }`. Add the shared `MenuCommand` type and `EVENTS.menuCommand` to `src/shared/ipc.ts` now, since `menu.ts` imports the type.

- [ ] **Step 4: Run the menu tests**

Run: `npx vitest run test/main/menu.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing App tests**

Add to `test/renderer/App.test.tsx`, using the file's `withFiles` and `clickRename` helpers:

```tsx
it('runs menu commands through the same actions as the buttons', async () => {
  const api = createFakeApi();
  render(<App api={api} />);
  act(() => api.emitMenuCommand('addFolder'));
  expect(api.pickPaths).toHaveBeenCalledWith('folder');
  await screen.findByRole('cell', { name: 'Trip_001.jpg' });
  act(() => api.emitMetadata({ done: 2, total: 2, finished: true, exiftoolFailed: false }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Rename 2 files' })).toBeEnabled());
  act(() => api.emitMenuCommand('rename'));
  await waitFor(() => expect(api.execute).toHaveBeenCalledWith('plan-1'));
});

it('ignores menu commands that do not apply', async () => {
  const api = createFakeApi();
  render(<App api={api} />);
  act(() => api.emitMenuCommand('rename'));
  act(() => api.emitMenuCommand('undo'));
  act(() => api.emitMenuCommand('importNames'));
  act(() => api.emitMenuCommand('exportPreview'));
  act(() => api.emitMenuCommand('exportLast'));
  expect(api.execute).not.toHaveBeenCalled();
  expect(api.undo).not.toHaveBeenCalled();
  expect(api.readText).not.toHaveBeenCalled();
  expect(api.saveText).not.toHaveBeenCalled();
});

it('ignores menu commands while renaming', async () => {
  const done = deferred<Awaited<ReturnType<FakeApi['execute']>>>();
  const api = await withFiles(createFakeApi({ execute: vi.fn(() => done.promise) }));
  await clickRename();
  act(() => api.emitMenuCommand('addFolder'));
  expect(api.pickPaths).toHaveBeenCalledTimes(1); // only the click that added the folder
  done.resolve({ status: 'done', renamed: 2, datesChanged: 0, changes: [], sourcesAfter: ['/photos'] });
});
```

Also `ignores menu commands while a dialog is open`: drive an outcome that `isDialogOutcome` reports as a dialog (see how the existing tests in this file open `OutcomeDialog`, e.g. a `failed` execute outcome), emit `addFolder`, and assert `pickPaths` was called once.

- [ ] **Step 6: Run them to make sure they fail**

Run: `npx vitest run test/renderer/App.test.tsx -t "menu commands"`
Expected: FAIL, `api.emitMenuCommand is not a function`.

- [ ] **Step 7: Wire the renderer side**

`src/shared/ipc.ts`: `onMenuCommand(cb: (command: MenuCommand) => void): () => void` on `Api`. `src/preload/index.ts`: `onMenuCommand: (cb) => subscribe<MenuCommand>(EVENTS.menuCommand, cb)`. `test/renderer/fakeApi.ts`: `onMenuCommand`/`emitMenuCommand` like the other event pairs. In `App.tsx`, above the early return: a `useRef<(c: MenuCommand) => void>` whose `.current` is reassigned every render to a dispatcher applying the guards from Global Constraints, and one `useEffect` on `[api]` that subscribes with `(c) => menuHandler.current(c)` and returns the unsubscribe. The dispatcher calls `actions.pick('files' | 'folder')`, `actions.importNames()`, `actions.exportPreview()`, `actions.exportLastBatch()`, `actions.rename()`, `actions.undo()` (each `void`-ed).

- [ ] **Step 8: Wire the main side**

In `src/main/index.ts` `buildMenu`, pass a fourth argument `{ run: (command) => send(EVENTS.menuCommand, command) }` to `menuTemplate`.

- [ ] **Step 9: Run the unit suites and the type check**

Run: `npm run typecheck && npm test`
Expected: PASS, including `test/main/ipc.test.ts` (it needs the literal `EVENTS.menuCommand` in both `main/index.ts` and `preload/index.ts`).

- [ ] **Step 10: Write the e2e test**

Create `e2e/menu.spec.ts` with one test that follows `e2e/app.spec.ts:25-48` (add a folder, set a pattern, rename, undo) but drives it from the menu: a helper `clickMenu(app, id)` = `app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()!.getMenuItemById(id)!.click(), id)`. Stub the open dialog as `ui.spec.ts` does, `clickMenu(app, 'addFolder')`, expect the first file's cell; fill the pattern; `clickMenu(app, 'rename')`, expect the renamed cell; `clickMenu(app, 'undo')`, expect the original cell back.

- [ ] **Step 11: Run it**

Run: `npx electron-vite build && npx playwright test e2e/menu.spec.ts`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/menu.ts src/main/index.ts src/renderer/App.tsx test/renderer/fakeApi.ts test/main/menu.test.ts test/renderer/App.test.tsx e2e/menu.spec.ts
git commit -m "feat: add the app's commands and shortcuts to the File menu"
```

---

### Task 5: About panel

**Files:**
- Modify: `src/main/menu.ts`
- Modify: `src/main/index.ts` (next to `buildMenu()`)
- Test: `test/main/menu.test.ts`

**Interfaces:**
- Produces: `export function aboutPanelOptions(version: string): Electron.AboutPanelOptionsOptions` in `src/main/menu.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// test/main/menu.test.ts
import { aboutPanelOptions, menuTemplate } from '../../src/main/menu.js';

describe('aboutPanelOptions', () => {
  it('names the app, its version and the project page', () => {
    expect(aboutPanelOptions('0.3.2')).toEqual({ applicationName: 'Renami', applicationVersion: '0.3.2', website: 'https://github.com/AesonFord/Renami' });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run test/main/menu.test.ts -t aboutPanelOptions`
Expected: FAIL, `aboutPanelOptions` is not exported.

- [ ] **Step 3: Implement and call it**

Add `aboutPanelOptions(version: string)` to `src/main/menu.ts` returning exactly that object. In `src/main/index.ts`, right before `buildMenu();`, call `app.setAboutPanelOptions(aboutPanelOptions(app.getVersion()))` (works on macOS and Linux; a no-op on Windows).

- [ ] **Step 4: Run the test, the type check and the full suites**

Run: `npm run typecheck && npm test && npx electron-vite build && npx playwright test`
Expected: all PASS. On macOS, Renami › About Renami shows the name, version and a link to the repo.

- [ ] **Step 5: Commit**

```bash
git add src/main/menu.ts src/main/index.ts test/main/menu.test.ts
git commit -m "feat: fill in the About panel"
```
