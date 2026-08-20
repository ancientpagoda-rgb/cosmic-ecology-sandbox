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
requireText('index.html', 'src="./core/surface-mode-entry.js?', 'legacy surface stack retained as fallback');
requireText('index.html', 'src="./core/experimental-spherical-world.js?', 'spherical production loader');
forbidText('index.html', 'src="./core/single-spherical-world-renderer.js?', 'direct spherical renderer boot');
requireText('index.html', 'build-v86-smooth-spherical-default', 'v86 smooth default build marker');

requireText('core/experimental-spherical-world.js', "rendererChoice === 'spherical'", 'explicit spherical query flag');
requireText('core/experimental-spherical-world.js', "rendererChoice === 'classic'", 'explicit legacy fallback query flag');
requireText('core/experimental-spherical-world.js', 'productionDefault: true', 'spherical renderer production default');
requireText('core/experimental-spherical-world.js', "import('./single-spherical-world-renderer.js?", 'lazy production renderer import');
requireText('core/hide-foundry-panel.js', "selector: '.planet-foundry'", 'foundry panel cleanup retained');
forbidText('core/hide-foundry-panel.js', "selector: '#enterSurfaceMode'", 'legacy enter control hiding');
forbidText('core/hide-foundry-panel.js', "selector: '#surfaceModeHud button'", 'legacy exit control hiding');

for (const marker of [
  'createOrbitalSystem', 'configurePlanetGeneration', 'createWaterCycle', 'createLivingSystems',
  'createBiosphere', 'createEcologyJournal', 'createSeasonalResourceFields', 'createPlanetDynamics',
  'createLofiLivingRuntime', 'planet.interior-tectonics', 'planet.water-cycle', 'planet.living-ecology',
  'ecology.seasonal-resource-fields', 'planet.climate-terrain-feedbacks',
]) requireText('app-seeded.js', marker, `simulation root ${marker}`);

for (const file of ['core/world.js', 'core/living-systems.js', 'core/biosphere.js', 'core/planet-dynamics.js']) {
  forbidText(file, 'Math.random()', 'unseeded random call');
}

for (const marker of [
  'const DEFAULT_ALTITUDE = 12',
  'const LOCAL_PATCH_SEGMENTS = 112',
  'const LOCAL_PATCH_BUILD_ALTITUDE = 420',
  "{ name: 'ground', maxAltitude: 70, widthSegments: 192, heightSegments: 120 }",
  'const DESKTOP_DPR_CAP = 2.5',
  'function ensureGlobalLod()',
  'function updateAdaptiveDpr(dt, now)',
  'buildPatch();',
  'renderPixelRatio',
]) requireText('core/single-spherical-world-renderer.js', marker, `production quality ${marker}`);
forbidText('core/single-spherical-world-renderer.js', '.eidolon-creatures{display:none', 'forced creature-layer hiding');

requireText('scripts/visual-quality-check.cjs', "classic-overview.png", 'legacy fallback screenshot artifact');
requireText('scripts/visual-quality-check.cjs', "classic-surface.png", 'legacy surface screenshot artifact');
requireText('scripts/visual-quality-check.cjs', "experimental-spherical.png", 'smooth default screenshot artifact');
requireText('scripts/visual-quality-check.cjs', 'colorBuckets', 'visual diversity regression metric');
requireText('scripts/visual-quality-check.cjs', 'edgeMean', 'spatial-detail regression metric');
requireText('.github/workflows/browser-smoke.yml', 'node scripts/visual-quality-check.cjs', 'CI visual regression gate');
requireText('package.json', '"check:visual"', 'visual regression command');
requireText('README.md', 'Eidolon is not Earth', 'fictional-world boundary');

if (failures.length) {
  console.error('Reality Sandbox v86 integration audit failed:\n');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error(`\n${passes.length} checks passed; ${failures.length} failed.`);
  process.exit(1);
}
console.log(`Reality Sandbox v86 integration audit passed: ${passes.length} checks.`);
for (const pass of passes) console.log(`  ✓ ${pass}`);
