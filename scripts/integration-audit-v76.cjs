const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const failures = [];
const passes = [];

function read(file) {
  const target = path.join(root, file);
  if (!fs.existsSync(target)) {
    failures.push(`missing file: ${file}`);
    return '';
  }
  return fs.readFileSync(target, 'utf8');
}
function requireText(file, marker, label = marker) {
  if (read(file).includes(marker)) passes.push(`${file}: ${label}`);
  else failures.push(`${file}: missing ${label}`);
}
function forbidText(file, marker, label = marker) {
  if (read(file).includes(marker)) failures.push(`${file}: contains forbidden ${label}`);
  else passes.push(`${file}: no ${label}`);
}

requireText('index.html', 'Procedural Living Planet', 'fictional living-planet title');
requireText('index.html', 'src="./app-seeded.js?', 'seeded simulation root');
requireText('index.html', 'src="./core/single-spherical-world-renderer.js?', 'true single-scene world renderer');
forbidText('index.html', 'src="./core/continuous-world-view.js?', 'retired two-renderer crossfade controller');
requireText('index.html', 'build-surface-mode-v76-one-three-scene-one-camera', 'v76 build marker');

for (const marker of [
  'createOrbitalSystem', 'configurePlanetGeneration', 'createWaterCycle', 'createLivingSystems',
  'createBiosphere', 'createEcologyJournal', 'createSeasonalResourceFields', 'createPlanetDynamics',
  'createLofiLivingRuntime', 'planet.interior-tectonics', 'planet.water-cycle', 'planet.living-ecology',
  'ecology.seasonal-resource-fields', 'planet.climate-terrain-feedbacks',
]) requireText('app-seeded.js', marker, `simulation root ${marker}`);

for (const file of ['core/world.js', 'core/living-systems.js', 'core/biosphere.js', 'core/planet-dynamics.js']) {
  forbidText(file, 'Math.random()', 'unseeded random call');
}
requireText('core/monotonic-world-clock.js', 'monotonic', 'monotonic world clock guard');
requireText('core/reproductive-isolation.js', 'sexual-recombination', 'reproductive isolation/recombination');
requireText('core/hybrid-dynamics.js', 'genomicAncestry', 'multigenerational ancestry');
requireText('core/life-history-selection.js', 'starvation', 'life-history mortality');
requireText('core/social-learning.js', 'rewardMemory', 'individual/social learning');
requireText('core/cultural-traditions.js', 'cultural', 'non-genetic tradition layer');
requireText('core/predator-dispersal.js', 'prey', 'coarse predator dispersal');

for (const marker of [
  "import * as THREE from 'three'", 'new THREE.WebGLRenderer', 'new THREE.PerspectiveCamera',
  "model: 'single-three-scene-single-camera-spherical-lod'", 'oneScene: true', 'oneCamera: true',
  'rendererSwaps: 0', 'canvasSwaps: 0', 'new THREE.SphereGeometry(PLANET_RADIUS',
  'LOCAL_PATCH_SEGMENTS', 'buildGlobalPlanet()', 'buildPatch()', 'createOrResizeFauna',
  'runtime.setPresentationSuspended', 'visibleCanvases.length !== 1',
]) requireText('core/single-spherical-world-renderer.js', marker, `single renderer ${marker}`);

forbidText('core/single-spherical-world-renderer.js', 'surface.enterAt(', 'Surface Mode camera handoff');
forbidText('core/single-spherical-world-renderer.js', 'surface.exit(', 'Surface Mode exit handoff');
requireText('core/single-spherical-world-renderer.js', '#surfaceModeLayer,#enterSurfaceMode', 'legacy surface UI hidden');
requireText('core/single-spherical-world-renderer.js', 'previousSetPresentationSuspended?.(true)', 'retired Pixi presentation suspended');

requireText('scripts/continuous-world-view-check.cjs', "'eidolonSingleWorldCanvas'", 'one visible canvas assertion');
requireText('scripts/continuous-world-view-check.cjs', 'assertSameRenderer', 'same renderer across altitude sweep');
requireText('scripts/continuous-world-view-check.cjs', 'rendererSwaps === 0', 'zero renderer swaps assertion');
requireText('scripts/continuous-world-view-check.cjs', 'canvasSwaps === 0', 'zero canvas swaps assertion');
requireText('scripts/continuous-world-view-check.cjs', 'altitudeSequence', 'ground-to-orbit altitude sweep');
requireText('scripts/continuous-world-view-check.cjs', 'Simulation stopped in local LOD', 'simulation continuity assertion');
requireText('scripts/reality-check.cjs', 'exerciseDesktopInteraction', 'real browser interaction');
requireText('scripts/reality-check.cjs', 'exerciseBiology', 'causal reproduction scenario');
requireText('scripts/reality-check.cjs', 'exerciseLongRun', 'deterministic stress run');

requireText('package.json', '"check:view"', 'single-world-view regression command');
requireText('.github/workflows/reality-check.yml', 'npm run check:reality', 'full real Chromium gate');
requireText('.github/workflows/browser-smoke.yml', 'node scripts/reality-check.cjs', 'secondary browser interaction gate');
requireText('README.md', 'Eidolon is not Earth', 'fictional-world boundary');

if (failures.length) {
  console.error('Reality Sandbox v76 integration audit failed:\n');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error(`\n${passes.length} checks passed; ${failures.length} failed.`);
  process.exit(1);
}
console.log(`Reality Sandbox v76 integration audit passed: ${passes.length} checks.`);
for (const pass of passes) console.log(`  ✓ ${pass}`);
