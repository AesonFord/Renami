import type { Part } from './template/render.js';
import type { CaseMode } from './types.js';

const EDGE_START = /^[_\- .]+/;
const EDGE_END = /[_\- .]+$/;
// Windows-forbidden characters plus control characters U+0000 to U+001F.
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const REPEATED_SEPARATOR = /([_\- .])\1+/g;
const TRAILING_DOTS_SPACES = /[. ]+$/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?=\.|$)/i;

/** Letters that NFD does not decompose but that have an obvious ASCII spelling. */
const SPECIAL_LETTERS: Record<string, string> = {
  'ß': 'ss', 'æ': 'ae', 'Æ': 'Ae', 'œ': 'oe', 'Œ': 'Oe', 'ø': 'o', 'Ø': 'O',
  'đ': 'd', 'Đ': 'D', 'ł': 'l', 'Ł': 'L', 'þ': 'th', 'Þ': 'Th', 'ð': 'd', 'Ð': 'D', 'ı': 'i',
};
const SPECIAL = /[ßæÆœŒøØđĐłŁþÞðÐı]/g;

/** Removes accents and other combining marks, and spells out letters like ß and ø. */
export function stripDiacritics(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(SPECIAL, (ch) => SPECIAL_LETTERS[ch] ?? ch);
}

/** stripDiacritics, then every remaining character outside printable ASCII becomes _. */
export function asciiOnly(text: string): string {
  return stripDiacritics(text).replace(/[^\x20-\x7e]/g, '_');
}

export interface CleanupOptions {
  caseMode: CaseMode;
  spacesToUnderscores: boolean;
  /** é → e, ß → ss and so on. */
  stripDiacritics?: boolean;
  /** Implies stripDiacritics; every other character outside printable ASCII becomes _. */
  asciiOnly?: boolean;
}

const WORD_SPLIT = /[\s_\-.]+/;
const capitalize = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);

export function applyCase(text: string, mode: CaseMode): string {
  const words = text.split(WORD_SPLIT).filter((w) => w !== '');
  switch (mode) {
    case 'none': return text;
    case 'lower': return text.toLowerCase();
    case 'upper': return text.toUpperCase();
    case 'title':
      return text
        .toLowerCase()
        .replace(/(^|[\s_\-.])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
    case 'sentence':
      return text.toLowerCase().replace(/\p{L}/u, (ch) => ch.toUpperCase());
    case 'snake':
      return words.length === 0 ? text : words.map((w) => w.toLowerCase()).join('_');
    case 'kebab':
      return words.length === 0 ? text : words.map((w) => w.toLowerCase()).join('-');
    case 'camel':
      return words.length === 0
        ? text
        : words.map((w, i) => (i === 0 ? w.toLowerCase() : capitalize(w.toLowerCase()))).join('');
  }
}

export function isReservedWindowsName(stem: string): boolean {
  return RESERVED.test(stem);
}

export function utf8Bytes(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

/** Cleans one path segment. The extension is not part of `parts`. */
export function cleanSegment(parts: readonly Part[], opts: CleanupOptions): string {
  const first = parts.findIndex((p) => p.text !== '');
  if (first === -1) return '';
  let last = parts.length - 1;
  while (last > first && parts[last]?.text === '') last -= 1;

  let text = parts.slice(first, last + 1).map((p) => p.text).join('');
  // Only strip edge separators that an empty token left behind.
  if (parts.slice(0, first).some((p) => p.token)) text = text.replace(EDGE_START, '');
  if (parts.slice(last + 1).some((p) => p.token)) text = text.replace(EDGE_END, '');

  if (opts.asciiOnly) text = asciiOnly(text);
  else if (opts.stripDiacritics) text = stripDiacritics(text);
  text = applyCase(text, opts.caseMode);
  if (opts.spacesToUnderscores) text = text.replace(/ /g, '_');
  text = text.replace(INVALID_CHARS, '_');
  text = text.replace(REPEATED_SEPARATOR, '$1');
  text = text.replace(TRAILING_DOTS_SPACES, '');
  text = text.normalize('NFC');
  text = text.replace(RESERVED, '$1_');
  return text;
}
