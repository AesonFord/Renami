import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
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

/** The first item with this label, at any depth. */
function findLabel(items: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions | undefined {
  for (const item of items) {
    if (item.label === label) return item;
    const found = Array.isArray(item.submenu) ? findLabel(item.submenu, label) : undefined;
    if (found) return found;
  }
  return undefined;
}

describe('menuTemplate update items', () => {
  const updates = (autoCheck = true) => ({ autoCheck, checkNow: vi.fn(), setAutoCheck: vi.fn() });
  const CHECK = 'Check for Updates…';
  const AUTO = 'Check for Updates Automatically';

  it('puts the update items in the mac app menu', () => {
    const appMenu = menuTemplate('darwin', false, updates()).find((item) => item.role === 'appMenu');
    expect(appMenu).toBeDefined();
    const shape = (appMenu!.submenu as MenuItemConstructorOptions[]).map((s) => s.role ?? s.label ?? s.type);
    expect(shape).toEqual(['about', 'separator', CHECK, AUTO, 'separator', 'services', 'separator', 'hide', 'hideOthers', 'unhide', 'separator', 'quit']);
  });

  it('puts the update items in a Help menu elsewhere', () => {
    for (const platform of ['win32', 'linux'] as const) {
      const help = menuTemplate(platform, false, updates()).at(-1)!;
      expect(help.role).toBe('help');
      expect((help.submenu as MenuItemConstructorOptions[]).map((s) => s.label)).toEqual([CHECK, AUTO]);
    }
  });

  it('shows the automatic check as a checkbox that mirrors the setting', () => {
    expect(findLabel(menuTemplate('linux', false, updates(true)), AUTO)).toMatchObject({ type: 'checkbox', checked: true });
    expect(findLabel(menuTemplate('linux', false, updates(false)), AUTO)).toMatchObject({ type: 'checkbox', checked: false });
  });

  it('menu items call through', () => {
    const u = updates(false);
    const template = menuTemplate('darwin', false, u);
    const click = (label: string, item: object) => (findLabel(template, label)!.click as unknown as (i: object) => void)(item);
    click(CHECK, {});
    expect(u.checkNow).toHaveBeenCalledTimes(1);
    click(AUTO, { checked: true });
    expect(u.setAutoCheck).toHaveBeenCalledWith(true);
  });

  it('has no update items without the argument', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const template = menuTemplate(platform, false);
      expect(findLabel(template, CHECK)).toBeUndefined();
      expect(findLabel(template, AUTO)).toBeUndefined();
      expect(template.some((item) => item.role === 'help')).toBe(false);
    }
  });
});
