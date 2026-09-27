import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
    },
    projects: [
      {
        test: {
          name: 'node',
          include: [
            'test/core/**/*.test.ts',
            'test/main/**/*.test.ts',
            'test/release/**/*.test.ts',
            'test/repo/**/*.test.ts',
            'test/site/**/*.test.ts',
          ],
          environment: 'node',
          testTimeout: 30_000,
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'renderer',
          include: ['test/renderer/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['test/renderer/setup.ts'],
          testTimeout: 30_000,
        },
      },
    ],
  },
});
