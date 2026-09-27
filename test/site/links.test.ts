import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLATFORMS, installerNames } from '../../scripts/release-config.mjs';

// The download page links to releases/latest/download/<name>, so its links and the installers a
// release holds must agree. installerNames reads the names from electron-builder.yml.

describe('the download page', () => {
  const html = readFileSync('site/index.html', 'utf8');
  const LATEST = 'https://github.com/AesonFord/Renami/releases/latest/download/';

  it('links to every installer a release holds, and nothing else', () => {
    const linked = [...html.matchAll(/href="([^"]+)"/g)]
      .map((m) => m[1] ?? '')
      .filter((href) => href.startsWith(LATEST))
      .map((href) => href.slice(LATEST.length));
    const released = PLATFORMS.flatMap((platform) => installerNames(platform));
    expect([...new Set(linked)].sort()).toEqual([...released].sort());
  });

  it('has the #download and #install anchors other pages link to', () => {
    expect(html).toContain('id="download"');
    expect(html).toContain('id="install"');
  });
});
