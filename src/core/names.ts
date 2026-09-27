const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Splits a file name on its last dot. Dotfiles and trailing dots have no extension. */
export function splitName(fileName: string): { stem: string; ext: string } {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) return { stem: fileName, ext: '' };
  return { stem: fileName.slice(0, dot), ext: fileName.slice(dot + 1) };
}

/** The key used for every name comparison: NFC, lowercase. */
export function nameKey(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

/** Natural sort ("IMG_2" before "IMG_10"), case-insensitive, with a stable tie-break. */
export function naturalCompare(a: string, b: string): number {
  const c = collator.compare(a, b);
  if (c !== 0) return c;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Last component of a path, accepting both / and \ as separators. */
export function lastSegment(p: string): string {
  const parts = p.split(/[\\/]+/).filter((s) => s !== '');
  return parts[parts.length - 1] ?? '';
}
