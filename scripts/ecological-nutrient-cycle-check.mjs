import assert from 'node:assert/strict';
import { installEcologicalTransactions } from '../core/ecological-transactions.js';
import { installEcologicalEnergyLedger } from '../core/ecological-energy-ledger.js';
import { installEcologicalNutrientCycle } from '../core/ecological-nutrient-cycle.js';

const EPSILON = 1e-9;

function assertConserved(snapshot, label) {
  assert(snapshot.conservation.baseline > 0, `${label}: missing nutrient baseline`);
  assert(Math.abs(snapshot.conservation.drift) <= EPSILON, `${label}: nutrient drift ${snapshot.conservation.drift}`);
}

function makeField() {
  return {
    sample() {
      return { food: 1, fertility: 0.9, moisture: 0.85, temperature: 0.58 };
    },
  };
}

function makeWorld({ grazers = [], predators = [], apex = [], step } = {}) {
  const position = new Map();
  const agent = new Map();
  const predator = new Map();
  const apexMap = new Map();

  for (const item of grazers) {
    position.set(item.id, { x: item.x ?? 50, y: item.y ?? 50 });
    agent.set(item.id, { energy: item.energy ?? 1, grazeClock: item.grazeClock ?? 1 });
  }
  for (const item of predators) {
    position.set(item.id, { x: item.x ?? 52, y: item.y ?? 50 });
    predator.set(item.id, { energy: item.energy ?? 2 });
  }
  for (const item of apex) {
    position.set(item.id, { x: item.x ?? 54, y: item.y ?? 50 });
    apexMap.set(item.id, { energy: item.energy ?? 3 });
  }

  const components = { position, agent, predator, apex: apexMap };
  const ecs = {
    components,
    destroyEntity(id) {
      for (const map of Object.values(components)) map.delete(id);
    },
  };
  const world = { tick: 1, width: 100, height: 100, ecs, step: null };
  world.step = step ? dt => step({ world, position, agent, predator, apex: apexMap, dt }) : () => { world.tick += 1; };
  return { world, position, agent, predator, apex: apexMap };
}

function installPair(world, field, energyOptions = {}) {
  const transactions = installEcologicalTransactions({ world });
  const nutrients = installEcologicalNutrientCycle({
    world,
    resourceField: field,
    transactions,
    columns: 1,
    rows: 1,
    nutrientPerForageEnergy: 0.08,
    decompositionRate: 0.08,
  });
  const energy = installEcologicalEnergyLedger({
    world,
    resourceField: field,
    transactions,
    columns: 1,
    rows: 1,
    capacityScale: 0.4,
    recoveryRate: 0,
    assimilationEfficiency: 0.5,
    ...energyOptions,
  });
  nutrients.attachEnergyLedger(energy);
  return { nutrients, energy, transactions };
}

{
  const field = makeField();
  const fixture = makeWorld({
    grazers: [{ id: 1, energy: 1, x: 50, y: 50, grazeClock: 1 }],
    step: ({ world, agent, dt }) => {
      world.tick += 1;
      const grazer = agent.get(1);
      if (!grazer) return;
      grazer.energy += field.sample(50, 50).food * dt * 0.052;
    },
  });
  const { nutrients, transactions } = installPair(fixture.world, field);
  const baseline = nutrients.snapshot();
  assert.equal(baseline.eventDriven, true);
  assert.equal(baseline.populationScanFree, true);
  assertConserved(baseline, 'grazing baseline');

  fixture.world.step(1);
  const grazed = nutrients.snapshot();
  assert(grazed.flowTotals.vegetationToBiota > 0, 'grazing did not move vegetation nutrients into mobile biota');
  assert(grazed.flowTotals.vegetationToDetritus > 0, 'grazing waste did not enter detritus');
  assert(grazed.reservoirs.detritus > 0, 'grazing produced no detritus reservoir');
  assert(transactions.snapshot().counts.GRAZE > 0, 'grazing was not represented by explicit transactions');
  assertConserved(grazed, 'after grazing');

  const soilBefore = grazed.reservoirs.soil;
  const detritusBefore = grazed.reservoirs.detritus;
  nutrients.decompose(8);
  const decomposed = nutrients.snapshot();
  assert(decomposed.reservoirs.soil > soilBefore, 'decomposition did not return mineral nutrients to soil');
  assert(decomposed.reservoirs.detritus < detritusBefore, 'decomposition did not consume detritus');
  assert(decomposed.flowTotals.mineralization > 0, 'decomposition flow was not recorded');
  assert(transactions.snapshot().counts.DECOMPOSE > 0, 'decomposition did not emit DECOMPOSE transactions');
  assertConserved(decomposed, 'after decomposition');
}

{
  const field = makeField();
  const fixture = makeWorld({
    grazers: [{ id: 1, energy: 1, x: 50, y: 50 }],
    predators: [{ id: 2, energy: 2, x: 51, y: 50 }],
    step: ({ world, predator }) => {
      world.tick += 1;
      world.ecs.destroyEntity(1);
      predator.get(2).energy += 1;
    },
  });
  const { nutrients, transactions } = installPair(fixture.world, field);
  const baseline = nutrients.snapshot();
  fixture.world.step(1);
  const afterPredation = nutrients.snapshot();
  assert(afterPredation.flowTotals.biotaToBiota > 0, 'predation did not transfer prey nutrients to predator biomass');
  assert(afterPredation.flowTotals.biotaToDetritus > 0, 'predation waste did not become detritus');
  assert(afterPredation.reservoirs.detritus > baseline.reservoirs.detritus, 'predation did not increase detritus');
  assert.equal(transactions.snapshot().counts.PREDATE, 1, 'predation was not one explicit PREDATE transaction');
  assertConserved(afterPredation, 'after predation');
}

{
  const field = makeField();
  const fixture = makeWorld();
  const { nutrients, energy, transactions } = installPair(fixture.world, field, { recoveryRate: 0.02 });
  energy.withdraw(50, 50, 0.4);
  const beforeGrowth = nutrients.snapshot();
  fixture.world.step(1);
  const afterGrowth = nutrients.snapshot();
  assert(afterGrowth.flowTotals.soilToVegetation > beforeGrowth.flowTotals.soilToVegetation, 'primary production did not take nutrients from soil');
  assert(afterGrowth.reservoirs.vegetation > beforeGrowth.reservoirs.vegetation, 'primary production did not restore vegetation nutrients');
  assert(transactions.snapshot().counts.UPTAKE > 0, 'primary production did not emit UPTAKE transactions');
  assertConserved(afterGrowth, 'after primary production');
}

{
  const field = makeField();
  const fixture = makeWorld({
    predators: [{ id: 2, energy: 3, x: 50, y: 50 }],
    step: ({ world, position, predator }) => {
      world.tick += 1;
      position.set(4, { x: 51, y: 50 });
      predator.set(4, { energy: 2 });
      predator.get(2).energy *= 0.5;
    },
  });
  const { nutrients, transactions } = installPair(fixture.world, field);
  const before = nutrients.snapshot();
  fixture.world.step(1);
  const after = nutrients.snapshot();
  assert.equal(transactions.snapshot().counts.REPRODUCE, 1, 'reproduction was not an explicit REPRODUCE transaction');
  assert(after.flowTotals.reproductionTransferred > 0, 'reproduction did not transfer tracked body nutrients to offspring');
  assertConserved(before, 'before reproduction');
  assertConserved(after, 'after reproduction');
}

console.log(JSON.stringify({
  ok: true,
  eventDriven: true,
  populationScanFree: true,
  contract: 'soil minerals <-> vegetation nutrients -> mobile biota -> detritus -> soil minerals',
  unit: 'model-nutrient',
  physicalUnitClaim: false,
}, null, 2));
