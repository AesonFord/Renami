import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Platform } from '../../src/core/index.js';
import {
  LINUX_APP,
  openInApp,
  parseRegValue,
  WINDOWS_INSTALL_KEY,
  type LaunchDeps,
} from '../../src/cli/launch.js';

function fake(platform: Platform, over: Partial<LaunchDeps> & { files?: string[]; reg?: Record<string, string> } = {}) {
  const started: [string, string[]][] = [];
  const ran: [string, string[]][] = [];
  const deps: LaunchDeps = {
    platform,
    env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', ProgramFiles: 'C:\\Program Files' },
    exists: async (file) => (over.files ?? []).includes(file),
    installLocation: async (root, key) => over.reg?.[`${root}\\${key}`] ?? null,
    start: async (file, args) => {
      started.push([file, args]);
      return true;
    },
    run: async (file, args) => {
      ran.push([file, args]);
      return 0;
    },
    ...over,
  };
  return { deps, started, ran };
}

describe('openInApp', () => {
  it('opens the paths with "open -a Renami" on macOS', async () => {
    const { deps, ran } = fake('darwin');
    expect(await openInApp(['/a', '/b'], deps)).toBe(true);
    expect(ran).toEqual([['open', ['-a', 'Renami', '/a', '/b']]]);
  });

  it('reports the app missing on macOS when open fails', async () => {
    const { deps } = fake('darwin', { run: async () => 1 });
    expect(await openInApp(['/a'], deps)).toBe(false);
  });

  it('prefers the per-user install location on Windows, then per-machine, then the default folders', async () => {
    const user = 'D:\\Apps\\Renami';
    const machine = 'E:\\Renami';
    const local = 'C:\\Users\\me\\AppData\\Local\\Programs\\Renami\\Renami.exe';
    const both = fake('win32', {
      reg: { [`HKCU\\${WINDOWS_INSTALL_KEY}`]: user, [`HKLM\\${WINDOWS_INSTALL_KEY}`]: machine },
      files: [path.win32.join(user, 'Renami.exe'), path.win32.join(machine, 'Renami.exe')],
    });
    expect(await openInApp(['C:\\x'], both.deps)).toBe(true);
    expect(both.started).toEqual([[path.win32.join(user, 'Renami.exe'), ['C:\\x']]]);

    const machineOnly = fake('win32', { reg: { [`HKLM\\${WINDOWS_INSTALL_KEY}`]: machine }, files: [path.win32.join(machine, 'Renami.exe')] });
    await openInApp(['C:\\x'], machineOnly.deps);
    expect(machineOnly.started[0]?.[0]).toBe(path.win32.join(machine, 'Renami.exe'));

    const fallback = fake('win32', { files: [local] });
    await openInApp(['C:\\x'], fallback.deps);
    expect(fallback.started[0]?.[0]).toBe(local);

    expect(await openInApp(['C:\\x'], fake('win32').deps)).toBe(false);
  });

  it('starts /opt/Renami/renami-app on Linux when it exists', async () => {
    const found = fake('linux', { files: [LINUX_APP] });
    expect(await openInApp(['/a'], found.deps)).toBe(true);
    expect(found.started).toEqual([[LINUX_APP, ['/a']]]);
    expect(await openInApp(['/a'], fake('linux').deps)).toBe(false);
  });

  it('reports failure when the app cannot be started', async () => {
    const { deps } = fake('linux', { files: [LINUX_APP], start: async () => false });
    expect(await openInApp(['/a'], deps)).toBe(false);
  });
});

describe('Windows registry', () => {
  it('reads the value out of reg query output', () => {
    const out = '\r\nHKEY_CURRENT_USER\\Software\\x\r\n    InstallLocation    REG_SZ    C:\\Users\\me\\AppData\\Local\\Programs\\Renami\r\n\r\n';
    expect(parseRegValue(out)).toBe('C:\\Users\\me\\AppData\\Local\\Programs\\Renami');
    expect(parseRegValue('ERROR: nothing here')).toBeNull();
  });

  it("matches the key electron-builder's installer writes for this appId", () => {
    const require = createRequire(import.meta.url);
    const { UUID } = require('builder-util-runtime') as {
      UUID: { v5(name: string, namespace: unknown): string; parse(text: string): unknown };
    };
    const appId = /^appId:\s*(\S+)/m.exec(readFileSync('electron-builder.yml', 'utf8'))?.[1];
    expect(appId).toBeDefined();
    // electron-builder's NSIS namespace, from app-builder-lib/out/targets/nsis/NsisTarget.js.
    const guid = UUID.v5(appId!, UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3'));
    expect(WINDOWS_INSTALL_KEY).toBe(`Software\\${guid}`);
  });
});
