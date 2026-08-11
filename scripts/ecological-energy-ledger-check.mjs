import assert from 'node:assert/strict';
import { installEcologicalTransactions } from '../core/ecological-transactions.js';
import { installEcologicalEnergyLedger } from '../core/ecological-energy-ledger.js';

function makeFixture() {
  const position = new Map([[1, { x: 50, y: 50 }]]);
  const agent = new Map([[1, { energy: 1, grazeClock: 1 }]]);
  const predator = new Map();
  const apex = new Map();
  const components = { position, agent, predator, apex };
  const ecs = {
    components,
    destroyEntity(id) {
      for (const map of Object.values(components)) map.delete(id);
    },
  };
  const field = {
    sample() {
      return { food: 1, fertility: 1, moisture: 1, temperature: 0.5 };
    },
  };
  const world = {
    tick: 1,
    width: 100,
    height: 100,
    ecs,
    forageField: field,
    step(dt) {
      world.tick += 1;
      const grazer = agent.get(1);
      if (!grazer) return;
      const food = field.sample(50, 50).food;
      grazer.energy += food * dt * 0.052;
    },
  };
  return { world, field, agent, predator, apex, position };
}

const fixture = makeFixture();
const transactions = installEcologicalTransactions({ world: fixture.world });
const ledger = installEcologicalEnergyLedger({
  world: fixture.world,
  resourceField: fixture.field,
  transactions,
  columns: 1,
  rows: 1,
  capacityScale: 0.05,
  recoveryRate: 0,
  assimilationEfficiency: 0.5,
});

const initial = ledger.snapshot();
assert.equal(initial.writable, true);
assert.equal(initial.eventDriven, true);
assert.equal(initial.populationScanFree, true);
assert.equal(initial.unit, 'model-ecological-energy');
assert.equal(initial.physicalUnitClaim, false);
assert(Math.abs(initial.stock.total - 0.05) < 1e-12, `unexpected initial stock ${initial.stock.total}`);

fixture.world.step(1);
const afterOne = ledger.snapshot();
assert(afterOne.stock.total < initial.stock.total, 'grazing must debit coarse landscape stock');
assert(fixture.agent.get(1).energy > 1, 'grazer should receive assimilated landscape energy');
assert(afterOne.flowTotals.grazingWithdrawal > 0, 'ledger did not record coarse-to-fine withdrawal');
assert(afterOne.flowTotals.assimilatedToGrazers > 0, 'ledger did not record fine-scale assimilation');
assert(transactions.snapshot().counts.GRAZE > 0, 'grazing did not become an explicit GRAZE transaction');

for (let index = 0; index < 20; index += 1) fixture.world.step(1);
const depleted = ledger.snapshot();
assert(depleted.stock.total <= 1e-12, `stock should be exhausted, got ${depleted.stock.total}`);
const energyAtDepletion = fixture.agent.get(1).energy;
fixture.world.step(1);
assert(Math.abs(fixture.agent.get(1).energy - energyAtDepletion) < 1e-12, 'grazer gained energy from an exhausted coarse cell');
assert(fixture.field.sample(50, 50).food <= 1e-12, 'depleted landscape should report no available forage');

ledger.destroy();
const energyBeforeDestroyStep = fixture.agent.get(1).energy;
fixture.world.step(1);
assert(fixture.agent.get(1).energy > energyBeforeDestroyStep, 'destroy() did not remove the energy constraint');
transactions.destroy();

const replenishing = makeFixture();
const recoveryTransactions = installEcologicalTransactions({ world: replenishing.world });
const recoveryLedger = installEcologicalEnergyLedger({
  world: replenishing.world,
  resourceField: replenishing.field,
  transactions: recoveryTransactions,
  columns: 1,
  rows: 1,
  capacityScale: 0.05,
  recoveryRate: 0.01,
  assimilationEfficiency: 0.5,
});
recoveryLedger.withdraw(50, 50, 0.05);
assert(recoveryLedger.snapshot().stock.total <= 1e-12);
recoveryLedger.replenish(2);
const recovered = recoveryLedger.snapshot();
assert(recovered.stock.total > 0, 'primary production did not restore coarse stock');
assert(recovered.flowTotals.primaryProduction > 0, 'primary production flow was not recorded');
assert(recoveryTransactions.snapshot().counts.UPTAKE > 0, 'primary production did not emit UPTAKE transactions');

const trophic = makeFixture();
trophic.agent.clear();
trophic.predator.set(10, { energy: 3 });
trophic.position.set(10, { x: 30, y: 30 });
trophic.world.step = () => {
  trophic.world.tick += 1;
  trophic.position.set(11, { x: 31, y: 30 });
  trophic.predator.set(11, { energy: 2 });
  trophic.predator.get(10).energy *= 0.5;
};
const trophicTransactions = installEcologicalTransactions({ world: trophic.world });
const trophicLedger = installEcologicalEnergyLedger({
  world: trophic.world,
  resourceField: trophic.field,
  transactions: trophicTransactions,
  columns: 1,
  rows: 1,
  recoveryRate: 0,
});
const predatorEnergyBefore = [...trophic.predator.values()].reduce((sum, entity) => sum + entity.energy, 0);
trophic.world.step(1);
const predatorEnergyAfter = [...trophic.predator.values()].reduce((sum, entity) => sum + entity.energy, 0);
const trophicSnapshot = trophicLedger.snapshot();
assert(predatorEnergyAfter <= predatorEnergyBefore + 1e-12, `predator reproduction created energy: ${predatorEnergyBefore} -> ${predatorEnergyAfter}`);
assert(trophicSnapshot.flowTotals.trophicRejectedCreation > 0, 'ledger did not reject reproduction energy creation');
assert(trophicTransactions.snapshot().counts.REPRODUCE === 1, 'predator birth did not become one REPRODUCE transaction');

const predation = makeFixture();
predation.predator.set(2, { energy: 2 });
predation.position.set(2, { x: 51, y: 50 });
predation.world.step = () => {
  predation.world.tick += 1;
  predation.world.ecs.destroyEntity(1);
  predation.predator.get(2).energy += 1;
};
const predationTransactions = installEcologicalTransactions({ world: predation.world });
const predationLedger = installEcologicalEnergyLedger({
  world: predation.world,
  resourceField: predation.field,
  transactions: predationTransactions,
  columns: 1,
  rows: 1,
  recoveryRate: 0,
});
predation.world.step(1);
assert(predationTransactions.snapshot().counts.PREDATE === 1, 'kill plus consumer gain did not become one PREDATE transaction');
assert(predationLedger.snapshot().flowTotals.predatorEnergyRetained > 0, 'predation transfer retained no bounded prey energy');

console.log(JSON.stringify({
  ok: true,
  eventDriven: true,
  populationScanFree: true,
  initialStock: initial.stock.total,
  depletedStock: depleted.stock.total,
  recoveredStock: recovered.stock.total,
  predatorEnergyBefore,
  predatorEnergyAfter,
  transactionCounts: trophicTransactions.snapshot().counts,
}, null, 2));
