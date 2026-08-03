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
        worldCoreLab: resolve(process.cwd(), 'world-core-lab.html'),
        hexOctreeLab: resolve(process.cwd(), 'hex-octree-lab.html'),
        planetRendererLab: resolve(process.cwd(), 'planet-renderer-lab.html'),
        potreePlanetLab: resolve(process.cwd(), 'potree-planet-lab.html'),
        openSpaceBridgeLab: resolve(process.cwd(), 'openspace-bridge-lab.html'),
        realityLab: resolve(process.cwd(), 'reality-lab.html'),
        realityFlightLab: resolve(process.cwd(), 'reality-flight-lab.html'),
      },
    },
  },
});
