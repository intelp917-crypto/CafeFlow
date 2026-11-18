import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // The web app consumes the workspace packages as TypeScript source, so a
      // design-system change needs no rebuild step.
      '@cafeflow/ui': fileURLToPath(new URL('../../packages/ui/src/index.ts', import.meta.url)),
      '@cafeflow/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      // Same-origin API calls in development: the session cookie stays first
      // party, so no CORS relaxation is needed.
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
