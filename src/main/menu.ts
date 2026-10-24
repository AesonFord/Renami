import type { MenuItemConstructorOptions } from 'electron';
import type { MenuCommand } from '../shared/ipc.js';

/** The update check's two menu items (src/main/updater.ts). */
export interface UpdateMenu {
  autoCheck: boolean;
  checkNow: () => void;
  setAutoCheck: (on: boolean) => void;
}

/** Runs a File menu command in the page (src/main/index.ts sends it over EVENTS.menuCommand). */
export interface MenuCommands {
  run(command: MenuCommand): void;
}

/**
 * The app's commands, with each item's id set to its command. Undo Last Rename is Alt+Cmd+Z
 * because Shift+Cmd+Z is Edit › Redo in text fields.
 */
function fileMenu(platform: NodeJS.Platform, commands: MenuCommands): MenuItemConstructorOptions {
  const item = (id: MenuCommand, label: string, accelerator?: string): MenuItemConstructorOptions => ({
    id,
    label,
    ...(accelerator ? { accelerator } : {}),
    click: () => commands.run(id),
  });
  return {
    label: 'File',
    submenu: [
      item('addFiles', 'Add Files…', 'CmdOrCtrl+O'),
      item('addFolder', 'Add Folder…', 'Shift+CmdOrCtrl+O'),
      { type: 'separator' },
      item('importNames', 'Import Names…', 'CmdOrCtrl+I'),
      item('exportPreview', 'Export Preview…', 'Shift+CmdOrCtrl+E'),
      item('exportLast', 'Export Last Rename…'),
      { type: 'separator' },
      item('rename', 'Rename Files', 'CmdOrCtrl+Return'),
      item('undo', 'Undo Last Rename', 'Alt+CmdOrCtrl+Z'),
      { type: 'separator' },
      platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
    ],
  };
}

function updateItems(updates: UpdateMenu): MenuItemConstructorOptions[] {
  return [
    { label: 'Check for Updates…', click: () => updates.checkNow() },
    {
      label: 'Check for Updates Automatically',
      type: 'checkbox',
      checked: updates.autoCheck,
      click: (item) => updates.setAutoCheck(item.checked),
    },
  ];
}

/**
 * Never Menu.setApplicationMenu(null): on macOS that removes Cmd+Q and copy/paste in text
 * fields. Production keeps View (fullscreen, zoom); reload and devtools exist only in dev.
 * With `updates`, the update items go in the macOS app menu (spelled out, since a given submenu
 * replaces the appMenu role's default one) or, elsewhere, in a Help menu. With `commands`, the
 * File menu holds the app's commands; without, it is Electron's default.
 */
export function menuTemplate(
  platform: NodeJS.Platform,
  isDev: boolean,
  updates?: UpdateMenu,
  commands?: MenuCommands,
): MenuItemConstructorOptions[] {
  const devItems: MenuItemConstructorOptions[] = isDev
    ? [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }]
    : [];
  const appMenu: MenuItemConstructorOptions = updates
    ? {
        role: 'appMenu',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          ...updateItems(updates),
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      }
    : { role: 'appMenu' };
  return [
    ...(platform === 'darwin' ? [appMenu] : []),
    commands ? fileMenu(platform, commands) : { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        ...devItems,
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    ...(updates && platform !== 'darwin' ? [{ role: 'help', submenu: updateItems(updates) } as const] : []),
  ];
}
