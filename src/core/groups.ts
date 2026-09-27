import { nameKey } from './names.js';
import type { FileEntry, FileMetadata } from './types.js';

export type MetaLookup = (entry: FileEntry) => FileMetadata;

export interface FileGroup {
  /** entry.path for a single file; a distinct id for a same-name group. */
  id: string;
  /** Sorted by extension tier (RAW first). */
  members: FileEntry[];
  primary: FileEntry;
}

const TIERS: readonly (readonly string[])[] = [
  ['nef', 'cr2', 'cr3', 'arw', 'dng'],
  ['heic', 'jpg', 'jpeg'],
  ['mov', 'mp4', 'm4v'],
];

export function extensionTier(ext: string): number {
  const e = ext.toLowerCase();
  const i = TIERS.findIndex((tier) => tier.includes(e));
  return i === -1 ? TIERS.length : i;
}

function byTier(a: FileEntry, b: FileEntry): number {
  const ea = a.ext.toLowerCase();
  const eb = b.ext.toLowerCase();
  return extensionTier(ea) - extensionTier(eb) || (ea < eb ? -1 : ea > eb ? 1 : 0);
}

/** A same-name group's date: the first member with a real date taken, in tier order; otherwise the first in tier order. */
export function choosePrimary(members: readonly FileEntry[], getMeta: MetaLookup): FileEntry {
  const ordered = [...members].sort(byTier);
  const first = ordered[0];
  if (!first) throw new Error('choosePrimary called with no members');
  return ordered.find((m) => getMeta(m).dateTaken !== undefined) ?? first;
}

export function buildGroups(
  entries: readonly FileEntry[],
  getMeta: MetaLookup,
  keepTogether: boolean,
): FileGroup[] {
  if (!keepTogether) return entries.map((e) => ({ id: e.path, members: [e], primary: e }));

  const byKey = new Map<string, FileEntry[]>();
  for (const e of entries) {
    const key = `${e.dir}\u0000${nameKey(e.stem)}`;
    const list = byKey.get(key);
    if (list) list.push(e);
    else byKey.set(key, [e]);
  }
  return [...byKey.values()].map((members) => {
    const primary = choosePrimary(members, getMeta);
    return {
      id: members.length === 1 ? primary.path : `group:${primary.path}`,
      members: [...members].sort(byTier),
      primary,
    };
  });
}
