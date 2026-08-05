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

function forbidText(relativePath, marker, description = marker) {
  const content = read(relativePath);
  if (content.includes(marker)) failures.push(`${relativePath}: contains forbidden ${description}`);
  else passes.push(`${relativePath}: no ${description}`);
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

requireText('index.html', 'src="./app.js?', 'project-relative lo-fi living root entry point');
forbidText('index.html', 'src="/app.js?', 'domain-root app entry point');
forbidText('index.html', 'src="/core/', 'domain-root core entry points');
requireText('index.html', 'single deterministic lo-fi pixel living world', 'simplified accessibility description');
requireText('index.html', 'unified-runtime.css', 'living-world presentation stylesheet');
forbidText('index.html', 'reality-v6-9-audio-volume', 'root audio preference bootstrap');

requireText('app.js', "import { createPhase8Engine }", 'Phase 8 runtime import');
requireText('app.js', "import { createPhase9Engine }", 'Phase 9 runtime import');
requireText('app.js', "import { createPhase10Engine }", 'Phase 10 runtime import');
requireText('app.js', "import { createPhase11Engine }", 'Phase 11 runtime import');
requireText('app.js', "import { createLofiLivingRuntime }", 'lo-fi living runtime import');
requireText('app.js', 'installUnifiedDebugExtension', 'unified debug bridge extension');
requireText('app.js', 'window.realitySandboxUnified', 'living runtime exposure');
requireText('app.js', 'window.realitySandboxFactories', 'deterministic factory exposure');
requireOrder('app.js', [
  'moduleHost.register(phase8Engine)',
  'moduleHost.register(phase9Engine)',
  'moduleHost.register(phase10Module)',
  'moduleHost.register(phase11Module)',
  'moduleHost.register(unifiedRuntime)',
], 'Phase 8 → 11 → living runtime registration order');

requireText('core/module-host.js', 'topologicalOrder', 'capability dependency ordering');
requireText('core/module-host.js', 'module.save?.()', 'module save support');
requireText('core/module-host.js', 'module.load?.(', 'module load/migration support');

for (const [file, id] of [
  ['core/phase8-engine.js', 'civilization.phase8-institutions-industry-spaceflight'],
  ['core/phase9-engine.js', 'civilization.phase9-multiworld-ai-contact'],
  ['core/phase10-engine.js', 'civilization.phase10-relativistic-deep-time'],
  ['core/phase11-engine.js', 'civilization.phase11-cosmological-evolution'],
  ['core/lofi-living-runtime.js', 'runtime.lofi-living-world'],
]) requireText(file, id, `${id} module id`);

requireText('core/lofi-living-runtime.js', "from 'pixi.js'", 'root PixiJS presentation');
requireText('core/lofi-living-runtime.js', 'ReboundWasmSystem', 'hidden REBOUND verification client');
requireText('core/lofi-living-runtime.js', 'root-module-host-fixed-step', 'single authoritative clock');
requireText('core/lofi-living-runtime.js', "availableViews: ['living']", 'one-view contract');
requireText('core/lofi-living-runtime.js', 'audioEnabled: false', 'audio disabled contract');
requireText('core/lofi-living-runtime.js', 'controls: 0', 'zero-control contract');
forbidText('core/lofi-living-runtime.js', "from 'howler'", 'root Howler import');
requireText('unified-runtime.css', '#lofiLivingCanvas', 'lo-fi root canvas styling');
requireText('unified-runtime.css', 'image-rendering: pixelated', 'pixelated scaling');
requireText('unified-runtime.css', '#unifiedRuntimePanel', 'legacy controls hidden');

requireText('core/unified-debug-extension.js', 'seedUnifiedScenario', 'living runtime debug scenarios');
requireText('scripts/unified-smoke.cjs', "seedUnifiedScenario('shared-clock')", 'shared-clock browser scenario');
requireText('scripts/unified-smoke.cjs', "seedUnifiedScenario('scene')", 'simplified scene browser scenario');
requireText('scripts/unified-smoke.cjs', "seedUnifiedScenario('rebound')", 'REBOUND browser scenario');
requireText('scripts/unified-smoke.cjs', "initial.controls === 0", 'zero visible controls assertion');
requireText('scripts/unified-smoke.cjs', 'initial.unified.audio.enabled === false', 'audio absence assertion');
requireText('.github/workflows/unified-live.yml', 'REALITY_REQUIRE_REBOUND: "1"', 'live REBOUND requirement');
requireText('scripts/rebound-deploy-smoke.cjs', "seedUnifiedScenario('rebound')", 'generated REBOUND browser scenario');
requireText('scripts/rebound-deploy-smoke.cjs', "status.mode === 'rebound-wasm'", 'generated REBOUND WASM assertion');
requireText('scripts/rebound-deploy-smoke.cjs', 'rebound.sampleBodies.every', 'finite generated body snapshot assertion');
requireText('.github/workflows/deploy-pages.yml', 'node scripts/rebound-deploy-smoke.cjs', 'predeployment REBOUND browser smoke');
requireText('.github/workflows/deploy-pages.yml', 'pages/v6.9-rebound-browser', 'predeployment REBOUND browser status');

for (const [phase, moduleId, obsoleteRootMarker] of [
  [8, 'civilization.phase8-institutions-industry-spaceflight', 'Unified interactive observable universe'],
  [9, 'civilization.phase9-multiworld-ai-contact', 'Unified interactive observable universe'],
  [10, 'civilization.phase10-relativistic-deep-time', 'relativistic missions'],
  [11, 'civilization.phase11-cosmological-evolution', 'cosmological expansion'],
]) {
  const workflow = `.github/workflows/phase${phase}-live.yml`;
  requireText(workflow, 'single deterministic lo-fi pixel living world', `Phase ${phase} lo-fi root marker`);
  requireText(workflow, moduleId, `Phase ${phase} deployed module signature`);
  forbidText(workflow, obsoleteRootMarker, `obsolete Phase ${phase} root copy marker`);
}

requireText('core/debug-bridge.js', 'window.realitySandboxDebug = api', 'debug API exposure');
requireText('core/debug-bridge.js', 'seedPhase11Scenario', 'Phase 11 scenario injection');
requireText('core/debug-bridge.js', 'captureWebGL', 'Spector WebGL capture hook');
requireText('scripts/browser-smoke.cjs', "debugSeedScenario('galaxy-merger')", 'Phase 11 deterministic scenario suite');
requireText('scripts/browser-smoke.cjs', "debugSeedScenario('distance-frames')", 'reference-frame scenario');

requireText('reality-engine-v6-9.html', 'ENGINE V6.9 · HOWLER.JS SOUNDSCAPE', 'preserved V6.9 experience');
requireText('reality-engine-v6-9.html', 'pixiPresentationCanvas', 'V6.9 Pixi presentation canvas');
requireText('reality-engine-v6-9.html', 'audioToggle', 'V6.9 sound controls');
requireText('core/reality-v6-9/soundscape.js', "from 'howler'", 'V6.9 Howler.js integration');
requireText('core/reality-v6-8/pixi-presentation.js', "from 'pixi.js'", 'V6.9 PixiJS integration');
requireText('core/reality-v6-5/orbit-climate.js', 'astronomy-engine@2.1.19', 'V6.9 Astronomy Engine integration');
requireText('scripts/build-rebound-wasm.sh', 'REBOUND_REF="${REBOUND_REF:-5.0.0}"', 'pinned REBOUND source');
requireText('scripts/build-rebound-wasm.sh', 'rebound.wasm', 'REBOUND WebAssembly output');
requireText('scripts/build-rebound-wasm.sh', '["cwrap","HEAPF64"]', 'REBOUND heap view export');
requireText('core/reality-v6-6/rebound-client.js', 'did not export HEAPF64', 'clear missing heap export failure');
requireText('integrations/rebound-adapter.js', 'orbit.rebound', 'REBOUND fallback adapter');
requireText('integrations/rapier-adapter.js', '@dimforge/rapier3d-compat', 'Rapier runtime adapter');
requireText('integrations/gdal-adapter.js', "from 'gdal3.js'", 'GDAL runtime adapter');

for (const notice of ['Three.js', 'PixiJS', 'Howler.js', 'Astronomy Engine', 'Rapier 3D', 'REBOUND 5.0.0', 'GDAL3.js', 'Graphology', 'XState', 'Playwright', 'Spector.js']) {
  requireText('THIRD_PARTY_NOTICES.md', notice, `${notice} notice`);
}

requireText('README.md', '# Reality Sandbox', 'project overview');
requireText('README.md', 'Lo-fi living root', 'simplified root overview');
requireText('README.md', 'npm run audit:integration', 'documented integration audit');
requireText('package.json', '"audit:integration"', 'integration audit npm script');
requireText('.github/workflows/browser-smoke.yml', 'node scripts/unified-smoke.cjs', 'living runtime CI browser step');

if (failures.length) {
  console.error('Reality Sandbox integration audit failed:\n');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error(`\n${passes.length} checks passed; ${failures.length} failed.`);
  process.exit(1);
}

console.log(`Reality Sandbox integration audit passed: ${passes.length} checks.`);
for (const pass of passes) console.log(`  ✓ ${pass}`);
