import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assetMime, resolveAppPath } from '../../src/main/appServer.js';

const ROOT = path.resolve('/app/out/renderer');

describe('resolveAppPath', () => {
  it('maps the root URL to index.html and a file URL to its file', () => {
    expect(resolveAppPath('renami-app://app/', ROOT)).toBe(path.join(ROOT, 'index.html'));
    expect(resolveAppPath('renami-app://app/assets/main.js', ROOT)).toBe(path.join(ROOT, 'assets', 'main.js'));
  });

  it('never resolves outside the renderer folder', () => {
    // WHATWG URL parsing already collapses `..` and `%2e%2e` dot segments before pathname, so
    // these two come back INSIDE root (a nonexistent path that 404s at readFile), not null.
    // The invariant under test is only "never escapes root".
    const inRoot = (r: string | null): boolean => r === null || r.startsWith(ROOT + path.sep);
    expect(inRoot(resolveAppPath('renami-app://app/../../../etc/passwd', ROOT))).toBe(true);
    expect(inRoot(resolveAppPath('renami-app://app/%2e%2e/%2e%2e/etc/passwd', ROOT))).toBe(true);
    // %2f survives URL parsing; decodeURIComponent turns it into a real `../`, which must be caught.
    expect(resolveAppPath('renami-app://app/assets/..%2f..%2f..%2fsecret', ROOT)).toBeNull();
    // %5c is a backslash: a path separator on Windows, a plain name character elsewhere.
    expect(inRoot(resolveAppPath('renami-app://app/..%5c..%5csecret', ROOT))).toBe(true);
    expect(inRoot(resolveAppPath('renami-app://app/assets/..%5c..%5c..%5csecret', ROOT))).toBe(true);
  });

  it('refuses a malformed percent-escape', () => {
    expect(resolveAppPath('renami-app://app/%E0%A4%A', ROOT)).toBeNull();
  });

  it('refuses other hosts and unparseable URLs', () => {
    expect(resolveAppPath('renami-app://evil/index.html', ROOT)).toBeNull();
    expect(resolveAppPath('not a url', ROOT)).toBeNull();
  });
});

describe('assetMime', () => {
  it('knows the built page types and falls back to octet-stream', () => {
    expect(assetMime('index.html')).toBe('text/html; charset=utf-8');
    expect(assetMime('a.js')).toBe('text/javascript');
    expect(assetMime('a.css')).toBe('text/css');
    expect(assetMime('a.woff')).toBe('font/woff');
    expect(assetMime('a.woff2')).toBe('font/woff2');
    expect(assetMime('a.unknownext')).toBe('application/octet-stream');
  });
});
