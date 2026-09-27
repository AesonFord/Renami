import { describe, expect, it } from 'vitest';
import { parsePattern, patternSpans } from '../../../src/core/template/parse.js';

describe('parsePattern', () => {
  it('parses text, tokens and formats', () => {
    expect(parsePattern('Hawaii_{date_taken:YYYY-MM-DD}_{seq:3}')).toEqual({
      ok: true,
      nodes: [
        { type: 'text', value: 'Hawaii_' },
        { type: 'token', name: 'date_taken', format: 'YYYY-MM-DD', fallback: null },
        { type: 'text', value: '_' },
        { type: 'token', name: 'seq', format: '3', fallback: null },
      ],
    });
  });

  it('parses folder separators of both kinds', () => {
    const r = parsePattern('{year}/{album}\\{track:2} {title}');
    expect(r.ok && r.nodes.map((n) => n.type)).toEqual([
      'token', 'separator', 'token', 'separator', 'token', 'text', 'token',
    ]);
  });

  it('parses defaults, and formats containing colons', () => {
    const r = parsePattern('{artist|Unknown Artist} {date_taken:HH:mm|x}');
    expect(r).toEqual({
      ok: true,
      nodes: [
        { type: 'token', name: 'artist', format: null, fallback: 'Unknown Artist' },
        { type: 'text', value: ' ' },
        { type: 'token', name: 'date_taken', format: 'HH:mm', fallback: 'x' },
      ],
    });
  });

  it('turns doubled braces into literal braces', () => {
    expect(parsePattern('{{draft}}')).toEqual({ ok: true, nodes: [{ type: 'text', value: '{draft}' }] });
  });

  it.each([
    ['', 'The pattern is empty'],
    ['{nope}', 'Unknown token "{nope}"'],
    ['{Name}', 'Unknown token "{Name}"'],
    ['{name', 'Unclosed "{" at position 1'],
    ['a}b', 'Unexpected "}" at position 2. Use "}}" for a literal brace.'],
    ['{}', 'Empty token "{}"'],
    ['{iso:3}', '"{iso}" doesn\'t take a format'],
    ['{seq:x}', '"{seq:x}" needs a number of digits from 1 to 10'],
    ['{seq:0}', '"{seq:0}" needs a number of digits from 1 to 10'],
    ['{date_taken:}', 'Missing date format after "{date_taken:"'],
  ])('rejects %j', (pattern, error) => {
    const r = parsePattern(pattern);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(error);
  });
});

describe('patternSpans', () => {
  it('locates tokens and folder separators', () => {
    expect(patternSpans('{date_taken:YYYY}/Hawaii_{seq:3|x}')).toEqual([
      { kind: 'token', start: 0, end: 17, name: 'date_taken', format: 'YYYY', fallback: null },
      { kind: 'separator', start: 17, end: 18 },
      { kind: 'token', start: 25, end: 34, name: 'seq', format: '3', fallback: 'x' },
    ]);
  });

  it('counts escaped braces as two source characters each', () => {
    expect(patternSpans('{{a}}{name}')).toEqual([
      { kind: 'token', start: 5, end: 11, name: 'name', format: null, fallback: null },
    ]);
  });

  it('returns nothing for a pattern that does not parse', () => {
    expect(patternSpans('a{nope}')).toEqual([]);
    expect(patternSpans('')).toEqual([]);
  });
});
