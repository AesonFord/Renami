import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  buildPlan,
  createFsView,
  DEFAULT_SETTINGS,
  executePlan,
  History,
  MetadataReader,
  scan,
  type Platform,
} from '../../src/core/index.js';

const root = mkdtempSync(path.join(tmpdir(), 'renami-e2e-'));
const reader = new MetadataReader({ timeZone: 'Pacific/Honolulu' });
afterAll(async () => {
  await reader.end();
  rmSync(root, { recursive: true, force: true });
});

describe('core end to end', () => {
  it('scans, reads metadata, plans, renames and undoes', async () => {
    for (const name of ['photo.jpg', 'clip.mp4', 'nodate.jpg']) {
      copyFileSync(path.join('test/fixtures/media', name), path.join(root, name));
    }

    const { entries } = await scan([root], { includeSubfolders: false, extensions: null });
    const metadata = await reader.readAll(entries);
    const plan = buildPlan({
      entries,
      metadata,
      settings: { ...DEFAULT_SETTINGS, pattern: 'Hawaii_{date_taken:YYYY-MM-DD}_{seq:3}' },
      fs: createFsView(),
      platform: process.platform as Platform,
      timeZone: 'Pacific/Honolulu',
    });

    // photo.jpg (Jul 4) sorts before clip.mp4 (Jul 5, converted from UTC); nodate.jpg falls back to today's file dates.
    expect(plan.items.slice(0, 2).map((i) => path.basename(i.target))).toEqual([
      'Hawaii_2024-07-04_001.jpg',
      'Hawaii_2024-07-05_002.mp4',
    ]);
    expect(plan.items[2]?.flags.map((f) => f.code)).toContain('fallback-date');

    const history = new History();
    const result = await executePlan(plan);
    expect(result.status).toBe('done');
    if (result.status === 'done') history.push(result.record);
    expect(readdirSync(root).filter((n) => n.startsWith('Hawaii_'))).toHaveLength(3);

    const undo = await history.undo();
    expect(undo.status).toBe('done');
    expect(readdirSync(root).sort()).toEqual(['clip.mp4', 'nodate.jpg', 'photo.jpg']);
  });
});
