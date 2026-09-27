import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  protocol,
  session as webSession,
  shell,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from 'electron';
import type { Platform } from '../core/types.js';
import { EVENTS, INVOKE, type PickKind, type PlanRequest } from '../shared/ipc.js';
import { filterWithDefaults } from '../core/presets.js';
import { PREVIEW_SCHEME } from '../core/preview.js';
import { OpenPaths, pathsFromArgv } from './openPaths.js';
import { Worker } from 'node:worker_threads';
import { HeicDecoder } from './heicDecoder.js';
import heicWorkerPath from './heicWorker.js?modulePath';
import { toJpeg } from './previewImage.js';
import { PreviewServer } from './previewServer.js';
import {
  BUSY_QUIT,
  CONFIRM_QUIT,
  disposeBounded,
  QUIT_WAIT_NOTE_MS,
  QUIT_WAITING,
  quitDecision,
  QUITTING,
  waitForIdle,
  type LongWaitNote,
} from './quitGuard.js';
import { Session } from './session.js';
import { devRendererUrl } from './devMode.js';
import { APP_ORIGIN, APP_SCHEME, assetMime, resolveAppPath } from './appServer.js';
import { menuTemplate } from './menu.js';
import { appendLog, appendLogSync, crashLoopMessage, reloadLimiter } from './crash.js';
import { progressFraction } from './progress.js';

// Tests point this at a temp folder so they never touch the user's presets. Honored in packaged
// builds too: e2e/packaged.spec.ts drives the real app and must not write real userData. It only
// relocates presets and logs, so it is not gated on app.isPackaged like ELECTRON_RENDERER_URL is.
if (process.env.RENAMI_USER_DATA_DIR) app.setPath('userData', process.env.RENAMI_USER_DATA_DIR);
// userData is resolvable before ready; computed here so the startup failure handler can log too.
const logFile = path.join(app.getPath('userData'), 'renami.log');

// Sandbox every renderer this app will ever open, not just the one window created below.
app.enableSandbox();

// Must equal appId in electron-builder.yml so NSIS shortcuts and the running app group together.
app.setAppUserModelId('app.renami');

let mainWindow: BrowserWindow | null = null;
const liveWindow = (): BrowserWindow | null => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
let session: Session | null = null;
let preview: PreviewServer | null = null;
let quitConfirmed = false;
/** Set while the crash-loop give-up waits for a batch to finish before quitting. */
let quitWaiting = false;
/** Set once will-quit has started disposing the session. */
let disposing = false;

/** Logs, once, a quit that has waited long for a rename or undo (a hung rollback leaves a trace). */
const quitWaitNote: LongWaitNote = {
  noteAfterMs: QUIT_WAIT_NOTE_MS,
  onLongWait: () =>
    appendLogSync(logFile, 'quit-waiting', `still waiting for a rename or undo to finish after ${QUIT_WAIT_NOTE_MS / 1000} s`),
};

const openPaths = new OpenPaths((paths) => send(EVENTS.openPaths, paths));
/** A name list bigger than this is almost certainly the wrong file. */
const MAX_TEXT_BYTES = 5 * 1024 * 1024;

// Spec P3: the preview panel loads batch files from renami-file:. Must be registered before ready.
// stream lets <video> seek through ranged responses; the page's CSP still applies (no bypassCSP).
protocol.registerSchemesAsPrivileged([
  { scheme: PREVIEW_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
  // The page itself: a real origin (so CSP 'self' and the pdf.js worker work), unlike file://.
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Registered before whenReady: macOS can emit open-file for the launching drop.
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  openPaths.add([filePath]);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv, workingDirectory) => {
    // While quitting (possibly waiting a long time for a rollback) there is no window to show,
    // and this process still holds the lock, so a new launch would otherwise just vanish.
    if (disposing || quitWaiting) {
      const text = session?.isBusy() ? QUIT_WAITING : QUITTING;
      void dialog.showMessageBox({ type: 'info', buttons: ['OK'], message: text.message, detail: text.detail });
      return;
    }
    openPaths.add(pathsFromArgv(argv, app.isPackaged, workingDirectory));
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');

const isStringRecord = (v: unknown): v is Record<string, string> =>
  typeof v === 'object' && v !== null && Object.values(v).every((s) => typeof s === 'string');

function send(channel: string, payload: unknown): void {
  const win = liveWindow();
  if (!win) return;
  try {
    win.webContents.send(channel, payload);
  } catch (error) {
    // Session reports progress from a throttle timer and from finish(); a throwing sink here
    // would otherwise become an uncaught exception, or a rejected read that makes undo throw.
    console.error('failed to send to renderer', error);
  }
}

/** Undo history is lost on quit, so ask first. Never quit in the middle of a batch. */
function confirmQuit(): boolean {
  if (!session || !mainWindow) return true;
  const decision = quitDecision({ busy: session.isBusy(), canUndo: session.canUndo() });
  if (decision === 'quit') return true;
  if (decision === 'refuse') {
    dialog.showMessageBoxSync(mainWindow, {
      type: 'info',
      buttons: ['OK'],
      message: BUSY_QUIT.message,
      detail: BUSY_QUIT.detail,
    });
    return false;
  }
  const choice = dialog.showMessageBoxSync(mainWindow, {
    type: 'warning',
    buttons: ['Quit', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: CONFIRM_QUIT.message,
    detail: CONFIRM_QUIT.detail,
  });
  return choice === 0;
}

const openDialog = (options: OpenDialogOptions) =>
  mainWindow ? dialog.showOpenDialog(mainWindow, options) : dialog.showOpenDialog(options);

async function pickPaths(kind: PickKind): Promise<string[]> {
  const options: OpenDialogOptions =
    kind === 'files'
      ? { title: 'Add files', properties: ['openFile', 'multiSelections'] }
      : { title: 'Add folders', properties: ['openDirectory', 'multiSelections'] };
  const result = await openDialog(options);
  return result.canceled ? [] : result.filePaths;
}

async function pickFolder(): Promise<string | null> {
  const options: OpenDialogOptions = { title: 'Choose a destination folder', properties: ['openDirectory', 'createDirectory'] };
  const result = await openDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

async function saveText(suggestedName: string, text: string): Promise<boolean> {
  const options = {
    title: 'Save as',
    defaultPath: suggestedName,
    filters: [
      { name: 'CSV', extensions: ['csv'] },
      { name: 'Text', extensions: ['txt'] },
    ],
  };
  const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return false;
  await writeFile(result.filePath, text, 'utf8');
  return true;
}

async function readText(): Promise<{ name: string; text: string } | null> {
  const options: OpenDialogOptions = {
    title: 'Import names',
    properties: ['openFile'],
    filters: [{ name: 'Text or CSV', extensions: ['txt', 'csv'] }],
  };
  const result = await openDialog(options);
  const file = result.filePaths[0];
  if (result.canceled || !file) return null;
  const buffer = await readFile(file);
  if (buffer.byteLength > MAX_TEXT_BYTES) throw new Error('That file is bigger than 5 MB, which is too big for a name list.');
  return { name: path.basename(file), text: buffer.toString('utf8') };
}

function requireStringName(name: unknown): string {
  if (typeof name !== 'string') throw new Error('A preset name must be text');
  return name;
}

/**
 * Wraps ipcMain.handle so only the app's own page may call in (Electron security checklist:
 * validate the sender). A renderer navigated elsewhere, or a devtools frame, can't reach it.
 */
function handle(channel: string, fn: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
      throw new Error('Unexpected sender');
    }
    return fn(...args);
  });
}

/**
 * Runs a rename or undo with every preview file closed: Windows won't rename an open file. The
 * taskbar progress is cleared afterwards, however it ends.
 */
async function runBatch<T>(run: () => Promise<T>): Promise<T> {
  try {
    const p = preview;
    await p?.closeAll();
    try {
      return await run();
    } finally {
      p?.resume();
    }
  } finally {
    liveWindow()?.setProgressBar(-1);
  }
}

/** A path the preview may act on: a file in the current batch. Anything else throws. */
function batchFile(s: Session, p: unknown): string {
  if (typeof p !== 'string' || !s.hasFile(p)) throw new Error('That file is not in the batch');
  return p;
}

function registerIpc(s: Session): void {
  handle(INVOKE.platform, () => s.platform());
  handle(INVOKE.scan, (paths: unknown, filter: unknown) => {
    if (!isStringArray(paths)) throw new Error('scan needs a list of paths');
    return s.scan(paths, filterWithDefaults(filter));
  });
  handle(INVOKE.buildPlan, (req: unknown) => {
    const r = (req ?? {}) as Partial<PlanRequest>;
    return s.buildPlan({
      // Session.buildPlan runs settings through withDefaults; the cast only satisfies the type.
      settings: r.settings as PlanRequest['settings'],
      excluded: isStringArray(r.excluded) ? r.excluded : [],
      overrides: isStringRecord(r.overrides) ? r.overrides : {},
      manualOrder: isStringArray(r.manualOrder) ? r.manualOrder : [],
    });
  });
  handle(INVOKE.tokenValues, () => s.tokenValues());
  handle(INVOKE.execute, (planId: unknown) => runBatch(() => s.execute(String(planId))));
  handle(INVOKE.cancel, () => s.cancel());
  handle(INVOKE.undo, () => runBatch(() => s.undo()));
  handle(INVOKE.canUndo, () => s.canUndo());
  handle(INVOKE.listPresets, () => s.listPresets());
  handle(INVOKE.savePreset, (name: unknown, settings: unknown) => s.savePreset(requireStringName(name), settings as PlanRequest['settings']));
  handle(INVOKE.deletePreset, (name: unknown) => s.deletePreset(requireStringName(name)));
  handle(INVOKE.pickPaths, (kind: unknown) => pickPaths(kind === 'files' ? 'files' : 'folder'));
  handle(INVOKE.pickFolder, () => pickFolder());
  handle(INVOKE.copyText, (text: unknown) => clipboard.writeText(String(text)));
  handle(INVOKE.clear, () => s.clear());
  handle(INVOKE.saveText, (name: unknown, text: unknown) => saveText(String(name), String(text)));
  handle(INVOKE.readText, () => readText());
  handle(INVOKE.takeOpenPaths, () => openPaths.take());
  handle(INVOKE.fileDetails, (p: unknown) => (typeof p === 'string' ? s.fileDetails(p) : null));
  handle(INVOKE.showInFolder, (p: unknown) => shell.showItemInFolder(batchFile(s, p)));
  handle(INVOKE.openFile, async (p: unknown) => {
    const error = await shell.openPath(batchFile(s, p));
    return error === '' ? null : error;
  });
}

/**
 * What the window shows before the page paints and while it resizes. Matches --bg in styles.css
 * for each color mode, so neither mode flashes the other's background.
 */
function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#161615' : '#f4f3f0';
}

/** A renderer that dies on every load would otherwise be reloaded forever. */
const CRASH_RELOADS = { max: 3, windowMs: 60_000 };

function createWindow(devUrl: string | null): BrowserWindow {
  const allowReload = reloadLimiter(CRASH_RELOADS);
  let gaveUp = false;
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'Renami',
    backgroundColor: windowBackground(),
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: !app.isPackaged,
      spellcheck: false,
    },
  });
  // The app never opens other pages.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    if (win.isDestroyed()) return;
    if (gaveUp) return;
    // The main process still holds the session (files, plan, undo history); reload recovers it.
    appendLog(logFile, 'renderer-gone', details.reason);
    if (allowReload()) {
      win.webContents.reload();
      return;
    }
    gaveUp = true;
    appendLogSync(logFile, 'renderer-gone', `gave up after ${CRASH_RELOADS.max} reloads in ${CRASH_RELOADS.windowMs / 1000} s`);
    const busy = session?.isBusy() ?? false;
    dialog.showErrorBox(
      'Renami keeps crashing',
      crashLoopMessage({
        crashes: CRASH_RELOADS.max + 1,
        windowSeconds: CRASH_RELOADS.windowMs / 1000,
        reason: details.reason,
        logFile,
        busy,
      }),
    );
    // Skip the undo prompt: with no working window the user can't act on undo history anyway,
    // and confirmQuit() would ask again on every close. will-quit still disposes the session.
    const quit = (): void => {
      quitConfirmed = true;
      app.quit();
    };
    // Never quit in the middle of a batch: the rename or undo (or its rollback) runs in this
    // process and finishes without the window. quitConfirmed stays false until then, so a
    // quit the user asks for meanwhile is still refused by confirmQuit().
    if (session?.isBusy()) {
      quitWaiting = true;
      void waitForIdle(session, quitWaitNote).then(quit);
      return;
    }
    quit();
  });
  win.on('unresponsive', () => appendLog(logFile, 'unresponsive', 'renderer unresponsive'));
  win.on('close', (event) => {
    if (quitConfirmed) return;
    event.preventDefault();
    if (confirmQuit()) {
      quitConfirmed = true;
      app.quit();
    }
  });
  win.on('closed', () => {
    mainWindow = null;
  });
  void win.loadURL(devUrl ?? `${APP_ORIGIN}/index.html`);
  return win;
}

void app.whenReady().then(() => {
  const devUrl = devRendererUrl(app.isPackaged, process.env);
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate(process.platform, devUrl !== null)));
  // Deny every Chromium permission (camera, mic, geolocation, notifications) except fullscreen:
  // that one is requestFullscreen(), which the preview panel's <video controls> button calls.
  webSession.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'fullscreen'));
  webSession.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen');
  // The spellchecker downloads dictionaries from Google on Windows/Linux; the app is offline.
  webSession.defaultSession.spellCheckerEnabled = false;
  // Installing these replaces Electron's default error dialog: log first, then still tell the user.
  process.on('uncaughtException', (error) => {
    appendLog(logFile, 'uncaught', error);
    dialog.showErrorBox('Renami hit an unexpected error', error instanceof Error ? (error.stack ?? error.message) : String(error));
  });
  // Changes Node's default for main-process rejections from crash to log-and-continue.
  process.on('unhandledRejection', (reason) => appendLog(logFile, 'unhandled-rejection', reason));
  session = new Session({
    platform: process.platform as Platform,
    presetsFile: path.join(app.getPath('userData'), 'presets.json'),
    events: {
      metadataProgress: (status) => send(EVENTS.metadataProgress, status),
      executeProgress: (progress) => {
        send(EVENTS.executeProgress, progress);
        liveWindow()?.setProgressBar(progressFraction(progress.done, progress.total));
      },
    },
  });
  registerIpc(session);
  const s = session;
  // unref: a decode in progress must not keep the app from quitting.
  const heic = new HeicDecoder(() => {
    const worker = new Worker(heicWorkerPath);
    worker.unref();
    return worker;
  });
  preview = new PreviewServer({
    allowed: (p) => s.hasFile(p),
    busy: () => s.isBusy(),
    embeddedJpeg: (p) => s.embeddedJpeg(p),
    decodeHeic: (data) => heic.decode(data),
    toJpeg,
    pageOrigin: devUrl ? new URL(devUrl).origin : APP_ORIGIN,
  });
  const server = preview;
  protocol.handle(PREVIEW_SCHEME, (request) => server.handle(request));
  const rendererRoot = path.join(import.meta.dirname, '../renderer');
  protocol.handle(APP_SCHEME, async (request) => {
    const file = resolveAppPath(request.url, rendererRoot);
    if (!file) return new Response('Not found', { status: 404 });
    try {
      return new Response(await readFile(file), { headers: { 'content-type': assetMime(file) } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
  mainWindow = createWindow(devUrl);
  openPaths.add(pathsFromArgv(process.argv, app.isPackaged, process.cwd()));
  // The page follows the OS color mode through prefers-color-scheme; the window has to be told.
  nativeTheme.on('updated', () => {
    liveWindow()?.setBackgroundColor(windowBackground());
  });
}).catch((error: unknown) => {
  // Without this, a throw above ends up in the unhandledRejection log only: no window, no dialog,
  // and a process that keeps the single-instance lock so every later launch exits at once.
  appendLogSync(logFile, 'startup', error);
  dialog.showErrorBox('Renami could not start', error instanceof Error ? (error.stack ?? error.message) : String(error));
  app.exit(1);
});

app.on('before-quit', (event) => {
  if (quitConfirmed) return;
  if (!confirmQuit()) {
    event.preventDefault();
    return;
  }
  quitConfirmed = true;
});

// Quit on macOS too (against the platform convention): a windowless bulk renamer has nothing
// to do in the background, and undo history dies with the session anyway.
app.on('window-all-closed', () => app.quit());

/**
 * quitConfirmed is already true by the time this runs (before-quit or the close handler set it),
 * so the second app.quit() below skips the prompt. Bounded so a stuck ExifTool end() can't hang
 * the quit, but the bound only starts once a cancelled rename or undo has finished rolling back:
 * a cross-volume rollback can take longer than this, and cutting it short strands files under
 * temporary names. The cost: a rollback that hangs keeps this windowless process alive, so the
 * wait is logged after QUIT_WAIT_NOTE_MS and a second launch is told why (see disposeBounded).
 */
const DISPOSE_TIMEOUT_MS = 3000;
let disposed = false;
app.on('will-quit', (event) => {
  if (disposed || !session) return;
  event.preventDefault();
  // A quit already in flight (e.g. a second app.quit() while dispose() is still running) just
  // waits for the first one's deferred app.quit() below; starting a second dispose() would be
  // wasted work and could reset the timer.
  if (disposing) return;
  disposing = true;
  void disposeBounded(session, DISPOSE_TIMEOUT_MS, quitWaitNote)
    .catch((error) => console.error('session dispose failed', error))
    .finally(() => {
      disposed = true;
      // A dispose that settles within the same microtask turn (nothing to await, e.g. no scan
      // ever ran) calls app.quit() while Electron is still inside NotifyAndShutdown() for the
      // will-quit it just emitted; that re-entrant call is a no-op and the app never exits.
      // Deferring to a macrotask guarantees this runs after that call has returned.
      setImmediate(() => app.quit());
    });
});
