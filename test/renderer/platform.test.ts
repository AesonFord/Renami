import { describe, expect, it } from 'vitest';
import { markPlatform } from '../../src/renderer/lib/platform.js';

describe('markPlatform', () => {
  it('writes the platform onto the element for CSS to scope on', () => {
    const root = document.createElement('html');
    markPlatform(root, 'darwin');
    expect(root.dataset.platform).toBe('darwin');
    markPlatform(root, 'win32');
    expect(root.dataset.platform).toBe('win32');
  });
});
