import assert from 'node:assert/strict';
import { installEcologicalEnergyLedger } from '../core/ecological-energy-ledger.js';

function makeFixture() {
  const position = new Map([[1, { x: 50, y: 50 }]]);
  const agent = new Map([[1, { energy: 1, grazeClock: 1 }]]);
  const field = {
    sample() {
      return { food: 1, fertility: 1, moisture: 1, temperature: 0.5 };
    },
  };
  const world = {
    width: 100,
    height: 100,
    ecs: { components: { position, agent } },
    forageField: field,
    step(dt) {
      const grazer = agent.get(1);
      if (!grazer) return;
      const food = field.sample(50, 50).food;
      grazer.energy += food * dt * 0.052;
    },
  };
  return { world, field, agent };
}

const { world, field, agent } = makeFixture();
const ledger = installEcologicalEnergyLedger({
  world,
  resourceField: field,
  columns: 1,
  rows: 1,
  capacityScale: 0.05,
  recoveryRate: 0,
  assimilationEfficiency: 0.5,
});

const initial = ledger.snapshot();
assert.equal(initial.writable, true);
assert.equal(initial.unit, 'model-ecological-energy');
assert.equal(initial.physicalUnitClaim, false);
assert(Math.abs(initial.stock.total - 0.05) < 1e-12, `unexpected initial stock ${initial.stock.total}`);

world.step(1);
const afterOne = ledger.snapshot();
assert(afterOne.stock.total < initial.stock.total, 'grazing must debit coarse landscape stock');
assert(agent.get(1).energy > 1, 'grazer should receive assimilated landscape energy');
assert(afterOne.flowTotals.grazingWithdrawal > 0, 'ledger did not record coarse-to-fine withdrawal');
assert(afterOne.flowTotals.assimilatedToGrazers > 0, 'ledger did not record fine-scale assimilation');

for (let index = 0; index < 20; index += 1) world.step(1);
const depleted = ledger.snapshot();
assert(depleted.stock.total <= 1e-12, `stock should be exhausted, got ${depleted.stock.total}`);
const energyAtDepletion = agent.get(1).energy;
world.step(1);
assert(Math.abs(agent.get(1).energy - energyAtDepletion) < 1e-12, 'grazer gained energy from an exhausted coarse cell');
assert(field.sample(50, 50).food <= 1e-12, 'depleted landscape should report no available forage');

ledger.destroy();
const energyBeforeDestroyStep = agent.get(1).energy;
world.step(1);
assert(agent.get(1).energy > energyBeforeDestroyStep, 'destroy() did not restore the original unconstrained world step/field sample');

const replenishing = makeFixture();
const recoveryLedger = installEcologicalEnergyLedger({
  world: replenishing.world,
  resourceField: replenishing.field,
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

console.log(JSON.stringify({
  ok: true,
  initialStock: initial.stock.total,
  depletedStock: depleted.stock.total,
  recoveredStock: recovered.stock.total,
  flows: depleted.flowTotals,
}, null, 2));
