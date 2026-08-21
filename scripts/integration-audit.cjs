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

requireText('index.html', 'Procedural Plant Planet', 'fictional-planet title');
requireText('index.html', 'fictional procedural plant planet', 'fictional-world accessibility label');
requireText('index.html', 'src="./app-seeded.js?', 'seeded project-relative root entry point');
requireText('index.html', 'src="./core/flora-world-presentation.js?', 'flora presentation entry point');
requireText('index.html', 'src="./core/monotonic-world-clock.js?', 'monotonic world clock entry point');
requireText('index.html', 'src="./core/surface-mode-entry.js?', 'bundled local-detail renderer entry point');
requireText('index.html', 'src="./core/experimental-spherical-world.js?', 'production spherical loader');
requireText('index.html', 'build-surface-mode-v78-flora-world', 'flora build marker');
requireText('index.html', 'build-surface-v85-stable-water-radar', 'surface build marker');
requireText('index.html', 'build-v86-smooth-spherical-default', 'smooth spherical build marker');
forbidText('index.html', 'scientific-earth-presentation', 'retired Earth renderer');
forbidText('index.html', 'lilac-cloud-overlay', 'retired cloud sidecar');
forbidText('index.html', 'rain-runoff-overlay', 'retired rain sidecar');
forbidText('index.html', 'iphone-performance-mode', 'retired mobile sidecar');

for (const marker of [
  'createOrbitalSystem',
  'configurePlanetGeneration',
  'createWaterCycle',
  'createLivingSystems',
  'createBiosphere',
  'createEcologyJournal',
  'createSeasonalResourceFields',
  'createPlanetDynamics',
  'createLofiLivingRuntime',
  'planet.interior-tectonics',
  'planet.water-cycle',
  'planet.living-ecology',
  'ecology.seasonal-resource-fields',
  'planet.climate-terrain-feedbacks',
]) requireText('app-seeded.js', marker, `root chain ${marker}`);

requireText('core/lofi-living-runtime.js', "id: 'runtime.procedural-living-planet'", 'root chain runtime.procedural-living-planet');
requireText('core/flora-world-presentation.js', 'procedural-3d-plants', 'flora presentation contract');
requireText('core/experimental-spherical-world.js', "rendererChoice === 'spherical'", 'explicit spherical query flag');
requireText('core/experimental-spherical-world.js', "rendererChoice === 'classic'", 'explicit classic fallback flag');
requireText('core/experimental-spherical-world.js', 'productionDefault: true', 'spherical renderer production default');
requireText('core/experimental-spherical-world.js', "import('./single-spherical-world-renderer.js?", 'lazy production renderer import');
requireText('core/hide-foundry-panel.js', "selector: '.planet-foundry'", 'foundry panel cleanup retained');
forbidText('core/hide-foundry-panel.js', "selector: '#enterSurfaceMode'", 'legacy enter control hiding');
forbidText('core/hide-foundry-panel.js', "selector: '#surfaceModeHud button'", 'legacy exit control hiding');

for (const file of ['core/world.js', 'core/living-systems.js', 'core/biosphere.js', 'core/planet-dynamics.js']) {
  forbidText(file, 'Math.random()', 'unseeded random call');
}

requireText('scripts/reality-check.cjs', 'exerciseDesktopInteraction', 'desktop browser camera interaction');
requireText('scripts/reality-check.cjs', 'exerciseBiology', 'causal reproduction browser scenario');
requireText('scripts/reality-check.cjs', 'exerciseLongRun', 'deterministic long-run browser stress test');
requireText('scripts/frontier-lab-smoke.cjs', 'Estuary Town', 'frontier settlement selection assertion');
requireText('scripts/frontier-lab-smoke.cjs', 'frontier-lab.png', 'frontier smoke artifact');
requireText('scripts/iphone-sphere-smoke.cjs', 'Mobile dashboard overlaps the inspector.', 'mobile panel overlap assertion');
requireText('scripts/iphone-sphere-smoke.cjs', 'Movement joystick', 'mobile local-view joystick assertion');
requireText('scripts/iphone-sphere-smoke.cjs', 'window.realitySandboxSurfaceMode.exit()', 'mobile surface-mode exit handoff');
requireText('scripts/surface-mode-smoke.cjs', "document.documentElement.dataset.surfaceMode === 'active'", 'classic Surface Mode activates in browser');
requireText('scripts/surface-mode-smoke.cjs', "page.click('#enterSurfaceMode')", 'surface button click assertion');
requireText('scripts/surface-mode-smoke.cjs', "page.keyboard.down('w')", 'local movement browser assertion');
requireText('scripts/surface-mode-smoke.cjs', 'surfaceFloraV78?.installed === true', 'flora presentation assertion');
requireText('scripts/surface-mode-smoke.cjs', 'window.realitySandboxWorldView.jumpOutward()', 'local renderer rejoins unified view');
requireText('scripts/continuous-world-view-check.cjs', "page.mouse.wheel(0, -520)", 'globe-to-ground zoom descent assertion');
requireText('scripts/continuous-world-view-check.cjs', "page.mouse.wheel(0, 900)", 'ground-to-globe zoom ascent assertion');
requireText('scripts/continuous-world-view-check.cjs', 'Simulation stopped in local LOD', 'simulation remains continuous at local scale');
requireText('scripts/performance-smoke.cjs', 'webglcontextlost', 'surface context-loss fallback assertion');
requireText('scripts/performance-smoke.cjs', 'STARTUP_PIXEL_BUDGET', 'startup canvas performance budget');
requireText('scripts/performance-smoke.cjs', 'preEntrySurfaceResources', 'lazy Surface resource performance budget');
requireText('scripts/visual-quality-check.cjs', 'classic-overview.png', 'legacy fallback screenshot artifact');
requireText('scripts/visual-quality-check.cjs', 'classic-surface.png', 'legacy surface screenshot artifact');
requireText('scripts/visual-quality-check.cjs', 'experimental-spherical.png', 'smooth default screenshot artifact');
requireText('scripts/visual-quality-check.cjs', 'colorBuckets', 'visual diversity regression metric');
requireText('scripts/visual-quality-check.cjs', 'edgeMean', 'spatial-detail regression metric');
requireText('core/continuous-world-view.js', "model: 'single-authoritative-location-altitude-continuous-lod-view'", 'single authoritative continuous camera model');
requireText('core/continuous-world-view.js', "rendererPolicy: 'globe-and-local-renderers-are-private-lod-backends'", 'globe and local renderers are private LOD backends');

requireMissing('.github/workflows/phase8-live.yml', 'Phase 8 live workflow frozen');
requireMissing('.github/workflows/phase9-live.yml', 'Phase 9 live workflow frozen');
requireMissing('.github/workflows/phase10-live.yml', 'Phase 10 live workflow frozen');
requireMissing('.github/workflows/phase11-live.yml', 'Phase 11 live workflow frozen');
forbidText('.github/workflows/browser-smoke.yml', 'node scripts/browser-smoke.cjs', 'old browser smoke script');
requireText('.github/workflows/browser-smoke.yml', 'node scripts/reality-check.cjs', 'reality check gate');
requireText('.github/workflows/browser-smoke.yml', 'node scripts/frontier-lab-smoke.cjs', 'frontier-lab route check');
requireText('.github/workflows/browser-smoke.yml', 'node scripts/iphone-sphere-smoke.cjs', 'iPhone visual check');
requireText('.github/workflows/browser-smoke.yml', 'node scripts/surface-mode-smoke.cjs', 'local-renderer interaction check');
requireText('.github/workflows/browser-smoke.yml', 'node scripts/performance-smoke.cjs', 'startup and local-detail performance check');
requireText('.github/workflows/browser-smoke.yml', 'node scripts/visual-quality-check.cjs', 'CI visual regression gate');

requireText('package.json', '"audit:integration"', 'integration audit script');
requireText('package.json', '"check:reality"', 'runtime reality contract script');
requireText('package.json', '"check:surface"', 'surface smoke script');
requireText('package.json', '"check:view"', 'continuous world-view regression script');
requireText('package.json', '"check:visual"', 'visual regression command');

if (failures.length) {
  console.error('Reality Sandbox integration audit failed:\n');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error(`\n${passes.length} checks passed; ${failures.length} failed.`);
  process.exit(1);
}

console.log(`Reality Sandbox integration audit passed: ${passes.length} checks.`);
for (const pass of passes) console.log(`  ✓ ${pass}`);
