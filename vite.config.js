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
      // Pages is the product artifact. Sumer is an explicitly linked parallel
      // experiment powered by the reusable reality kernel; the living-planet
      // root remains the v76 single-scene world view.
      input: {
        main: resolve(process.cwd(), 'index.html'),
        origins: resolve(process.cwd(), 'origins.html'),
        realityEngineV69: resolve(process.cwd(), 'reality-engine-v6-9.html'),
        sumer: resolve(process.cwd(), 'sumer.html'),
      },
    },
  },
});
