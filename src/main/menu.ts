import type { MenuItemConstructorOptions } from 'electron';

/**
 * Never Menu.setApplicationMenu(null): on macOS that removes Cmd+Q and copy/paste in text
 * fields. Production keeps View (fullscreen, zoom); reload and devtools exist only in dev.
 */
export function menuTemplate(platform: NodeJS.Platform, isDev: boolean): MenuItemConstructorOptions[] {
  const devItems: MenuItemConstructorOptions[] = isDev
    ? [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }]
    : [];
  return [
    ...(platform === 'darwin' ? [{ role: 'appMenu' } as const] : []),
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
  ];
}
