import { describe, expect, it } from 'vitest';
import { applyExtensionRules, normalizeExtension } from '../../src/core/extensions.js';

describe('normalizeExtension', () => {
  it('trims, drops leading dots and lowercases', () => {
    expect(normalizeExtension(' .JPEG ')).toBe('jpeg');
    expect(normalizeExtension('..tif')).toBe('tif');
    expect(normalizeExtension('')).toBe('');
  });
});

describe('applyExtensionRules', () => {
  const rules = [
    { from: 'jpeg', to: 'jpg' },
    { from: 'TIF', to: '.tiff' },
    { from: 'bak', to: '' },
  ];
  it('maps the original extension case-insensitively and normalizes the result', () => {
    expect(applyExtensionRules('JPEG', rules, false)).toBe('jpg');
    expect(applyExtensionRules('tif', rules, false)).toBe('tiff');
  });
  it('removes the extension for an empty target', () => {
    expect(applyExtensionRules('bak', rules, false)).toBe('');
  });
  it('keeps or lowercases an extension no rule matches', () => {
    expect(applyExtensionRules('HEIC', rules, false)).toBe('HEIC');
    expect(applyExtensionRules('HEIC', rules, true)).toBe('heic');
    expect(applyExtensionRules('', rules, true)).toBe('');
  });
  it('lets the first matching rule win', () => {
    expect(applyExtensionRules('jpeg', [{ from: 'jpeg', to: 'a' }, { from: 'jpeg', to: 'b' }], false)).toBe('a');
  });
});
