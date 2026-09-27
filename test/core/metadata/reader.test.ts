import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MetadataReader, type ExifToolLike } from '../../../src/core/metadata/reader.js';
import { scan } from '../../../src/core/scanner.js';
import type { FileEntry } from '../../../src/core/types.js';
import { makeEntry, wc } from '../helpers.js';

const MEDIA = path.resolve('test/fixtures/media');
const RAW = path.resolve('test/fixtures/raw');
const reader = new MetadataReader({ timeZone: 'Pacific/Honolulu' });
const byName = new Map<string, FileEntry>();

beforeAll(async () => {
  const { entries } = await scan([MEDIA, RAW], { includeSubfolders: false, extensions: null });
  for (const e of entries) byName.set(path.basename(e.path), e);
});
afterAll(() => reader.end());

const read = (name: string) => {
  const e = byName.get(name);
  if (!e) throw new Error(`missing fixture ${name}; run npm run fixtures`);
  return reader.read(e);
};

describe('MetadataReader: real files', () => {
  it('reads a JPEG', async () => {
    const m = await read('photo.jpg');
    expect(m).toMatchObject({
      dateTaken: wc(2024, 7, 4, 14, 30),
      cameraMake: 'Canon', cameraModel: 'EOS R5', lens: 'RF24-70mm F2.8 L IS USM', iso: 400, focalLength: 35,
    });
    expect(m.gpsLat).toBeCloseTo(21.2766, 4);
    expect(m.gpsLon).toBeCloseTo(-157.8259, 4);
    expect(m.readError).toBeUndefined();
  });

  it('reads a HEIC', async () => {
    expect(await read('photo.heic')).toMatchObject({ dateTaken: wc(2024, 7, 5, 8, 10), cameraModel: 'iPhone 15' });
  });

  it('leaves date taken empty for a photo without EXIF', async () => {
    const m = await read('nodate.jpg');
    expect(m.dateTaken).toBeUndefined();
    expect(m.readError).toBeUndefined();
  });

  it.each(['clip.mp4', 'clip.m4v'])('converts the UTC date of %s into the reader zone', async (name) => {
    expect((await read(name)).dateTaken).toEqual(wc(2024, 7, 5, 13, 15, 2));
  });

  it('keeps the wall clock of a MOV CreationDate with offset', async () => {
    expect((await read('live.mov')).dateTaken).toEqual(wc(2024, 7, 4, 18, 42));
  });

  it.each(['song.mp3', 'song.m4a', 'book.m4b'])('reads audio tags from %s', async (name) => {
    const m = await read(name);
    expect(m).toMatchObject({
      artist: 'Test Artist', albumArtist: 'Test Band', album: 'Test Album', title: 'Test Title',
      genre: 'Hawaiian', track: 3, disc: 1, year: 1993,
    });
    expect(m.dateTaken).toBeUndefined();
    expect(m.durationSeconds).toBeGreaterThan(0.5);
  });

  it('reads FLAC tags', async () => {
    expect(await read('song.flac')).toMatchObject({ artist: 'Test Artist', album: 'Test Album', title: 'Test Title', track: 3 });
  });

  it('reads a file with no metadata without an error', async () => {
    const m = await read('notes.txt');
    expect(m.readError).toBeUndefined();
    expect(m.modified.year).toBeGreaterThan(2000);
  });

  it.skipIf(!existsSync(path.join(RAW, 'sample.nef')))('reads a NEF', async () => {
    const m = await read('sample.nef');
    expect(m.dateTaken).toBeDefined();
    expect(m.cameraMake).toMatch(/nikon/i);
  });

  it.skipIf(!existsSync(path.join(RAW, 'sample.cr3')))('reads a CR3', async () => {
    const m = await read('sample.cr3');
    expect(m.dateTaken).toBeDefined();
    expect(m.cameraMake).toMatch(/canon/i);
  });
});

describe('MetadataReader: caching and failures', () => {
  const entry = makeEntry('/x/a.jpg', { mtimeMs: Date.UTC(2024, 7, 1), birthtimeMs: null });
  const fake = (impl: () => Promise<Record<string, unknown>>) => {
    const tool = { readRaw: vi.fn(impl), end: vi.fn(async () => {}) };
    return { tool, reader: new MetadataReader({ exiftool: tool as unknown as ExifToolLike, timeZone: 'UTC' }) };
  };

  it('caches by path, size and mtime', async () => {
    const { tool, reader: r } = fake(async () => ({ Make: 'Canon' }));
    await r.read(entry);
    await r.read(entry);
    expect(tool.readRaw).toHaveBeenCalledTimes(1);
    await r.read({ ...entry, mtimeMs: entry.mtimeMs + 1000 });
    expect(tool.readRaw).toHaveBeenCalledTimes(2);
  });

  it('retries once, then falls back to filesystem dates with an error', async () => {
    const { tool, reader: r } = fake(async () => {
      throw new Error('exiftool crashed');
    });
    const m = await r.read(entry);
    expect(tool.readRaw).toHaveBeenCalledTimes(2);
    expect(m).toEqual({ modified: wc(2024, 8, 1), readError: 'exiftool crashed' });
  });

  it('succeeds on the retry', async () => {
    let calls = 0;
    const { reader: r } = fake(async () => {
      calls += 1;
      if (calls === 1) throw new Error('flaky');
      return { Make: 'Canon' };
    });
    expect((await r.read(entry)).cameraMake).toBe('Canon');
  });

  it('reads many files with progress', async () => {
    const { reader: r } = fake(async () => ({}));
    const entries = [1, 2, 3].map((n) => makeEntry(`/x/${n}.jpg`));
    const progress: number[] = [];
    const result = await r.readAll(entries, (done) => progress.push(done), 2);
    expect([...result.keys()].sort()).toEqual(['/x/1.jpg', '/x/2.jpg', '/x/3.jpg']);
    expect(progress).toEqual([1, 2, 3]);
  });

  it('reports each result as soon as it is read', async () => {
    const { reader: r } = fake(async () => ({ Make: 'Canon' }));
    const entries = [1, 2].map((n) => makeEntry(`/x/${n}.jpg`));
    const seen: string[] = [];
    await r.readAll(entries, undefined, 1, { onResult: (p, meta) => seen.push(`${p}:${meta.cameraMake}`) });
    expect(seen).toEqual(['/x/1.jpg:Canon', '/x/2.jpg:Canon']);
  });

  it('stops handing out files once the signal is aborted', async () => {
    const controller = new AbortController();
    const { tool, reader: r } = fake(async () => {
      controller.abort();
      return {};
    });
    const entries = [1, 2, 3].map((n) => makeEntry(`/x/${n}.jpg`));
    const result = await r.readAll(entries, undefined, 1, { signal: controller.signal });
    expect([...result.keys()]).toEqual(['/x/1.jpg']);
    expect(tool.readRaw).toHaveBeenCalledTimes(1);
  });

  it('lets the reads already started finish after an abort, and starts no more', async () => {
    const controller = new AbortController();
    let open = (): void => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    let started = 0;
    let markAllStarted = (): void => {};
    const allStarted = new Promise<void>((resolve) => {
      markAllStarted = resolve;
    });
    const { tool, reader: r } = fake(async () => {
      started += 1;
      if (started === 4) markAllStarted();
      await gate;
      return {};
    });
    const entries = [1, 2, 3, 4, 5, 6].map((n) => makeEntry(`/x/${n}.jpg`));
    const seen: string[] = [];

    const reading = r.readAll(entries, undefined, 4, { signal: controller.signal, onResult: (p) => seen.push(p) });
    await allStarted;
    controller.abort();
    open();
    await reading;

    expect(seen.sort()).toEqual(['/x/1.jpg', '/x/2.jpg', '/x/3.jpg', '/x/4.jpg']);
    expect(tool.readRaw).toHaveBeenCalledTimes(4);
  });

  it('waits for the reads still open before rejecting with the first error from onResult, and starts no more', async () => {
    let open = (): void => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    let calls = 0;
    // The first read answers at once; the next three are held open.
    const { tool, reader: r } = fake(async () => {
      calls += 1;
      if (calls > 1) await gate;
      return {};
    });
    const entries = [1, 2, 3, 4, 5, 6].map((n) => makeEntry(`/x/${n}.jpg`));
    const seen: string[] = [];
    let settled = false;

    const reading = r.readAll(entries, undefined, 4, {
      onResult: (p) => {
        seen.push(p);
        if (seen.length === 1) throw new Error('handling the result failed');
      },
    });
    reading.then(
      () => (settled = true),
      () => (settled = true),
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(seen).toEqual(['/x/1.jpg']);
    expect(settled).toBe(false);

    open();
    await expect(reading).rejects.toThrow('handling the result failed');
    expect(seen.sort()).toEqual(['/x/1.jpg', '/x/2.jpg', '/x/3.jpg', '/x/4.jpg']);
    expect(tool.readRaw).toHaveBeenCalledTimes(4);
  });
});

describe('MetadataReader: folders', () => {
  it('answers with filesystem dates for a folder without asking ExifTool', async () => {
    const readRaw = vi.fn(async () => {
      throw new Error('must not be called');
    });
    const exiftool = { readRaw, end: async () => {}, version: async () => '12.0' } as unknown as ExifToolLike;
    const r = new MetadataReader({ exiftool, timeZone: 'UTC' });
    const entry = makeEntry(MEDIA, { isDir: true, stem: 'media', ext: '', mtimeMs: Date.UTC(2024, 0, 2, 3, 4, 5), birthtimeMs: null });
    expect(await r.read(entry)).toEqual({ modified: wc(2024, 1, 2, 3, 4, 5) });
    expect(readRaw).not.toHaveBeenCalled();
  });
});

describe('MetadataReader.isWorking', () => {
  it('is true when the ExifTool process responds to version()', async () => {
    const tool = { readRaw: vi.fn(), end: vi.fn(async () => {}), version: vi.fn(async () => '12.0') };
    const r = new MetadataReader({ exiftool: tool as unknown as ExifToolLike, timeZone: 'UTC' });
    expect(await r.isWorking()).toBe(true);
  });

  it('is false when version() rejects', async () => {
    const tool = {
      readRaw: vi.fn(),
      end: vi.fn(async () => {}),
      version: vi.fn(async () => {
        throw new Error('process died');
      }),
    };
    const r = new MetadataReader({ exiftool: tool as unknown as ExifToolLike, timeZone: 'UTC' });
    expect(await r.isWorking()).toBe(false);
  });
});

describe('embeddedJpeg', () => {
  const tool = (tags: Record<string, Buffer>, orientation?: unknown) =>
    ({
      readRaw: vi.fn(async () => (orientation === undefined ? {} : { Orientation: orientation })),
      end: async () => {},
      version: async () => '12.0',
      extractBinaryTagToBuffer: vi.fn(async (tag: string) => {
        const data = tags[tag];
        if (!data) throw new Error(`no ${tag}`);
        return data;
      }),
    }) as unknown as ExifToolLike;

  it('takes the largest JPEG the RAW file carries, with its orientation', async () => {
    const r = new MetadataReader({ exiftool: tool({ PreviewImage: Buffer.from('preview'), ThumbnailImage: Buffer.from('thumb') }, 6) });
    expect(await r.embeddedJpeg('/a.nef')).toEqual({ data: Buffer.from('preview'), orientation: 6 });
  });

  it('skips empty tags and treats a missing or odd orientation as upright', async () => {
    const r = new MetadataReader({ exiftool: tool({ JpgFromRaw: Buffer.alloc(0), ThumbnailImage: Buffer.from('thumb') }, 'Rotate 90 CW') });
    expect(await r.embeddedJpeg('/a.nef')).toEqual({ data: Buffer.from('thumb'), orientation: 1 });
  });

  it('returns null when there is no embedded JPEG', async () => {
    const r = new MetadataReader({ exiftool: tool({}) });
    expect(await r.embeddedJpeg('/a.nef')).toBeNull();
  });
});
