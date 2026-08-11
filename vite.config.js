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
      // Pages is the product artifact, not the experiment archive. Vite's dev
      // server can still open every root-level lab HTML file directly. The
      // Sumer page is an explicit experiment entry carried by its draft PR.
      input: {
        main: resolve(process.cwd(), 'index.html'),
        origins: resolve(process.cwd(), 'origins.html'),
        sumer: resolve(process.cwd(), 'sumer.html'),
        realityEngineV69: resolve(process.cwd(), 'reality-engine-v6-9.html'),
      },
    },
  },
});