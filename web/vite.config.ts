import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The viewer is served by the daemon from dist/web, on the daemon's own origin.
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [react()],
  // Shiki ships one chunk per language and theme, loaded on demand; some are large by nature.
  logLevel: 'warn',
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1024,
  },
});
