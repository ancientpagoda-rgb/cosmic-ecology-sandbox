import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/reality-sandbox/',
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
        cohesionLab: resolve(process.cwd(), 'cohesion-lab.html'),
        emergenceLab: resolve(process.cwd(), 'emergence-lab.html'),
        worldCoreLab: resolve(process.cwd(), 'world-core-lab.html'),
        hexOctreeLab: resolve(process.cwd(), 'hex-octree-lab.html'),
        planetRendererLab: resolve(process.cwd(), 'planet-renderer-lab.html'),
        potreePlanetLab: resolve(process.cwd(), 'potree-planet-lab.html'),
        openSpaceBridgeLab: resolve(process.cwd(), 'openspace-bridge-lab.html'),
        realityLab: resolve(process.cwd(), 'reality-lab.html'),
        realityFlightLab: resolve(process.cwd(), 'reality-flight-lab.html'),
        realityEngineV1: resolve(process.cwd(), 'reality-engine-v1.html'),
        realityEngineV2: resolve(process.cwd(), 'reality-engine-v2.html'),
        realityEngineV3: resolve(process.cwd(), 'reality-engine-v3.html'),
        realityEngineV4: resolve(process.cwd(), 'reality-engine-v4.html'),
        realityEngineV5: resolve(process.cwd(), 'reality-engine-v5.html'),
        realityWorldWindV5: resolve(process.cwd(), 'reality-worldwind-v5.html'),
        realityV5Export: resolve(process.cwd(), 'reality-v5-export.html'),
        realityEngineV6: resolve(process.cwd(), 'reality-engine-v6.html'),
        realityEngineV61: resolve(process.cwd(), 'reality-engine-v6-1.html'),
        realityEngineV62: resolve(process.cwd(), 'reality-engine-v6-2.html'),
        realityEngineV63: resolve(process.cwd(), 'reality-engine-v6-3.html'),
        realityEngineV64: resolve(process.cwd(), 'reality-engine-v6-4.html'),
        realityEngineV65: resolve(process.cwd(), 'reality-engine-v6-5.html'),
        realityEngineV66: resolve(process.cwd(), 'reality-engine-v6-6.html'),
        realityEngineV67: resolve(process.cwd(), 'reality-engine-v6-7.html'),
        realityEngineV68: resolve(process.cwd(), 'reality-engine-v6-8.html'),
      },
    },
  },
});
