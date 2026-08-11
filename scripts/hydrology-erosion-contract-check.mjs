import assert from 'node:assert/strict';
import { installRealityTransactions } from '../core/ecological-transactions.js';
import { installHydrologyErosionContract } from '../core/hydrology-erosion-contract.js';
import { createWaterCycle } from '../core/water-cycle.js';

const EPSILON = 1e-8;

function makeWorld() {
  const position = new Map();
  const agent = new Map();
  const predator = new Map();
  const apex = new Map();
  const components = { position, agent, predator, apex };
  const ecs = {
    components,
    destroyEntity(id) {
      for (const map of Object.values(components)) map.delete(id);
    },
  };
  const world = {
    tick: 0,
    width: 1200,
    height: 720,
    ecs,
    step() { world.tick += 1; },
  };
  return world;
}

const world = makeWorld();
const transactions = installRealityTransactions({ world, historyLimit: 512 });
const waterCycle = createWaterCycle(world, null);
const contract = installHydrologyErosionContract({
  world,
  waterCycle,
  transactions,
  columns: 24,
  rows: 12,
  updateInterval: 0.24,
  erosionRate: 0.12,
  transportRate: 0.7,
  depositionRate: 0.35,
});

const initial = contract.snapshot();
assert.equal(initial.writable, true);
assert.equal(initial.eventDriven, true);
assert.equal(initial.units.physicalUnitClaim, false);
assert.equal(initial.waterAccounting.conservationClaim, false, 'reduced-order water solver must not claim closed mass conservation');
assert.equal(initial.sediment.conservationClaim, true);
assert(initial.sediment.baseline > 0, 'sediment baseline was not initialized');
assert(Math.abs(initial.sediment.drift) <= EPSILON, `initial sediment drift ${initial.sediment.drift}`);

// Stay below the water-cycle's 12-second browser event interval so this test
// remains headless while still giving runoff/erosion several deterministic
// solves to evolve.
for (let index = 0; index < 36; index += 1) {
  world.step(0.24);
  waterCycle.step(0.24);
}

const after = contract.snapshot();
assert(after.macroSteps >= 30, `expected many geomorphic macrosteps, got ${after.macroSteps}`);
assert(after.sediment.totals.eroded > 0, 'dynamic runoff produced no erosion');
assert(after.sediment.totals.transported > 0, 'eroded sediment was never transported');
assert(after.sediment.totals.deposited > 0, 'suspended sediment was never deposited');
assert(after.sediment.reservoirs.suspended > 0 || after.sediment.reservoirs.deposited > initial.sediment.reservoirs.deposited,
  'sediment reservoirs did not evolve');
assert(Math.abs(after.sediment.drift) <= EPSILON, `sediment conservation drift ${after.sediment.drift}`);

const journal = transactions.snapshot();
assert.equal(journal.domains.includes('hydrology'), true, 'shared transaction bus did not advertise hydrology');
for (const type of ['PRECIPITATE', 'FLOW', 'ERODE', 'DEPOSIT', 'EVAPORATE']) {
  assert(journal.counts[type] >= 1, `${type} was not journaled: ${JSON.stringify(journal.counts)}`);
}

const sample = contract.sample(600, 360);
assert(sample.sediment?.unit === 'model-sediment', 'hydrology sample did not expose sediment state');
assert(sample.sediment?.physicalUnitClaim === false, 'model sediment must not be presented as a physical measurement');

const originalStep = waterCycle.step;
contract.destroy();
assert.notEqual(waterCycle.step, originalStep, 'destroy() did not restore the original water-cycle step');
transactions.destroy();

console.log(JSON.stringify({
  ok: true,
  macroSteps: after.macroSteps,
  sediment: after.sediment,
  waterAccounting: after.waterAccounting,
  transactionCounts: Object.fromEntries(
    ['PRECIPITATE', 'FLOW', 'ERODE', 'DEPOSIT', 'EVAPORATE'].map(type => [type, journal.counts[type]])
  ),
}, null, 2));
