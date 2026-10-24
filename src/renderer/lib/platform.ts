import type { Platform } from '../../core/types.js';

/** Marks the page with its platform, so platform-only CSS applies from the first paint. */
export function markPlatform(root: HTMLElement, platform: Platform): void {
  root.dataset.platform = platform;
}
