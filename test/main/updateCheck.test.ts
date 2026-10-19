import { describe, expect, it } from 'vitest';
import {
  AUTO_CHECK_INTERVAL_MS,
  compareVersions,
  downloadUrl,
  installerName,
  isDueForAutoCheck,
  notesExcerpt,
  parseRelease,
  parseVersion,
  RELEASES_PAGE,
  type Release,
} from '../../src/main/updateCheck.js';

const MAC_ARM_URL = 'https://github.com/AesonFord/Renami/releases/download/v0.3.0/Renami-mac-arm64.dmg';
const PAGE_URL = 'https://github.com/AesonFord/Renami/releases/tag/v0.3.0';

const githubRelease = (over: Record<string, unknown> = {}) => ({
  tag_name: 'v0.3.0',
  html_url: PAGE_URL,
  body: "## What's new",
  draft: false,
  prerelease: false,
  assets: [{ name: 'Renami-mac-arm64.dmg', browser_download_url: MAC_ARM_URL }],
  ...over,
});

describe('parseVersion', () => {
  it('accepts v-prefixed and prerelease versions', () => {
    expect(parseVersion('v0.2.2')).toEqual({ major: 0, minor: 2, patch: 2, pre: [] });
    expect(parseVersion('1.0.0-beta.2')?.pre).toEqual(['beta', '2']);
  });

  it('rejects anything that is not a full version', () => {
    expect(parseVersion('latest')).toBeNull();
    expect(parseVersion('1.2')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('orders by number, not text', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('0.2.2', 'v0.2.2')).toBe(0);
  });

  it('orders prereleases below their release', () => {
    expect(compareVersions('0.3.0-beta.1', '0.3.0')).toBeLessThan(0);
    expect(compareVersions('0.3.0-beta.2', '0.3.0-beta.10')).toBeLessThan(0);
    expect(compareVersions('0.3.0-alpha', '0.3.0-beta')).toBeLessThan(0);
    expect(compareVersions('0.3.0-beta.1', '0.2.2')).toBeGreaterThan(0);
  });
});

describe('parseRelease', () => {
  it('reads a GitHub release', () => {
    expect(parseRelease(githubRelease())).toEqual({
      version: '0.3.0',
      pageUrl: PAGE_URL,
      notes: "## What's new",
      assets: [{ name: 'Renami-mac-arm64.dmg', url: MAC_ARM_URL }],
    });
  });

  it('rejects drafts, prereleases and malformed input', () => {
    expect(parseRelease(githubRelease({ draft: true }))).toBeNull();
    expect(parseRelease(githubRelease({ prerelease: true }))).toBeNull();
    expect(parseRelease(githubRelease({ tag_name: 'latest' }))).toBeNull();
    expect(parseRelease(githubRelease({ tag_name: undefined }))).toBeNull();
    expect(parseRelease(null)).toBeNull();
    expect(parseRelease('text')).toBeNull();
    expect(parseRelease([])).toBeNull();
  });

  it('tolerates missing notes and bad assets', () => {
    expect(parseRelease(githubRelease({ body: null }))?.notes).toBe('');
    expect(parseRelease(githubRelease({ assets: 'nope' }))?.assets).toEqual([]);
    const assets = [{ name: 5, browser_download_url: MAC_ARM_URL }, { name: 'a.dmg' }, null];
    expect(parseRelease(githubRelease({ assets }))?.assets).toEqual([]);
  });
});

describe('installerName', () => {
  it("matches each platform's installer", () => {
    expect(installerName('darwin', 'arm64', false)).toBe('Renami-mac-arm64.dmg');
    expect(installerName('darwin', 'x64', false)).toBe('Renami-mac-x64.dmg');
    expect(installerName('win32', 'x64', false)).toBe('Renami-win-x64-setup.exe');
    expect(installerName('linux', 'x64', true)).toBe('Renami-linux-x86_64.AppImage');
    expect(installerName('linux', 'x64', false)).toBe('Renami-linux-amd64.deb');
    expect(installerName('win32', 'arm64', false)).toBeNull();
  });
});

describe('downloadUrl', () => {
  const release = parseRelease(githubRelease()) as Release;

  it("picks the platform's asset, or the release page", () => {
    expect(downloadUrl(release, 'darwin', 'arm64', false)).toBe(MAC_ARM_URL);
    expect(downloadUrl(release, 'win32', 'x64', false)).toBe(PAGE_URL);
  });

  it('never returns an off-site URL', () => {
    const evil: Release = {
      ...release,
      pageUrl: 'https://evil.example/',
      assets: [{ name: 'Renami-mac-arm64.dmg', url: 'https://evil.example/Renami-mac-arm64.dmg' }],
    };
    expect(downloadUrl(evil, 'darwin', 'arm64', false)).toBe(RELEASES_PAGE);
    const elsewhere: Release = {
      ...evil,
      assets: [{ name: 'Renami-mac-arm64.dmg', url: 'https://github.com/someoneelse/Renami/x.dmg' }],
    };
    expect(downloadUrl(elsewhere, 'darwin', 'arm64', false)).toBe(RELEASES_PAGE);
    // A look-alike repository name must not pass the prefix check.
    const lookalike: Release = { ...release, assets: [], pageUrl: 'https://github.com/AesonFord/Renami-evil/' };
    expect(downloadUrl(lookalike, 'darwin', 'arm64', false)).toBe(RELEASES_PAGE);
  });
});

describe('notesExcerpt', () => {
  it('strips markdown', () => {
    expect(notesExcerpt('## New\n\n* **Fast** rename by [@x](https://github.com/x)\n')).toBe('New\n\n• Fast rename by @x');
  });

  it('truncates at a word boundary', () => {
    const body = 'word '.repeat(400);
    const text = notesExcerpt(body);
    expect(text.length).toBeLessThanOrEqual(601);
    expect(text.endsWith('…')).toBe(true);
    expect(text.slice(0, -1).endsWith('word')).toBe(true);
  });
});

describe('isDueForAutoCheck', () => {
  const now = 1_760_000_000_000;

  it('is due when never checked or a day has passed', () => {
    expect(isDueForAutoCheck(null, 0)).toBe(true);
    expect(isDueForAutoCheck(now - AUTO_CHECK_INTERVAL_MS, now)).toBe(true);
    expect(isDueForAutoCheck(now - AUTO_CHECK_INTERVAL_MS + 1, now)).toBe(false);
  });

  it('is due when the clock went backwards', () => {
    expect(isDueForAutoCheck(now + 1000, now)).toBe(true);
  });
});
