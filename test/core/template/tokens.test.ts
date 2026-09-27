import { describe, expect, it } from 'vitest';
import { formatDuration, formatExposure, formatSize, isTokenName, parentFolder, TOKENS } from '../../../src/core/template/tokens.js';

describe('TOKENS', () => {
  it('contains exactly the expected tokens', () => {
    expect(Object.keys(TOKENS).sort()).toEqual(
      [
        'album', 'album_artist', 'aperture', 'artist', 'bitrate', 'camera_make', 'camera_model', 'composer',
        'crc32', 'created', 'date_taken', 'disc', 'duration', 'ext', 'focal_length', 'folder', 'fps', 'genre',
        'gps_lat', 'gps_lon', 'height', 'iso', 'lens', 'md5', 'modified', 'name', 'parent', 'seq', 'shutter',
        'size', 'size_bytes', 'title', 'track', 'width', 'year',
      ].sort(),
    );
  });
  it('recognizes names case-sensitively', () => {
    expect(isTokenName('artist')).toBe(true);
    expect(isTokenName('Artist')).toBe(false);
    expect(isTokenName('toString')).toBe(false);
  });
});

describe('formatDuration', () => {
  it('uses minutes and seconds, adding hours when needed', () => {
    expect(formatDuration(187)).toBe('3m07s');
    expect(formatDuration(3727.4)).toBe('1h02m07s');
    expect(formatDuration(5)).toBe('0m05s');
  });
});

describe('formatSize', () => {
  it('picks a unit and keeps one decimal below 100', () => {
    expect(formatSize(512)).toBe('512B');
    expect(formatSize(348_160)).toBe('340KB');
    expect(formatSize(1_258_291)).toBe('1.2MB');
    expect(formatSize(2 * 1024 ** 3)).toBe('2GB');
    expect(formatSize(150 * 1024 ** 2)).toBe('150MB');
  });
});

describe('formatExposure', () => {
  it('writes fractions as 1-N and whole seconds with an s', () => {
    expect(formatExposure(0.004)).toBe('1-250');
    expect(formatExposure(1 / 60)).toBe('1-60');
    expect(formatExposure(2)).toBe('2s');
    expect(formatExposure(1.5)).toBe('1.5s');
  });
});

describe('parentFolder', () => {
  it('is the folder above the file’s folder, for both separators', () => {
    expect(parentFolder('/photos/Hawaii 2024')).toBe('photos');
    expect(parentFolder('C:\\Users\\me\\Pictures')).toBe('me');
    expect(parentFolder('/photos')).toBeUndefined();
  });
});
