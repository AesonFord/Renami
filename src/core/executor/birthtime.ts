import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Platform } from '../types.js';
import { CancelledError } from './moves.js';

const run = promisify(execFile);

export interface BirthtimeItem {
  path: string;
  timeMs: number;
}

export interface BirthtimeSetter {
  readonly supported: boolean;
  set(items: readonly BirthtimeItem[], signal?: AbortSignal): Promise<void>;
}

// JavaScript for Automation: built into macOS, no developer tools needed.
const MAC_SCRIPT = `
ObjC.import('Foundation');
function run(argv) {
  const fm = $.NSFileManager.defaultManager;
  for (let i = 0; i < argv.length; i += 2) {
    const date = $.NSDate.dateWithTimeIntervalSince1970(Number(argv[i + 1]));
    const attrs = $.NSDictionary.dictionaryWithObjectForKey(date, $.NSFileCreationDate);
    if (!fm.setAttributesOfItemAtPathError(attrs, argv[i], null)) {
      throw new Error('Could not set the created date of ' + argv[i]);
    }
  }
  return 'ok';
}`;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Runs a native tool, surfacing only its stderr — never the (possibly huge) command line. */
async function runTool(cmd: string, args: string[]): Promise<void> {
  try {
    await run(cmd, args);
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    throw new Error((err.stderr ?? '').trim() || 'The created-date tool failed');
  }
}

const WINDOWS_JSON_BUDGET = 7000;

function windowsPayload(chunk: readonly BirthtimeItem[]): string {
  return JSON.stringify(chunk.map((it) => ({ p: it.path, t: Math.round(it.timeMs) })));
}

/** Chunk by encoded JSON size, not count, so long paths can't blow past PowerShell's ~32,767-character command-line limit. */
export function windowsChunks(items: readonly BirthtimeItem[]): BirthtimeItem[][] {
  const out: BirthtimeItem[][] = [];
  let current: BirthtimeItem[] = [];
  for (const item of items) {
    const candidate = [...current, item];
    if (current.length > 0 && Buffer.byteLength(windowsPayload(candidate), 'utf8') > WINDOWS_JSON_BUDGET) {
      out.push(current);
      current = [item];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}

/**
 * The PowerShell script for one chunk. The payload travels as base64, which has no quote
 * characters, so paths (including curly quotes, which PowerShell also treats as string
 * delimiters) can never break out of the script or inject commands.
 */
export function windowsScript(chunk: readonly BirthtimeItem[]): string {
  const payload = Buffer.from(windowsPayload(chunk), 'utf8').toString('base64');
  return (
    "$ErrorActionPreference = 'Stop'; " +
    `$items = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json; ` +
    'foreach ($i in $items) { [System.IO.File]::SetCreationTimeUtc($i.p, [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$i.t).UtcDateTime) }'
  );
}

export function createBirthtimeSetter(platform: Platform): BirthtimeSetter {
  if (platform === 'darwin') {
    return {
      supported: true,
      async set(items, signal) {
        for (const chunk of chunks(items, 200)) {
          if (signal?.aborted) throw new CancelledError();
          const args = chunk.flatMap((it) => [it.path, String(it.timeMs / 1000)]);
          await runTool('osascript', ['-l', 'JavaScript', '-e', MAC_SCRIPT, ...args]);
        }
      },
    };
  }
  if (platform === 'win32') {
    return {
      supported: true,
      async set(items, signal) {
        for (const chunk of windowsChunks(items)) {
          if (signal?.aborted) throw new CancelledError();
          const encoded = Buffer.from(windowsScript(chunk), 'utf16le').toString('base64');
          await runTool('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded]);
        }
      },
    };
  }
  return {
    supported: false,
    async set() {
      throw new Error('Setting created dates is not supported on Linux');
    },
  };
}
