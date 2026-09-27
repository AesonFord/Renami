export type NameList =
  | { kind: 'pairs'; pairs: [current: string, next: string][] }
  | { kind: 'list'; names: string[] };

const HEADER_FROM = /^(current( name)?|from|old( name)?)$/i;
const HEADER_TO = /^(new( name)?|to)$/i;

/** Splits one line on `sep`, honouring double quotes ("" inside quotes is a quote). */
function splitLine(line: string, sep: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line.charAt(i);
    if (quoted) {
      if (ch === '"' && line.charAt(i + 1) === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === sep) {
      cells.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

/** A whole line as one name, without the quotes a spreadsheet may have wrapped it in. */
function unquote(line: string): string {
  return line.length >= 2 && line.startsWith('"') && line.endsWith('"') ? line.slice(1, -1).replace(/""/g, '"') : line;
}

/**
 * Reads a pasted or exported name list: `current<TAB>new` or `current,new` pairs (an optional
 * header line is dropped), or one new name per line. Comma lines count as pairs only when every
 * first column names a file in the batch, so names containing commas still work.
 */
export function parseNameList(text: string, currentNames: readonly string[]): NameList {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
  const sep = text.includes('\t') ? '\t' : ',';
  let rows = lines.map((l) => splitLine(l, sep));
  const first = rows[0];
  if (first && first.length >= 2 && HEADER_FROM.test(first[0] ?? '') && HEADER_TO.test(first[1] ?? '')) {
    rows = rows.slice(1);
    lines.shift();
  }
  const known = new Set(currentNames.map((n) => n.toLowerCase()));
  const allPairs = rows.length > 0 && rows.every((r) => r.length >= 2);
  const firstColumnKnown = rows.every((r) => known.has((r[0] ?? '').toLowerCase()));
  if (allPairs && (sep === '\t' || firstColumnKnown)) {
    return { kind: 'pairs', pairs: rows.map((r) => [r[0] ?? '', r[1] ?? '']) };
  }
  return { kind: 'list', names: lines.map(unquote) };
}

/**
 * The stem to use for `newName`: the row's own extension is stripped when the name repeats it.
 * `ext` is the row's extension after any extension rule (never guessed from `currentName`, which
 * would double it or, for a folder, strip a dotted name that isn't an extension at all).
 */
export function stemFor(newName: string, ext: string, isDir: boolean): string {
  const name = newName.trim();
  if (isDir || ext === '') return name;
  const suffix = `.${ext.toLowerCase()}`;
  return name.length > suffix.length && name.toLowerCase().endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}

/**
 * Turns a name list into overrides keyed by path. A plain list applies to rows in order; pairs
 * match by current name, ignoring case. Empty names and unknown files count as unmatched.
 */
export function overridesFrom(
  list: NameList,
  rows: readonly { path: string; currentName: string; ext: string; isDir: boolean }[],
): { overrides: Record<string, string>; matched: number; unmatched: number } {
  const overrides: Record<string, string> = {};
  let matched = 0;
  let unmatched = 0;
  const take = (row: { path: string; currentName: string; ext: string; isDir: boolean } | undefined, next: string): void => {
    const stem = row ? stemFor(next, row.ext, row.isDir) : '';
    if (row && stem !== '') {
      overrides[row.path] = stem;
      matched += 1;
    } else {
      unmatched += 1;
    }
  };
  if (list.kind === 'list') {
    list.names.forEach((name, i) => take(rows[i], name));
  } else {
    const byName = new Map<string, { path: string; currentName: string; ext: string; isDir: boolean }>();
    for (const r of rows) if (!byName.has(r.currentName.toLowerCase())) byName.set(r.currentName.toLowerCase(), r);
    for (const [current, next] of list.pairs) take(byName.get(current.toLowerCase()), next);
  }
  return { overrides, matched, unmatched };
}
