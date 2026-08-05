const assert = require('node:assert/strict');

(async () => {
  global.CustomEvent = class CustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  };
  global.window = { dispatchEvent() {} };

  const { createHeadlessCivilizationEngine } = await import('../core/headless-societies.js');
  const world = {
    width: 1200,
    height: 720,
    tick: 0,
    globals: { civilizationPressure: 0, anthropogenicImpact: 0 },
  };
  const settlements = [
    { id: 'alpha', type: 'settlement', speciesId: 'people', x: 300, y: 300, population: 24, progress: 0.55 },
    { id: 'beta', type: 'settlement', speciesId: 'people', x: 420, y: 330, population: 19, progress: 0.5 },
    { id: 'gamma', type: 'settlement', speciesId: 'people', x: 510, y: 360, population: 16, progress: 0.47 },
  ];
  const evolution = {
    getSpecies: () => [{ id: 'people', role: 'agent', members: 59, centroidX: 410, centroidY: 330 }],
    getStructures: () => settlements,
  };
  const engine = createHeadlessCivilizationEngine(world, evolution, { mobile: false, seed: 20260807 });
  engine.initialize({ provideCapability() {} });
  engine.step(1.1);

  const routes = engine.getRoutes();
  assert.ok(routes.length >= 2, `Expected multiple routes, received ${routes.length}.`);
  assert.equal(new Set(routes.map(route => route.id)).size, routes.length, 'Phase 8 route IDs must be unique.');
  for (const route of routes) {
    assert.equal(typeof route.id, 'string', 'Phase 8 route requires a string id.');
    assert.ok(route.id.length > 0, 'Phase 8 route id cannot be empty.');
    assert.ok(['trade', 'alliance', 'conflict'].includes(route.kind), `Unsupported Phase 8 route kind: ${route.kind}`);
    assert.ok(Number.isFinite(route.flow), 'Phase 8 route flow must be finite.');
    assert.ok(route.from && route.to && route.from !== route.to, 'Phase 8 route endpoints must be distinct.');
  }

  const communities = engine.getCommunities();
  assert.equal(communities.length, 3, 'All test settlements must become communities.');
  assert.ok(communities.every(item => Array.isArray(item.technologies)), 'Serialized community technologies must remain arrays for Phase 8.');

  console.log(`Headless Phase 8 contract passed: ${communities.length} communities, ${routes.length} unique routes.`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
