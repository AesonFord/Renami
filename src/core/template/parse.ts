import { isTokenName, TOKENS, type TokenName } from './tokens.js';

export type PatternNode =
  | { type: 'text'; value: string }
  | { type: 'separator' }
  | { type: 'token'; name: TokenName; format: string | null; fallback: string | null };

export type ParseResult =
  | { ok: true; nodes: PatternNode[] }
  | { ok: false; error: string; index: number };

/** Where one token or folder separator sits in the pattern text. `end` is exclusive. */
export type PatternSpan =
  | { kind: 'token'; start: number; end: number; name: TokenName; format: string | null; fallback: string | null }
  | { kind: 'separator'; start: number; end: number };

type TokenNode = Extract<PatternNode, { type: 'token' }>;

type Failure = { ok: false; error: string; index: number };
const fail = (error: string, index: number): Failure => ({ ok: false, error, index });

function parseToken(
  body: string,
  index: number,
): { ok: true; node: TokenNode } | Failure {
  const bar = body.indexOf('|');
  const head = bar === -1 ? body : body.slice(0, bar);
  const fallback = bar === -1 ? null : body.slice(bar + 1);
  const colon = head.indexOf(':');
  const name = colon === -1 ? head : head.slice(0, colon);
  const format = colon === -1 ? null : head.slice(colon + 1);

  if (name === '') return fail('Empty token "{}"', index);
  if (!isTokenName(name)) return fail(`Unknown token "{${name}}"`, index);

  const def = TOKENS[name];
  if (format !== null) {
    if (def.kind === 'date') {
      if (format === '') return fail(`Missing date format after "{${name}:"`, index);
    } else if (def.kind === 'number' && def.digitsFormat) {
      const digits = Number(format);
      if (!/^\d{1,2}$/.test(format) || digits < 1 || digits > 10) {
        return fail(`"{${name}:${format}}" needs a number of digits from 1 to 10`, index);
      }
    } else {
      return fail(`"{${name}}" doesn't take a format`, index);
    }
  }
  return { ok: true, node: { type: 'token', name, format, fallback } };
}

type Scanned = { ok: true; nodes: PatternNode[]; spans: PatternSpan[] } | Failure;

function scanPattern(pattern: string): Scanned {
  if (pattern.trim() === '') return fail('The pattern is empty', 0);

  const nodes: PatternNode[] = [];
  const spans: PatternSpan[] = [];
  let text = '';
  const flush = (): void => {
    if (text !== '') {
      nodes.push({ type: 'text', value: text });
      text = '';
    }
  };

  let i = 0;
  while (i < pattern.length) {
    const ch = pattern.charAt(i);
    const next = pattern.charAt(i + 1);
    if (ch === '{' && next === '{') { text += '{'; i += 2; continue; }
    if (ch === '}' && next === '}') { text += '}'; i += 2; continue; }
    if (ch === '}') {
      return fail(`Unexpected "}" at position ${i + 1}. Use "}}" for a literal brace.`, i);
    }
    if (ch === '/' || ch === '\\') {
      flush();
      nodes.push({ type: 'separator' });
      spans.push({ kind: 'separator', start: i, end: i + 1 });
      i += 1;
      continue;
    }
    if (ch === '{') {
      const close = pattern.indexOf('}', i + 1);
      if (close === -1) return fail(`Unclosed "{" at position ${i + 1}`, i);
      const parsed = parseToken(pattern.slice(i + 1, close), i);
      if (!parsed.ok) return parsed;
      flush();
      const { name, format, fallback } = parsed.node;
      nodes.push(parsed.node);
      spans.push({ kind: 'token', start: i, end: close + 1, name, format, fallback });
      i = close + 1;
      continue;
    }
    text += ch;
    i += 1;
  }
  flush();
  return { ok: true, nodes, spans };
}

/** Parses a pattern. Errors carry a 0-based index into the pattern. */
export function parsePattern(pattern: string): ParseResult {
  const r = scanPattern(pattern);
  return r.ok ? { ok: true, nodes: r.nodes } : r;
}

/** Tokens and folder separators with their positions, for the pattern bar. Empty when the pattern doesn't parse. */
export function patternSpans(pattern: string): PatternSpan[] {
  const r = scanPattern(pattern);
  return r.ok ? r.spans : [];
}
