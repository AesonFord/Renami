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

  it('exports what the desktop app uses', () => {
    expect(typeof patternSpans).toBe('function');
    expect(typeof tokenValues).toBe('function');
    expect(applyFindReplace('IMG_1', [{ find: 'IMG', replace: 'Trip', regex: false, matchCase: true }])).toBe('Trip_1');
    expect(validateRules([{ find: '(', replace: '', regex: true, matchCase: true }])).toMatch(/rule 1/);
    expect(typeof fsMetadata).toBe('function');
  });
});
