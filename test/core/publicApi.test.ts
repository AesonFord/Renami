import { describe, expect, it } from 'vitest';
import {
  applyFindReplace,
  CancelledError,
  DEFAULT_DATE_FORMAT,
  fsMetadata,
  isTokenName,
  patternSpans,
  tokenValues,
  validateRules,
  type PatternSpan,
  type ReadAllOptions,
  type RenderContext,
  type TokenDef,
} from '../../src/core/index.js';

describe('public API', () => {
  it('exports CancelledError', () => {
    const e = new CancelledError();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('CancelledError');
  });

  it('exports DEFAULT_DATE_FORMAT', () => {
    expect(DEFAULT_DATE_FORMAT).toBe('YYYY-MM-DD');
  });

  it('exports isTokenName', () => {
    expect(isTokenName('name')).toBe(true);
    expect(isTokenName('not-a-token')).toBe(false);
  });

  it('exports the TokenDef type', () => {
    const def: TokenDef = { kind: 'text', label: 'x', get: () => undefined };
    expect(def.kind).toBe('text');
  });

  it('exports what the desktop app uses', () => {
    expect(typeof patternSpans).toBe('function');
    expect(typeof tokenValues).toBe('function');
    expect(applyFindReplace('IMG_1', [{ find: 'IMG', replace: 'Trip', regex: false, matchCase: true }])).toBe('Trip_1');
    expect(validateRules([{ find: '(', replace: '', regex: true, matchCase: true }])).toMatch(/rule 1/);
    expect(typeof fsMetadata).toBe('function');
    const span: PatternSpan = { kind: 'separator', start: 0, end: 1 };
    const opts: ReadAllOptions = {};
    const ctx: Partial<RenderContext> = { seq: 1 };
    expect([span.kind, typeof opts, ctx.seq]).toEqual(['separator', 'object', 1]);
  });
});
