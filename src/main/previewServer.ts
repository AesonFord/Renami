import { createReadStream, type ReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { EmbeddedJpeg } from '../core/index.js';
import { mimeType, pathFromPreviewUrl, previewKind } from '../core/preview.js';

/** Decoded pixels, BGRA (Skia's order, which nativeImage takes), 8 bits per channel. */
export interface Bitmap {
  width: number;
  height: number;
  data: Uint8Array;
}

/** What the preview server turns RAW and HEIC files into: a JPEG the page can show. */
export type ConvertInput = { kind: 'jpeg'; data: Buffer } | { kind: 'bgra'; bitmap: Bitmap };

export interface PreviewServerOptions {
  /** Whether a path is a file in the current batch. Everything else answers 404. */
  allowed(path: string): boolean;
  /** True while a rename or undo runs. Requests then answer 503. */
  busy(): boolean;
  embeddedJpeg(path: string): Promise<EmbeddedJpeg | null>;
  decodeHeic(data: Buffer): Promise<Bitmap>;
  /** Scales to at most MAX_EDGE on the long side and encodes as JPEG. nativeImage in the app. */
  toJpeg(input: ConvertInput): Buffer;
  /** The page's origin (renami-app://app built, the dev server's origin in dev): the only CORS peer. */
  pageOrigin: string;
}

/** Converted images kept in memory, most recently used last. */
export const CACHE_SIZE = 32;
/** How long closeAll waits for conversions still reading a file (a hung ExifTool gets no longer). */
export const CLOSE_WAIT_MS = 5000;

type Range = { start: number; end: number };

/**
 * Parses a single `bytes=` range against a file of `size` bytes. null means serve the whole
 * file (no header, or one this doesn't handle, like several ranges); 'unsatisfiable' is a 416.
 */
export function parseRange(header: string | null, size: number): Range | 'unsatisfiable' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, from, to] = m;
  if (from === '' && to === '') return null;
  if (from === '') {
    // A suffix: the last n bytes.
    const n = Number(to);
    if (n === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(from);
  const end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
  if (start >= size || end < start) return 'unsatisfiable';
  return { start, end };
}

/**
 * Inserts an EXIF block holding just an orientation into a JPEG, right after its start marker,
 * so the page turns the picture the way the camera held it. nativeImage drops EXIF when it encodes.
 */
export function withOrientation(jpeg: Buffer, orientation: number): Buffer {
  if (orientation === 1 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  // Big-endian TIFF header, IFD0 with one entry: 0x0112 Orientation, SHORT, count 1.
  const tiff = Buffer.from([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01,
    0x00, orientation, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const length = payload.length + 2;
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, length >> 8, length & 0xff]), payload]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

/**
 * Answers the page's `renami-file:` requests. Electron-free, so tests run it in Node;
 * the app registers `handle` with protocol.handle.
 */
export class PreviewServer {
  private readonly streams = new Set<ReadStream>();
  /** Conversions still reading their file. */
  private readonly converting = new Set<Promise<unknown>>();
  /** Set by closeAll until resume: a rename or undo is about to run, or running. */
  private paused = false;
  private readonly cache = new Map<string, { key: string; jpeg: Buffer }>();

  constructor(private readonly opts: PreviewServerOptions) {}

  /** On every response. fetch() from the page is cross-origin to this scheme, so it needs CORS. */
  private baseHeaders(): Record<string, string> {
    return {
      'access-control-allow-origin': this.opts.pageOrigin,
      'access-control-expose-headers': 'content-range, content-length',
      'cache-control': 'no-store',
    };
  }

  private text(status: number, body: string): Response {
    return new Response(body, { status, headers: { ...this.baseHeaders(), 'content-type': 'text/plain; charset=utf-8' } });
  }

  async handle(request: Request): Promise<Response> {
    const path = pathFromPreviewUrl(request.url);
    if (path === null || !this.opts.allowed(path)) return this.text(404, 'Not in the batch');
    if (this.stopped()) return this.text(503, 'A rename or undo is running');
    const kind = previewKind(path);
    if (kind === null) return this.text(415, 'No preview for this file');
    let info;
    try {
      info = await stat(path);
    } catch {
      return this.text(404, 'File not found');
    }
    if (!info.isFile()) return this.text(404, 'Not a file');
    // closeAll may have run while stat was waiting; opening the file now would hold it during the batch.
    if (this.stopped()) return this.text(503, 'A rename or undo is running');
    if (kind === 'raw' || kind === 'heic') return this.converted(path, kind, `${info.size}:${info.mtimeMs}`);
    return this.stream(path, info.size, request.headers.get('range'), mimeType(path) ?? 'application/octet-stream');
  }

  /**
   * Called before a rename or undo starts, because Windows won't rename a file that is open:
   * refuses new requests until resume(), closes every file a preview streams, and waits (up to
   * CLOSE_WAIT_MS) for conversions still reading theirs.
   */
  async closeAll(): Promise<void> {
    this.paused = true;
    for (const s of this.streams) s.destroy();
    this.streams.clear();
    if (this.converting.size === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled([...this.converting]),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, CLOSE_WAIT_MS);
      }),
    ]);
    clearTimeout(timer);
  }

  /** Serves requests again after closeAll. */
  resume(): void {
    this.paused = false;
  }

  private stopped(): boolean {
    return this.paused || this.opts.busy();
  }

  /** How many files previews hold open right now. For tests. */
  openCount(): number {
    return this.streams.size;
  }

  private stream(path: string, size: number, rangeHeader: string | null, type: string): Response {
    const range = parseRange(rangeHeader, size);
    if (range === 'unsatisfiable') {
      return new Response(null, { status: 416, headers: { ...this.baseHeaders(), 'content-range': `bytes */${size}` } });
    }
    const { start, end } = range ?? { start: 0, end: size - 1 };
    const headers: Record<string, string> = {
      ...this.baseHeaders(),
      'content-type': type,
      'accept-ranges': 'bytes',
      'content-length': String(size === 0 ? 0 : end - start + 1),
    };
    if (range) headers['content-range'] = `bytes ${start}-${end}/${size}`;
    const status = range ? 206 : 200;
    if (size === 0) return new Response(null, { status: 200, headers });
    const file = createReadStream(path, { start, end });
    this.streams.add(file);
    file.once('close', () => this.streams.delete(file));
    return new Response(Readable.toWeb(file) as ReadableStream<Uint8Array>, { status, headers });
  }

  private async converted(path: string, kind: 'raw' | 'heic', key: string): Promise<Response> {
    let jpeg = this.cached(path, key);
    if (!jpeg) {
      const work = this.convert(path, kind).catch(() => null);
      this.converting.add(work);
      try {
        jpeg = await work;
      } finally {
        this.converting.delete(work);
      }
      if (!jpeg) return this.text(415, "Couldn't convert this file");
      this.remember(path, key, jpeg);
    }
    return new Response(new Uint8Array(jpeg), {
      status: 200,
      headers: { ...this.baseHeaders(), 'content-type': 'image/jpeg', 'content-length': String(jpeg.length) },
    });
  }

  private async convert(path: string, kind: 'raw' | 'heic'): Promise<Buffer | null> {
    if (kind === 'raw') {
      const embedded = await this.opts.embeddedJpeg(path);
      if (!embedded) return null;
      return withOrientation(this.opts.toJpeg({ kind: 'jpeg', data: embedded.data }), embedded.orientation);
    }
    // libheif applies the file's rotation and mirroring as it decodes.
    const bitmap = await this.opts.decodeHeic(await readFile(path));
    return this.opts.toJpeg({ kind: 'bgra', bitmap });
  }

  private cached(path: string, key: string): Buffer | null {
    const hit = this.cache.get(path);
    if (!hit || hit.key !== key) return null;
    // Map keeps insertion order: re-inserting marks it most recently used.
    this.cache.delete(path);
    this.cache.set(path, hit);
    return hit.jpeg;
  }

  private remember(path: string, key: string, jpeg: Buffer): void {
    this.cache.delete(path);
    this.cache.set(path, { key, jpeg });
    while (this.cache.size > CACHE_SIZE) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
