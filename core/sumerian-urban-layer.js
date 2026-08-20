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

function unitHash(input) {
  return hash32(input) / 0x100000000;
}

const WARD_TYPES = Object.freeze(['temple', 'market', 'canal', 'craft', 'residential', 'gate']);
const TARGET_HOUSEHOLDS_PER_WARD = 140;
const TARGET_COMPOUNDS_PER_CORRIDOR = 45;
const METRIC_EPSILON = 1e-7;

function typeBase(type) {
  switch (type) {
    case 'temple': return { canal: 0.55, market: 0.62, institution: 0.96, security: 0.80, food: 0.70 };
    case 'market': return { canal: 0.61, market: 0.97, institution: 0.70, security: 0.70, food: 0.83 };
    case 'canal': return { canal: 0.98, market: 0.56, institution: 0.46, security: 0.58, food: 0.93 };
    case 'craft': return { canal: 0.68, market: 0.85, institution: 0.55, security: 0.63, food: 0.75 };
    case 'gate': return { canal: 0.50, market: 0.69, institution: 0.42, security: 0.94, food: 0.61 };
    default: return { canal: 0.61, market: 0.58, institution: 0.55, security: 0.68, food: 0.77 };
  }
}

function wardPosition(seed, cityId, ordinal) {
  const angle = unitHash(`${seed}|${cityId}|ward-angle|${ordinal}`) * Math.PI * 2;
  const ring = 0.18 + (ordinal % 4) * 0.11 + unitHash(`${seed}|${cityId}|ward-ring|${ordinal}`) * 0.05;
  return {
    x: clamp(0.5 + Math.cos(angle) * ring, 0.08, 0.92),
    y: clamp(0.5 + Math.sin(angle) * ring * 0.78, 0.10, 0.90),
    radius: clamp(0.105 - Math.min(0.035, ordinal * 0.0012), 0.058, 0.105),
  };
}

function corridorGeometry(seed, ward, ordinal) {
  const spread = 0.18 + Math.min(0.13, ordinal * 0.015);
  const angle = unitHash(`${seed}|${ward.id}|corridor-angle|${ordinal}`) * Math.PI * 2;
  const dx = Math.cos(angle) * spread;
  const dy = Math.sin(angle) * spread * 0.65;
  return {
    x1: clamp(0.5 - dx, 0.08, 0.92),
    y1: clamp(0.5 - dy, 0.10, 0.90),
    x2: clamp(0.5 + dx, 0.08, 0.92),
    y2: clamp(0.5 + dy, 0.10, 0.90),
  };
}

function householdProfile(social, household) {
  const occupations = {};
  let adults = 0;
  let statusTotal = 0;
  let living = 0;
  for (const id of household.memberIds) {
    const person = social.people.get(id);
    if (!person?.alive) continue;
    living += 1;
    statusTotal += person.status || 0;
    if (person.occupation) {
      adults += 1;
      occupations[person.occupation] = (occupations[person.occupation] || 0) + 1;
    }
  }
  return {
    living,
    adults,
    occupations,
    statusTotal,
    meanStatus: living ? statusTotal / living : 0,
  };
}

function occupationAffinity(type, profile) {
  const jobs = profile.occupations;
  const farmer = jobs.farmer || 0;
  const canal = jobs['canal-worker'] || 0;
  const herder = jobs.herder || 0;
  const potter = jobs.potter || 0;
  const merchant = jobs.merchant || 0;
  const scribe = jobs.scribe || 0;
  const priest = jobs.priest || 0;
  const soldier = jobs.soldier || 0;
  switch (type) {
    case 'temple': return priest * 3.2 + scribe * 2.2 + profile.meanStatus * 2.1;
    case 'market': return merchant * 3.2 + potter * 1.8 + herder * 1.0 + scribe * 0.35;
    case 'canal': return canal * 3.0 + farmer * 2.1 + herder * 0.8;
    case 'craft': return potter * 3.0 + merchant * 1.25 + canal * 0.35;
    case 'gate': return soldier * 3.1 + merchant * 0.8 + herder * 0.35;
    default: return Math.max(0, profile.living - profile.adults) * 0.35 + farmer * 0.35 + profile.meanStatus * 0.7;
  }
}

export function createSumerianUrbanLayer({
  seed,
  cities,
  state,
  kernel,
  social,
  transact,
  transactionTypes,
} = {}) {
  if (!seed || !Array.isArray(cities) || !state || !kernel || !social) {
    throw new Error('Sumer urban layer requires seed, cities, state, kernel, and social state.');
  }

  const wards = new Map();
  const corridors = new Map();
  const compounds = new Map();
  const cityData = new Map();

  function dataForCity(cityId) {
    if (!cityData.has(cityId)) {
      cityData.set(cityId, { cityId, wardIds: [], serial: 0, opened: 0, settled: 0, relocated: 0, compounds: 0 });
    }
    return cityData.get(cityId);
  }

  for (const city of cities) dataForCity(city.id);

  function cityById(cityId) {
    return cities.find(city => city.id === cityId) || null;
  }

  function wardType(city, ordinal) {
    if (ordinal < WARD_TYPES.length) return WARD_TYPES[ordinal];
    const weighted = [
      ['residential', 1.8],
      ['canal', 0.8 + (1 - clamp(city.canalHealth || 0, 0, 1)) * 0.7],
      ['market', 0.7 + clamp(city.administration || 0, 0, 1) * 0.5],
      ['craft', 0.65 + clamp(city.craftCapacity || 0, 0, 1) * 0.55],
      ['gate', 0.45 + clamp(city.military || 0, 0, 1) * 0.5],
      ['temple', 0.40 + clamp(city.templeComplexity || 0, 0, 1) * 0.5],
    ];
    const total = weighted.reduce((sum, entry) => sum + entry[1], 0);
    let cursor = unitHash(`${seed}|${city.id}|ward-type|${ordinal}`) * total;
    for (const [type, weight] of weighted) {
      cursor -= weight;
      if (cursor <= 0) return type;
    }
    return 'residential';
  }

  function createWard(cityId, reason = 'growth') {
    const city = cityById(cityId);
    const data = dataForCity(cityId);
    const ordinal = data.serial++;
    const id = `${cityId}:ward:${ordinal + 1}`;
    const position = wardPosition(seed, cityId, ordinal);
    const ward = {
      id,
      cityId,
      ordinal,
      type: wardType(city, ordinal),
      foundedYearIndex: state.yearIndex,
      reason,
      corridorIds: [],
      householdIds: new Set(),
      population: 0,
      adults: 0,
      statusTotal: 0,
      meanStatus: 0,
      density: 0,
      canalAccess: 0,
      marketAccess: 0,
      institutionalAccess: 0,
      security: 0,
      foodAccess: 0,
      ...position,
    };
    wards.set(id, ward);
    data.wardIds.push(id);
    data.opened += 1;
    createCorridor(ward, 'initial');
    if (transactionTypes?.WARD && typeof transact === 'function') {
      transact(transactionTypes.WARD, { cityId, wardId: id, wardType: ward.type, reason }, { wards: 1 });
    }
    return ward;
  }

  function createCorridor(ward, reason = 'growth') {
    const ordinal = ward.corridorIds.length;
    const id = `${ward.id}:corridor:${ordinal + 1}`;
    const geometry = corridorGeometry(seed, ward, ordinal);
    const corridor = {
      id,
      cityId: ward.cityId,
      wardId: ward.id,
      ordinal,
      kind: ward.type === 'canal' && ordinal === 0 ? 'canal' : ordinal === 0 ? 'street' : 'lane',
      foundedYearIndex: state.yearIndex,
      reason,
      compoundIds: new Set(),
      ...geometry,
    };
    corridors.set(id, corridor);
    ward.corridorIds.push(id);
    if (transactionTypes?.CORRIDOR && typeof transact === 'function') {
      transact(transactionTypes.CORRIDOR, { cityId: ward.cityId, wardId: ward.id, corridorId: id, kind: corridor.kind, reason }, { corridors: 1 });
    }
    return corridor;
  }

  function ensureWardCount(cityId, householdCount) {
    const data = dataForCity(cityId);
    const desired = Math.max(3, Math.ceil(Math.max(1, householdCount) / TARGET_HOUSEHOLDS_PER_WARD));
    while (data.wardIds.length < desired) createWard(cityId, data.wardIds.length ? 'household-pressure' : 'initial');
  }

  function currentWardRows(cityId) {
    return dataForCity(cityId).wardIds.map(id => wards.get(id)).filter(Boolean);
  }

  function placementScore(ward, profile, householdId) {
    const affinity = occupationAffinity(ward.type, profile);
    const load = ward.householdIds.size / TARGET_HOUSEHOLDS_PER_WARD;
    const statusPreference = profile.meanStatus * (ward.type === 'temple' || ward.type === 'market' ? 0.8 : ward.type === 'gate' ? 0.2 : 0.4);
    const deterministicTie = unitHash(`${seed}|${householdId}|${ward.id}`) * 0.12;
    return affinity + statusPreference + deterministicTie - load * 2.2;
  }

  function chooseWard(household, profile) {
    const cityId = household.cityId;
    const rows = currentWardRows(cityId);
    let best = rows[0];
    let bestScore = -Infinity;
    for (const ward of rows) {
      const score = placementScore(ward, profile, household.id);
      if (score > bestScore) {
        best = ward;
        bestScore = score;
      }
    }
    return best;
  }

  function chooseCorridor(ward) {
    const desired = Math.max(1, Math.ceil((ward.householdIds.size + 1) / TARGET_COMPOUNDS_PER_CORRIDOR));
    while (ward.corridorIds.length < desired) createCorridor(ward, 'compound-pressure');
    return ward.corridorIds
      .map(id => corridors.get(id))
      .filter(Boolean)
      .sort((a, b) => a.compoundIds.size - b.compoundIds.size || a.ordinal - b.ordinal)[0];
  }

  function compoundPosition(householdId, corridor) {
    const t = 0.08 + unitHash(`${seed}|${householdId}|corridor-t`) * 0.84;
    const normal = (unitHash(`${seed}|${householdId}|corridor-n`) - 0.5) * 0.055;
    const dx = corridor.x2 - corridor.x1;
    const dy = corridor.y2 - corridor.y1;
    const length = Math.max(1e-6, Math.hypot(dx, dy));
    return {
      x: clamp(corridor.x1 + dx * t - dy / length * normal, 0.04, 0.96),
      y: clamp(corridor.y1 + dy * t + dx / length * normal, 0.05, 0.95),
    };
  }

  function applyWardDelta(ward, populationDelta, adultsDelta, statusDelta) {
    ward.population += populationDelta;
    ward.adults += adultsDelta;
    ward.statusTotal += statusDelta;
    if (Math.abs(ward.population) < METRIC_EPSILON) ward.population = 0;
    if (Math.abs(ward.adults) < METRIC_EPSILON) ward.adults = 0;
    if (Math.abs(ward.statusTotal) < METRIC_EPSILON) ward.statusTotal = 0;
  }

  function removeCompound(compound) {
    const ward = wards.get(compound.wardId);
    if (ward) {
      applyWardDelta(ward, -compound.population, -compound.adults, -compound.statusTotal);
      ward.householdIds.delete(compound.householdId);
    }
    corridors.get(compound.corridorId)?.compoundIds.delete(compound.id);
    const data = dataForCity(compound.cityId);
    data.compounds = Math.max(0, data.compounds - 1);
    compounds.delete(compound.householdId);
  }

  function placeHousehold(household, reason = 'settlement') {
    ensureWardCount(household.cityId, social.summary(household.cityId).households);
    const profile = householdProfile(social, household);
    const ward = chooseWard(household, profile);
    const corridor = chooseCorridor(ward);
    const point = compoundPosition(household.id, corridor);
    const id = `${household.id}:compound`;
    const compound = {
      id,
      householdId: household.id,
      cityId: household.cityId,
      wardId: ward.id,
      corridorId: corridor.id,
      foundedYearIndex: state.yearIndex,
      x: point.x,
      y: point.y,
      frontage: 0.45 + unitHash(`${seed}|${household.id}|frontage`) * 0.55,
      population: profile.living,
      adults: profile.adults,
      statusTotal: profile.statusTotal,
    };
    compounds.set(household.id, compound);
    ward.householdIds.add(household.id);
    applyWardDelta(ward, compound.population, compound.adults, compound.statusTotal);
    corridor.compoundIds.add(id);
    household.urbanParentNodeId = `compound:${id}`;
    const data = dataForCity(household.cityId);
    data.compounds += 1;
    if (reason === 'relocation') data.relocated += 1;
    else data.settled += 1;
    const type = reason === 'relocation' ? transactionTypes?.RELOCATE : transactionTypes?.SETTLE;
    if (type && typeof transact === 'function') {
      transact(type, { cityId: household.cityId, householdId: household.id, wardId: ward.id, corridorId: corridor.id, reason }, { households: 1 });
    }
    return compound;
  }

  function updateCompoundMetrics(compound, household) {
    const ward = wards.get(compound.wardId);
    if (!ward) throw new Error(`Sumer compound lacks ward while updating metrics: ${compound.householdId}`);
    const profile = householdProfile(social, household);
    const populationDelta = profile.living - compound.population;
    const adultsDelta = profile.adults - compound.adults;
    const statusDelta = profile.statusTotal - compound.statusTotal;
    if (populationDelta || adultsDelta || Math.abs(statusDelta) > METRIC_EPSILON) {
      applyWardDelta(ward, populationDelta, adultsDelta, statusDelta);
      compound.population = profile.living;
      compound.adults = profile.adults;
      compound.statusTotal = profile.statusTotal;
    }
  }

  function refreshWardMetrics(ward) {
    const city = cityById(ward.cityId);
    const base = typeBase(ward.type);
    ward.meanStatus = ward.population ? ward.statusTotal / ward.population : 0;
    ward.density = ward.householdIds.size / TARGET_HOUSEHOLDS_PER_WARD;
    const densityPenalty = clamp((ward.density - 0.9) * 0.22, 0, 0.20);
    ward.canalAccess = clamp(base.canal * 0.62 + clamp(city.canalHealth || 0, 0, 1) * 0.38 - densityPenalty * 0.35, 0, 1);
    ward.marketAccess = clamp(base.market * 0.72 + clamp(city.craftCapacity || 0, 0, 1) * 0.28 - densityPenalty * 0.20, 0, 1);
    ward.institutionalAccess = clamp(base.institution * 0.62 + clamp(city.administration || 0, 0, 1) * 0.21 + clamp(city.templeComplexity || 0, 0, 1) * 0.17 - densityPenalty * 0.25, 0, 1);
    ward.security = clamp(base.security * 0.70 + clamp(city.military || 0, 0, 1) * 0.30 - densityPenalty * 0.50, 0, 1);
    ward.foodAccess = clamp(base.food * 0.52 + clamp(city.foodRatio || 0, 0, 1) * 0.48 - densityPenalty * 0.35, 0, 1);
  }

  function bootstrap() {
    for (const city of cities) ensureWardCount(city.id, social.summary(city.id).households);
    for (const household of social.households.values()) placeHousehold(household, 'initial');
    for (const ward of wards.values()) refreshWardMetrics(ward);
    assertConsistent();
    return snapshot();
  }

  function reconcile() {
    for (const city of cities) {
      ensureWardCount(city.id, social.summary(city.id).households);
    }

    const changedHouseholdIds = typeof social.drainUrbanChanges === 'function'
      ? social.drainUrbanChanges()
      : [...social.households.keys()];

    for (const householdId of changedHouseholdIds) {
      const household = social.households.get(householdId);
      const compound = compounds.get(householdId);
      if (!household) {
        if (compound) removeCompound(compound);
        continue;
      }
      if (!compound) {
        placeHousehold(household, state.yearIndex === 0 ? 'initial' : 'settlement');
        continue;
      }
      if (household.cityId !== compound.cityId) {
        removeCompound(compound);
        placeHousehold(household, 'relocation');
        continue;
      }
      updateCompoundMetrics(compound, household);
    }

    for (const ward of wards.values()) refreshWardMetrics(ward);
    if (compounds.size !== social.households.size) {
      throw new Error(`Sumer urban compound mismatch: compounds=${compounds.size} households=${social.households.size}`);
    }
    return snapshot();
  }

  function summary(cityId) {
    const wardRows = currentWardRows(cityId);
    const data = dataForCity(cityId);
    const corridorRows = wardRows.flatMap(ward => ward.corridorIds.map(id => corridors.get(id)).filter(Boolean));
    const householdCount = Math.max(1, data.compounds);
    const weighted = key => wardRows.reduce((sum, ward) => sum + ward[key] * ward.householdIds.size, 0) / householdCount;
    return {
      cityId,
      wards: wardRows.length,
      corridors: corridorRows.length,
      compounds: data.compounds,
      targetHouseholdsPerWard: TARGET_HOUSEHOLDS_PER_WARD,
      hardWardCap: null,
      displayCap: null,
      meanCanalAccess: weighted('canalAccess'),
      meanMarketAccess: weighted('marketAccess'),
      meanInstitutionalAccess: weighted('institutionalAccess'),
      meanSecurity: weighted('security'),
      meanFoodAccess: weighted('foodAccess'),
      meanDensity: weighted('density'),
    };
  }

  function householdContext(householdId) {
    const compound = compounds.get(householdId);
    if (!compound) return null;
    const ward = wards.get(compound.wardId);
    const corridor = corridors.get(compound.corridorId);
    return {
      compound: { ...compound },
      ward: ward ? {
        id: ward.id,
        type: ward.type,
        canalAccess: ward.canalAccess,
        marketAccess: ward.marketAccess,
        institutionalAccess: ward.institutionalAccess,
        security: ward.security,
        foodAccess: ward.foodAccess,
        density: ward.density,
      } : null,
      corridor: corridor ? { id: corridor.id, kind: corridor.kind } : null,
    };
  }

  function cityDetail(cityId) {
    const wardRows = currentWardRows(cityId);
    const wardIds = new Set(wardRows.map(ward => ward.id));
    const corridorRows = [...corridors.values()].filter(corridor => wardIds.has(corridor.wardId));
    const compoundRows = [...compounds.values()].filter(compound => compound.cityId === cityId);
    return {
      ...summary(cityId),
      wards: wardRows.map(ward => ({
        id: ward.id,
        cityId: ward.cityId,
        type: ward.type,
        foundedYearIndex: ward.foundedYearIndex,
        x: ward.x,
        y: ward.y,
        radius: ward.radius,
        population: ward.population,
        households: ward.householdIds.size,
        density: ward.density,
        canalAccess: ward.canalAccess,
        marketAccess: ward.marketAccess,
        institutionalAccess: ward.institutionalAccess,
        security: ward.security,
        foodAccess: ward.foodAccess,
        corridorIds: [...ward.corridorIds],
      })),
      corridors: corridorRows.map(corridor => ({
        id: corridor.id,
        cityId: corridor.cityId,
        wardId: corridor.wardId,
        kind: corridor.kind,
        x1: corridor.x1,
        y1: corridor.y1,
        x2: corridor.x2,
        y2: corridor.y2,
        compoundIds: [...corridor.compoundIds],
      })),
      compounds: compoundRows.map(compound => ({ ...compound })),
    };
  }

  function ensureNode({ id, parentId, label, scale, state: nodeState }) {
    if (!kernel.nodes.has(id)) {
      kernel.addNode({ id, parentId, label, scale, characteristicTime: 1, state: nodeState, conserved: {} });
    }
    return id;
  }

  function ensureHouseholdPath(householdId) {
    const household = social.households.get(householdId);
    const compound = compounds.get(householdId);
    if (!household || !compound) throw new Error(`Unknown Sumer urban household: ${householdId}`);
    const ward = wards.get(compound.wardId);
    const corridor = corridors.get(compound.corridorId);
    const cityNodeId = `city:${household.cityId}`;
    const wardNodeId = ensureNode({ id: `ward:${ward.id}`, parentId: cityNodeId, label: ward.id, scale: 900, state: ward });
    const corridorNodeId = ensureNode({ id: `corridor:${corridor.id}`, parentId: wardNodeId, label: corridor.id, scale: 180, state: corridor });
    const compoundNodeId = ensureNode({ id: `compound:${compound.id}`, parentId: corridorNodeId, label: compound.id, scale: 35, state: compound });
    household.urbanParentNodeId = compoundNodeId;

    const householdNode = kernel.nodes.get(`household:${household.id}`);
    if (householdNode && householdNode.parentId !== compoundNodeId) {
      const oldParent = kernel.nodes.get(householdNode.parentId);
      if (oldParent) oldParent.children = oldParent.children.filter(id => id !== householdNode.id);
      householdNode.parentId = compoundNodeId;
      const newParent = kernel.nodes.get(compoundNodeId);
      if (newParent && !newParent.children.includes(householdNode.id)) newParent.children.push(householdNode.id);
    }
    return { wardNodeId, corridorNodeId, compoundNodeId };
  }

  function observeWard(wardId, observerId = 'sumer-ward-viewer') {
    const ward = wards.get(wardId);
    if (!ward) throw new Error(`Unknown Sumer ward: ${wardId}`);
    const nodeId = ensureNode({ id: `ward:${ward.id}`, parentId: `city:${ward.cityId}`, label: ward.id, scale: 900, state: ward });
    return kernel.requestResolution({ observerId, nodeId, spatialScale: 900, temporalScale: 1 });
  }

  function observeCorridor(corridorId, observerId = 'sumer-corridor-viewer') {
    const corridor = corridors.get(corridorId);
    if (!corridor) throw new Error(`Unknown Sumer corridor: ${corridorId}`);
    const ward = wards.get(corridor.wardId);
    const wardNodeId = ensureNode({ id: `ward:${ward.id}`, parentId: `city:${ward.cityId}`, label: ward.id, scale: 900, state: ward });
    const nodeId = ensureNode({ id: `corridor:${corridor.id}`, parentId: wardNodeId, label: corridor.id, scale: 180, state: corridor });
    return kernel.requestResolution({ observerId, nodeId, spatialScale: 180, temporalScale: 0.5 });
  }

  function observeCompound(householdId, observerId = 'sumer-compound-viewer') {
    const path = ensureHouseholdPath(householdId);
    return kernel.requestResolution({ observerId, nodeId: path.compoundNodeId, spatialScale: 35, temporalScale: 0.25 });
  }

  function assertClose(actual, expected, label) {
    if (Math.abs(actual - expected) > METRIC_EPSILON) {
      throw new Error(`Sumer urban metric mismatch for ${label}: cached=${actual} scanned=${expected}`);
    }
  }

  function assertConsistent() {
    if (compounds.size !== social.households.size) {
      throw new Error(`Sumer urban compound mismatch: compounds=${compounds.size} households=${social.households.size}`);
    }
    for (const household of social.households.values()) {
      const compound = compounds.get(household.id);
      if (!compound) throw new Error(`Sumer household lacks compound: ${household.id}`);
      if (compound.cityId !== household.cityId) throw new Error(`Sumer household compound city mismatch: ${household.id}`);
      const ward = wards.get(compound.wardId);
      const corridor = corridors.get(compound.corridorId);
      if (!ward || ward.cityId !== household.cityId) throw new Error(`Sumer compound lacks valid ward: ${household.id}`);
      if (!corridor || corridor.wardId !== ward.id) throw new Error(`Sumer compound lacks valid corridor: ${household.id}`);
      if (!ward.householdIds.has(household.id)) throw new Error(`Sumer ward missing household membership: ${household.id}`);
      if (!corridor.compoundIds.has(compound.id)) throw new Error(`Sumer corridor missing compound membership: ${household.id}`);
      const profile = householdProfile(social, household);
      assertClose(compound.population, profile.living, `${household.id} population`);
      assertClose(compound.adults, profile.adults, `${household.id} adults`);
      assertClose(compound.statusTotal, profile.statusTotal, `${household.id} statusTotal`);
    }
    const compoundCountsByCity = new Map(cities.map(city => [city.id, 0]));
    for (const compound of compounds.values()) {
      compoundCountsByCity.set(compound.cityId, (compoundCountsByCity.get(compound.cityId) || 0) + 1);
    }
    for (const city of cities) {
      assertClose(dataForCity(city.id).compounds, compoundCountsByCity.get(city.id) || 0, `${city.id} compound count`);
    }
    for (const ward of wards.values()) {
      let population = 0;
      let adults = 0;
      let statusTotal = 0;
      for (const householdId of ward.householdIds) {
        const household = social.households.get(householdId);
        if (!household) throw new Error(`Sumer ward contains stale household: ${householdId}`);
        const profile = householdProfile(social, household);
        population += profile.living;
        adults += profile.adults;
        statusTotal += profile.statusTotal;
      }
      assertClose(ward.population, population, `${ward.id} population`);
      assertClose(ward.adults, adults, `${ward.id} adults`);
      assertClose(ward.statusTotal, statusTotal, `${ward.id} statusTotal`);
      assertClose(ward.meanStatus, population ? statusTotal / population : 0, `${ward.id} meanStatus`);
      assertClose(ward.density, ward.householdIds.size / TARGET_HOUSEHOLDS_PER_WARD, `${ward.id} density`);
    }
    return true;
  }

  function snapshot() {
    const summaries = cities.map(city => summary(city.id));
    return {
      version: 1,
      model: 'persistent-ward-corridor-compound',
      metricUpdateMode: 'event-driven-household-deltas',
      exactHouseholds: true,
      displayCap: null,
      hardWardCap: null,
      wards: summaries.reduce((sum, item) => sum + item.wards, 0),
      corridors: summaries.reduce((sum, item) => sum + item.corridors, 0),
      compounds: summaries.reduce((sum, item) => sum + item.compounds, 0),
      cities: summaries,
    };
  }

  bootstrap();

  return {
    version: 1,
    wards,
    corridors,
    compounds,
    reconcile,
    summary,
    cityDetail,
    householdContext,
    ensureHouseholdPath,
    observeWard,
    observeCorridor,
    observeCompound,
    snapshot,
    assertConsistent,
  };
}
