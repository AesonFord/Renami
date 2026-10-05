import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  HashCache,
  MetadataReader,
  patternUsesHash,
  readMetadata,
  scan,
  type ExifToolLike,
  type FileEntry,
  type FileMetadata,
} from '../../src/core/index.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'renami-pipeline-'));
  dirs.push(d);
  return d;
}

/** Scans a fresh folder holding these files; the scanner returns them sorted by name. */
async function filesIn(names: string[], content = 'x'): Promise<{ dir: string; entries: FileEntry[] }> {
  const dir = tempDir();
  for (const n of names) writeFileSync(path.join(dir, n), content);
  const { entries } = await scan([dir], { includeSubfolders: false, extensions: null });
  return { dir, entries };
}

function fakeReader(
  readRaw: (file: string) => Promise<object>,
  version: () => Promise<string> = async () => '12.0',
): MetadataReader {
  const exiftool = { readRaw, end: async () => {}, version } as unknown as ExifToolLike;
  return new MetadataReader({ exiftool, timeZone: 'UTC' });
}

describe('readMetadata', () => {
  it('reads every file and reports each result as it arrives', async () => {
    const { entries } = await filesIn(['a.jpg', 'b.jpg', 'c.jpg']);
    const seen: string[] = [];
    const result = await readMetadata(entries, fakeReader(async () => ({})), {
      onResult: (p) => seen.push(path.basename(p)),
    });
    expect(result).toEqual({ exiftoolFailed: false });
    expect(seen.sort()).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  });

  it('keeps reading through per-file failures when ExifTool itself still answers', async () => {
    const names = Array.from({ length: 12 }, (_, i) => `f${String(i).padStart(2, '0')}.jpg`);
    const { entries } = await filesIn(names);
    const seen: FileMetadata[] = [];
    const reader = fakeReader(async () => {
      throw new Error('cannot read this file');
    });
    const result = await readMetadata(entries, reader, { onResult: (_p, meta) => seen.push(meta) });
    expect(result.exiftoolFailed).toBe(false);
    expect(seen).toHaveLength(12);
    expect(seen.every((m) => m.readError !== undefined)).toBe(true);
  });

  it('reports a broken ExifTool, waiting for a slow probe at the end of the batch', async () => {
    const good = Array.from({ length: 4 }, (_, i) => `a_good${i}.jpg`);
    const bad = Array.from({ length: 8 }, (_, i) => `z_bad${i}.jpg`);
    const { entries } = await filesIn([...good, ...bad]);
    const reader = fakeReader(
      async (file) => {
        if (path.basename(file).startsWith('z_bad')) throw new Error('cannot read this file');
        return {};
      },
      async () => {
        // Settles after every read has finished, so readAll drains before the verdict is in.
        await new Promise((resolve) => setTimeout(resolve, 20));
        throw new Error('exiftool died');
      },
    );
    expect(await readMetadata(entries, reader)).toEqual({ exiftoolFailed: true });
  });

  it('returns what onResult threw, stops, and ignores the results still arriving', async () => {
    const { entries } = await filesIn(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']);
    const boom = new Error('boom');
    let calls = 0;
    const result = await readMetadata(entries, fakeReader(async () => ({})), {
      onResult: () => {
        calls += 1;
        if (calls === 2) throw boom;
      },
    });
    expect(result).toEqual({ exiftoolFailed: false, error: boom });
    expect(calls).toBe(2);
  });

  it("ignores results once the caller's signal aborts", async () => {
    const { entries } = await filesIn(['a.jpg', 'b.jpg', 'c.jpg']);
    const controller = new AbortController();
    let calls = 0;
    const result = await readMetadata(entries, fakeReader(async () => ({})), {
      signal: controller.signal,
      onResult: () => {
        calls += 1;
        controller.abort();
      },
    });
    expect(result.exiftoolFailed).toBe(false);
    expect(calls).toBe(1);
  });
});

describe('patternUsesHash', () => {
  it('is true only for patterns with {crc32} or {md5}', () => {
    expect(patternUsesHash('{crc32}')).toBe(true);
    expect(patternUsesHash('{name}_{md5}')).toBe(true);
    expect(patternUsesHash('{name}')).toBe(false);
    expect(patternUsesHash('{')).toBe(false);
  });
});

describe('HashCache', () => {
  it('hashes files on demand and merges the hashes into the metadata', async () => {
    const { entries } = await filesIn(['a.txt'], 'abc');
    const cache = new HashCache('UTC');
    const metadata = new Map<string, FileMetadata>();
    expect(cache.mergeInto(metadata, entries)).toBe(metadata);

    await cache.hashMissing(entries);
    expect(cache.size).toBe(1);
    const merged = cache.mergeInto(metadata, entries);
    expect(merged).not.toBe(metadata);
    expect(merged.get(entries[0]!.path)).toMatchObject({ crc32: '352441c2', md5: '900150983cd24fb0d6963f7d28e17f72' });
  });

  it('does not use a hash once the file changed size or time', async () => {
    const { entries } = await filesIn(['a.txt'], 'abc');
    const cache = new HashCache('UTC');
    await cache.hashMissing(entries);
    const edited = { ...entries[0]!, size: 99 };
    expect(cache.withHash(edited, new Map())).toBeUndefined();
  });

  it('skips folders and files it cannot read, without throwing', async () => {
    const { dir, entries } = await filesIn(['gone.txt']);
    unlinkSync(path.join(dir, 'gone.txt'));
    mkdirSync(path.join(dir, 'sub'));
    const folder = { ...entries[0]!, path: path.join(dir, 'sub'), isDir: true };
    const cache = new HashCache('UTC');
    await cache.hashMissing([...entries, folder]);
    expect(cache.size).toBe(0);
  });
});
