import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fuseMismatches, installerNames, releaseFuses, unpackedApps } from '../../scripts/release-config.mjs';

const toCrlf = (text: string) => text.replace(/\n/g, '\r\n');

describe('installerNames', () => {
  it('names every installer without the version, so latest/download URLs never go stale', () => {
    expect(installerNames('mac')).toEqual(['Renami-mac-arm64.dmg', 'Renami-mac-x64.dmg']);
    expect(installerNames('win')).toEqual(['Renami-win-x64-setup.exe']);
    expect(installerNames('linux')).toEqual(['Renami-linux-x86_64.AppImage', 'Renami-linux-amd64.deb']);
  });

  it('refuses a platform it does not know', () => {
    expect(() => installerNames('darwin' as never)).toThrow('Unknown platform darwin; expected mac, win or linux');
  });

  it('names the section when a target sets no artifactName', () => {
    const yml = 'productName: Renami\nmac:\n  target: dmg\nnsis:\n  oneClick: false\n';
    expect(() => installerNames('mac', yml)).toThrow("electron-builder.yml's mac: section sets no artifactName");
  });

  it('reads a CRLF checkout of electron-builder.yml the same as the LF original', () => {
    const crlfYml = toCrlf(readFileSync('electron-builder.yml', 'utf8'));
    expect(installerNames('win', crlfYml)).toEqual(installerNames('win'));
  });
});

describe('unpackedApps', () => {
  it('finds each platform build where electron-builder leaves it', () => {
    expect(unpackedApps('mac')).toEqual([
      { arch: 'arm64', app: 'dist/mac-arm64/Renami.app', exe: 'dist/mac-arm64/Renami.app/Contents/MacOS/Renami' },
      { arch: 'x64', app: 'dist/mac/Renami.app', exe: 'dist/mac/Renami.app/Contents/MacOS/Renami' },
    ]);
    expect(unpackedApps('win')).toEqual([
      { arch: 'x64', app: 'dist/win-unpacked/Renami.exe', exe: 'dist/win-unpacked/Renami.exe' },
    ]);
    expect(unpackedApps('linux')).toEqual([
      { arch: 'x64', app: 'dist/linux-unpacked/renami', exe: 'dist/linux-unpacked/renami' },
    ]);
  });

  it('reads a CRLF checkout of electron-builder.yml the same as the LF original', () => {
    const crlfYml = toCrlf(readFileSync('electron-builder.yml', 'utf8'));
    expect(unpackedApps('linux', crlfYml)).toEqual(unpackedApps('linux'));
  });
});

describe('releaseFuses', () => {
  it('reads the fuses electron-builder.release.yml sets, by their @electron/fuses names', () => {
    expect(releaseFuses()).toEqual({
      RunAsNode: false,
      EnableCookieEncryption: true,
      EnableNodeOptionsEnvironmentVariable: false,
      EnableNodeCliInspectArguments: false,
      OnlyLoadAppFromAsar: true,
      EnableEmbeddedAsarIntegrityValidation: true,
    });
  });

  // An empty expectation would let the fuse check pass while checking nothing.
  it('refuses a config with no fuses rather than expecting none', () => {
    expect(() => releaseFuses('extends: ./electron-builder.yml\n')).toThrow(
      'electron-builder.release.yml has no electronFuses: section',
    );
    expect(() => releaseFuses('electronFuses:\n  resetAdHocDarwinSignature: true\n')).toThrow(
      'electron-builder.release.yml sets no fuses under electronFuses:',
    );
  });

  it('reads a CRLF checkout of electron-builder.release.yml the same as the LF original', () => {
    const crlfYml = toCrlf(readFileSync('electron-builder.release.yml', 'utf8'));
    expect(releaseFuses(crlfYml)).toEqual(releaseFuses());
  });

  it('still finds every fuse when a blank line and a column-0 comment sit inside the section', () => {
    const withGaps = readFileSync('electron-builder.release.yml', 'utf8').replace(
      '  runAsNode: false\n',
      '  runAsNode: false\n\n# a stray comment\n',
    );
    expect(releaseFuses(withGaps)).toEqual(releaseFuses());
  });
});

describe('fuseMismatches', () => {
  const OPTIONS = { RunAsNode: 0, EnableCookieEncryption: 1 };
  const DISABLED = 48;
  const ENABLED = 49;

  it('finds nothing when every fuse is as configured', () => {
    expect(fuseMismatches({ 0: DISABLED, 1: ENABLED }, { RunAsNode: false, EnableCookieEncryption: true }, OPTIONS)).toEqual([]);
  });

  it('names each fuse left in the wrong state', () => {
    expect(fuseMismatches({ 0: ENABLED, 1: DISABLED }, { RunAsNode: false, EnableCookieEncryption: true }, OPTIONS)).toEqual([
      'RunAsNode is enabled, expected disabled',
      'EnableCookieEncryption is disabled, expected enabled',
    ]);
  });

  it('reports a fuse the binary does not have, or one @electron/fuses does not know', () => {
    expect(fuseMismatches({ 0: DISABLED }, { EnableCookieEncryption: true, NoSuchFuse: true }, OPTIONS)).toEqual([
      'EnableCookieEncryption is missing from this Electron binary, expected enabled',
      'NoSuchFuse is not a fuse @electron/fuses knows',
    ]);
  });
});

// Only the release workflow runs check-fuses.mjs, so a broken import would otherwise first show up
// after every installer has been built.
describe('check-fuses.mjs', () => {
  it('loads with the installed @electron/fuses, and refuses a platform it does not know', () => {
    const run = spawnSync(process.execPath, ['scripts/check-fuses.mjs', 'nope'], { encoding: 'utf8' });
    expect(run.stderr).not.toContain('SyntaxError');
    expect(run.stderr).toContain('Unknown platform nope; expected mac, win or linux');
    expect(run.status).not.toBe(0);
  });
});
