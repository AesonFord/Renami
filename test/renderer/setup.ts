import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest globals are off, so Testing Library can't register its own cleanup.
afterEach(cleanup);

// jsdom has no layout. The preview table's virtualizer sizes its scroll element from
// clientWidth/clientHeight (virtual-core 3.19.6+; offsetWidth/offsetHeight before that, and
// initialRect alone is not enough), so give every element a fixed box on both.
for (const [prop, value] of [['Height', 600], ['Width', 1000]] as const) {
  Object.defineProperty(HTMLElement.prototype, `offset${prop}`, { configurable: true, get: () => value });
  Object.defineProperty(HTMLElement.prototype, `client${prop}`, { configurable: true, get: () => value });
}

// jsdom can't load media; the preview panel calls load() to let go of a video it removes.
HTMLMediaElement.prototype.load = () => {};
