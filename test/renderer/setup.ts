import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest globals are off, so Testing Library can't register its own cleanup.
afterEach(cleanup);

// jsdom has no layout. The preview table's virtualizer sizes itself from offsetWidth and
// offsetHeight (initialRect alone is not enough), so give every element a fixed box.
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 600 });
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 1000 });

// jsdom can't load media; the preview panel calls load() to let go of a video it removes.
HTMLMediaElement.prototype.load = () => {};
