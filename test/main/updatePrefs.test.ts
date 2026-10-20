import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_UPDATE_PREFS, loadUpdatePrefs, saveUpdatePrefs } from '../../src/main/updatePrefs.js';

const prefsFile = () => path.join(mkdtempSync(path.join(tmpdir(), 'renami-updates-')), 'updates.json');

describe('loadUpdatePrefs', () => {
  it('loads defaults when the file is missing', async () => {
    expect(await loadUpdatePrefs(prefsFile())).toEqual(DEFAULT_UPDATE_PREFS);
    expect(DEFAULT_UPDATE_PREFS).toEqual({ autoCheck: true, skippedVersion: null, lastCheckedAt: null });
  });

  it('loads defaults from garbage', async () => {
    const file = prefsFile();
    writeFileSync(file, '{not json');
    expect(await loadUpdatePrefs(file)).toEqual(DEFAULT_UPDATE_PREFS);
    writeFileSync(file, '{"autoCheck":"yes","skippedVersion":5,"lastCheckedAt":"x"}');
    expect(await loadUpdatePrefs(file)).toEqual(DEFAULT_UPDATE_PREFS);
    writeFileSync(file, '{"skippedVersion":"not-a-version"}');
    expect(await loadUpdatePrefs(file)).toEqual(DEFAULT_UPDATE_PREFS);
    writeFileSync(file, 'null');
    expect(await loadUpdatePrefs(file)).toEqual(DEFAULT_UPDATE_PREFS);
    writeFileSync(file, '{"autoCheck":false}');
    expect(await loadUpdatePrefs(file)).toEqual({ autoCheck: false, skippedVersion: null, lastCheckedAt: null });
  });
});

describe('saveUpdatePrefs', () => {
  it('round-trips what it saves', async () => {
    const file = prefsFile();
    const prefs = { autoCheck: false, skippedVersion: '0.3.0', lastCheckedAt: 1_760_000_000_000 };
    await saveUpdatePrefs(file, prefs);
    expect(await loadUpdatePrefs(file)).toEqual(prefs);
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it('does not throw when it cannot write', async () => {
    const file = path.join(path.dirname(prefsFile()), 'missing-dir', 'updates.json');
    await expect(saveUpdatePrefs(file, DEFAULT_UPDATE_PREFS)).resolves.toBeUndefined();
  });
});
