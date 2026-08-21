import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import {
  CAMERA_FAR,
  CAMERA_NEAR,
  LOCAL_PATCH_RADIUS_WORLD,
  PATCH_MOVE_THRESHOLD,
  PLANET_RADIUS,
  SPRINT_SPEED,
  STARFIELD_MIN_RADIUS,
  STARFIELD_SPAN,
  SUN_POSITION,
  WALK_SPEED,
} from './core/planet-scale.js';

function nativeTenXPlanetPlugin() {
  const rendererReplacements = [
    ['const PLANET_RADIUS = 220;', `const PLANET_RADIUS = ${PLANET_RADIUS};`],
    ['const LOCAL_PATCH_RADIUS_WORLD = 148;', `const LOCAL_PATCH_RADIUS_WORLD = ${LOCAL_PATCH_RADIUS_WORLD};`],
    ['const PATCH_MOVE_THRESHOLD = 18;', `const PATCH_MOVE_THRESHOLD = ${PATCH_MOVE_THRESHOLD};`],
    [
      'const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.05, 12000);',
      `const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, ${CAMERA_NEAR}, ${CAMERA_FAR});`,
    ],
    ['sun.position.set(800, 520, 420);', `sun.position.set(${SUN_POSITION.join(', ')});`],
    ['const radius = 2600 + rj * 3200;', `const radius = ${STARFIELD_MIN_RADIUS} + rj * ${STARFIELD_SPAN};`],
    [
      "const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 24 : 8;",
      `const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? ${SPRINT_SPEED} : ${WALK_SPEED};`,
    ],
  ];
  const gamepadReplacements = [
    ['const speed = sprint ? 24 : 8;', `const speed = sprint ? ${SPRINT_SPEED} : ${WALK_SPEED};`],
  ];

  const applyExactReplacements = (plugin, code, id, replacements) => {
    let next = code;
    for (const [from, to] of replacements) {
      if (!next.includes(from)) plugin.error(`[eidolon-native-ten-x-planet] Expected source marker missing in ${id}: ${from}`);
      next = next.replace(from, to);
    }
    return { code: next, map: null };
  };

  return {
    name: 'eidolon-native-ten-x-planet',
    enforce: 'pre',
    transform(code, id) {
      const cleanId = id.split('?')[0].replace(/\\/g, '/');
      if (cleanId.endsWith('/core/single-spherical-world-renderer.js')) {
        return applyExactReplacements(this, code, cleanId, rendererReplacements);
      }
      if (cleanId.endsWith('/core/spherical-input-polish-v88.js')) {
        return applyExactReplacements(this, code, cleanId, gamepadReplacements);
      }
      return null;
    },
  };
}

export default defineConfig({
  // Scale is compiled into the renderer before it constructs any Three.js
  // geometry or camera state. This keeps terrain, fauna, camera, atmosphere,
  // and input in one coordinate system instead of remapping objects afterward.
  plugins: [nativeTenXPlanetPlugin()],
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
      // server can still open every root-level lab HTML file directly, but the
      // public deployment should contain only the living planet, its Origins
      // prologue, and the explicitly linked V6.9 compatibility page.
      input: {
        main: resolve(process.cwd(), 'index.html'),
        origins: resolve(process.cwd(), 'origins.html'),
        frontierLab: resolve(process.cwd(), 'frontier-lab.html'),
        realityEngineV69: resolve(process.cwd(), 'reality-engine-v6-9.html'),
      },
    },
  },
});
