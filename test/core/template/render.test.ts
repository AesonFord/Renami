import { describe, expect, it } from 'vitest';
import { parsePattern } from '../../../src/core/template/parse.js';
import { renderPattern, tokenValues } from '../../../src/core/template/render.js';
import { TOKENS, type RenderContext } from '../../../src/core/template/tokens.js';
import type { FileMetadata } from '../../../src/core/types.js';
import { makeEntry, makeMeta, wc } from '../helpers.js';

function render(pattern: string, meta: Partial<FileMetadata> = {}, extra: Partial<RenderContext> = {}) {
  const parsed = parsePattern(pattern);
  if (!parsed.ok) throw new Error(parsed.error);
  const ctx: RenderContext = {
    entry: makeEntry('/photos/Hawaii 2024/IMG_4821.HEIC'),
    meta: makeMeta(meta),
    name: 'IMG_4821',
    seq: 1,
    defaultDigits: 3,
    ...extra,
  };
  return renderPattern(parsed.nodes, ctx);
}

const joined = (r: ReturnType<typeof render>) => r.segments.map((s) => s.map((p) => p.text).join(''));

describe('renderPattern', () => {
  it('renders the headline example', () => {
    const r = render('Hawaii_{date_taken:YYYY-MM-DD}_{seq:3}', { dateTaken: wc(2024, 7, 4, 14, 30) });
    expect(joined(r)).toEqual(['Hawaii_2024-07-04_001']);
    expect(r.flags).toEqual([]);
    expect(r.firstDate).toEqual({ value: wc(2024, 7, 4, 14, 30), source: 'taken' });
    expect(r.segments[0]).toEqual([
      { text: 'Hawaii_', token: false },
      { text: '2024-07-04', token: true },
      { text: '_', token: false },
      { text: '001', token: true },
    ]);
  });

  it('flags a fallback date', () => {
    const r = render('{date_taken}', { created: wc(2024, 7, 5, 9, 12) });
    expect(joined(r)).toEqual(['2024-07-05']);
    expect(r.flags).toEqual([
      { level: 'warning', code: 'fallback-date', message: 'No date taken in this file; used created date' },
    ]);
  });

  it('pads {seq} with the default digits and {track:N} with its own', () => {
    expect(joined(render('{seq}', {}, { seq: 7, defaultDigits: 4 }))).toEqual(['0007']);
    expect(joined(render('{track:2}', { track: 7 }))).toEqual(['07']);
    expect(joined(render('{track}', { track: 7 }))).toEqual(['7']);
  });

  it('renders an empty token part and one flag for a missing value', () => {
    const r = render('{artist}-{artist}');
    expect(r.segments[0]).toEqual([
      { text: '', token: true },
      { text: '-', token: false },
      { text: '', token: true },
    ]);
    expect(r.flags).toEqual([{ level: 'warning', code: 'missing-value', message: 'No artist for this file' }]);
  });

  it('uses a default instead of flagging', () => {
    const r = render('{artist|Unknown Artist}');
    expect(joined(r)).toEqual(['Unknown Artist']);
    expect(r.flags).toEqual([]);
  });

  it('splits folder segments and reads the folder name', () => {
    const r = render('{date_taken:YYYY}/{folder}_{name}', { dateTaken: wc(2024, 7, 4) });
    expect(joined(r)).toEqual(['2024', 'Hawaii 2024_IMG_4821']);
  });

  it('renders metadata formats', () => {
    const r = render('{focal_length} {gps_lat} {duration} {iso}', {
      focalLength: 35.2, gpsLat: 21.27661, durationSeconds: 187, iso: 400,
    });
    expect(joined(r)).toEqual(['35mm 21.2766 3m07s 400']);
  });
});

describe('more tokens', () => {
  it('renders the file and hash tokens', () => {
    const r = render(
      '{ext} {parent} {size} {size_bytes} {crc32} {md5}',
      { crc32: 'cbf43926', md5: 'abc' },
      { entry: makeEntry('/photos/Hawaii 2024/IMG_4821.HEIC', { size: 1_258_291 }) },
    );
    expect(joined(r)).toEqual(['HEIC photos 1.2MB 1258291 cbf43926 abc']);
  });
  it('renders the camera and audio tokens', () => {
    const r = render('{aperture} {shutter} {fps} {bitrate} {composer}', {
      aperture: 2.8, exposureSeconds: 0.004, frameRate: 29.97, bitrateKbps: 320, composer: 'Bach',
    });
    expect(joined(r)).toEqual(['f2.8 1-250 29.97 320 Bach']);
    expect(joined(render('{shutter} {aperture} {fps}', { exposureSeconds: 2, aperture: 11, frameRate: 30 }))).toEqual(['2s f11 30']);
  });
  it('flags a missing extension, parent and hash', () => {
    const r = render('{ext}{parent}{crc32}', {}, { entry: makeEntry('/README') });
    expect(r.flags.map((f) => f.message)).toEqual([
      'No extension for this file',
      'No parent folder name for this file',
      'No CRC32 for this file',
    ]);
  });
  it('renders milliseconds from a sub-second date taken', () => {
    const r = render('{date_taken:HH-mm-ss-SSS}', { dateTaken: { ...wc(2024, 7, 4, 14, 30, 5), millisecond: 42 } });
    expect(joined(r)).toEqual(['14-30-05-042']);
  });
});

describe('tokenValues', () => {
  it('lists every token with its value for one file, or null when there is none', () => {
    const v = tokenValues({
      entry: makeEntry('/photos/Hawaii 2024/IMG_4821.HEIC'),
      meta: makeMeta({ dateTaken: wc(2024, 7, 4, 14, 30), cameraModel: 'EOS R5' }),
      name: 'IMG_4821',
      seq: 7,
      defaultDigits: 3,
    });
    expect(Object.keys(v).sort()).toEqual(Object.keys(TOKENS).sort());
    expect(v.name).toBe('IMG_4821');
    expect(v.folder).toBe('Hawaii 2024');
    expect(v.date_taken).toBe('2024-07-04');
    expect(v.seq).toBe('007');
    expect(v.camera_model).toBe('EOS R5');
    expect(v.artist).toBeNull();
    expect(v.track).toBeNull();
  });
});
