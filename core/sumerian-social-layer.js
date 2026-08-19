const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function hash32(input) {
  let hash = 2166136261 >>> 0;
  const text = String(input);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function deterministicRandom(seed, ...parts) {
  let state = hash32(`${seed}|${parts.join('|')}`) || 0x9e3779b9;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) / 0x100000000;
}

export const SUMER_OCCUPATIONS = Object.freeze([
  'farmer',
  'canal-worker',
  'herder',
  'potter',
  'merchant',
  'scribe',
  'priest',
  'soldier',
]);

const STATUS_BY_OCCUPATION = Object.freeze({
  farmer: 0.26,
  'canal-worker': 0.30,
  herder: 0.31,
  potter: 0.36,
  merchant: 0.48,
  scribe: 0.58,
  priest: 0.62,
  soldier: 0.43,
});

function occupationWeights(city) {
  const admin = clamp(city.administration || 0, 0, 1);
  const temple = clamp(city.templeComplexity || 0, 0, 1);
  const military = clamp(city.military || 0, 0, 1);
  const trade = clamp((city.tradeGoods || 0) / Math.max(1, city.population || 1), 0, 1);
  return [
    ['farmer', 0.46 - admin * 0.10],
    ['canal-worker', 0.11 + (1 - clamp(city.canalHealth || 0, 0, 1)) * 0.08],
    ['herder', 0.09],
    ['potter', 0.075 + clamp(city.craftCapacity || 0, 0, 1) * 0.06],
    ['merchant', 0.045 + trade * 0.14],
    ['scribe', 0.018 + admin * 0.095],
    ['priest', 0.022 + temple * 0.075],
    ['soldier', 0.055 + military * 0.12],
  ].map(([occupation, weight]) => [occupation, Math.max(0.005, weight)]);
}

function chooseWeighted(seed, key, weights) {
  const total = weights.reduce((sum, entry) => sum + entry[1], 0);
  let cursor = deterministicRandom(seed, key) * total;
  for (const [value, weight] of weights) {
    cursor -= weight;
    if (cursor <= 0) return value;
  }
  return weights[weights.length - 1][0];
}

function initialAge(seed, cityId, serial) {
  const roll = deterministicRandom(seed, 'age-band', cityId, serial);
  if (roll < 0.34) return Math.floor(deterministicRandom(seed, 'age-child', cityId, serial) * 15);
  if (roll < 0.82) return 15 + Math.floor(deterministicRandom(seed, 'age-adult', cityId, serial) * 30);
  return 45 + Math.floor(deterministicRandom(seed, 'age-elder', cityId, serial) * 27);
}

function householdTargetSize(seed, cityId, serial) {
  const roll = deterministicRandom(seed, 'household-size', cityId, serial);
  if (roll < 0.08) return 2;
  if (roll < 0.28) return 3;
  if (roll < 0.58) return 4;
  if (roll < 0.82) return 5;
  if (roll < 0.95) return 6;
  return 7;
}

export function createSumerianSocialLayer({
  seed,
  cities,
  state,
  kernel,
  transact,
  transactionTypes,
} = {}) {
  if (!seed || !Array.isArray(cities) || !state || !kernel || typeof transact !== 'function') {
    throw new Error('Sumer social layer requires seed, cities, state, kernel, and transact.');
  }

  const people = new Map();
  const households = new Map();
  const cityData = new Map();
  const maturitySchedule = new Map();
  const dirtyHouseholdIds = new Set();
  let trackUrbanChanges = false;
  let personSerial = 0;
  let householdSerial = 0;

  function markHouseholdDirty(householdId) {
    if (trackUrbanChanges && householdId) dirtyHouseholdIds.add(householdId);
  }

  function drainUrbanChanges() {
    const householdIds = [...dirtyHouseholdIds];
    dirtyHouseholdIds.clear();
    return householdIds;
  }

  function makeCityData(city) {
    const occupations = Object.fromEntries(SUMER_OCCUPATIONS.map(name => [name, 0]));
    const data = {
      cityId: city.id,
      livingIds: [],
      livingIndex: new Map(),
      householdIds: new Set(),
      occupations,
      adults: 0,
      dependents: 0,
      statusTotal: 0,
      births: 0,
      deaths: 0,
      migrantsIn: 0,
      migrantsOut: 0,
    };
    cityData.set(city.id, data);
    return data;
  }

  for (const city of cities) makeCityData(city);

  function scheduleMaturity(person) {
    const age = state.yearIndex - person.birthYearIndex;
    if (age >= 15 || !person.alive) return;
    const year = person.birthYearIndex + 15;
    const list = maturitySchedule.get(year) || [];
    list.push(person.id);
    maturitySchedule.set(year, list);
  }

  function createHousehold(cityId, reason = 'initial') {
    const id = `${cityId}:h:${++householdSerial}`;
    const household = {
      id,
      cityId,
      foundedYearIndex: state.yearIndex,
      memberIds: [],
      kinGroup: `${cityId}:kin:${Math.floor((householdSerial - 1) / 7) + 1}`,
      status: 0.25,
      reason,
    };
    households.set(id, household);
    cityData.get(cityId).householdIds.add(id);
    markHouseholdDirty(id);
    return household;
  }

  function setOccupation(person, city, occupation) {
    const data = cityData.get(person.cityId);
    if (person.occupation) data.occupations[person.occupation] -= 1;
    person.occupation = occupation;
    person.status = STATUS_BY_OCCUPATION[occupation] || 0.25;
    data.occupations[occupation] += 1;
    markHouseholdDirty(person.householdId);
  }

  function assignOccupation(person, city, reason = 'adulthood') {
    if (!person.alive || (state.yearIndex - person.birthYearIndex) < 15) return null;
    const occupation = chooseWeighted(seed, `occupation|${person.id}|${state.yearIndex}|${reason}`, occupationWeights(city));
    setOccupation(person, city, occupation);
    return occupation;
  }

  function addLivingIndex(data, person) {
    data.livingIndex.set(person.id, data.livingIds.length);
    data.livingIds.push(person.id);
  }

  function addPerson({ city, household, age = 0, sex = null, reason = 'birth', parentIds = [] }) {
    const serial = ++personSerial;
    const id = `${city.id}:p:${serial}`;
    const resolvedSex = sex || (deterministicRandom(seed, 'sex', id) < 0.5 ? 'female' : 'male');
    const birthYearIndex = state.yearIndex - Math.max(0, Math.floor(age));
    const person = {
      id,
      cityId: city.id,
      householdId: household.id,
      kinGroup: household.kinGroup,
      sex: resolvedSex,
      birthYearIndex,
      parentIds: parentIds.slice(0, 2),
      occupation: null,
      status: 0.12,
      alive: true,
      reason,
    };
    people.set(id, person);
    household.memberIds.push(id);
    const data = cityData.get(city.id);
    addLivingIndex(data, person);
    if (age >= 15) {
      data.adults += 1;
      assignOccupation(person, city, reason);
      data.statusTotal += person.status;
    } else {
      data.dependents += 1;
      data.statusTotal += person.status;
      scheduleMaturity(person);
    }
    markHouseholdDirty(household.id);
    return person;
  }

  function removeLivingIndex(data, personId) {
    const index = data.livingIndex.get(personId);
    if (index === undefined) return;
    const lastId = data.livingIds[data.livingIds.length - 1];
    data.livingIds[index] = lastId;
    data.livingIds.pop();
    data.livingIndex.delete(personId);
    if (lastId !== personId) data.livingIndex.set(lastId, index);
  }

  function removePerson(person, cause = 'demographic-turnover') {
    if (!person?.alive) return false;
    const data = cityData.get(person.cityId);
    const age = state.yearIndex - person.birthYearIndex;
    person.alive = false;
    person.deathYearIndex = state.yearIndex;
    person.deathCause = cause;
    removeLivingIndex(data, person.id);
    if (age >= 15) {
      data.adults -= 1;
      if (person.occupation) data.occupations[person.occupation] -= 1;
    } else {
      data.dependents -= 1;
    }
    data.statusTotal -= person.status || 0;
    const household = households.get(person.householdId);
    if (household) {
      const index = household.memberIds.indexOf(person.id);
      if (index >= 0) household.memberIds.splice(index, 1);
      if (!household.memberIds.length) {
        households.delete(household.id);
        data.householdIds.delete(household.id);
      }
    }
    markHouseholdDirty(person.householdId);
    return true;
  }

  function chooseDeathCandidate(cityId, ordinal, cause) {
    const data = cityData.get(cityId);
    if (!data?.livingIds.length) return null;
    let best = null;
    let bestRisk = -Infinity;
    for (let sample = 0; sample < 4; sample += 1) {
      const roll = deterministicRandom(seed, 'death-candidate', state.yearIndex, cityId, cause, ordinal, sample);
      const id = data.livingIds[Math.floor(roll * data.livingIds.length) % data.livingIds.length];
      const person = people.get(id);
      if (!person?.alive) continue;
      const age = state.yearIndex - person.birthYearIndex;
      const ageRisk = age < 5 ? 0.55 : age < 15 ? 0.15 : age < 45 ? 0.08 : age < 60 ? 0.45 : 0.90 + (age - 60) * 0.035;
      const noise = deterministicRandom(seed, 'death-risk', state.yearIndex, person.id, cause) * 0.22;
      const risk = ageRisk + noise;
      if (risk > bestRisk) {
        best = person;
        bestRisk = risk;
      }
    }
    return best;
  }

  function killMany(cityId, requested, cause = 'demographic-turnover', emit = true) {
    const data = cityData.get(cityId);
    const maximum = Math.max(0, data.livingIds.length - 300);
    const count = Math.min(maximum, Math.max(0, Math.round(requested)));
    let killed = 0;
    for (let ordinal = 0; ordinal < count; ordinal += 1) {
      const candidate = chooseDeathCandidate(cityId, ordinal, cause);
      if (candidate && removePerson(candidate, cause)) killed += 1;
    }
    data.deaths += killed;
    if (emit && killed > 0 && transactionTypes?.DEATH) {
      transact(transactionTypes.DEATH, { cityId, cause }, { people: killed });
    }
    return killed;
  }

  function birthMany(cityId, requested, cause = 'natural-growth', emit = true) {
    const city = cities.find(item => item.id === cityId);
    const data = cityData.get(cityId);
    const count = Math.max(0, Math.round(requested));
    const householdIds = [...data.householdIds];
    let born = 0;
    for (let ordinal = 0; ordinal < count; ordinal += 1) {
      let household = null;
      if (householdIds.length) {
        const roll = deterministicRandom(seed, 'birth-household', state.yearIndex, cityId, ordinal);
        for (let probe = 0; probe < Math.min(12, householdIds.length); probe += 1) {
          const id = householdIds[(Math.floor(roll * householdIds.length) + probe * 17) % householdIds.length];
          const candidate = households.get(id);
          if (candidate && candidate.memberIds.length < 8) { household = candidate; break; }
        }
      }
      if (!household) {
        household = createHousehold(cityId, 'household-formation');
        householdIds.push(household.id);
      }
      const adultParents = household.memberIds
        .map(id => people.get(id))
        .filter(person => person?.alive && (state.yearIndex - person.birthYearIndex) >= 15)
        .slice(0, 2)
        .map(person => person.id);
      addPerson({ city, household, age: 0, reason: cause, parentIds: adultParents });
      born += 1;
    }
    data.births += born;
    if (emit && born > 0 && transactionTypes?.BIRTH) {
      transact(transactionTypes.BIRTH, { cityId, cause }, { people: born });
    }
    return born;
  }

  function initializeCity(city) {
    const target = Math.max(300, Math.round(city.population));
    let created = 0;
    while (created < target) {
      const household = createHousehold(city.id, 'initial');
      const size = Math.min(target - created, householdTargetSize(seed, city.id, householdSerial));
      const staged = [];
      for (let index = 0; index < size; index += 1) {
        const age = initialAge(seed, city.id, created + index + 1);
        staged.push(addPerson({ city, household, age, reason: 'initial' }));
      }
      const adults = staged.filter(person => (state.yearIndex - person.birthYearIndex) >= 18);
      const children = staged.filter(person => (state.yearIndex - person.birthYearIndex) < 15);
      for (const child of children) child.parentIds = adults.slice(0, 2).map(parent => parent.id);
      created += size;
    }
    city.population = cityData.get(city.id).livingIds.length;
  }

  for (const city of cities) initializeCity(city);
  trackUrbanChanges = true;

  function beginYear() {
    const maturities = maturitySchedule.get(state.yearIndex) || [];
    const byCity = new Map();
    for (const id of maturities) {
      const person = people.get(id);
      if (!person?.alive || person.occupation) continue;
      const city = cities.find(item => item.id === person.cityId);
      if (!city) continue;
      const data = cityData.get(city.id);
      data.dependents = Math.max(0, data.dependents - 1);
      data.adults += 1;
      data.statusTotal -= person.status || 0;
      const occupation = assignOccupation(person, city, 'adulthood');
      data.statusTotal += person.status || 0;
      markHouseholdDirty(person.householdId);
      const counts = byCity.get(city.id) || {};
      counts[occupation] = (counts[occupation] || 0) + 1;
      byCity.set(city.id, counts);
    }
    maturitySchedule.delete(state.yearIndex);
    if (transactionTypes?.WORK) {
      for (const [cityId, occupations] of byCity) {
        transact(transactionTypes.WORK, { cityId, reason: 'adulthood' }, { occupations });
      }
    }
  }

  function summary(cityId) {
    const data = cityData.get(cityId);
    const population = data.livingIds.length;
    const employed = Object.values(data.occupations).reduce((sum, value) => sum + value, 0);
    const productiveAdults = Math.min(data.adults, employed);
    return {
      cityId,
      population,
      households: data.householdIds.size,
      adults: data.adults,
      dependents: data.dependents,
      employed,
      laborUnits: productiveAdults * 0.60,
      meanStatus: population > 0 ? data.statusTotal / population : 0,
      occupations: { ...data.occupations },
      births: data.births,
      deaths: data.deaths,
      migrantsIn: data.migrantsIn,
      migrantsOut: data.migrantsOut,
    };
  }

  function reconcileNaturalPopulation(cityId, targetPopulation, { foodRatio = 1, climateStress = 0 } = {}) {
    const data = cityData.get(cityId);
    const target = Math.max(300, Math.round(targetPopulation));
    const current = data.livingIds.length;
    const shortage = clamp(1 - foodRatio, 0, 1);
    const baselineTurnover = Math.round(current * (0.006 + shortage * 0.012 + clamp(climateStress, 0, 1) * 0.0015));
    const requiredLoss = Math.max(0, current - target);
    const deaths = Math.max(baselineTurnover, requiredLoss);
    const killed = killMany(cityId, deaths, shortage > 0.25 ? 'food-stress' : 'natural-turnover');
    const afterDeaths = cityData.get(cityId).livingIds.length;
    const births = Math.max(0, target - afterDeaths);
    birthMany(cityId, births, foodRatio > 0.95 ? 'growth' : 'replacement');
    return summary(cityId);
  }

  function moveHousehold(household, fromCityId, toCityId) {
    const from = cityData.get(fromCityId);
    const to = cityData.get(toCityId);
    from.householdIds.delete(household.id);
    to.householdIds.add(household.id);
    household.cityId = toCityId;
    let moved = 0;
    for (const id of household.memberIds.slice()) {
      const person = people.get(id);
      if (!person?.alive || person.cityId !== fromCityId) continue;
      const age = state.yearIndex - person.birthYearIndex;
      removeLivingIndex(from, id);
      if (age >= 15 && person.occupation) from.occupations[person.occupation] -= 1;
      if (age >= 15) from.adults -= 1;
      else from.dependents -= 1;
      from.statusTotal -= person.status || 0;
      person.cityId = toCityId;
      addLivingIndex(to, person);
      if (age >= 15 && person.occupation) to.occupations[person.occupation] += 1;
      if (age >= 15) to.adults += 1;
      else to.dependents += 1;
      to.statusTotal += person.status || 0;
      moved += 1;
    }
    from.migrantsOut += moved;
    to.migrantsIn += moved;
    markHouseholdDirty(household.id);
    return moved;
  }

  function migrateHouseholds(fromCityId, toCityId, requested) {
    const from = cityData.get(fromCityId);
    const target = Math.min(Math.max(0, Math.round(requested)), Math.max(0, from.livingIds.length - 300));
    if (target <= 0) return 0;
    const ids = [...from.householdIds];
    const start = ids.length ? Math.floor(deterministicRandom(seed, 'migration-start', state.yearIndex, fromCityId, toCityId) * ids.length) : 0;
    let moved = 0;
    for (let offset = 0; offset < ids.length && moved < target; offset += 1) {
      const household = households.get(ids[(start + offset * 13) % ids.length]);
      if (!household || household.cityId !== fromCityId) continue;
      const living = household.memberIds.filter(id => people.get(id)?.alive).length;
      if (!living) continue;
      const remaining = target - moved;
      if (living > remaining && moved > 0) continue;
      moved += moveHousehold(household, fromCityId, toCityId);
    }
    return moved;
  }

  function materializeHouseholdNode(householdId) {
    const household = households.get(householdId);
    if (!household) throw new Error(`Unknown Sumer household: ${householdId}`);
    const cityNodeId = `city:${household.cityId}`;
    const householdNodeId = `household:${household.id}`;
    if (!kernel.nodes.has(householdNodeId)) {
      kernel.addNode({
        id: householdNodeId,
        parentId: cityNodeId,
        label: household.id,
        scale: 35,
        characteristicTime: 1,
        state: household,
        conserved: {},
      });
    }
    return householdNodeId;
  }

  function materializePersonNode(personId) {
    const person = people.get(personId);
    if (!person?.alive) throw new Error(`Unknown living Sumer person: ${personId}`);
    const householdNodeId = materializeHouseholdNode(person.householdId);
    const personNodeId = `person:${person.id}`;
    if (!kernel.nodes.has(personNodeId)) {
      kernel.addNode({
        id: personNodeId,
        parentId: householdNodeId,
        label: person.id,
        scale: 1.7,
        characteristicTime: 0.25,
        state: person,
        conserved: {},
      });
    }
    return personNodeId;
  }

  function observeHousehold(householdId, observerId = 'sumer-household-viewer') {
    const nodeId = materializeHouseholdNode(householdId);
    return kernel.requestResolution({ observerId, nodeId, spatialScale: 35, temporalScale: 1 });
  }

  function observePerson(personId, observerId = 'sumer-person-viewer') {
    const nodeId = materializePersonNode(personId);
    return kernel.requestResolution({ observerId, nodeId, spatialScale: 1.7, temporalScale: 0.25 });
  }

  function cityDetail(cityId) {
    const data = cityData.get(cityId);
    if (!data) throw new Error(`Unknown Sumer city social state: ${cityId}`);
    const householdRows = [...data.householdIds].map(id => households.get(id)).filter(Boolean);
    return {
      ...summary(cityId),
      households: householdRows.map(household => ({
        id: household.id,
        cityId: household.cityId,
        kinGroup: household.kinGroup,
        foundedYearIndex: household.foundedYearIndex,
        memberIds: household.memberIds.filter(id => people.get(id)?.alive),
      })),
      people: data.livingIds.map(id => {
        const person = people.get(id);
        return {
          id: person.id,
          cityId: person.cityId,
          householdId: person.householdId,
          kinGroup: person.kinGroup,
          sex: person.sex,
          age: state.yearIndex - person.birthYearIndex,
          parentIds: person.parentIds.slice(),
          occupation: person.occupation,
          status: person.status,
        };
      }),
    };
  }

  function assertConsistent() {
    for (const city of cities) {
      const data = cityData.get(city.id);
      if (Math.round(city.population) !== data.livingIds.length) {
        throw new Error(`Sumer social mismatch for ${city.id}: city=${city.population} people=${data.livingIds.length}`);
      }
      const counted = Object.values(data.occupations).reduce((sum, value) => sum + value, 0);
      if (counted > data.adults) throw new Error(`Sumer occupation count exceeds adults for ${city.id}`);
      if (data.adults + data.dependents !== data.livingIds.length) throw new Error(`Sumer age-class mismatch for ${city.id}`);
    }
  }

  function snapshot() {
    const summaries = cities.map(city => summary(city.id));
    return {
      version: 1,
      model: 'explicit-households-event-driven-people',
      exactPeople: true,
      displayCap: null,
      people: summaries.reduce((sum, item) => sum + item.population, 0),
      households: summaries.reduce((sum, item) => sum + item.households, 0),
      adults: summaries.reduce((sum, item) => sum + item.adults, 0),
      dependents: summaries.reduce((sum, item) => sum + item.dependents, 0),
      cities: summaries,
    };
  }

  return {
    version: 1,
    people,
    households,
    beginYear,
    summary,
    reconcileNaturalPopulation,
    killMany,
    birthMany,
    migrateHouseholds,
    cityDetail,
    observeHousehold,
    observePerson,
    snapshot,
    assertConsistent,
    drainUrbanChanges,
  };
}
