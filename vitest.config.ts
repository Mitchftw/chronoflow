import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Playwright owns e2e/*.spec.ts; Vitest only runs unit tests in src.
    include: ['src/**/*.spec.ts'],
  },
});
