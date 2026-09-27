import { describe, expect, it } from 'vitest';
import { devRendererUrl } from '../../src/main/devMode.js';

describe('devRendererUrl', () => {
  it('gives the dev server URL when unpackaged and the env var is set', () => {
    expect(devRendererUrl(false, { ELECTRON_RENDERER_URL: 'http://localhost:5173' })).toBe('http://localhost:5173');
  });

  it('ignores the env var when packaged', () => {
    expect(devRendererUrl(true, { ELECTRON_RENDERER_URL: 'http://evil.example' })).toBeNull();
  });

  it('is null when the env var is missing or empty', () => {
    expect(devRendererUrl(false, {})).toBeNull();
    expect(devRendererUrl(false, { ELECTRON_RENDERER_URL: '' })).toBeNull();
  });
});
