const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app-seeded.js'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'core/lofi-living-runtime.js'), 'utf8');
const classicEntry = fs.readFileSync(path.join(root, 'core/surface-mode-entry.js'), 'utf8');
const productionLoader = fs.readFileSync(path.join(root, 'core/experimental-spherical-world.js'), 'utf8');
const spherical = fs.readFileSync(path.join(root, 'core/single-spherical-world-renderer.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const failures = [];

for (const marker of ['configurePlanetGeneration', 'planet.interior-tectonics', 'createLofiLivingRuntime']) {
  if (!app.includes(marker)) failures.push(`seeded simulation root missing: ${marker}`);
}
for (const marker of ['root-module-host-fixed-step', 'living.sampleDynamicPlanet', 'waterCycle.sample', 'planet-inspector']) {
  if (!runtime.includes(marker)) failures.push(`simulation/runtime contract missing: ${marker}`);
}
for (const marker of ['surface-mode-sphere-controller-v33.js', 'surface-cpu-relief.js', 'presentation-invariant-compat.js']) {
  if (!classicEntry.includes(marker)) failures.push(`legacy renderer entry missing: ${marker}`);
}
if (!index.includes('src="./core/surface-mode-entry.js?')) failures.push('index does not retain the legacy surface stack');
if (!index.includes('src="./core/experimental-spherical-world.js?')) failures.push('index does not load the spherical production gate');
if (index.includes('src="./core/single-spherical-world-renderer.js?')) failures.push('spherical renderer is booted directly rather than through its fallback-safe loader');
if (!productionLoader.includes("rendererChoice === 'spherical'")) failures.push('spherical renderer lacks an explicit URL enable flag');
if (!productionLoader.includes("rendererChoice === 'classic'")) failures.push('legacy renderer lacks an explicit URL fallback flag');
if (!productionLoader.includes('productionDefault: true')) failures.push('spherical renderer is not marked as the production default');
if (!productionLoader.includes("import('./single-spherical-world-renderer.js?")) failures.push('production loader does not lazy-load the spherical renderer');

for (const marker of [
  "import * as THREE from 'three'",
  'new THREE.WebGLRenderer',
  'new THREE.PerspectiveCamera',
  "model: 'single-three-scene-single-camera-spherical-lod'",
  'GLOBAL_LOD_TIERS',
  'function ensureGlobalLod()',
  'function updateAdaptiveDpr(dt, now)',
  'rendererSwaps: 0',
  'canvasSwaps: 0',
]) {
  if (!spherical.includes(marker)) failures.push(`production spherical renderer missing: ${marker}`);
}

if (failures.length) {
  console.error('Root renderer audit failed:\n');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log('Root renderer audit passed: the smooth single-scene spherical renderer is authoritative and the classic Pixi/Surface stack remains available as an explicit fallback.');
