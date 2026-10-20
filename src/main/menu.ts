import type { MenuItemConstructorOptions } from 'electron';

/** The update check's two menu items (src/main/updater.ts). */
export interface UpdateMenu {
  autoCheck: boolean;
  checkNow: () => void;
  setAutoCheck: (on: boolean) => void;
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
 * replaces the appMenu role's default one) or, elsewhere, in a Help menu.
 */
export function menuTemplate(platform: NodeJS.Platform, isDev: boolean, updates?: UpdateMenu): MenuItemConstructorOptions[] {
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
    { role: 'fileMenu' },
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
