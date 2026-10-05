import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPlan } from '../../src/core/planner.js';
import { DEFAULT_SETTINGS, type FileMetadata, type FsView } from '../../src/core/types.js';
import { makeEntry, makeMeta, wc } from './helpers.js';

// The target is 200 ms. Shared CI machines are slower, so they get more room.
const BUDGET_MS = process.env.CI ? 600 : 200;

describe('buildPlan performance', () => {
  it('plans 5,000 files within budget once metadata is cached', () => {
    const entries = Array.from({ length: 5000 }, (_, i) =>
      makeEntry(`/photos/IMG_${String(i).padStart(5, '0')}.jpg`));
    const metadata = new Map<string, FileMetadata>(
      entries.map((e, i) => [e.path, makeMeta({ dateTaken: wc(2024, 7, 1 + (i % 28), i % 24, i % 60) })]),
    );
    const names = entries.map((e) => path.posix.basename(e.path));
    const fs: FsView = { listDir: () => names, nearestExisting: (p) => p, deviceOf: () => 1, isWritableDir: () => true };
    const settings = { ...DEFAULT_SETTINGS, pattern: 'Hawaii_{date_taken:YYYY-MM-DD}_{seq:4}' };
    const run = () => buildPlan({ entries, metadata, settings, fs, platform: 'darwin', timeZone: 'UTC', path: path.posix });

    run(); // warm up
    const start = performance.now();
    const plan = run();
    const elapsed = performance.now() - start;

    expect(plan.items).toHaveLength(5000);
    expect(new Set(plan.items.map((i) => i.target)).size).toBe(5000);
    // The timing check runs only with RENAMI_PERF=1 because wall-clock limits depend on the machine.
    if (process.env.RENAMI_PERF === '1') expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it('plans 5,000 colliding files within budget (all sharing one suffix chain)', () => {
    const entries = Array.from({ length: 5000 }, (_, i) =>
      makeEntry(`/photos/IMG_${String(i).padStart(5, '0')}.jpg`));
    const metadata = new Map<string, FileMetadata>(
      entries.map((e, i) => [e.path, makeMeta({ dateTaken: wc(2024, 7, 1 + (i % 28), i % 24, i % 60) })]),
    );
    const names = entries.map((e) => path.posix.basename(e.path));
    const fs: FsView = { listDir: () => names, nearestExisting: (p) => p, deviceOf: () => 1, isWritableDir: () => true };
    // Every file renders to the same literal name, so all 5,000 collide on one suffix chain.
    const settings = { ...DEFAULT_SETTINGS, pattern: 'Hawaii_' };
    const run = () => buildPlan({ entries, metadata, settings, fs, platform: 'darwin', timeZone: 'UTC', path: path.posix });

    run(); // warm up
    const start = performance.now();
    const plan = run();
    const elapsed = performance.now() - start;

    expect(plan.items).toHaveLength(5000);
    expect(new Set(plan.items.map((i) => i.target)).size).toBe(5000);
    // The timing check runs only with RENAMI_PERF=1 because wall-clock limits depend on the machine.
    if (process.env.RENAMI_PERF === '1') expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
