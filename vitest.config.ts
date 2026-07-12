import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the DOM-free core math live in `src/*.test.ts`.
 * The Playwright accessibility/E2E suite in `e2e/` is driven by
 * `@playwright/test` (via `npm run test:a11y`), NOT vitest, so it is
 * excluded here to avoid double-collection.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    environment: 'node',
  },
});
