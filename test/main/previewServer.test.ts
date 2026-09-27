import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewUrl } from '../../src/core/preview.js';
import {
  CACHE_SIZE,
  parseRange,
  PreviewServer,
  withOrientation,
  type PreviewServerOptions,
} from '../../src/main/previewServer.js';

const MEDIA = path.resolve('test/fixtures/media');

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tempDir(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'renami-preview-'));
  dirs.push(d);
  return d;
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

function server(allowed: string[], extra: Partial<PreviewServerOptions> = {}) {
  const opts: PreviewServerOptions = {
    allowed: (p) => allowed.includes(p),
    busy: () => false,
    embeddedJpeg: vi.fn(async () => ({ data: JPEG, orientation: 1 })),
    decodeHeic: vi.fn(async () => ({ width: 1, height: 1, data: new Uint8Array([1, 2, 3, 4]) })),
    toJpeg: vi.fn(() => JPEG),
    pageOrigin: 'renami-app://app',
    ...extra,
  };
  return { s: new PreviewServer(opts), opts };
}

const get = (s: PreviewServer, p: string, headers: Record<string, string> = {}) =>
  s.handle(new Request(previewUrl(p), { headers }));

describe('parseRange', () => {
  it('reads a start-end, an open-ended and a suffix range', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange('bytes=0-5000', 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 });
  });

  it('serves the whole file for no header or one it does not handle', () => {
    expect(parseRange(null, 10)).toBeNull();
    expect(parseRange('bytes=0-1,5-6', 10)).toBeNull();
    expect(parseRange('items=0-1', 10)).toBeNull();
    expect(parseRange('bytes=-', 10)).toBeNull();
  });

  it('refuses ranges outside the file', () => {
    expect(parseRange('bytes=10-', 10)).toBe('unsatisfiable');
    expect(parseRange('bytes=5-2', 10)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 10)).toBe('unsatisfiable');
  });
});

describe('withOrientation', () => {
  it('inserts an EXIF block holding the orientation right after the start marker', () => {
    const out = withOrientation(JPEG, 6);
    expect(out.subarray(0, 4)).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xe1]));
    const length = out.readUInt16BE(4);
    expect(out.subarray(6, 12).toString('latin1')).toBe('Exif\0\0');
    const tiff = out.subarray(12, 4 + length);
    expect(tiff.readUInt16BE(10)).toBe(0x0112);
    expect(tiff.readUInt16BE(18)).toBe(6);
    expect(out.subarray(4 + length)).toEqual(JPEG.subarray(2));
  });

  it('leaves upright pictures and non-JPEG data alone', () => {
    expect(withOrientation(JPEG, 1)).toBe(JPEG);
    const png = Buffer.from([0x89, 0x50]);
    expect(withOrientation(png, 6)).toBe(png);
  });
});

describe('PreviewServer', () => {
  it('answers CORS only for the page origin it was given', async () => {
    const { s } = server([]);
    const res = await s.handle(new Request('renami-file:///nope'));
    expect(res.headers.get('access-control-allow-origin')).toBe('renami-app://app');
    const { s: dev } = server([], { pageOrigin: 'http://localhost:5173' });
    const devRes = await dev.handle(new Request('renami-file:///nope'));
    expect(devRes.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('serves only files in the batch', async () => {
    const dir = tempDir();
    const inside = path.join(dir, 'a.jpg');
    const outside = path.join(dir, 'b.jpg');
    copyFileSync(path.join(MEDIA, 'photo.jpg'), inside);
    copyFileSync(path.join(MEDIA, 'photo.jpg'), outside);
    const { s } = server([inside]);
    expect((await get(s, outside)).status).toBe(404);
    expect((await s.handle(new Request('renami-file://preview/'))).status).toBe(404);
    const ok = await get(s, inside);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/jpeg');
    expect(ok.headers.get('access-control-allow-origin')).toBe('renami-app://app');
    expect(Buffer.from(await ok.arrayBuffer())).toEqual(readFileSync(inside));
  });

  it('answers 503 while a rename or undo runs, 404 for a file gone since the scan, 415 for no preview', async () => {
    const dir = tempDir();
    const photo = path.join(dir, 'a.jpg');
    const text = path.join(dir, 'a.txt');
    copyFileSync(path.join(MEDIA, 'photo.jpg'), photo);
    writeFileSync(text, 'hi');
    let busy = true;
    const { s } = server([photo, text, path.join(dir, 'gone.jpg')], { busy: () => busy });
    expect((await get(s, photo)).status).toBe(503);
    busy = false;
    expect((await get(s, path.join(dir, 'gone.jpg'))).status).toBe(404);
    expect((await get(s, text)).status).toBe(415);
  });

  it('answers a range with 206 and just those bytes, and an impossible one with 416', async () => {
    const dir = tempDir();
    const clip = path.join(dir, 'clip.mp4');
    writeFileSync(clip, Buffer.from('0123456789'));
    const { s } = server([clip]);
    const part = await get(s, clip, { range: 'bytes=2-5' });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(part.headers.get('content-length')).toBe('4');
    expect(await part.text()).toBe('2345');
    const bad = await get(s, clip, { range: 'bytes=20-' });
    expect(bad.status).toBe(416);
    expect(bad.headers.get('content-range')).toBe('bytes */10');
  });

  it('closeAll closes files a preview still holds open', async () => {
    const dir = tempDir();
    const clip = path.join(dir, 'clip.mp4');
    writeFileSync(clip, Buffer.alloc(1024 * 1024));
    const { s } = server([clip]);
    const res = await get(s, clip);
    expect(s.openCount()).toBe(1);
    await s.closeAll();
    expect(s.openCount()).toBe(0);
    await expect(res.arrayBuffer()).rejects.toThrow();
  });

  it('refuses requests from closeAll until resume, including one that was already checking the file', async () => {
    const dir = tempDir();
    const clip = path.join(dir, 'clip.mp4');
    writeFileSync(clip, Buffer.from('abc'));
    const { s } = server([clip]);
    // The request is waiting on stat when closeAll runs; it must not open the file afterwards.
    const racing = get(s, clip);
    await s.closeAll();
    expect((await racing).status).toBe(503);
    expect(s.openCount()).toBe(0);
    expect((await get(s, clip)).status).toBe(503);
    s.resume();
    expect((await get(s, clip)).status).toBe(200);
  });

  it('closeAll waits for a conversion still reading its file', async () => {
    const dir = tempDir();
    const raw = path.join(dir, 'a.nef');
    writeFileSync(raw, 'raw');
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let started!: () => void;
    const running = new Promise<void>((r) => (started = r));
    const { s } = server([raw], {
      embeddedJpeg: vi.fn(async () => {
        started();
        await held;
        return { data: JPEG, orientation: 1 };
      }),
    });
    const request = get(s, raw);
    await running;
    let closed = false;
    const closing = s.closeAll().then(() => (closed = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(closed).toBe(false);
    release();
    await closing;
    expect((await request).status).toBe(200);
  });

  it('a finished download lets go of its file', async () => {
    const dir = tempDir();
    const clip = path.join(dir, 'clip.mp4');
    writeFileSync(clip, Buffer.from('abc'));
    const { s } = server([clip]);
    await (await get(s, clip)).arrayBuffer();
    await vi.waitFor(() => expect(s.openCount()).toBe(0));
  });

  it("turns a RAW file's embedded JPEG upright, and remembers the result", async () => {
    const dir = tempDir();
    const raw = path.join(dir, 'a.nef');
    writeFileSync(raw, 'raw');
    const embedded = Buffer.from([0xff, 0xd8, 1, 2]);
    const { s, opts } = server([raw], { embeddedJpeg: vi.fn(async () => ({ data: embedded, orientation: 8 })) });
    const res = await get(s, raw);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    const body = Buffer.from(await res.arrayBuffer());
    expect(body.subarray(2, 4)).toEqual(Buffer.from([0xff, 0xe1]));
    expect(opts.toJpeg).toHaveBeenCalledWith({ kind: 'jpeg', data: embedded });
    await get(s, raw);
    expect(opts.embeddedJpeg).toHaveBeenCalledTimes(1);
  });

  it('converts again once the file changes', async () => {
    const dir = tempDir();
    const raw = path.join(dir, 'a.nef');
    writeFileSync(raw, 'raw');
    const { s, opts } = server([raw]);
    await get(s, raw);
    writeFileSync(raw, 'a longer raw');
    await get(s, raw);
    expect(opts.embeddedJpeg).toHaveBeenCalledTimes(2);
  });

  it('decodes HEIC files and hands the pixels to the encoder', async () => {
    const dir = tempDir();
    const heic = path.join(dir, 'a.heic');
    copyFileSync(path.join(MEDIA, 'photo.heic'), heic);
    const { s, opts } = server([heic]);
    expect((await get(s, heic)).status).toBe(200);
    expect(opts.decodeHeic).toHaveBeenCalledOnce();
    expect(opts.toJpeg).toHaveBeenCalledWith({ kind: 'bgra', bitmap: { width: 1, height: 1, data: new Uint8Array([1, 2, 3, 4]) } });
  });

  it('answers 415 when a file cannot be converted, and tries again next time', async () => {
    const dir = tempDir();
    const raw = path.join(dir, 'a.nef');
    const heic = path.join(dir, 'a.heic');
    writeFileSync(raw, 'raw');
    writeFileSync(heic, 'not really');
    const { s, opts } = server([raw, heic], {
      embeddedJpeg: vi.fn(async () => null),
      decodeHeic: vi.fn(async () => {
        throw new Error('bad file');
      }),
    });
    expect((await get(s, raw)).status).toBe(415);
    expect((await get(s, heic)).status).toBe(415);
    await get(s, raw);
    expect(opts.embeddedJpeg).toHaveBeenCalledTimes(2);
  });

  it(`keeps at most ${CACHE_SIZE} converted images, dropping the least recently used`, async () => {
    const dir = tempDir();
    const files = Array.from({ length: CACHE_SIZE + 1 }, (_, i) => path.join(dir, `${i}.nef`));
    for (const f of files) writeFileSync(f, 'raw');
    const { s, opts } = server(files);
    for (const f of files.slice(0, CACHE_SIZE)) await get(s, f);
    await get(s, files[0]!); // now the most recently used
    await get(s, files[CACHE_SIZE]!); // pushes out files[1]
    const calls = vi.mocked(opts.embeddedJpeg).mock.calls.length;
    await get(s, files[0]!);
    expect(vi.mocked(opts.embeddedJpeg).mock.calls.length).toBe(calls);
    await get(s, files[1]!);
    expect(vi.mocked(opts.embeddedJpeg).mock.calls.length).toBe(calls + 1);
  });
});
