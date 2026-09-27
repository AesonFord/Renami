import { availableParallelism } from 'node:os';
import { ExifTool } from 'exiftool-vendored';
import { fsMetadata } from '../dates.js';
import type { FileEntry, FileMetadata, Progress } from '../types.js';
import { systemTimeZone } from '../wallclock.js';
import { normalizeTags, type RawTags } from './normalize.js';

export type ExifToolLike = Pick<ExifTool, 'readRaw' | 'end' | 'version' | 'extractBinaryTagToBuffer'>;

/** Embedded JPEGs in a RAW file, largest first. */
export const EMBEDDED_JPEG_TAGS = ['JpgFromRaw', 'PreviewImage', 'ThumbnailImage'] as const;

export interface EmbeddedJpeg {
  data: Buffer;
  /** EXIF orientation (1-8) of the RAW file; the embedded JPEG usually doesn't carry it. */
  orientation: number;
}

/** -n: numeric values; -fast: never read a whole video; QuickTimeUTC=0: leave QuickTime dates as raw UTC. */
export const READ_ARGS = ['-fast', '-n', '-api', 'QuickTimeUTC=0'];

export interface MetadataReaderOptions {
  exiftool?: ExifToolLike;
  /** IANA zone for converting UTC-only dates. Defaults to the system zone. */
  timeZone?: string;
}

export interface ReadAllOptions {
  /** Once aborted, no new files are started. Files already being read still finish. */
  signal?: AbortSignal;
  /** Called with each file's metadata as soon as it is read. */
  onResult?: (path: string, meta: FileMetadata) => void;
}

export class MetadataReader {
  private readonly cache = new Map<string, { key: string; meta: FileMetadata }>();
  private exiftool: ExifToolLike | null;
  private readonly timeZone: string;

  constructor(opts: MetadataReaderOptions = {}) {
    this.exiftool = opts.exiftool ?? null;
    this.timeZone = opts.timeZone ?? systemTimeZone();
  }

  private tool(): ExifToolLike {
    this.exiftool ??= new ExifTool({
      maxProcs: Math.max(1, Math.min(4, availableParallelism() - 1)),
      taskTimeoutMillis: 30_000,
    });
    return this.exiftool;
  }

  async read(entry: FileEntry): Promise<FileMetadata> {
    // Folders have nothing ExifTool could read; folder mode only needs their filesystem dates.
    if (entry.isDir) return fsMetadata(entry, this.timeZone);
    const key = `${entry.size}:${entry.mtimeMs}`;
    const hit = this.cache.get(entry.path);
    if (hit && hit.key === key) return hit.meta;
    const meta = await this.readUncached(entry);
    this.cache.set(entry.path, { key, meta });
    return meta;
  }

  private async readUncached(entry: FileEntry): Promise<FileMetadata> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const raw = (await this.tool().readRaw(entry.path, { readArgs: READ_ARGS })) as RawTags;
        return normalizeTags(raw, entry, this.timeZone);
      } catch (e) {
        lastError = e;
      }
    }
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    return { ...fsMetadata(entry, this.timeZone), readError: message };
  }

  /**
   * Reads every entry, `concurrency` at a time. If a callback throws, no more files start; the
   * files already open finish, and then this rejects with the first error.
   */
  async readAll(
    entries: readonly FileEntry[],
    onProgress?: Progress,
    concurrency = 8,
    opts: ReadAllOptions = {},
  ): Promise<Map<string, FileMetadata>> {
    const result = new Map<string, FileMetadata>();
    let next = 0;
    let done = 0;
    /** Errors thrown by the callbacks. The first one stops every worker from starting another file. */
    const errors: unknown[] = [];
    const worker = async (): Promise<void> => {
      try {
        while (next < entries.length && errors.length === 0 && !opts.signal?.aborted) {
          const entry = entries[next];
          next += 1;
          if (!entry) continue;
          const meta = await this.read(entry);
          result.set(entry.path, meta);
          opts.onResult?.(entry.path, meta);
          done += 1;
          onProgress?.(done, entries.length);
        }
      } catch (e) {
        errors.push(e);
      }
    };
    // Every worker settles before this returns or rejects, so no file is still open afterwards.
    await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker));
    if (errors.length > 0) throw errors[0];
    return result;
  }

  /**
   * The largest JPEG a RAW file carries, for the preview panel, with the RAW file's
   * orientation. Null when it has none.
   */
  async embeddedJpeg(path: string): Promise<EmbeddedJpeg | null> {
    const tool = this.tool();
    for (const tag of EMBEDDED_JPEG_TAGS) {
      try {
        const data = await tool.extractBinaryTagToBuffer(tag, path);
        if (data.length === 0) continue;
        const raw = (await tool.readRaw(path, { readArgs: ['-n', '-Orientation'] }).catch(() => ({}))) as RawTags;
        const o = Number(raw.Orientation);
        return { data, orientation: Number.isInteger(o) && o >= 1 && o <= 8 ? o : 1 };
      } catch {
        // No such tag in this file; try the next one.
      }
    }
    return null;
  }

  async end(): Promise<void> {
    await this.exiftool?.end();
    this.exiftool = null;
  }

  /**
   * Tells a broken ExifTool process apart from files ExifTool simply can't read: a run of
   * `readError`s might mean a crashed/hung ExifTool, or it might just be a run of empty or
   * missing files. Resolves true when the vendored ExifTool responds to `version()`, false when
   * it throws.
   */
  async isWorking(): Promise<boolean> {
    try {
      await this.tool().version();
      return true;
    } catch {
      return false;
    }
  }
}
