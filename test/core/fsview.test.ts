import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createFsView } from '../../src/core/fsview.js';

const root = mkdtempSync(path.join(tmpdir(), 'renami-fsview-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('createFsView', () => {
  it('lists directories and returns null for missing ones', () => {
    mkdirSync(path.join(root, 'a'));
    writeFileSync(path.join(root, 'a', 'x.jpg'), '');
    const fs = createFsView();
    expect(fs.listDir(path.join(root, 'a'))).toEqual(['x.jpg']);
    expect(fs.listDir(path.join(root, 'missing'))).toBeNull();
  });
  it('finds the nearest existing ancestor', () => {
    expect(createFsView().nearestExisting(path.join(root, 'a', 'new', 'deeper'))).toBe(path.join(root, 'a'));
  });
  it('reports device ids and writability for existing folders', () => {
    const fs = createFsView();
    expect(typeof fs.deviceOf(root)).toBe('number');
    expect(fs.isWritableDir(root)).toBe(true);
  });
});
