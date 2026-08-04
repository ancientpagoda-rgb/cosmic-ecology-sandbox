const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const failures = [];
const passes = [];

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    failures.push(`missing file: ${relativePath}`);
    return '';
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

function requireText(relativePath, marker, description = marker) {
  const content = read(relativePath);
  if (!content.includes(marker)) failures.push(`${relativePath}: missing ${description}`);
  else passes.push(`${relativePath}: ${description}`);
}

function requireOrder(relativePath, markers, description) {
  const content = read(relativePath);
  let previous = -1;
  for (const marker of markers) {
    const index = content.indexOf(marker);
    if (index < 0) {
      failures.push(`${relativePath}: missing ordered marker ${marker}`);
      return;
    }
    if (index <= previous) {
      failures.push(`${relativePath}: incorrect order for ${description}`);
      return;
    }
    previous = index;
  }
  passes.push(`${relativePath}: ${description}`);
}

function requireDependency(name) {
  const pkg = JSON.parse(read('package.json') || '{}');
  if (!pkg.dependencies?.[name] && !pkg.devDependencies?.[name]) failures.push(`package.json: missing dependency ${name}`);
  else passes.push(`package.json: ${name}`);
}

for (const dependency of ['three', 'pixi.js', 'howler', '@dimforge/rapier3d-compat', 'gdal3.js', 'vite', 'eslint']) {
  requireDependency(dependency);
}

requireText('index.html', 'phase11-observable-universe', 'Phase 11 root entry point');
requireText('index.html', 'Interactive observable universe', 'observable-universe accessibility description');
requireText('app.js', "import { createPhase8Engine }", 'Phase 8 runtime import');
requireText('app.js', "import { createPhase9Engine }", 'Phase 9 runtime import');
requireText('app.js', "import { createPhase10Engine }", 'Phase 10 runtime import');
requireText('app.js', "import { createPhase11Engine }", 'Phase 11 runtime import');
requireText('app.js', 'createDebugBridge({', 'debug bridge construction');
requireText('app.js', 'window.realitySandboxFactories', 'deterministic factory exposure');
requireOrder('app.js', [
  'moduleHost.register(phase8Engine)',
  'moduleHost.register(phase9Engine)',
  'moduleHost.register(phase10Module)',
  'moduleHost.register(phase11Module)',
], 'Phase 8 → 11 module registration order');

requireText('core/module-host.js', 'topologicalOrder', 'capability dependency ordering');
requireText('core/module-host.js', 'module.save?.()', 'module save support');
requireText('core/module-host.js', 'module.load?.(', 'module load/migration support');

for (const [file, id] of [
  ['core/phase8-engine.js', 'civilization.phase8-institutions-industry-spaceflight'],
  ['core/phase9-engine.js', 'civilization.phase9-multiworld-ai-contact'],
  ['core/phase10-engine.js', 'civilization.phase10-relativistic-deep-time'],
  ['core/phase11-engine.js', 'civilization.phase11-cosmological-evolution'],
]) requireText(file, id, `${id} module id`);

requireText('core/debug-bridge.js', 'window.realitySandboxDebug = api', 'debug API exposure');
requireText('core/debug-bridge.js', 'seedPhase11Scenario', 'Phase 11 scenario injection');
requireText('core/debug-bridge.js', 'captureWebGL', 'Spector WebGL capture hook');
requireText('scripts/browser-smoke.cjs', "debugSeedScenario('galaxy-merger')", 'Phase 11 deterministic scenario suite');
requireText('scripts/browser-smoke.cjs', "debugSeedScenario('distance-frames')", 'reference-frame scenario');

requireText('reality-engine-v6-9.html', 'ENGINE V6.9 · HOWLER.JS SOUNDSCAPE', 'preserved V6.9 experience');
requireText('reality-engine-v6-9.html', 'pixiPresentationCanvas', 'V6.9 Pixi presentation canvas');
requireText('reality-engine-v6-9.html', 'audioToggle', 'V6.9 sound controls');
requireText('core/reality-v6-9/soundscape.js', "from 'howler'", 'Howler.js integration');
requireText('core/reality-v6-8/pixi-presentation.js', "from 'pixi.js'", 'PixiJS integration');
requireText('core/reality-v6-5/orbit-climate.js', 'astronomy-engine@2.1.19', 'Astronomy Engine integration');
requireText('scripts/build-rebound-wasm.sh', 'REBOUND_REF="${REBOUND_REF:-5.0.0}"', 'pinned REBOUND source');
requireText('scripts/build-rebound-wasm.sh', 'rebound.wasm', 'REBOUND WebAssembly output');
requireText('integrations/rebound-adapter.js', 'orbit.rebound', 'REBOUND runtime adapter');
requireText('integrations/rapier-adapter.js', '@dimforge/rapier3d-compat', 'Rapier runtime adapter');
requireText('integrations/gdal-adapter.js', "from 'gdal3.js'", 'GDAL runtime adapter');

for (const notice of ['Three.js', 'PixiJS', 'Howler.js', 'Astronomy Engine', 'Rapier 3D', 'REBOUND 5.0.0', 'GDAL3.js', 'Graphology', 'XState', 'Playwright', 'Spector.js']) {
  requireText('THIRD_PARTY_NOTICES.md', notice, `${notice} notice`);
}

requireText('README.md', '# Reality Sandbox', 'project overview');
requireText('README.md', 'Root Phase 11 universe', 'root/legacy architecture boundary');
requireText('README.md', 'npm run audit:integration', 'documented integration audit');
requireText('package.json', '"audit:integration"', 'integration audit npm script');
requireText('.github/workflows/browser-smoke.yml', 'npm run audit:integration', 'CI integration audit step');

if (failures.length) {
  console.error('Reality Sandbox integration audit failed:\n');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error(`\n${passes.length} checks passed; ${failures.length} failed.`);
  process.exit(1);
}

console.log(`Reality Sandbox integration audit passed: ${passes.length} checks.`);
for (const pass of passes) console.log(`  ✓ ${pass}`);
