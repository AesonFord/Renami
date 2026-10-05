import { fsMetadata } from './dates.js';
import { hashFile } from './hash.js';
import type { MetadataReader } from './metadata/reader.js';
import { parsePattern } from './template/parse.js';
import type { FileEntry, FileMetadata } from './types.js';

/**
 * After this many files in a row fail to read, ExifTool is probed with `isWorking()` to tell a
 * broken process apart from a run of ordinary unreadable files.
 */
export const EXIFTOOL_FAILURE_LIMIT = 5;
/** How many files are hashed at once when the pattern uses {crc32} or {md5}. */
export const HASH_CONCURRENCY = 4;
/** How many files ExifTool reads at once. */
export const READ_CONCURRENCY = 8;

/** Whether the pattern needs file hashes, which are read on demand. */
export function patternUsesHash(pattern: string): boolean {
  const parsed = parsePattern(pattern);
  return parsed.ok && parsed.nodes.some((n) => n.type === 'token' && (n.name === 'crc32' || n.name === 'md5'));
}

export type MetadataSource = Pick<MetadataReader, 'readAll' | 'isWorking'>;

export interface ReadMetadataOptions {
  /** Once aborted, no new files start and results still arriving are ignored. */
  signal?: AbortSignal;
  /** Each file's metadata as soon as it is read. Throwing stops reading. */
  onResult?: (path: string, meta: FileMetadata, state: { exiftoolFailed: boolean }) => void;
}

export interface ReadMetadataResult {
  /** ExifTool stopped answering, so reading stopped early. Files not read keep filesystem dates. */
  exiftoolFailed: boolean;
  /** What onResult threw, when it threw. Reading stopped there. */
  error?: unknown;
}

/**
 * Reads every entry's metadata. A run of read errors might be a broken ExifTool or just a run of
 * unreadable files, so after EXIFTOOL_FAILURE_LIMIT in a row ExifTool is asked whether it still
 * works; if not, reading stops. Resolves only once that probe's verdict is in.
 */
export async function readMetadata(
  entries: readonly FileEntry[],
  reader: MetadataSource,
  opts: ReadMetadataOptions = {},
): Promise<ReadMetadataResult> {
  const stop = new AbortController();
  const signal = opts.signal ? AbortSignal.any([opts.signal, stop.signal]) : stop.signal;
  let failuresInARow = 0;
  let exiftoolFailed = false;
  let probing = false;
  /** The most recent isWorking() probe, if one is (or was) in flight. */
  let probe: Promise<void> | null = null;
  let threw = false;
  let error: unknown;

  const onResult = (p: string, meta: FileMetadata): void => {
    // readAll lets files already open finish after a callback threw; drop their results.
    if (threw || opts.signal?.aborted) return;
    failuresInARow = meta.readError === undefined ? 0 : failuresInARow + 1;
    if (failuresInARow >= EXIFTOOL_FAILURE_LIMIT && !exiftoolFailed && !probing) {
      probing = true;
      probe = reader.isWorking().then((working) => {
        probing = false;
        if (opts.signal?.aborted) return;
        if (working) {
          // Per-file problems, not a broken process. Those files keep their readError.
          failuresInARow = 0;
        } else {
          exiftoolFailed = true;
          stop.abort();
        }
      });
    }
    try {
      opts.onResult?.(p, meta, { exiftoolFailed });
    } catch (e) {
      threw = true;
      error = e;
      throw e;
    }
  };

  try {
    await reader.readAll(entries, undefined, READ_CONCURRENCY, { signal, onResult });
  } catch (e) {
    // Reading a file never throws (it records a readError), so this is onResult's error.
    if (!threw) {
      threw = true;
      error = e;
    }
    stop.abort();
  }
  // readAll can settle while the last streak's probe is still in flight; wait for its verdict.
  if (probe) await probe;
  return threw ? { exiftoolFailed, error } : { exiftoolFailed };
}

interface HashEntry {
  key: string;
  crc32: string;
  md5: string;
}

const sizeKey = (e: FileEntry): string => `${e.size}:${e.mtimeMs}`;

/** File hashes read on demand, by path, checked against size + mtime so an edited file is hashed again. */
export class HashCache {
  private readonly hashes = new Map<string, HashEntry>();

  constructor(private readonly timeZone: string) {}

  get size(): number {
    return this.hashes.size;
  }

  /** Hashes the files that have no current hash, HASH_CONCURRENCY at a time. Skips folders. */
  async hashMissing(entries: readonly FileEntry[], signal?: AbortSignal): Promise<void> {
    const todo = entries.filter((e) => !e.isDir && this.hashes.get(e.path)?.key !== sizeKey(e));
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < todo.length) {
        if (signal?.aborted) return;
        const entry = todo[next];
        next += 1;
        if (!entry) continue;
        try {
          const h = await hashFile(entry.path, signal);
          this.hashes.set(entry.path, { key: sizeKey(entry), ...h });
        } catch {
          // Unreadable, or cancelled: the token renders as a missing value.
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(HASH_CONCURRENCY, todo.length) }, worker));
  }

  /** The file's metadata with its current hashes, or undefined when it has none. */
  withHash(entry: FileEntry, metadata: ReadonlyMap<string, FileMetadata>): FileMetadata | undefined {
    const h = this.hashes.get(entry.path);
    if (!h || h.key !== sizeKey(entry)) return undefined;
    return { ...(metadata.get(entry.path) ?? fsMetadata(entry, this.timeZone)), crc32: h.crc32, md5: h.md5 };
  }

  /** The metadata map with current hashes merged in; the map itself when there are none. */
  mergeInto(metadata: Map<string, FileMetadata>, entries: readonly FileEntry[]): Map<string, FileMetadata> {
    if (this.hashes.size === 0) return metadata;
    const out = new Map(metadata);
    for (const e of entries) {
      const meta = this.withHash(e, metadata);
      if (meta) out.set(e.path, meta);
    }
    return out;
  }
}
