import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  // Keep built asset URLs relative so the app works from any GitHub Pages
  // repository path (and in local static previews).
  base: './',
  define: {
    'THREE.REVISION': JSON.stringify('184'),
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html'),
        origins: resolve(process.cwd(), 'origins.html'),
        realityEngineV69: resolve(process.cwd(), 'reality-engine-v6-9.html'),
        sumer: resolve(process.cwd(), 'sumer.html'),
      },
    },
  },
});
