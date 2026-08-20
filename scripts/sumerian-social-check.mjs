import assert from 'node:assert/strict';
import { createSumerianCivilizationSimulation } from '../core/sumerian-civilization-social-v2.js';

function socialCompact(snapshot) {
  return {
    yearBCE: snapshot.yearBCE,
    population: snapshot.totals.population,
    households: snapshot.social.households,
    adults: snapshot.social.adults,
    dependents: snapshot.social.dependents,
    cities: snapshot.cities.map(city => ({
      id: city.id,
      population: city.population,
      households: city.social.households,
      adults: city.social.adults,
      dependents: city.social.dependents,
      occupations: city.social.occupations,
      urban: {
        wards: city.urban.wards,
        corridors: city.urban.corridors,
        compounds: city.urban.compounds,
        meanCanalAccess: city.urban.meanCanalAccess,
        meanMarketAccess: city.urban.meanMarketAccess,
        meanInstitutionalAccess: city.urban.meanInstitutionalAccess,
        meanSecurity: city.urban.meanSecurity,
      },
    })),
    socialTransactions: snapshot.social.transactions.counts,
    urbanTransactions: snapshot.urban.transactions.counts,
  };
}

const simulation = createSumerianCivilizationSimulation({ seed: 'sumer-social-check-2026' });
const initial = simulation.snapshot();
assert.equal(initial.version, 3);
assert.equal(initial.social.model, 'explicit-households-event-driven-people');
assert.equal(initial.social.exactPeople, true);
assert.equal(initial.social.displayCap, null);
assert.equal(initial.urban.model, 'persistent-ward-corridor-compound');
assert.equal(initial.urban.exactHouseholds, true);
assert.equal(initial.urban.displayCap, null);
assert.equal(initial.urban.hardWardCap, null);
assert.equal(initial.social.people, Math.round(initial.totals.population));
assert.equal(initial.urban.compounds, initial.social.households, 'every living household must have one persistent compound');
assert(initial.social.households > 5_000, `too few explicit households: ${initial.social.households}`);
assert(initial.urban.wards > 20, `too few urban wards: ${initial.urban.wards}`);
assert(initial.urban.corridors >= initial.urban.wards, 'each ward must have at least one corridor');
assert.equal(initial.social.adults + initial.social.dependents, initial.social.people);
assert(initial.urban.transactions.counts.WARD > 0, 'no initial ward construction transactions');
assert(initial.urban.transactions.counts.CORRIDOR > 0, 'no initial corridor construction transactions');
assert(initial.urban.transactions.counts.SETTLE > 0, 'no initial household settlement transactions');

for (const city of initial.cities) {
  assert.equal(city.social.population, Math.round(city.population), `initial social population mismatch in ${city.id}`);
  assert(city.social.households > 0, `no households in ${city.id}`);
  assert(city.social.adults > 0 && city.social.dependents > 0, `missing age classes in ${city.id}`);
  assert(city.social.occupations.farmer > 0, `no farmers in ${city.id}`);
  assert(city.social.occupations['canal-worker'] > 0, `no canal workers in ${city.id}`);
  assert(city.social.occupations.scribe > 0, `no scribes in ${city.id}`);
  assert(city.urban.wards >= 3, `fewer than three wards in ${city.id}`);
  assert.equal(city.urban.compounds, city.social.households, `urban compound mismatch in ${city.id}`);
  assert.equal(city.urban.hardWardCap, null, `hard ward cap introduced in ${city.id}`);
  for (const key of ['meanCanalAccess', 'meanMarketAccess', 'meanInstitutionalAccess', 'meanSecurity', 'meanFoodAccess']) {
    assert(Number.isFinite(city.urban[key]) && city.urban[key] >= 0 && city.urban[key] <= 1, `invalid ${key} in ${city.id}`);
  }
}

const urukInitial = initial.cities.find(city => city.id === 'uruk');
const urukDetail = simulation.getCitySocialDetail('uruk');
const urukUrban = simulation.getCityUrbanDetail('uruk');
assert.equal(urukDetail.people.length, urukDetail.population, 'city detail must expose every living person without a display cap');
assert.equal(urukDetail.households.length, urukInitial.social.households, 'city detail household list must match the cached household count');
assert.equal(urukUrban.compounds.length, urukDetail.households.length, 'urban detail must expose one compound per household');
assert.equal(urukUrban.wards.length, urukInitial.urban.wards, 'urban detail ward count mismatch');
assert.equal(urukUrban.corridors.length, urukInitial.urban.corridors, 'urban detail corridor count mismatch');

const firstHousehold = urukDetail.households.find(household => household.memberIds.length > 0 && household.urban?.ward && household.urban?.corridor);
assert(firstHousehold, 'Uruk has no populated urban household');
const firstPersonId = firstHousehold.memberIds[0];
const urbanContext = firstHousehold.urban;
const wardObservation = simulation.observeWard(urbanContext.ward.id, 'social-ward-test');
assert(wardObservation.resolvedNodeId.includes('ward:'), 'ward observer did not resolve a ward node');
const corridorObservation = simulation.observeCorridor(urbanContext.corridor.id, 'social-corridor-test');
assert(corridorObservation.resolvedNodeId.includes('corridor:'), 'corridor observer did not resolve a corridor node');
const compoundObservation = simulation.observeCompound(firstHousehold.id, 'social-compound-test');
assert(compoundObservation.resolvedNodeId.includes('compound:'), 'compound observer did not resolve a compound node');
const householdObservation = simulation.observeHousehold(firstHousehold.id, 'social-household-test');
assert(householdObservation.resolvedNodeId.includes('household:'), 'household observer did not resolve a household node');
const personObservation = simulation.observePerson(firstPersonId, 'social-person-test');
assert(personObservation.resolvedNodeId.includes('person:'), 'person observer did not resolve a person node');

const wardNode = simulation.kernel.nodes.get(`ward:${urbanContext.ward.id}`);
const corridorNode = simulation.kernel.nodes.get(`corridor:${urbanContext.corridor.id}`);
const compoundId = urukUrban.compounds.find(compound => compound.householdId === firstHousehold.id).id;
const compoundNode = simulation.kernel.nodes.get(`compound:${compoundId}`);
const householdNode = simulation.kernel.nodes.get(`household:${firstHousehold.id}`);
const personNode = simulation.kernel.nodes.get(`person:${firstPersonId}`);
assert.equal(wardNode.parentId, 'city:uruk', 'ward is not parented to Uruk');
assert.equal(corridorNode.parentId, wardNode.id, 'corridor is not parented to ward');
assert.equal(compoundNode.parentId, corridorNode.id, 'compound is not parented to corridor');
assert.equal(householdNode.parentId, compoundNode.id, 'household is not parented to compound');
assert.equal(personNode.parentId, householdNode.id, 'person is not parented to household');

const firstPerson = urukDetail.people.find(person => person.id === firstPersonId);
assert(Number.isFinite(firstPerson.needs.marketAccess), 'person lacks local market access');
assert(Number.isFinite(firstPerson.needs.canalAccess), 'person lacks local canal access');
assert(firstPerson.urban?.ward?.id === urbanContext.ward.id, 'person urban context disagrees with household ward');

simulation.advance(120);
const after = simulation.snapshot();
assert.equal(after.yearBCE, 3380);
assert.equal(after.social.people, Math.round(after.totals.population));
assert.equal(after.urban.compounds, after.social.households, 'urban compounds drifted from living households');
assert(after.social.transactions.counts.BIRTH > 0, 'no explicit births occurred');
assert(after.social.transactions.counts.DEATH > 0, 'no explicit deaths occurred');
assert(after.social.transactions.counts.WORK > 0, 'no adulthood/work assignment events occurred');
simulation.urban.assertConsistent();
for (const city of after.cities) {
  assert.equal(city.social.population, Math.round(city.population), `social population drift in ${city.id}`);
  assert.equal(city.social.adults + city.social.dependents, city.social.population, `age-class drift in ${city.id}`);
  assert.equal(city.urban.compounds, city.social.households, `urban household drift in ${city.id}`);
  const employed = Object.values(city.social.occupations).reduce((sum, value) => sum + value, 0);
  assert(employed <= city.social.adults, `occupation count exceeds adults in ${city.id}`);
}

const sameA = createSumerianCivilizationSimulation({ seed: 'sumer-social-deterministic' });
const sameB = createSumerianCivilizationSimulation({ seed: 'sumer-social-deterministic' });
sameA.advance(80);
sameB.advance(80);
assert.deepEqual(socialCompact(sameA.snapshot()), socialCompact(sameB.snapshot()), 'social/urban layer is not deterministic for the same seed');

simulation.advance(1380);
const final = simulation.snapshot();
assert.equal(final.yearBCE, 2000);
assert(final.social.people > 7_000, `social civilization collapsed: ${final.social.people}`);
assert.equal(final.social.people, Math.round(final.totals.population));
assert(final.social.households > 1_000, `household system collapsed: ${final.social.households}`);
assert.equal(final.urban.compounds, final.social.households, 'final urban compound ledger drift');
assert(final.cities.filter(city => city.social.population > 600).length >= 3, 'fewer than three viable social urban centers remain');
simulation.urban.assertConsistent();

console.log(JSON.stringify({
  ok: true,
  initialPeople: initial.social.people,
  initialHouseholds: initial.social.households,
  initialWards: initial.urban.wards,
  initialCorridors: initial.urban.corridors,
  year3380People: after.social.people,
  year3380Wards: after.urban.wards,
  finalPeople: final.social.people,
  finalHouseholds: final.social.households,
  finalWards: final.urban.wards,
  finalCorridors: final.urban.corridors,
  socialTransactionCounts: final.social.transactions.counts,
  urbanTransactionCounts: final.urban.transactions.counts,
  finalOccupations: Object.fromEntries(final.cities.map(city => [city.id, city.social.occupations])),
}, null, 2));
