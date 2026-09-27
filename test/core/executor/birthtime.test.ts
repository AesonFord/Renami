import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createBirthtimeSetter,
  windowsChunks,
  windowsScript,
  type BirthtimeItem,
} from '../../../src/core/executor/birthtime.js';

const root = mkdtempSync(path.join(tmpdir(), 'renami-birth-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('createBirthtimeSetter', () => {
  it('is unsupported on Linux', async () => {
    const setter = createBirthtimeSetter('linux');
    expect(setter.supported).toBe(false);
    await expect(setter.set([{ path: '/x', timeMs: 0 }])).rejects.toThrow(/not supported on Linux/);
  });

  const native = process.platform === 'darwin' || process.platform === 'win32';
  it.skipIf(!native)('moves the created date earlier and later on this OS', async () => {
    const file = path.join(root, "Mike’s é file.txt");
    writeFileSync(file, 'x');
    const setter = createBirthtimeSetter(process.platform as 'darwin' | 'win32');
    const earlier = Date.UTC(2024, 6, 4, 14, 30, 0);
    await setter.set([{ path: file, timeMs: earlier }]);
    expect(Math.abs(statSync(file).birthtimeMs - earlier)).toBeLessThan(1000);
    const later = Date.UTC(2029, 11, 31, 18, 0, 0);
    await setter.set([{ path: file, timeMs: later }]);
    expect(Math.abs(statSync(file).birthtimeMs - later)).toBeLessThan(1000);
  });
});

describe('windowsScript', () => {
  it('keeps a curly quote (and any other data) out of the PowerShell source text', () => {
    // U+2018/2019/201A/201B are curly quotes PowerShell also treats as string delimiters;
    // '"$ and an emoji round out the awkward-name check.
    const item: BirthtimeItem = {
      path: String.raw`C:\Users\Mike’s "wëird" $file 😀 'quote'.txt`,
      timeMs: Date.UTC(2024, 6, 4, 14, 30, 0),
    };
    const script = windowsScript([item]);

    for (const curly of ['\u2018', '\u2019', '\u201A', '\u201B']) {
      expect(script.includes(curly)).toBe(false);
    }
    // Only the template's own two ASCII-quoted literals ('Stop' and the base64 payload)
    // may contribute quote characters — never the path.
    expect((script.match(/'/g) ?? []).length).toBe(4);

    const match = /FromBase64String\('([^']*)'\)/.exec(script);
    expect(match).not.toBeNull();
    const decoded = Buffer.from(match?.[1] ?? '', 'base64').toString('utf8');
    expect(JSON.parse(decoded)).toEqual([{ p: item.path, t: item.timeMs }]);
  });
});

describe('windowsChunks', () => {
  it('splits many long paths into size-bounded chunks, keeping order', () => {
    const items: BirthtimeItem[] = Array.from({ length: 100 }, (_, i) => ({
      path: `C:\\${'p'.repeat(250)}\\file-${i}.txt`,
      timeMs: i,
    }));
    const chunked = windowsChunks(items);
    expect(chunked.length).toBeGreaterThan(1);
    expect(chunked.flat()).toEqual(items);
    for (const chunk of chunked) {
      const bytes = Buffer.byteLength(
        JSON.stringify(chunk.map((it) => ({ p: it.path, t: Math.round(it.timeMs) }))),
        'utf8',
      );
      expect(bytes).toBeLessThanOrEqual(7000);
    }
  });
});
