const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'core/lofi-living-runtime.js'), 'utf8');
const failures = [];

for (const marker of ['three', 'ReboundWasmSystem', 'scientific-earth-presentation', 'lilac-cloud-overlay', 'rain-runoff-overlay', 'iphone-performance-mode']) {
  if (app.includes(marker) || runtime.includes(marker)) failures.push(`root includes retired renderer or universe marker: ${marker}`);
}
for (const marker of ['new Application()', 'autoStart: false', 'sharedTicker: false', 'living.sampleDynamicPlanet', 'waterCycle.sample', 'planet-inspector']) {
  if (!runtime.includes(marker)) failures.push(`root renderer missing: ${marker}`);
}

if (failures.length) {
  console.error('Root renderer audit failed:\n');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log('Root renderer audit passed: one integrated Pixi living-planet renderer.');
