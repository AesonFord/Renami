import { describe, expect, it } from 'vitest';
import { isStoreInstall } from '../../src/main/distribution.js';

// A store install must never ask GitHub for releases (see electron-builder.store.yml), so each
// store's signal has to be recognised, and a plain install must not be mistaken for one.

describe('isStoreInstall', () => {
  const direct = { mas: false, windowsStore: false, env: {} as NodeJS.ProcessEnv, execPath: '/Applications/Renami.app/Contents/MacOS/Renami' };

  it('is false for a direct download', () => {
    expect(isStoreInstall(direct)).toBe(false);
    expect(isStoreInstall({ ...direct, env: { HOME: '/home/me', PATH: '/usr/bin' } })).toBe(false);
  });

  it('recognises the Mac App Store build of Electron', () => {
    expect(isStoreInstall({ ...direct, mas: true })).toBe(true);
  });

  it('recognises a Microsoft Store (AppX) package', () => {
    expect(isStoreInstall({ ...direct, windowsStore: true })).toBe(true);
  });

  it('recognises a Flatpak sandbox', () => {
    expect(isStoreInstall({ ...direct, env: { FLATPAK_ID: 'app.renami' } })).toBe(true);
  });

  it('recognises a snap by the app running from the snap folder', () => {
    expect(isStoreInstall({ ...direct, env: { SNAP: '/snap/renami/42' }, execPath: '/snap/renami/42/renami-app' })).toBe(true);
  });

  it('is not fooled by SNAP inherited from a snapped terminal or editor', () => {
    expect(isStoreInstall({ ...direct, env: { SNAP: '/snap/code/180' }, execPath: '/home/me/Renami/node_modules/electron/dist/electron' })).toBe(false);
    expect(isStoreInstall({ ...direct, env: { SNAP: '/snap/code/180' }, execPath: '/snap/code/180-old/bin' })).toBe(false);
  });

  it('ignores an empty FLATPAK_ID or SNAP', () => {
    expect(isStoreInstall({ ...direct, env: { FLATPAK_ID: '', SNAP: '' }, execPath: '/renami' })).toBe(false);
  });
});
