import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it } from 'vitest';
import { menuTemplate } from '../../src/main/menu.js';

/** Every role in the template, top-level and one submenu deep. */
function roles(items: MenuItemConstructorOptions[]): string[] {
  return items.flatMap((item) => [
    ...(item.role ? [item.role] : []),
    ...(Array.isArray(item.submenu) ? item.submenu.flatMap((s) => (s.role ? [s.role] : [])) : []),
  ]);
}

describe('menuTemplate', () => {
  it('keeps fullscreen and zoom in production', () => {
    const r = roles(menuTemplate('win32', false));
    expect(r).toEqual(expect.arrayContaining(['togglefullscreen', 'zoomIn', 'zoomOut', 'resetZoom']));
    expect(r).not.toContain('reload');
    expect(r).not.toContain('toggleDevTools');
  });

  it('adds reload and devtools in dev', () => {
    const r = roles(menuTemplate('win32', true));
    expect(r).toEqual(expect.arrayContaining(['reload', 'forceReload', 'toggleDevTools']));
  });

  it('has the app menu only on macOS', () => {
    expect(roles(menuTemplate('darwin', false))).toContain('appMenu');
    expect(roles(menuTemplate('linux', false))).not.toContain('appMenu');
  });
});
