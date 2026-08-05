const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const failures = [];
const passes = [];
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function requireText(file, marker, label) {
  if (read(file).includes(marker)) passes.push(`${file}: ${label}`);
  else failures.push(`${file}: missing ${label}`);
}

function forbidText(file, marker, label) {
  if (read(file).includes(marker)) failures.push(`${file}: contains forbidden ${label}`);
  else passes.push(`${file}: no ${label}`);
}

for (const [marker, label] of [
  ["import { createHeadlessGroundLevel }", 'headless ground import'],
  ["import { createHeadlessEvolution }", 'headless evolution import'],
  ["import { createHeadlessCivilizationEngine }", 'headless civilization import'],
  ['moduleHost.register(groundLevelPhase)', 'headless ground registration'],
  ['moduleHost.register(embodiedEvolution)', 'headless evolution registration'],
  ['moduleHost.register(civilizationEngine)', 'headless civilization registration'],
  ['placeExistingEntitiesOnBiomes(world, rng)', 'deterministic initial placement'],
]) requireText('app.js', marker, label);

for (const [marker, label] of [
  ["from 'three'", 'Three.js import'],
  ['./core/globe-render-v4.js', 'globe renderer import'],
  ['./core/galaxy-render-layer.js', 'galaxy renderer import'],
  ['./core/ground-level-phase.js', '3D ground import'],
  ['./core/origin-surface-visuals.js', 'origin visual import'],
  ['./core/embodied-evolution.js', '3D evolution import'],
  ['./core/civilization-engine.js', '3D civilization import'],
  ['./core/surface-character.js', 'surface character import'],
  ['./core/closeup-polish.js', 'close-up renderer import'],
  ['createGlobeRenderer', 'globe construction'],
  ['createGalaxyRenderLayer', 'galaxy render construction'],
  ['render.three', 'Three.js module registration'],
]) forbidText('app.js', marker, label);

for (const [file, id] of [
  ['core/headless-ground-level.js', 'terrain.headless-surface'],
  ['core/headless-evolution.js', 'evolution.headless-lineages'],
  ['core/headless-civilization-engine.js', 'civilization.emergent-graphology'],
]) {
  requireText(file, id, `${id} module id`);
  forbidText(file, "from 'three'", 'Three.js import');
  forbidText(file, 'WebGLRenderer', 'WebGL renderer');
}

requireText('integrations/runtime.js', 'if (systems.globe)', 'conditional legacy Three.js registration');
requireText('scripts/root-renderer-smoke.cjs', "!result.modules.includes('render.three')", 'runtime Three.js module exclusion');
requireText('scripts/root-renderer-smoke.cjs', 'result.forbiddenResources.length === 0', 'runtime Three.js resource exclusion');
requireText('scripts/root-renderer-smoke.cjs', 'result.visibleCanvases.length === 1', 'single visible root canvas');
requireText('.github/workflows/browser-smoke.yml', 'node scripts/root-renderer-smoke.cjs', 'Pixi-only browser gate');
requireText('README.md', 'Three.js stays available on the standalone', 'legacy-only Three.js boundary');
requireText('core/globe-render-v4.js', "from 'three'", 'legacy Three.js globe retained');

if (failures.length) {
  console.error('Root renderer audit failed:\n');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error(`\n${passes.length} checks passed; ${failures.length} failed.`);
  process.exit(1);
}

console.log(`Root renderer audit passed: ${passes.length} checks.`);
for (const pass of passes) console.log(`  ✓ ${pass}`);
