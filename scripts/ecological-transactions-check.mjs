import assert from 'node:assert/strict';
import { installRealityTransactions } from '../core/ecological-transactions.js';

function makeWorld() {
  const position = new Map([
    [1, { x: 10, y: 10 }],
    [2, { x: 11, y: 10 }],
    [3, { x: 12, y: 10 }],
  ]);
  const agent = new Map([[1, { energy: 1 }]]);
  const predator = new Map([[2, { energy: 2 }]]);
  const apex = new Map([[3, { energy: 3 }]]);
  const components = { position, agent, predator, apex };
  const ecs = {
    components,
    destroyEntity(id) {
      for (const map of Object.values(components)) map.delete(id);
    },
  };
  const world = { tick: 0, width: 100, height: 100, ecs, step: () => { world.tick += 1; } };
  return { world, position, agent, predator, apex };
}

const fixture = makeWorld();
const transactions = installRealityTransactions({ world: fixture.world });

fixture.world.step = fixture.world.step.bind(fixture.world);

// Explicit coarse transactions are journaled directly.
transactions.transact(transactions.types.UPTAKE, { x: 5, y: 5, requestedEnergy: 0.2 }, { allowedEnergy: 0.2 });
transactions.transact(transactions.types.DECOMPOSE, { x: 5, y: 5, requestedNutrient: 0.1 }, { mineralized: 0.1 });
for (const type of ['PRECIPITATE', 'FLOW', 'ERODE', 'DEPOSIT', 'EVAPORATE']) {
  transactions.transact(transactions.types[type], { domain: 'hydrology', amount: 0.1 }, {});
}

// Replace the wrapped source step by mutating behavior through the already
// wrapped world: before/after hooks remain authoritative, while proxy-backed
// organism mutations become transactions during the step.
let mode = 'graze';
const capturedStep = fixture.world.step;
const sourceStep = () => {
  fixture.world.tick += 1;
  if (mode === 'graze') fixture.agent.get(1).energy += 0.2;
  if (mode === 'predate') {
    fixture.world.ecs.destroyEntity(1);
    fixture.predator.get(2).energy += 0.6;
  }
  if (mode === 'reproduce') {
    fixture.position.set(4, { x: 11.5, y: 10 });
    fixture.predator.set(4, { energy: 2 });
    fixture.predator.get(2).energy -= 0.5;
  }
  if (mode === 'die') fixture.world.ecs.destroyEntity(3);
};

const removeDriver = transactions.beforeStep(() => sourceStep(), -1000);

mode = 'graze';
capturedStep(0.1);
mode = 'predate';
capturedStep(0.1);
mode = 'reproduce';
capturedStep(0.1);
mode = 'die';
capturedStep(0.1);
removeDriver();

const snapshot = transactions.snapshot();
assert.equal(snapshot.eventDriven, true);
assert.equal(snapshot.scanFreePopulationAccounting, true);
assert(snapshot.domains.includes('ecology'));
assert(snapshot.domains.includes('hydrology'));
for (const type of ['GRAZE', 'PREDATE', 'DIE', 'REPRODUCE', 'DECOMPOSE', 'UPTAKE', 'PRECIPITATE', 'FLOW', 'ERODE', 'DEPOSIT', 'EVAPORATE']) {
  assert(snapshot.counts[type] >= 1, `${type} transaction was not recorded: ${JSON.stringify(snapshot.counts)}`);
}
assert(snapshot.recent.every(record => Number.isInteger(record.sequence)), 'transaction journal is missing deterministic sequence numbers');

transactions.destroy();
assert.equal(fixture.world.ecologicalTransactions, null, 'destroy() did not detach ecological compatibility alias');
assert.equal(fixture.world.realityTransactions, null, 'destroy() did not detach shared reality transaction layer');

console.log(JSON.stringify({
  ok: true,
  domains: snapshot.domains,
  scanFreePopulationAccounting: snapshot.scanFreePopulationAccounting,
  counts: snapshot.counts,
  recentTypes: snapshot.recent.map(record => record.type),
}, null, 2));
