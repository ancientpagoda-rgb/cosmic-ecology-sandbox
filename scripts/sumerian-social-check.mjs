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
    })),
    socialTransactions: snapshot.social.transactions.counts,
  };
}

const simulation = createSumerianCivilizationSimulation({ seed: 'sumer-social-check-2026' });
const initial = simulation.snapshot();
assert.equal(initial.version, 2);
assert.equal(initial.social.model, 'explicit-households-event-driven-people');
assert.equal(initial.social.exactPeople, true);
assert.equal(initial.social.displayCap, null);
assert.equal(initial.social.people, Math.round(initial.totals.population));
assert(initial.social.households > 5_000, `too few explicit households: ${initial.social.households}`);
assert.equal(initial.social.adults + initial.social.dependents, initial.social.people);

for (const city of initial.cities) {
  assert.equal(city.social.population, Math.round(city.population), `initial social population mismatch in ${city.id}`);
  assert(city.social.households > 0, `no households in ${city.id}`);
  assert(city.social.adults > 0 && city.social.dependents > 0, `missing age classes in ${city.id}`);
  assert(city.social.occupations.farmer > 0, `no farmers in ${city.id}`);
  assert(city.social.occupations['canal-worker'] > 0, `no canal workers in ${city.id}`);
  assert(city.social.occupations.scribe > 0, `no scribes in ${city.id}`);
}

const urukInitial = initial.cities.find(city => city.id === 'uruk');
const urukDetail = simulation.getCitySocialDetail('uruk');
assert.equal(urukDetail.people.length, urukDetail.population, 'city detail must expose every living person without a display cap');
assert.equal(urukDetail.households.length, urukInitial.social.households, 'city detail household list must match the cached household count');
const firstHousehold = urukDetail.households.find(household => household.memberIds.length > 0);
assert(firstHousehold, 'Uruk has no populated household');
const firstPersonId = firstHousehold.memberIds[0];
const householdObservation = simulation.observeHousehold(firstHousehold.id, 'social-household-test');
assert(householdObservation.resolvedNodeId.includes('household:'), 'household observer did not resolve a household node');
const personObservation = simulation.observePerson(firstPersonId, 'social-person-test');
assert(personObservation.resolvedNodeId.includes('person:'), 'person observer did not resolve a person node');

simulation.advance(120);
const after = simulation.snapshot();
assert.equal(after.yearBCE, 3380);
assert.equal(after.social.people, Math.round(after.totals.population));
assert(after.social.transactions.counts.BIRTH > 0, 'no explicit births occurred');
assert(after.social.transactions.counts.DEATH > 0, 'no explicit deaths occurred');
assert(after.social.transactions.counts.WORK > 0, 'no adulthood/work assignment events occurred');
for (const city of after.cities) {
  assert.equal(city.social.population, Math.round(city.population), `social population drift in ${city.id}`);
  assert.equal(city.social.adults + city.social.dependents, city.social.population, `age-class drift in ${city.id}`);
  const employed = Object.values(city.social.occupations).reduce((sum, value) => sum + value, 0);
  assert(employed <= city.social.adults, `occupation count exceeds adults in ${city.id}`);
}

const sameA = createSumerianCivilizationSimulation({ seed: 'sumer-social-deterministic' });
const sameB = createSumerianCivilizationSimulation({ seed: 'sumer-social-deterministic' });
sameA.advance(80);
sameB.advance(80);
assert.deepEqual(socialCompact(sameA.snapshot()), socialCompact(sameB.snapshot()), 'social layer is not deterministic for the same seed');

simulation.advance(1380);
const final = simulation.snapshot();
assert.equal(final.yearBCE, 2000);
assert(final.social.people > 7_000, `social civilization collapsed: ${final.social.people}`);
assert.equal(final.social.people, Math.round(final.totals.population));
assert(final.social.households > 1_000, `household system collapsed: ${final.social.households}`);
assert(final.cities.filter(city => city.social.population > 600).length >= 3, 'fewer than three viable social urban centers remain');

console.log(JSON.stringify({
  ok: true,
  initialPeople: initial.social.people,
  initialHouseholds: initial.social.households,
  year3380People: after.social.people,
  finalPeople: final.social.people,
  finalHouseholds: final.social.households,
  socialTransactionCounts: final.social.transactions.counts,
  finalOccupations: Object.fromEntries(final.cities.map(city => [city.id, city.social.occupations])),
}, null, 2));