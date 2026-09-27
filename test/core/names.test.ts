import { describe, expect, it } from 'vitest';
import { lastSegment, nameKey, naturalCompare, splitName } from '../../src/core/names.js';

describe('splitName', () => {
  it('splits on the last dot', () => {
    expect(splitName('IMG_4821.HEIC')).toEqual({ stem: 'IMG_4821', ext: 'HEIC' });
    expect(splitName('archive.tar.gz')).toEqual({ stem: 'archive.tar', ext: 'gz' });
  });
  it('treats dotfiles, trailing dots and no dot as having no extension', () => {
    expect(splitName('.bashrc')).toEqual({ stem: '.bashrc', ext: '' });
    expect(splitName('README')).toEqual({ stem: 'README', ext: '' });
    expect(splitName('odd.')).toEqual({ stem: 'odd.', ext: '' });
  });
});

describe('nameKey', () => {
  it('ignores case and Unicode normalization form', () => {
    const nfd = 'Cafe\u0301.JPG';
    const nfc = 'caf\u00e9.jpg';
    expect(nameKey(nfd)).toBe(nameKey(nfc));
  });
});

describe('naturalCompare', () => {
  it('orders numbers numerically and ignores case', () => {
    expect(['IMG_10', 'IMG_2', 'img_1'].sort(naturalCompare)).toEqual(['img_1', 'IMG_2', 'IMG_10']);
  });
  it('is deterministic for names equal except case', () => {
    expect(naturalCompare('a', 'A')).not.toBe(0);
    expect(naturalCompare('a', 'A')).toBe(-naturalCompare('A', 'a'));
  });
});

describe('lastSegment', () => {
  it('handles both separators', () => {
    expect(lastSegment('/photos/Hawaii 2024')).toBe('Hawaii 2024');
    expect(lastSegment('C:\\Users\\me\\Trip\\')).toBe('Trip');
  });
});
