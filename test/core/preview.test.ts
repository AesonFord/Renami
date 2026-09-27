import { describe, expect, it } from 'vitest';
import { extensionOf, mimeType, pathFromPreviewUrl, previewKind, previewUrl } from '../../src/core/preview.js';

describe('previewKind', () => {
  it.each([
    ['IMG_1.JPG', 'image'],
    ['a.webp', 'image'],
    ['DSC_1.NEF', 'raw'],
    ['a.dng', 'raw'],
    ['IMG_1.HEIC', 'heic'],
    ['a.hif', 'heic'],
    ['clip.MOV', 'video'],
    ['song.m4a', 'audio'],
    ['doc.pdf', 'pdf'],
  ])('%s is %s', (name, kind) => {
    expect(previewKind(name)).toBe(kind);
  });

  it('has no preview for other files, files with no extension, or folders', () => {
    expect(previewKind('notes.txt')).toBeNull();
    expect(previewKind('README')).toBeNull();
    expect(previewKind('.jpg')).toBeNull();
    expect(previewKind('Photos.jpg', true)).toBeNull();
  });
});

describe('extensionOf and mimeType', () => {
  it('takes the last extension of the last path segment, lowercased', () => {
    expect(extensionOf('/a.b/c.TAR.GZ')).toBe('gz');
    expect(extensionOf('C:\\x.y\\z')).toBe('');
  });

  it('gives a content type only to files streamed unchanged', () => {
    expect(mimeType('a.MOV')).toBe('video/quicktime');
    expect(mimeType('a.heic')).toBeNull();
    expect(mimeType('a.nef')).toBeNull();
  });
});

describe('preview URLs', () => {
  it('round-trips any path, including ones with URL characters in them', () => {
    for (const p of ['/photos/a b#1?.jpg', 'C:\\Users\\Ana\\100% & more.heic', '/ünï/cödé.mp4']) {
      expect(pathFromPreviewUrl(previewUrl(p))).toBe(p);
    }
  });

  it('returns null for URLs that are not preview URLs', () => {
    expect(pathFromPreviewUrl('https://preview/?path=/etc/passwd')).toBeNull();
    expect(pathFromPreviewUrl('renami-file://other/?path=/a.jpg')).toBeNull();
    expect(pathFromPreviewUrl('renami-file://preview/')).toBeNull();
  });
});
