import { describe, expect, it } from 'vitest';
import { normalizeTags } from '../../../src/core/metadata/normalize.js';
import { makeEntry, wc } from '../helpers.js';

const entry = (name: string) => makeEntry(`/m/${name}`, { mtimeMs: Date.UTC(2024, 7, 1, 9), birthtimeMs: null });

describe('normalizeTags: photos', () => {
  it('reads date taken and camera fields', () => {
    const m = normalizeTags({
      DateTimeOriginal: '2024:07:04 14:30:00', OffsetTimeOriginal: '-10:00',
      Make: 'Canon', Model: 'EOS R5', LensModel: 'RF24-70mm F2.8 L IS USM',
      ISO: 400, FocalLength: 35, ImageWidth: 8192, ImageHeight: 5464,
      GPSLatitude: 21.2766, GPSLatitudeRef: 'N', GPSLongitude: 157.8259, GPSLongitudeRef: 'W',
    }, entry('IMG.jpg'), 'UTC');
    expect(m).toEqual({
      modified: wc(2024, 8, 1, 9),
      dateTaken: wc(2024, 7, 4, 14, 30),
      cameraMake: 'Canon', cameraModel: 'EOS R5', lens: 'RF24-70mm F2.8 L IS USM',
      iso: 400, focalLength: 35, width: 8192, height: 5464,
      gpsLat: 21.2766, gpsLon: -157.8259,
    });
  });

  it('falls back to CreateDate and ignores zero dates', () => {
    expect(normalizeTags({ CreateDate: '2024:07:05 08:10:00' }, entry('a.heic'), 'UTC').dateTaken).toEqual(wc(2024, 7, 5, 8, 10));
    expect(normalizeTags({ DateTimeOriginal: '0000:00:00 00:00:00' }, entry('a.jpg'), 'UTC').dateTaken).toBeUndefined();
  });

  it('keeps an already-signed GPS value', () => {
    const m = normalizeTags({ GPSLatitude: -33.86, GPSLatitudeRef: 'S' }, entry('a.jpg'), 'UTC');
    expect(m.gpsLat).toBe(-33.86);
  });
});

describe('normalizeTags: video', () => {
  it('prefers CreationDate with its own offset', () => {
    const m = normalizeTags(
      { CreationDate: '2024:07:04 18:42:00-10:00', CreateDate: '2024:07:05 04:42:00', Duration: 12.5 },
      entry('IMG_1234.MOV'), 'America/New_York',
    );
    expect(m.dateTaken).toEqual(wc(2024, 7, 4, 18, 42));
    expect(m.durationSeconds).toBe(12.5);
  });

  it('converts a UTC-only CreateDate into the given zone', () => {
    const m = normalizeTags({ CreateDate: '2024:07:05 23:15:02' }, entry('PXL.mp4'), 'Pacific/Honolulu');
    expect(m.dateTaken).toEqual(wc(2024, 7, 5, 13, 15, 2));
  });
});

describe('normalizeTags: audio', () => {
  it('reads ID3-style tags and never sets a date taken', () => {
    const m = normalizeTags({
      Artist: 'Test Artist', Band: 'Test Band', Album: 'Test Album', Title: 'Test Title', Genre: 'Hawaiian',
      Track: '3/12', PartOfSet: '1/2', Year: 1993, DateTimeOriginal: '2024:01:01 00:00:00', Duration: 187,
    }, entry('song.mp3'), 'UTC');
    expect(m).toMatchObject({
      artist: 'Test Artist', albumArtist: 'Test Band', album: 'Test Album', title: 'Test Title',
      genre: 'Hawaiian', track: 3, disc: 1, year: 1993, durationSeconds: 187,
    });
    expect(m.dateTaken).toBeUndefined();
  });

  it('reads MP4-style tags', () => {
    const m = normalizeTags(
      { AlbumArtist: 'AA', TrackNumber: '3 of 12', DiscNumber: '2 of 2', ContentCreateDate: '1993' },
      entry('book.m4b'), 'UTC',
    );
    expect(m).toMatchObject({ albumArtist: 'AA', track: 3, disc: 2, year: 1993 });
  });

  it('reads the disc number from QuickTime-style DiskNumber (observed on .m4a/.m4b)', () => {
    // ExifTool -n reports the disc number for QuickTime/MP4-family audio under `DiskNumber`
    // (spelled with a "k"), not `DiscNumber`/`PartOfSet` — e.g. "1 of 2" for song.m4a.
    const m = normalizeTags({ DiskNumber: '1 of 2' }, entry('song.m4a'), 'UTC');
    expect(m.disc).toBe(1);
  });
});

describe('normalizeTags: more fields', () => {
  it('reads aperture, exposure, frame rate, bitrate and composer', () => {
    const m = normalizeTags(
      { FNumber: 2.8, ExposureTime: 0.004, VideoFrameRate: 29.97, AvgBitrate: 2_610_000, Composer: 'J. S. Bach' },
      entry('clip.mov'), 'UTC',
    );
    expect(m).toMatchObject({ aperture: 2.8, exposureSeconds: 0.004, frameRate: 29.97, bitrateKbps: 2610, composer: 'J. S. Bach' });
    expect(normalizeTags({ AudioBitrate: 320_000 }, entry('song.mp3'), 'UTC').bitrateKbps).toBe(320);
    expect(normalizeTags({ ApertureValue: 4 }, entry('a.jpg'), 'UTC').aperture).toBe(4);
  });
  it('keeps sub-second precision from SubSecDateTimeOriginal, or from SubSecTimeOriginal', () => {
    expect(
      normalizeTags({ SubSecDateTimeOriginal: '2024:07:04 14:30:00.123-10:00', DateTimeOriginal: '2024:07:04 14:30:00' }, entry('a.jpg'), 'UTC').dateTaken,
    ).toEqual({ ...wc(2024, 7, 4, 14, 30), millisecond: 123 });
    expect(normalizeTags({ DateTimeOriginal: '2024:07:04 14:30:00', SubSecTimeOriginal: '45' }, entry('a.jpg'), 'UTC').dateTaken)
      .toEqual({ ...wc(2024, 7, 4, 14, 30), millisecond: 450 });
    expect(normalizeTags({ DateTimeOriginal: '2024:07:04 14:30:00' }, entry('a.jpg'), 'UTC').dateTaken).not.toHaveProperty('millisecond');
  });
});

describe('normalizeTags: errors', () => {
  it('records ExifTool errors and keeps filesystem dates', () => {
    const m = normalizeTags({ Error: 'File format error' }, entry('bad.jpg'), 'UTC');
    expect(m).toEqual({ modified: wc(2024, 8, 1, 9), readError: 'File format error' });
  });
});
