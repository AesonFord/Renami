import { describe, expect, it } from 'vitest';
import { applyFindReplace, rulesFor, validateRules } from '../../src/core/findReplace.js';
import type { FindReplaceRule } from '../../src/core/types.js';

const rule = (r: Partial<FindReplaceRule>): FindReplaceRule => ({
  find: '', replace: '', regex: false, matchCase: false, ...r,
});

describe('applyFindReplace', () => {
  it('replaces plain text case-insensitively by default', () => {
    expect(applyFindReplace('IMG_1234', [rule({ find: 'img', replace: 'Hawaii' })])).toBe('Hawaii_1234');
  });
  it('respects match case', () => {
    expect(applyFindReplace('IMG_1234', [rule({ find: 'img', replace: 'X', matchCase: true })])).toBe('IMG_1234');
  });
  it('treats $ in a plain replacement literally', () => {
    expect(applyFindReplace('a.b', [rule({ find: '.', replace: '$1' })])).toBe('a$1b');
  });
  it('supports regex with capture groups', () => {
    expect(applyFindReplace('IMG_1234', [rule({ find: '^IMG_(\\d+)$', replace: 'Photo-$1', regex: true })]))
      .toBe('Photo-1234');
  });
  it('applies rules in order and skips empty ones', () => {
    const rules = [rule({ find: '' }), rule({ find: 'a', replace: 'b' }), rule({ find: 'b', replace: 'c' })];
    expect(applyFindReplace('aab', rules)).toBe('ccc');
  });
});

describe('validateRules', () => {
  it('reports the first invalid regex with its rule number', () => {
    const msg = validateRules([rule({ find: 'ok', regex: true }), rule({ find: '(', regex: true })]);
    expect(msg).toMatch(/^Find & replace rule 2: /);
  });
  it('accepts plain text that would be invalid as a regex', () => {
    expect(validateRules([rule({ find: '(' })])).toBeNull();
  });
});

describe('rulesFor', () => {
  it('splits rules by scope, counting a missing scope as original', () => {
    const rules = [
      { find: 'a', replace: 'b', regex: false, matchCase: false },
      { find: 'c', replace: 'd', regex: false, matchCase: false, scope: 'result' as const },
      { find: 'e', replace: 'f', regex: false, matchCase: false, scope: 'original' as const },
    ];
    expect(rulesFor(rules, 'original').map((r) => r.find)).toEqual(['a', 'e']);
    expect(rulesFor(rules, 'result').map((r) => r.find)).toEqual(['c']);
  });
});
