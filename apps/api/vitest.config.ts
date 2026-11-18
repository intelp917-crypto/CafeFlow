import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Each test file opens its own SQLite database file, so files are isolated.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
