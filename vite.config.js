import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/reality-sandbox/',
  build: {
    outDir: 'dist',
    sourcemap: false,
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html'),
        cohesionLab: resolve(process.cwd(), 'cohesion-lab.html'),
        emergenceLab: resolve(process.cwd(), 'emergence-lab.html'),
      },
    },
  },
});
