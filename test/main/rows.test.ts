import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FileEntry, PlanItem } from '../../src/core/index.js';
import { remapSources, toPreviewRow } from '../../src/main/rows.js';

// Paths are built with node:path so these tests hold on Windows too.
const root = path.resolve('photos');

function entry(p: string, isDir = false): FileEntry {
  const { name, ext } = path.parse(p);
  return { path: p, dir: path.dirname(p), stem: name, ext: isDir ? '' : ext.slice(1), size: 1, mtimeMs: 0, birthtimeMs: null, dev: 1, isDir };
}

function item(source: FileEntry, over: Partial<PlanItem> = {}): PlanItem {
  return {
    source,
    target: source.path,
    kind: 'unchanged',
    flags: [],
    seq: 1,
    groupId: null,
    dateUsed: null,
    stem: source.stem,
    ext: source.ext,
    setDates: {},
    ...over,
  };
}

describe('toPreviewRow', () => {
  const photo = entry(path.join(root, 'Hawaii', 'IMG_1.HEIC'));

  it('shows a rename by its new file name, with the date used', () => {
    const row = toPreviewRow(
      item(photo, {
        target: path.join(root, 'Hawaii', 'Trip_001.heic'),
        kind: 'rename',
        dateUsed: { value: { year: 2024, month: 7, day: 4, hour: 14, minute: 30, second: 0 }, source: 'taken' },
        groupId: 'g1',
        stem: 'Trip_001',
        ext: 'heic',
      }),
      null,
    );
    expect(row).toEqual({
      path: photo.path,
      currentName: 'IMG_1.HEIC',
      newName: 'Trip_001.heic',
      kind: 'rename',
      dateUsed: '2024-07-04 14:30',
      dateSource: 'taken',
      folder: 'Hawaii',
      folderPath: path.join(root, 'Hawaii'),
      flags: [],
      groupId: 'g1',
      setsDates: false,
      isDir: false,
      stem: 'Trip_001',
      ext: 'heic',
    });
  });

  // I1: PreviewRow carries isDir and the planner's own stem/ext so the renderer never has to
  // re-derive "the extension" from the current name (wrong for a dotted folder name).
  it('carries isDir and the planned stem/ext straight from the plan item, not derived from the name', () => {
    const folder = entry(path.join(root, 'Trip.2024'), true);
    const row = toPreviewRow(item(folder, { kind: 'unchanged', stem: 'Trip.2024', ext: '' }), null);
    expect(row.isDir).toBe(true);
    expect(row.stem).toBe('Trip.2024');
    expect(row.ext).toBe('');

    const doubled = entry(path.join(root, 'IMG.jpeg'));
    const rule = toPreviewRow(
      item(doubled, { kind: 'rename', target: path.join(root, 'IMG.jpg'), stem: 'IMG', ext: 'jpg' }),
      null,
    );
    expect(rule.newName).toBe('IMG.jpg');
    expect(rule.stem).toBe('IMG');
    expect(rule.ext).toBe('jpg');
  });

  it('shows a move within the current folder with its relative folder path', () => {
    const row = toPreviewRow(item(photo, { target: path.join(root, 'Hawaii', '2024', 'x.heic'), kind: 'move' }), null);
    expect(row.newName).toBe(path.join('2024', 'x.heic'));
  });

  it('shows a move to a chosen folder relative to that folder', () => {
    const dest = path.resolve('sorted');
    const row = toPreviewRow(item(photo, { target: path.join(dest, '07', 'x.heic'), kind: 'cross-drive-move' }), dest);
    expect(row.newName).toBe(path.join('07', 'x.heic'));
  });

  it('shows unchanged files under their own name and error rows with no new name', () => {
    expect(toPreviewRow(item(photo), null).newName).toBe('IMG_1.HEIC');
    expect(toPreviewRow(item(photo, { kind: 'error' }), null).newName).toBe('');
    expect(toPreviewRow(item(photo, { kind: 'excluded' }), null).newName).toBe('');
  });

  it('marks rows whose dates will change', () => {
    const modified = { year: 2024, month: 7, day: 4, hour: 0, minute: 0, second: 0 };
    expect(toPreviewRow(item(photo, { setDates: { modified } }), null).setsDates).toBe(true);
  });
});

describe('remapSources', () => {
  it('swaps moved files for their new paths and keeps everything else', () => {
    const folder = path.join(root, 'Hawaii');
    const file = path.join(root, 'loose.jpg');
    const other = path.join(root, 'other.jpg');
    expect(remapSources([folder, file, other], [[file, path.join(root, 'Trip.jpg')]])).toEqual([
      folder,
      path.join(root, 'Trip.jpg'),
      other,
    ]);
  });
});
