const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app-seeded.js'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'core/lofi-living-runtime.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'core/single-spherical-world-renderer.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const failures = [];

for (const marker of ['configurePlanetGeneration', 'planet.interior-tectonics', 'createLofiLivingRuntime']) {
  if (!app.includes(marker)) failures.push(`seeded simulation root missing: ${marker}`);
}
for (const marker of ['root-module-host-fixed-step', 'living.sampleDynamicPlanet', 'waterCycle.sample', 'planet-inspector']) {
  if (!runtime.includes(marker)) failures.push(`simulation/runtime contract missing: ${marker}`);
}
for (const marker of [
  "import * as THREE from 'three'",
  'new THREE.WebGLRenderer',
  'new THREE.PerspectiveCamera',
  "model: 'single-three-scene-single-camera-spherical-lod'",
  'rendererSwaps: 0',
  'canvasSwaps: 0',
  'visibleCanvases.length !== 1',
]) {
  if (!renderer.includes(marker)) failures.push(`single world renderer missing: ${marker}`);
}
if (!index.includes('single-spherical-world-renderer.js')) failures.push('index does not load the single spherical renderer');
if (index.includes('src="./core/continuous-world-view.js?')) failures.push('retired two-renderer crossfade controller is still loaded');

if (failures.length) {
  console.error('Root renderer audit failed:\n');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log('Root renderer audit passed: one visible Three.js spherical scene/camera over the seeded living-world simulation.');
