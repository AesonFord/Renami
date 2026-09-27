import { defineConfig } from '@playwright/test';

// Without testDir, Playwright would also pick up Vitest's test/**/*.test.ts files.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
});
