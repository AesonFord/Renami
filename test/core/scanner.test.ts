import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localDateString, nameMatcher, passesFilters, scan } from '../../src/core/scanner.js';

let root = '';
const rel = (p: string) => path.relative(root, p).split(path.sep).join('/');

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'renami-scan-'));
  const file = (p: string, content = 'x') => writeFileSync(path.join(root, p), content);
  mkdirSync(path.join(root, 'sub', 'deeper'), { recursive: true });
  file('a.jpg', 'hello');
  file('B.HEIC');
  file('README');
  file('.hidden.jpg');
  file('.DS_Store');
  file('Thumbs.db');
  file('sub/c.jpg');
  file('sub/deeper/d.png');
  mkdirSync(path.join(root, '.hidden'));
  mkdirSync(path.join(root, 'Trip 2024'));
  file('big.bin', 'x'.repeat(5000));
  utimesSync(path.join(root, 'B.HEIC'), new Date(2020, 0, 15, 12), new Date(2020, 0, 15, 12));
  try {
    symlinkSync(path.join(root, 'a.jpg'), path.join(root, 'link.jpg'));
    symlinkSync(path.join(root, 'sub'), path.join(root, 'linkdir'), 'dir');
  } catch {
    // Creating symlinks needs extra rights on Windows; the symlink assertions still hold without them.
  }
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('scan', () => {
  it('lists visible files in the folder, skipping hidden, system and symlinked entries', async () => {
    const r = await scan([root], { includeSubfolders: false, extensions: null });
    expect(r.entries.map((e) => rel(e.path))).toEqual(['a.jpg', 'B.HEIC', 'big.bin', 'README']);
  });

  it('includes subfolders when asked, without following symlinked folders', async () => {
    const r = await scan([root], { includeSubfolders: true, extensions: null });
    expect(r.entries.map((e) => rel(e.path))).toEqual([
      'a.jpg',
      'B.HEIC',
      'big.bin',
      'README',
      'sub/c.jpg',
      'sub/deeper/d.png',
    ]);
  });

  it('filters by extension but reports every extension found', async () => {
    const r = await scan([root], { includeSubfolders: true, extensions: ['jpg', ''] });
    expect(r.entries.map((e) => rel(e.path))).toEqual(['a.jpg', 'README', 'sub/c.jpg']);
    expect(r.extensionsFound).toEqual(['', 'bin', 'heic', 'jpg', 'png']);
  });

  it('lists a file once even when dropped directly and through its folder', async () => {
    const r = await scan([root, path.join(root, 'a.jpg')], { includeSubfolders: false, extensions: null });
    expect(r.entries.filter((e) => rel(e.path) === 'a.jpg')).toHaveLength(1);
  });

  it('fills in entry fields and ignores paths that no longer exist', async () => {
    const r = await scan([path.join(root, 'a.jpg'), path.join(root, 'gone.jpg')], { includeSubfolders: false, extensions: null });
    expect(r.entries).toHaveLength(1);
    const e = r.entries[0]!;
    expect({ dir: e.dir, stem: e.stem, ext: e.ext, size: e.size }).toEqual({ dir: root, stem: 'a', ext: 'jpg', size: 5 });
    expect(e.mtimeMs).toBeGreaterThan(0);
    expect(typeof e.dev).toBe('number');
  });

  it('reports progress', async () => {
    const calls: [number, number][] = [];
    await scan([root], { includeSubfolders: false, extensions: null }, (done, total) => calls.push([done, total]));
    expect(calls.at(-1)).toEqual([4, 4]);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'skips folders it cannot read and reports them',
    async () => {
      const tempRoot = mkdtempSync(path.join(tmpdir(), 'renami-scan-unreadable-'));
      try {
        const file = (p: string, content = 'x') => writeFileSync(path.join(tempRoot, p), content);
        const locked = path.join(tempRoot, 'locked');
        mkdirSync(locked);
        file('locked/e.jpg');
        file('readable.txt');

        chmodSync(locked, 0o000);
        try {
          const r = await scan([tempRoot], { includeSubfolders: true, extensions: null });
          expect(r.entries.map((e) => path.relative(tempRoot, e.path).split(path.sep).join('/'))).toEqual([
            'readable.txt',
          ]);
          expect(r.unreadableFolders).toEqual([locked]);
        } finally {
          chmodSync(locked, 0o755);
        }
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    },
  );
});

describe('scan: name, size and date filters', () => {
  const all = { includeSubfolders: false, extensions: null };
  it('filters by a plain, case-insensitive name match', async () => {
    const r = await scan([root], { ...all, name: { text: 'heic', regex: false } });
    expect(r.entries.map((e) => rel(e.path))).toEqual(['B.HEIC']);
  });
  it('filters by a regex, and treats an invalid regex as plain text', async () => {
    const r = await scan([root], { ...all, name: { text: '^[ab]\\.', regex: true } });
    expect(r.entries.map((e) => rel(e.path))).toEqual(['a.jpg', 'B.HEIC']);
    const bad = await scan([root], { ...all, name: { text: '(', regex: true } });
    expect(bad.entries).toEqual([]);
  });
  it('filters by size', async () => {
    const r = await scan([root], { ...all, minBytes: 1000 });
    expect(r.entries.map((e) => rel(e.path))).toEqual(['big.bin']);
    const small = await scan([root], { ...all, maxBytes: 4 });
    expect(small.entries.map((e) => rel(e.path))).toEqual(['B.HEIC', 'README']);
  });
  it('filters by modified date, inclusive, in local time', async () => {
    const r = await scan([root], { ...all, modifiedFrom: '2020-01-15', modifiedTo: '2020-01-15' });
    expect(r.entries.map((e) => rel(e.path))).toEqual(['B.HEIC']);
    const later = await scan([root], { ...all, modifiedFrom: '2020-01-16' });
    expect(later.entries.map((e) => rel(e.path))).not.toContain('B.HEIC');
  });
  it('still reports every extension found before filtering', async () => {
    const r = await scan([root], { ...all, name: { text: 'zzz', regex: false } });
    expect(r.entries).toEqual([]);
    expect(r.extensionsFound).toEqual(['', 'bin', 'heic', 'jpg']);
  });
});

describe('scan: folder mode', () => {
  it('lists the folders directly inside each dropped folder, never nested ones', async () => {
    const r = await scan([root], { includeSubfolders: true, extensions: ['jpg'], mode: 'folders' });
    expect(r.entries.map((e) => rel(e.path))).toEqual(['sub', 'Trip 2024']);
    expect(r.entries.map((e) => [e.isDir, e.stem, e.ext])).toEqual([[true, 'sub', ''], [true, 'Trip 2024', '']]);
    expect(r.extensionsFound).toEqual([]);
  });
  it('ignores dropped files and applies the name filter to folder names', async () => {
    const r = await scan([root, path.join(root, 'a.jpg')], { includeSubfolders: false, extensions: null, mode: 'folders', name: { text: 'trip', regex: false } });
    expect(r.entries.map((e) => rel(e.path))).toEqual(['Trip 2024']);
  });
});

describe('filter helpers', () => {
  it('nameMatcher matches everything for an empty filter', () => {
    expect(nameMatcher(undefined)('x')).toBe(true);
    expect(nameMatcher({ text: '', regex: true })('x')).toBe(true);
  });
  it('localDateString uses the local calendar date', () => {
    expect(localDateString(new Date(2024, 6, 4, 23, 59).getTime())).toBe('2024-07-04');
  });
  it('passesFilters skips size limits for folders', () => {
    const dir = { path: '/p/d', dir: '/p', stem: 'd', ext: '', size: 0, mtimeMs: 0, birthtimeMs: null, dev: 1, isDir: true };
    expect(passesFilters(dir, { includeSubfolders: false, extensions: null, minBytes: 100 })).toBe(true);
    expect(passesFilters({ ...dir, isDir: false }, { includeSubfolders: false, extensions: null, minBytes: 100 })).toBe(false);
  });
});
