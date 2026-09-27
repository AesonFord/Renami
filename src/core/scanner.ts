import { lstat, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { naturalCompare, splitName } from './names.js';
import type { FileEntry, NameFilter, Progress, ScanOptions } from './types.js';

export interface ScanResult {
  entries: FileEntry[];
  /** Every extension found before filtering, lowercase, sorted. Empty in folder mode. */
  extensionsFound: string[];
  /** Folders that could not be read and were skipped. */
  unreadableFolders: string[];
}

const STAT_CONCURRENCY = 32;
const SYSTEM_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
const isSkipped = (name: string): boolean => name.startsWith('.') || SYSTEM_FILES.has(name.toLowerCase());
const extOf = (file: string): string => splitName(path.basename(file)).ext.toLowerCase();
const pad = (n: number): string => String(n).padStart(2, '0');

/** The calendar date of an instant in the computer's time zone, as the modified-date filter compares it. */
export function localDateString(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A predicate for the name filter. An empty filter matches everything; a bad regex is plain text. */
export function nameMatcher(filter: NameFilter | undefined): (name: string) => boolean {
  if (!filter || filter.text === '') return () => true;
  if (filter.regex) {
    try {
      const re = new RegExp(filter.text, 'i');
      return (name) => re.test(name);
    } catch {
      // Not a regex after all: match it as text below.
    }
  }
  const needle = filter.text.toLowerCase();
  return (name) => name.toLowerCase().includes(needle);
}

/** The size and date filters, which need a stat. Folders have no meaningful size. */
export function passesFilters(entry: FileEntry, opts: ScanOptions): boolean {
  if (!entry.isDir) {
    if (opts.minBytes != null && entry.size < opts.minBytes) return false;
    if (opts.maxBytes != null && entry.size > opts.maxBytes) return false;
  }
  if (opts.modifiedFrom || opts.modifiedTo) {
    const day = localDateString(entry.mtimeMs);
    if (opts.modifiedFrom && day < opts.modifiedFrom) return false;
    if (opts.modifiedTo && day > opts.modifiedTo) return false;
  }
  return true;
}

async function toEntry(filePath: string, isDir: boolean): Promise<FileEntry> {
  const st = await stat(filePath);
  const base = path.basename(filePath);
  const { stem, ext } = isDir ? { stem: base, ext: '' } : splitName(base);
  return {
    path: filePath,
    dir: path.dirname(filePath),
    stem,
    ext,
    size: st.size,
    mtimeMs: st.mtimeMs,
    birthtimeMs: Number.isFinite(st.birthtimeMs) && st.birthtimeMs > 0 ? st.birthtimeMs : null,
    dev: st.dev,
    isDir,
  };
}

async function walk(dir: string, recurse: boolean, found: Set<string>, unreadable: string[]): Promise<void> {
  let dirents;
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch {
    unreadable.push(dir);
    return;
  }
  await Promise.all(
    dirents.map(async (d) => {
      if (isSkipped(d.name) || d.isSymbolicLink()) return;
      const full = path.join(dir, d.name);
      if (d.isFile()) found.add(full);
      else if (d.isDirectory() && recurse) await walk(full, true, found, unreadable);
    }),
  );
}

/** Folder mode: the folders directly inside `dir`, never their contents. */
async function listSubfolders(dir: string, found: Set<string>, unreadable: string[]): Promise<void> {
  let dirents;
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch {
    unreadable.push(dir);
    return;
  }
  for (const d of dirents) {
    if (isSkipped(d.name) || d.isSymbolicLink()) continue;
    if (d.isDirectory()) found.add(path.join(dir, d.name));
  }
}

export async function scan(
  paths: readonly string[],
  opts: ScanOptions,
  onProgress?: Progress,
): Promise<ScanResult> {
  const folders = opts.mode === 'folders';
  const found = new Set<string>();
  const unreadable: string[] = [];
  for (const raw of paths) {
    const p = path.resolve(raw);
    let st;
    try {
      st = await lstat(p);
    } catch {
      continue; // dropped path no longer exists
    }
    if (st.isSymbolicLink() || isSkipped(path.basename(p))) continue;
    if (folders) {
      if (st.isDirectory()) await listSubfolders(p, found, unreadable);
    } else if (st.isFile()) {
      found.add(p);
    } else if (st.isDirectory()) {
      await walk(p, opts.includeSubfolders, found, unreadable);
    }
  }

  const all = [...found].sort(naturalCompare);
  const extensionsFound = folders ? [] : [...new Set(all.map(extOf))].sort();
  const wanted = folders || opts.extensions === null ? null : new Set(opts.extensions.map((e) => e.toLowerCase()));
  const matches = nameMatcher(opts.name);
  const selected = all.filter((f) => (wanted === null || wanted.has(extOf(f))) && matches(path.basename(f)));

  // Stat a few files at a time; results keep the sorted order.
  const stats: (FileEntry | null)[] = new Array(selected.length).fill(null);
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < selected.length) {
      const i = next++;
      try {
        const entry = await toEntry(selected[i]!, folders);
        if (passesFilters(entry, opts)) stats[i] = entry;
      } catch {
        // The file vanished between listing and stat; leave it out.
      }
      done += 1;
      onProgress?.(done, selected.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(STAT_CONCURRENCY, selected.length) }, worker));
  const entries = stats.filter((e): e is FileEntry => e !== null);
  return { entries, extensionsFound, unreadableFolders: unreadable.sort(naturalCompare) };
}
