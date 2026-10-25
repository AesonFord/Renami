import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { releaseFuses, section, value } from '../../scripts/release-config.mjs';

// electron-builder.store.yml shares electron-builder.common.yml with the direct-download config but
// can't extend electron-builder.yml itself (that one sets identity "-", and an extending config
// can't unset it). What it repeats from the other configs is pinned here, with the parts of the
// store build a submission depends on.

const base = readFileSync('electron-builder.yml', 'utf8');
const release = readFileSync('electron-builder.release.yml', 'utf8');
const store = readFileSync('electron-builder.store.yml', 'utf8');
const STORE = 'electron-builder.store.yml';
const mas = section(store, 'mas', STORE);

describe('electron-builder.store.yml', () => {
  it('extends the common config, like the base config, and sets no signing identity', () => {
    expect(value(store, 'extends')).toBe('./electron-builder.common.yml');
    expect(value(base, 'extends')).toBe('./electron-builder.common.yml');
    expect(store).not.toMatch(/^\s*identity:/m);
  });

  it('keeps appId and productName identical to the base config', () => {
    for (const key of ['appId', 'productName']) expect(value(store, key)).toBe(value(base, key));
  });

  it('sets the same fuses as the release config', () => {
    expect(releaseFuses(store)).toEqual(releaseFuses(release));
  });

  it('builds the Mac App Store and Microsoft Store targets, and nothing for Linux', () => {
    expect(value(section(store, 'mac', STORE), 'target')).toBe('mas');
    expect(value(section(store, 'win', STORE), 'target')).toBe('appx');
    expect(store).not.toMatch(/^linux:/m);
  });

  it('names the sandbox entitlements', () => {
    expect(value(mas, 'entitlements')).toBe('build/entitlements.mas.plist');
    expect(value(mas, 'entitlementsInherit')).toBe('build/entitlements.mas.inherit.plist');
  });
});

describe('the Mac App Store entitlements', () => {
  const keys = (file: string) => [...readFileSync(file, 'utf8').matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]);

  it('sandbox the app, let it write the files the user picks, and grant no network access', () => {
    expect(keys('build/entitlements.mas.plist')).toEqual([
      'com.apple.security.app-sandbox',
      'com.apple.security.files.user-selected.read-write',
      'com.apple.security.files.bookmarks.app-scope',
    ]);
  });

  it('let helpers and ExifTool inherit the sandbox', () => {
    expect(keys('build/entitlements.mas.inherit.plist')).toEqual(['com.apple.security.app-sandbox', 'com.apple.security.inherit']);
  });
});
