import { parsePattern, patternSpans, type PatternSpan } from '../../core/template/parse.js';
import { TOKENS, type TokenName } from '../../core/template/tokens.js';

export type TokenSpan = Extract<PatternSpan, { kind: 'token' }>;

export interface Piece {
  text: string;
  kind: 'text' | 'token' | 'separator' | 'error';
  /** Offset of the piece in the pattern. */
  start: number;
}

/** Pieces for the highlighted copy of the pattern drawn behind the input. */
export function highlight(pattern: string): Piece[] {
  const parsed = parsePattern(pattern);
  if (!parsed.ok) {
    const at = Math.min(parsed.index, pattern.length);
    const pieces: Piece[] = [];
    if (at > 0) pieces.push({ text: pattern.slice(0, at), kind: 'text', start: 0 });
    if (at < pattern.length) pieces.push({ text: pattern.slice(at), kind: 'error', start: at });
    return pieces;
  }
  const pieces: Piece[] = [];
  let pos = 0;
  for (const span of patternSpans(pattern)) {
    if (span.start > pos) pieces.push({ text: pattern.slice(pos, span.start), kind: 'text', start: pos });
    pieces.push({ text: pattern.slice(span.start, span.end), kind: span.kind, start: span.start });
    pos = span.end;
  }
  if (pos < pattern.length) pieces.push({ text: pattern.slice(pos), kind: 'text', start: pos });
  return pieces;
}

/** The token the caret is strictly inside, for the click-to-edit popover. */
export function tokenAt(pattern: string, caret: number): TokenSpan | null {
  for (const span of patternSpans(pattern)) {
    if (span.kind === 'token' && caret > span.start && caret < span.end) return span;
  }
  return null;
}

/** Source text for a token: {name}, {name:format}, {name|default}, {name:format|default}. */
export function tokenText(name: TokenName, format: string | null, fallback: string | null): string {
  return `{${name}${format !== null ? `:${format}` : ''}${fallback !== null ? `|${fallback}` : ''}}`;
}

export function replaceRange(pattern: string, start: number, end: number, text: string): { pattern: string; caret: number } {
  return { pattern: pattern.slice(0, start) + text + pattern.slice(end), caret: start + text.length };
}

/**
 * Why the Sequence tab's Start at and Digits don't reach the names: the pattern has no {seq}, or
 * every {seq} sets its own digits. Null when they do, or when the pattern doesn't parse (the
 * pattern bar shows that error).
 */
export function seqProblem(pattern: string): { kind: 'noSeq' } | { kind: 'fixedDigits'; token: string } | null {
  if (!parsePattern(pattern).ok) return null;
  const seqs = patternSpans(pattern).filter((s): s is TokenSpan => s.kind === 'token' && s.name === 'seq');
  if (seqs.length === 0) return { kind: 'noSeq' };
  const first = seqs[0]!;
  if (seqs.every((s) => s.format !== null)) return { kind: 'fixedDigits', token: pattern.slice(first.start, first.end) };
  return null;
}

/** The pattern with {seq} on the end, after an underscore unless it already ends in a separator. */
export function appendSeq(pattern: string): string {
  return /(^|[\s_\-./])$/.test(pattern) ? `${pattern}{seq}` : `${pattern}_{seq}`;
}

/** A token's format or default can't contain these: they would end or split the token. */
export const RESERVED_IN_TOKEN = /[{}|]/;

/** Suggestions in the date token popover. */
export const DATE_FORMATS = ['YYYY-MM-DD', 'YYYYMMDD', 'YYYY-MM-DD_HH-mm-ss', 'YYYY-MM-DD_HH-mm-ss-SSS', 'YYYY-MM-DD ddd', 'YYYY', 'MM', 'MMM', 'DD'];

/** The token palette: grouped as Dates, Number, File, Photo & video and Audio. */
export const PALETTE: { group: string; tokens: { token: TokenName }[] }[] = [
  { group: 'Dates', tokens: [{ token: 'date_taken' }, { token: 'created' }, { token: 'modified' }] },
  { group: 'Number', tokens: [{ token: 'seq' }] },
  { group: 'File', tokens: [{ token: 'name' }, { token: 'folder' }, { token: 'parent' }, { token: 'ext' }, { token: 'size' }] },
  { group: 'Photo & video', tokens: [{ token: 'camera_model' }, { token: 'lens' }, { token: 'aperture' }, { token: 'shutter' }] },
  { group: 'Audio', tokens: [{ token: 'artist' }, { token: 'album' }, { token: 'track' }, { token: 'composer' }] },
];

/** A token's label in sentence case, e.g. "Date taken", "ISO". */
export function tokenLabel(name: TokenName): string {
  const label = TOKENS[name].label;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Palette chip text that differs from `tokenLabel`, e.g. "camera model" -> "Camera" not "Camera model". */
const CHIP_LABELS: Partial<Record<TokenName, string>> = {
  created: 'Created',
  modified: 'Modified',
  seq: 'Sequence',
  folder: 'Folder',
  parent: 'Parent',
  camera_model: 'Camera',
  track: 'Track',
  shutter: 'Shutter',
};

/** A token's label as shown on its palette chip. */
export function chipLabel(name: TokenName): string {
  return CHIP_LABELS[name] ?? tokenLabel(name);
}
