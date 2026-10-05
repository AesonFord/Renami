import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, MetadataReader, type ExifToolLike, type Platform } from '../../src/core/index.js';
import { Session } from '../../src/main/session.js';

// The preview updates within 200 ms for 5,000 files with metadata cached.
// This covers the main process's share: plan, preview rows, and the copy IPC makes. CI gets more room.
const BUDGET_MS = process.env.CI ? 600 : 200;

const dir = mkdtempSync(path.join(tmpdir(), 'renami-session-perf-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('Session preview performance', () => {
  it('builds a 5,000-file preview within budget', async () => {
    for (let i = 0; i < 5000; i += 1) writeFileSync(path.join(dir, `IMG_${String(i).padStart(5, '0')}.jpg`), '');
    const reader = new MetadataReader({
      exiftool: { readRaw: async () => ({}), end: async () => {}, version: async () => '12.0' } as unknown as ExifToolLike,
      timeZone: 'UTC',
    });
    const session = new Session({
      platform: process.platform as Platform,
      presetsFile: path.join(dir, 'presets.json'),
      events: { metadataProgress: () => {}, executeProgress: () => {} },
      reader,
      timeZone: 'UTC',
    });
    await session.scan([dir], { includeSubfolders: false, extensions: null });
    await session.whenRead();
    const settings = { ...DEFAULT_SETTINGS, pattern: 'Hawaii_{date_taken:YYYY-MM-DD}_{seq:4}' };
    const run = async () => structuredClone(await session.buildPlan({ settings, excluded: [] }));

    await run(); // warm up
    const start = performance.now();
    const view = await run();
    const elapsed = performance.now() - start;

    expect(view.rows).toHaveLength(5000);
    // The timing check runs only with RENAMI_PERF=1 because wall-clock limits depend on the machine.
    if (process.env.RENAMI_PERF === '1') expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
