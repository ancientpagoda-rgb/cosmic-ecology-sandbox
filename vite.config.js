import { defineConfig } from 'vite';

export default defineConfig({
  base: '/reality-sandbox/',
  build: {
    outDir: 'dist',
    sourcemap: false,
    assetsDir: 'assets',
  },
});
