import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CancelledError } from '../../../src/core/executor/moves.js';

// The native setters shell out to osascript and PowerShell. Fake the child process so the
// command lines they build can be checked on any OS.
const execFile = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile }));

const { createBirthtimeSetter, windowsChunks, windowsScript } = await import('../../../src/core/executor/birthtime.js');

type Callback = (error: Error | null, result?: { stdout: string; stderr: string }) => void;

function succeed(): void {
  execFile.mockImplementation((_cmd: string, _args: string[], cb: Callback) => cb(null, { stdout: 'ok', stderr: '' }));
}

function fail(stderr: string): void {
  execFile.mockImplementation((_cmd: string, _args: string[], cb: Callback) => cb(Object.assign(new Error('Command failed'), { stderr })));
}

const items = (n: number, dir = '/Volumes/Photos') =>
  Array.from({ length: n }, (_, i) => ({ path: `${dir}/IMG_${i}.jpg`, timeMs: 1_700_000_000_000 + i * 1000 }));

beforeEach(() => {
  execFile.mockReset();
});

describe('createBirthtimeSetter on macOS', () => {
  it('runs one osascript per 200 files, passing each path with its time in seconds', async () => {
    succeed();
    const setter = createBirthtimeSetter('darwin');
    expect(setter.supported).toBe(true);
    await setter.set(items(201));

    expect(execFile).toHaveBeenCalledTimes(2);
    const [cmd, args] = execFile.mock.calls[0] as [string, string[]];
    expect(cmd).toBe('osascript');
    expect(args.slice(0, 3)).toEqual(['-l', 'JavaScript', '-e']);
    expect(args[3]).toContain('NSFileCreationDate');
    expect(args).toHaveLength(4 + 200 * 2);
    expect(args[4]).toBe('/Volumes/Photos/IMG_0.jpg');
    expect(args[5]).toBe(String(1_700_000_000_000 / 1000));
    expect((execFile.mock.calls[1] as [string, string[]])[1]).toHaveLength(4 + 2);
  });

  it('runs nothing for an empty list', async () => {
    succeed();
    await createBirthtimeSetter('darwin').set([]);
    expect(execFile).not.toHaveBeenCalled();
  });

  it('stops before running anything once cancelled', async () => {
    succeed();
    const controller = new AbortController();
    controller.abort();
    await expect(createBirthtimeSetter('darwin').set(items(1), controller.signal)).rejects.toBeInstanceOf(CancelledError);
    expect(execFile).not.toHaveBeenCalled();
  });

  it('cancels between chunks, keeping the chunks already done', async () => {
    const controller = new AbortController();
    execFile.mockImplementation((_cmd: string, _args: string[], cb: Callback) => {
      controller.abort();
      cb(null, { stdout: 'ok', stderr: '' });
    });
    await expect(createBirthtimeSetter('darwin').set(items(201), controller.signal)).rejects.toBeInstanceOf(CancelledError);
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it("surfaces the tool's stderr as the error, never the command line", async () => {
    fail('  Could not set the created date of /Volumes/Photos/IMG_0.jpg\n');
    await expect(createBirthtimeSetter('darwin').set(items(1))).rejects.toThrow(
      /^Could not set the created date of \/Volumes\/Photos\/IMG_0\.jpg$/,
    );
  });

  it('falls back to a generic message when the tool says nothing', async () => {
    fail('   ');
    await expect(createBirthtimeSetter('darwin').set(items(1))).rejects.toThrow('The created-date tool failed');
  });
});

describe('createBirthtimeSetter on Windows', () => {
  it('runs PowerShell with the encoded script for each size-bounded chunk', async () => {
    succeed();
    const setter = createBirthtimeSetter('win32');
    expect(setter.supported).toBe(true);
    const many = items(300, 'C:\\Users\\Someone\\Pictures\\A rather long folder name to fill the budget');
    await setter.set(many);

    const chunks = windowsChunks(many);
    expect(chunks.length).toBeGreaterThan(1);
    expect(execFile).toHaveBeenCalledTimes(chunks.length);
    execFile.mock.calls.forEach((call, i) => {
      const [cmd, args] = call as [string, string[]];
      expect(cmd).toBe('powershell.exe');
      expect(args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand']);
      expect(Buffer.from(args[3]!, 'base64').toString('utf16le')).toBe(windowsScript(chunks[i]!));
    });
  });

  it('stops before running anything once cancelled', async () => {
    succeed();
    const controller = new AbortController();
    controller.abort();
    await expect(createBirthtimeSetter('win32').set(items(1), controller.signal)).rejects.toBeInstanceOf(CancelledError);
    expect(execFile).not.toHaveBeenCalled();
  });

  it("surfaces the tool's stderr as the error", async () => {
    fail('Access to the path is denied.\r\n');
    await expect(createBirthtimeSetter('win32').set(items(1))).rejects.toThrow('Access to the path is denied.');
  });
});
