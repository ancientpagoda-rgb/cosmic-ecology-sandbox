import assert from 'node:assert/strict';
import { createSumerianCivilizationSimulation } from '../core/sumerian-civilization-model.js';

function compact(snapshot) {
  return {
    yearBCE: snapshot.yearBCE,
    totals: {
      population: Number(snapshot.totals.population.toFixed(6)),
      grain: Number(snapshot.totals.grain.toFixed(6)),
      meanSalinity: Number(snapshot.totals.meanSalinity.toFixed(9)),
      raids: snapshot.totals.raids,
      tradeVolume: Number(snapshot.totals.tradeVolume.toFixed(6)),
    },
    politics: snapshot.politics,
    cities: snapshot.cities.map(city => ({
      id: city.id,
      population: Number(city.population.toFixed(6)),
      grain: Number(city.grain.toFixed(6)),
      foodYears: Number(city.foodYears.toFixed(9)),
      canalHealth: Number(city.canalHealth.toFixed(9)),
      meanSalinity: Number(city.meanSalinity.toFixed(9)),
      administration: Number(city.administration.toFixed(9)),
      records: city.records,
    })),
    counts: snapshot.transactions.counts,
  };
}

function calibrationSummary(snapshot) {
  return snapshot.cities.map(city => ({
    city: city.name,
    population: Math.round(city.population),
    harvest: Math.round(city.harvest),
    grain: Math.round(city.grain + city.institutionalGrain),
    foodRatio: Number(city.foodRatio.toFixed(3)),
    foodYears: Number(city.foodYears.toFixed(3)),
    canal: Number(city.canalHealth.toFixed(3)),
    salinity: Number(city.meanSalinity.toFixed(3)),
    cultivatedArea: Math.round(city.cultivatedArea),
  }));
}

const simulation = createSumerianCivilizationSimulation({ seed: 'sumer-check-734221' });
const initial = simulation.snapshot();
assert.equal(initial.mode, 'historically-constrained-emergent');
assert.equal(initial.exactHistoricalReplay, false);
assert.equal(initial.syntheticInitialPopulations, true);
assert.equal(initial.yearBCE, 3500);
assert.equal(initial.cities.length, 7);
assert.equal(initial.kernel.nodes.length, 8, 'kernel should contain one alluvium root plus seven city nodes');

const observed = simulation.observeCity('uruk', 'test-observer');
assert.equal(observed.resolvedNodeId, 'city:uruk');
simulation.clearObserver('test-observer');

simulation.advance(25);
const early = simulation.snapshot();
assert.equal(early.yearBCE, 3475);
for (const type of ['IRRIGATE', 'SOW', 'HARVEST', 'RATION', 'TAX', 'BUILD', 'RECORD']) {
  assert(early.transactions.counts[type] > 0, `${type} did not occur in first 25 simulated years`);
}

simulation.advance(475);
const middle = simulation.snapshot();
assert.equal(middle.yearBCE, 3000);
assert(
  middle.totals.population > 12_000,
  `urban system collapsed too far by 3000 BCE: total=${middle.totals.population}; cities=${JSON.stringify(calibrationSummary(middle))}`,
);
assert(middle.totals.population < 5_000_000, `population runaway: ${middle.totals.population}`);
assert(Number.isFinite(middle.totals.grain) && middle.totals.grain >= 0);
assert(Number.isFinite(middle.totals.meanSalinity));
for (const city of middle.cities) {
  assert(Number.isFinite(city.population) && city.population >= 300, `invalid population in ${city.id}`);
  assert(Number.isFinite(city.grain) && city.grain >= 0, `invalid grain in ${city.id}`);
  assert(city.canalHealth >= 0 && city.canalHealth <= 1, `invalid canal health in ${city.id}`);
  assert(city.meanSalinity >= 0 && city.meanSalinity <= 1, `invalid salinity in ${city.id}`);
  assert(city.administration >= 0 && city.administration <= 1, `invalid administration in ${city.id}`);
}

const sameA = createSumerianCivilizationSimulation({ seed: 'deterministic-sumer' });
const sameB = createSumerianCivilizationSimulation({ seed: 'deterministic-sumer' });
sameA.advance(180);
sameB.advance(180);
assert.deepEqual(compact(sameA.snapshot()), compact(sameB.snapshot()), 'same seed did not reproduce identical Sumer state');

const different = createSumerianCivilizationSimulation({ seed: 'different-sumer' });
different.advance(180);
assert.notDeepEqual(compact(sameA.snapshot()), compact(different.snapshot()), 'different seeds did not diverge');

simulation.advance(1000);
const final = simulation.snapshot();
assert.equal(final.yearBCE, 2000);
assert(final.totals.population > 7_000, `civilization-wide collapse reached calibration floor: ${final.totals.population}`);
assert(final.cities.filter(city => city.population > 600).length >= 3, 'fewer than three viable urban centers remained at scenario end');
assert(final.transactions.counts.IRRIGATE >= 7 * 1000, 'annual irrigation transactions unexpectedly sparse');
assert(final.transactions.counts.HARVEST >= 7 * 1000, 'annual harvest transactions unexpectedly sparse');
assert(final.transactions.counts.RATION >= 7 * 1000, 'annual ration transactions unexpectedly sparse');
assert(final.transactions.counts.RECORD > 0, 'administrative record production never emerged');
assert(final.totals.tradeVolume >= 0);
assert(final.totals.raids >= 0 && final.totals.raids < 900, `raid feedback became runaway: ${final.totals.raids}`);

console.log(JSON.stringify({
  ok: true,
  initialYearBCE: initial.yearBCE,
  middleYearBCE: middle.yearBCE,
  middlePopulation: Math.round(middle.totals.population),
  middleCities: calibrationSummary(middle),
  finalYearBCE: final.yearBCE,
  finalPopulation: Math.round(final.totals.population),
  viableFinalCities: final.cities.filter(city => city.population > 600).map(city => ({ name: city.name, population: Math.round(city.population) })),
  finalHegemon: final.politics.hegemonName,
  transactionCounts: final.transactions.counts,
  tradeVolume: final.totals.tradeVolume,
  raids: final.totals.raids,
}, null, 2));
