import { execFile, spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Platform } from '../core/index.js';

/**
 * Where the Windows installer records the install folder, under HKCU (per-user install) or HKLM
 * (per-machine). electron-builder derives the GUID from the appId; test/cli/launch.test.ts checks
 * it still matches electron-builder.yml.
 */
export const WINDOWS_INSTALL_KEY = 'Software\\09c3bcba-8eb4-57fd-a1c8-89a5efb9a1ed';
/** Where the .deb installs the app. An AppImage can be anywhere, so it can't be found. */
export const LINUX_APP = '/opt/Renami/renami-app';

export interface LaunchDeps {
  platform: Platform;
  env: Readonly<Record<string, string | undefined>>;
  exists(file: string): Promise<boolean>;
  /** The InstallLocation value under `root\key`, or null. */
  installLocation(root: 'HKCU' | 'HKLM', key: string): Promise<string | null>;
  /** Starts a program without waiting for it. Resolves false when it couldn't start. */
  start(file: string, args: string[]): Promise<boolean>;
  /** Runs a program to the end. Resolves its exit code, or null when it couldn't run. */
  run(file: string, args: string[]): Promise<number | null>;
}

/** The InstallLocation value in `reg query … /v InstallLocation` output. */
export function parseRegValue(stdout: string): string | null {
  return /InstallLocation\s+REG_\w+\s+(.+?)\s*$/m.exec(stdout)?.[1] ?? null;
}

export async function windowsApp(deps: LaunchDeps): Promise<string | null> {
  // HKLM is only asked when the per-user install isn't there: each query starts reg.exe.
  for (const root of ['HKCU', 'HKLM'] as const) {
    const dir = await deps.installLocation(root, WINDOWS_INSTALL_KEY);
    const file = dir ? path.win32.join(dir, 'Renami.exe') : null;
    if (file && (await deps.exists(file))) return file;
  }
  const { LOCALAPPDATA, ProgramFiles } = deps.env;
  const defaults = [
    LOCALAPPDATA && path.win32.join(LOCALAPPDATA, 'Programs', 'Renami', 'Renami.exe'),
    ProgramFiles && path.win32.join(ProgramFiles, 'Renami', 'Renami.exe'),
  ];
  for (const file of defaults) if (file && (await deps.exists(file))) return file;
  return null;
}

/** Opens the desktop app with these paths. Resolves false when it isn't installed or won't start. */
export async function openInApp(paths: readonly string[], deps: LaunchDeps): Promise<boolean> {
  // open hands the paths to the app as open-file events, which also reach a window already open.
  if (deps.platform === 'darwin') return (await deps.run('open', ['-a', 'Renami', ...paths])) === 0;
  const app = deps.platform === 'win32' ? await windowsApp(deps) : (await deps.exists(LINUX_APP)) ? LINUX_APP : null;
  return app !== null && deps.start(app, [...paths]);
}

const execFileAsync = promisify(execFile);

export function systemLaunchDeps(): LaunchDeps {
  return {
    platform: process.platform as Platform,
    env: process.env,
    exists: (file) => access(file).then(
      () => true,
      () => false,
    ),
    installLocation: async (root, key) => {
      try {
        const { stdout } = await execFileAsync('reg', ['query', `${root}\\${key}`, '/v', 'InstallLocation'], {
          windowsHide: true,
        });
        return parseRegValue(stdout);
      } catch {
        return null;
      }
    },
    start: (file, args) =>
      new Promise((resolve) => {
        const child = spawn(file, args, { detached: true, stdio: 'ignore' });
        child.once('error', () => resolve(false));
        child.once('spawn', () => {
          child.unref();
          resolve(true);
        });
      }),
    run: (file, args) =>
      new Promise((resolve) => {
        const child = spawn(file, args, { stdio: 'ignore' });
        child.once('error', () => resolve(null));
        child.once('exit', (code) => resolve(code));
      }),
  };
}
