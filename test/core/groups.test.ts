import { describe, expect, it } from 'vitest';
import { buildGroups, choosePrimary, extensionTier } from '../../src/core/groups.js';
import type { FileEntry, FileMetadata } from '../../src/core/types.js';
import { makeEntry, makeMeta, wc } from './helpers.js';

const taken = wc(2024, 7, 4, 16, 5);
const lookup = (withDate: string[]) => (e: FileEntry): FileMetadata =>
  withDate.includes(e.path) ? makeMeta({ dateTaken: taken }) : makeMeta();

describe('extensionTier', () => {
  it('orders RAW, then HEIC/JPEG, then video, then everything else', () => {
    expect(['NEF', 'jpg', 'MOV', 'png'].map(extensionTier)).toEqual([0, 1, 2, 3]);
  });
});

describe('choosePrimary', () => {
  const nef = makeEntry('/p/DSC_0193.NEF');
  const jpg = makeEntry('/p/DSC_0193.JPG');
  it('prefers RAW when both have a date taken', () => {
    expect(choosePrimary([jpg, nef], lookup([nef.path, jpg.path]))).toBe(nef);
  });
  it('prefers the member that has a date taken', () => {
    expect(choosePrimary([jpg, nef], lookup([jpg.path]))).toBe(jpg);
  });
  it('falls back to tier order when no member has a date taken', () => {
    expect(choosePrimary([jpg, nef], lookup([]))).toBe(nef);
  });
});

describe('buildGroups', () => {
  const nef = makeEntry('/p/DSC_0193.NEF');
  const jpg = makeEntry('/p/dsc_0193.jpg');
  const heic = makeEntry('/p/IMG_1234.HEIC');
  const mov = makeEntry('/p/IMG_1234.MOV');
  const other = makeEntry('/q/DSC_0193.JPG');

  it('groups same folder + same name (case-insensitive), not across folders', () => {
    const groups = buildGroups([jpg, heic, nef, mov, other], lookup([]), true);
    const shapes = groups.map((g) => g.members.map((m) => m.path));
    expect(shapes).toEqual([
      ['/p/DSC_0193.NEF', '/p/dsc_0193.jpg'],
      ['/p/IMG_1234.HEIC', '/p/IMG_1234.MOV'],
      ['/q/DSC_0193.JPG'],
    ]);
    expect(groups[0]?.primary).toBe(nef);
    expect(groups[1]?.primary).toBe(heic);
  });

  it('gives single files their path as id, and groups a distinct id', () => {
    const groups = buildGroups([jpg, nef, other], lookup([]), true);
    expect(groups[1]?.id).toBe('/q/DSC_0193.JPG');
    expect(groups[0]?.id).not.toBe(groups[0]?.primary.path);
  });

  it('keeps every file separate when the option is off', () => {
    expect(buildGroups([jpg, nef], lookup([]), false).map((g) => g.members.length)).toEqual([1, 1]);
  });
});
