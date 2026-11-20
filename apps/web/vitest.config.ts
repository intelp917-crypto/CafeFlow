import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Renderer tests only: they mount one game screen against a state the server
 * would send, so no browser, API or socket is involved.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@cafeflow/ui': fileURLToPath(new URL('../../packages/ui/src/index.ts', import.meta.url)),
      '@cafeflow/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
