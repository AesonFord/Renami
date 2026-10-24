import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { aboutPanelOptions, menuTemplate } from '../../src/main/menu.js';

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

/** The first item with this id, at any depth. */
function findId(items: MenuItemConstructorOptions[], id: string): MenuItemConstructorOptions | undefined {
  for (const item of items) {
    if (item.id === id) return item;
    const found = Array.isArray(item.submenu) ? findId(item.submenu, id) : undefined;
    if (found) return found;
  }
  return undefined;
}

describe('menuTemplate file menu', () => {
  const commands = () => ({ run: vi.fn() });
  const fileMenu = (platform: NodeJS.Platform) => menuTemplate(platform, false, undefined, commands()).find((m) => m.label === 'File')!;
  const FILE_LABELS = ['Add Files…', 'Add Folder…', 'Import Names…', 'Export Preview…', 'Export Last Rename…', 'Rename Files', 'Undo Last Rename'];

  it('lists the commands with their shortcuts, then Close on macOS and Quit elsewhere', () => {
    const shape = (platform: NodeJS.Platform) => (fileMenu(platform).submenu as MenuItemConstructorOptions[]).map((s) => s.role ?? s.label ?? s.type);
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
      (findId(template, id)!.click as unknown as () => void)();
      expect(c.run).toHaveBeenLastCalledWith(id);
    }
  });

  it('uses no Edit menu accelerator', () => {
    const edit = ['CmdOrCtrl+Z', 'Shift+CmdOrCtrl+Z', 'CmdOrCtrl+X', 'CmdOrCtrl+C', 'CmdOrCtrl+V', 'CmdOrCtrl+A'];
    for (const item of fileMenu('darwin').submenu as MenuItemConstructorOptions[]) if (item.accelerator) expect(edit).not.toContain(item.accelerator);
  });

  it('gives Undo Last Rename no shortcut off macOS, where AltGr is Ctrl+Alt', () => {
    for (const platform of ['win32', 'linux'] as const) {
      expect(findId(menuTemplate(platform, false, undefined, commands()), 'undo')!.accelerator).toBeUndefined();
    }
  });

  it('keeps the fileMenu role without commands', () => {
    expect(menuTemplate('darwin', false).some((m) => m.role === 'fileMenu')).toBe(true);
  });
});

describe('aboutPanelOptions', () => {
  it('names the app, its version and the project page', () => {
    expect(aboutPanelOptions('0.3.2')).toEqual({ applicationName: 'Renami', applicationVersion: '0.3.2', website: 'https://github.com/AesonFord/Renami' });
  });
});
