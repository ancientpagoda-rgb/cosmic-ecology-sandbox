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

function requireMissing(file, label) {
  if (fs.existsSync(path.join(root, file))) failures.push(`${file}: ${label}`);
  else passes.push(`${file}: ${label}`);
}

const rootEntry = 'app-seeded.js';

requireText('index.html', 'Procedural Living Planet', 'honest fictional-planet title');
requireText('index.html', 'fictional procedural living planet', 'fictional-world accessibility label');
requireText('index.html', 'src="./app-seeded.js?', 'seeded project-relative root entry point');
requireText('index.html', 'src="./core/surface-mode-entry.js?', 'bundled surface-mode entry point');
forbidText('index.html', 'scientific-earth-presentation', 'retired Earth renderer');
forbidText('index.html', 'lilac-cloud-overlay', 'retired cloud sidecar');
forbidText('index.html', 'rain-runoff-overlay', 'retired rain sidecar');
forbidText('index.html', 'iphone-performance-mode', 'retired mobile sidecar');
requireText('origins.html', 'id="originForm"', 'separate Origins scenario form');
requireText('origins.html', 'From a universe to one living world', 'Origins narrative handoff');
requireText('origins.html', 'id="cosmosCanvas"', 'interactive Origins cosmic canvas');
requireText('origins.html', 'id="cosmicTimeline"', 'interactive Origins time control');
requireText('origins.js', 'originScenarioParams', 'Origins route emits a portable scenario URL');
requireText('origins.js', 'function drawCosmos', 'Origins route renders a seed-driven cosmic timeline');
requireText('core/origin-scenario.js', "origin: 'epic'", 'explicit Origins handoff contract');
requireText('app-seeded.js', 'readOriginScenario', 'planet root consumes Origins scenario');

for (const marker of [
  'createOrbitalSystem',
  'configurePlanetGeneration',
  'createWaterCycle',
  'createLivingSystems',
  'createBiosphere',
  'createPlanetDynamics',
  'createLofiLivingRuntime',
  'planet.interior-tectonics',
  'planet.water-cycle',
  'planet.living-ecology',
  'planet.climate-terrain-feedbacks',
]) requireText(rootEntry, marker, `root chain ${marker}`);
requireText(
  'core/lofi-living-runtime.js',
  "id: 'runtime.procedural-living-planet'",
  'root chain runtime.procedural-living-planet'
);

for (const marker of [
  'createGalaxySystem',
  'createCosmicOrigin',
  'createPhase8Engine',
  'createPhase9Engine',
  'createPhase10Engine',
  'createPhase11Engine',
  'createHeadlessCivilizationEngine',
  'installUnifiedDebugExtension',
  'createDebugBridge',
]) forbidText(rootEntry, marker, `frozen root import ${marker}`);

requireText('core/plate-tectonics.js', 'createGeodynamicModel', 'seeded planetary interior and convection model');
requireText('core/plate-tectonics.js', 'stepTectonics', 'evolving tectonic plates');
requireText('core/plate-tectonics.js', "boundaryType = 'ridge'", 'divergent ridge classification');
requireText('core/plate-tectonics.js', "boundaryType = 'trench'", 'convergent trench classification');
requireText('core/plate-tectonics.js', "boundaryType = 'transform'", 'transform-fault classification');

requireText('core/lofi-living-runtime.js', "from 'pixi.js'", 'single PixiJS root renderer');
requireText('core/lofi-living-runtime.js', 'living.sampleDynamicPlanet', 'renderer uses simulated terrain and climate');
requireText('core/lofi-living-runtime.js', 'waterCycle.sample', 'renderer uses simulated water state');
requireText('core/lofi-living-runtime.js', 'biosphere.getSpeciesForEntity', 'renderer uses simulated lineages');
requireText('core/lofi-living-runtime.js', 'selectAtClientPoint', 'regional inspection interaction');
requireText('core/lofi-living-runtime.js', 'statisticDefinitions: true', 'inspectable statistic contract');
requireText('core/lofi-living-runtime.js', "model: 'procedural'", 'procedural-world labeling');
requireText('core/lofi-living-runtime.js', 'earthData: false', 'explicit no-Earth-data boundary');
requireText('core/lofi-living-runtime.js', 'root-module-host-fixed-step', 'single authoritative clock');
forbidText('core/lofi-living-runtime.js', 'ReboundWasmSystem', 'root REBOUND client');
requireText(
  'core/lofi-living-runtime.js',
  "document.getElementById('lofiLivingCanvasBacking')",
  'retired backing-canvas absence invariant'
);
forbidText('core/lofi-living-runtime.js', 'scientific-earth', 'scientific Earth claim');

for (const file of ['core/world.js', 'core/living-systems.js', 'core/biosphere.js', 'core/planet-dynamics.js']) {
  forbidText(file, 'Math.random()', 'unseeded random call');
}
requireText('core/living-systems.js', 'createLivingSystems(world, rng', 'seeded living systems');
requireText('core/biosphere.js', 'createBiosphere(world, rng', 'seeded evolution');
requireText('core/planet-dynamics.js', 'createPlanetDynamics(world, living, waterCycle, rng', 'seeded planet dynamics');

requireText('unified-runtime.css', '#lofiLivingCanvas', 'single canvas styling');
requireText('unified-runtime.css', '.planet-inspector', 'integrated inspector styling');
requireText('unified-runtime.css', '.planet-dashboard', 'integrated statistics styling');
forbidText('unified-runtime.css', '#lofiLivingCanvasBacking', 'backing-canvas styling');

requireMissing('.github/workflows/phase8-live.yml', 'Phase 8 live workflow frozen');
requireMissing('.github/workflows/phase9-live.yml', 'Phase 9 live workflow frozen');
requireMissing('.github/workflows/phase10-live.yml', 'Phase 10 live workflow frozen');
requireMissing('.github/workflows/phase11-live.yml', 'Phase 11 live workflow frozen');
forbidText('.github/workflows/browser-smoke.yml', 'node scripts/browser-smoke.cjs', 'Phase 11 browser suite');
requireText('.github/workflows/browser-smoke.yml', 'node scripts/unified-smoke.cjs', 'living-planet experience check');
requireText('.github/workflows/browser-smoke.yml', 'node scripts/iphone-sphere-smoke.cjs', 'iPhone visual check');
requireText('.github/workflows/browser-smoke.yml', 'node scripts/surface-mode-smoke.cjs', 'surface-mode interaction check');

requireText('scripts/unified-smoke.cjs', "seedScenario('coupling')", 'terrain-water-inspector coupling scenario');
requireText('scripts/unified-smoke.cjs', 'statDefinitions === 8', 'defined statistic browser assertion');
requireText('scripts/unified-smoke.cjs', '[title][tabindex="0"]', 'keyboard-inspectable statistic assertion');
requireText('scripts/iphone-sphere-smoke.cjs', 'masthead.bottom <= metrics.inspector.top', 'mobile panel overlap assertion');
requireText('scripts/root-renderer-smoke.cjs', 'visibleSimulationCanvases.length === 1', 'single simulation canvas plus approved presentation layers');
requireText('scripts/surface-mode-smoke.cjs', "document.documentElement.dataset.surfaceMode === 'active'", 'surface mode activates in browser');
requireText('scripts/surface-mode-smoke.cjs', "page.keyboard.down('w')", 'surface mode movement browser assertion');

requireText('reality-engine-v6-9.html', 'ENGINE V6.9 · HOWLER.JS SOUNDSCAPE', 'archived V6.9 compatibility page');
requireText('README.md', 'Nysa is not Earth', 'scientific boundary documentation');
requireText('README.md', 'Scope freeze', 'universe scope freeze documentation');
requireText('README.md', 'No new phase should be added', 'experience-gate rule');
requireText('package.json', '"audit:integration"', 'integration audit script');

if (failures.length) {
  console.error('Reality Sandbox integration audit failed:\n');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error(`\n${passes.length} checks passed; ${failures.length} failed.`);
  process.exit(1);
}

console.log(`Reality Sandbox integration audit passed: ${passes.length} checks.`);
for (const pass of passes) console.log(`  ✓ ${pass}`);
