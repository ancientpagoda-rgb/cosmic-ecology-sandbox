import { RealityKernel, createTransactionJournal } from '../packages/multiscale-reality-kernel/src/index.js';

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export const SUMER_TRANSACTION_TYPES = Object.freeze({
  IRRIGATE: 'IRRIGATE',
  SOW: 'SOW',
  HARVEST: 'HARVEST',
  RATION: 'RATION',
  TAX: 'TAX',
  TRADE: 'TRADE',
  BUILD: 'BUILD',
  RECORD: 'RECORD',
  MIGRATE: 'MIGRATE',
  RAID: 'RAID',
  HEGEMONY: 'HEGEMONY',
});

// Geographic positions are schematic relative positions on the southern
// Mesopotamian alluvium, not survey-grade reconstructions of ancient channels.
// Initial populations and stocks are synthetic model state, not historical
// population estimates.
const CITY_SEEDS = Object.freeze([
  { id: 'kish', name: 'Kish', x: 0.55, y: 0.10, population: 5200, canal: 0.46, administration: 0.12, temple: 0.16 },
  { id: 'nippur', name: 'Nippur', x: 0.51, y: 0.27, population: 4100, canal: 0.52, administration: 0.14, temple: 0.25 },
  { id: 'uruk', name: 'Uruk', x: 0.45, y: 0.47, population: 7600, canal: 0.61, administration: 0.18, temple: 0.24 },
  { id: 'umma', name: 'Umma', x: 0.61, y: 0.46, population: 3900, canal: 0.55, administration: 0.11, temple: 0.14 },
  { id: 'lagash', name: 'Lagash', x: 0.69, y: 0.60, population: 4700, canal: 0.58, administration: 0.14, temple: 0.18 },
  { id: 'ur', name: 'Ur', x: 0.42, y: 0.74, population: 4400, canal: 0.62, administration: 0.13, temple: 0.20 },
  { id: 'eridu', name: 'Eridu', x: 0.34, y: 0.84, population: 3000, canal: 0.54, administration: 0.10, temple: 0.27 },
]);

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

function makeCities() {
  return CITY_SEEDS.map((seed, index) => ({
    ...seed,
    index,
    population: seed.population,
    grain: seed.population * 1.15,
    institutionalGrain: seed.population * 0.24,
    seedReserve: seed.population * 0.10,
    canalHealth: seed.canal,
    administration: seed.administration,
    templeComplexity: seed.temple,
    storage: 0.34,
    craftCapacity: 0.12 + index * 0.007,
    tradeGoods: seed.population * 0.05,
    prestige: 0,
    records: 0,
    foodRatio: 1,
    foodYears: 1.3,
    cultivatedArea: 0,
    harvest: 0,
    meanSalinity: 0.12,
    irrigation: 0,
    military: 0.08,
    migrationPressure: 0,
    pendingMigrants: 0,
    lastEvent: 'settlement seed',
  }));
}

function riverCoordinates(y) {
  return {
    euphrates: 0.40 + Math.sin(y * 5.1 + 0.4) * 0.055 + y * 0.025,
    tigris: 0.73 - Math.sin(y * 4.2 + 0.8) * 0.045 - y * 0.015,
  };
}

function makeFields(cities, seed, columns = 28, rows = 18) {
  const fields = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = (column + 0.5) / columns;
      const y = (row + 0.5) / rows;
      const rivers = riverCoordinates(y);
      const riverDistance = Math.min(Math.abs(x - rivers.euphrates), Math.abs(x - rivers.tigris));
      const floodplain = Math.exp(-riverDistance * 15);
      let owner = cities[0];
      let ownerDistance = Infinity;
      for (const city of cities) {
        const d = Math.hypot(x - city.x, (y - city.y) * 1.15);
        if (d < ownerDistance) {
          owner = city;
          ownerDistance = d;
        }
      }
      const localNoise = deterministicRandom(seed, 'field', column, row) - 0.5;
      const southSalt = clamp((y - 0.52) * 0.45, 0, 0.22);
      fields.push({
        id: `${column}:${row}`,
        column,
        row,
        x,
        y,
        ownerId: owner.id,
        riverDistance,
        floodplain,
        area: 95 + floodplain * 35,
        fertility: clamp(0.42 + floodplain * 0.42 + localNoise * 0.08 - southSalt * 0.45, 0.18, 0.95),
        salinity: clamp(0.07 + southSalt + Math.max(0, riverDistance - 0.12) * 0.10, 0.03, 0.48),
        moisture: 0.38 + floodplain * 0.20,
        lastYield: 0,
        lastIrrigation: 0,
      });
    }
  }
  return { columns, rows, fields };
}

function referencePeriod(yearBCE) {
  if (yearBCE > 3100) return 'Late Uruk reference window';
  if (yearBCE > 2900) return 'Uruk–Early Dynastic transition reference window';
  if (yearBCE > 2334) return 'Early Dynastic reference window';
  if (yearBCE > 2154) return 'Akkadian-period reference window';
  if (yearBCE > 2112) return 'Post-Akkadian reference window';
  if (yearBCE >= 2004) return 'Ur III reference window';
  return 'Post-Ur III edge of scenario';
}

export function createSumerianCivilizationSimulation({
  seed = 'sumer-emergent-001',
  startBCE = 3500,
  endBCE = 2000,
} = {}) {
  if (!(startBCE > endBCE)) throw new Error('Sumer simulation requires startBCE > endBCE.');

  const cities = makeCities();
  const cityById = new Map(cities.map(city => [city.id, city]));
  const plain = makeFields(cities, seed);
  const fieldsByCity = new Map(cities.map(city => [city.id, []]));
  for (const field of plain.fields) fieldsByCity.get(field.ownerId).push(field);

  const state = {
    seed,
    startBCE,
    endBCE,
    elapsedYears: 0,
    yearIndex: 0,
    yearBCE: startBCE,
    riverPulse: 0.72,
    climateStress: 0,
    hegemonId: null,
    hegemonYears: 0,
    totalRaids: 0,
    totalTrade: 0,
    chronicle: [],
  };

  const transactions = createTransactionJournal({
    types: SUMER_TRANSACTION_TYPES,
    historyLimit: 512,
    getTick: () => state.yearIndex,
  });

  const kernel = new RealityKernel({
    seed: `sumer-kernel:${seed}`,
    conservationTolerance: 1e-9,
    maxSubstepsPerNode: 4,
  });

  function transact(type, payload = {}, initialResult = {}) {
    return transactions.transact(type, {
      yearBCE: state.yearBCE,
      ...payload,
    }, initialResult);
  }

  function climateForYear() {
    const slowOscillation = Math.sin((state.yearIndex + 17) * 0.083) * 0.11;
    const mediumOscillation = Math.sin((state.yearIndex + 3) * 0.219) * 0.055;
    const stochastic = (deterministicRandom(seed, 'climate', state.yearIndex) - 0.5) * 0.18;
    const shockRoll = deterministicRandom(seed, 'climate-shock', Math.floor(state.yearIndex / 7));
    const shock = shockRoll < 0.035 ? -0.24 : shockRoll > 0.985 ? 0.16 : 0;
    const riverPulse = clamp(0.74 + slowOscillation + mediumOscillation + stochastic + shock, 0.28, 1.18);
    state.riverPulse = riverPulse;
    state.climateStress = clamp(Math.abs(riverPulse - 0.76) * 1.7 + Math.max(0, 0.50 - riverPulse), 0, 1);
  }

  function cityFoodAvailable(city) {
    return city.grain + city.institutionalGrain;
  }

  function advanceCity(city, dt, random) {
    const fields = fieldsByCity.get(city.id) || [];
    const populationBefore = city.population;
    const labor = city.population * 0.34;

    // Canal upkeep is primarily a labor-capacity problem with grain supporting
    // organized work crews. It must not become an absorbing zero-food ->
    // zero-maintenance -> zero-water state.
    const maintenanceNeed = Math.max(5, city.population * (0.006 + city.canalHealth * 0.003));
    const laborMaintenance = city.population * (0.0045 + city.administration * 0.006 + city.templeComplexity * 0.0015);
    const grainSupport = Math.min(city.grain * 0.012, maintenanceNeed * 0.25);
    city.grain = Math.max(0, city.grain - grainSupport);
    const maintenanceRatio = clamp((laborMaintenance + grainSupport) / maintenanceNeed, 0, 1.25);
    city.canalHealth = clamp(
      city.canalHealth - 0.0045 * dt + maintenanceRatio * 0.0065 * dt - state.climateStress * 0.001,
      0.20,
      0.98,
    );

    const laborAreaLimit = labor * (0.54 + city.administration * 0.22);
    const canalAreaLimit = fields.reduce((sum, field) => {
      const access = clamp(1 - field.riverDistance * (4.6 - city.canalHealth * 2.0), 0.05, 1);
      return sum + field.area * access * city.canalHealth;
    }, 0);
    const potentialArea = Math.min(laborAreaLimit, canalAreaLimit);
    const seedRequested = potentialArea * 0.060;

    // Seed barley is a protected productive stock. At most 75% of the reserve
    // is exposed in one sowing season, preventing a single bad year from
    // destroying the simulation's capacity to plant forever.
    const seedUsed = Math.min(city.seedReserve * 0.75, seedRequested);
    city.seedReserve = Math.max(0, city.seedReserve - seedUsed);
    const sowFraction = seedRequested > 0 ? seedUsed / seedRequested : 0;

    transact(SUMER_TRANSACTION_TYPES.SOW, {
      cityId: city.id,
      requestedSeed: seedRequested,
      seedUsed,
      potentialArea,
      seedReserveAfterSowing: city.seedReserve,
    }, { sowFraction });

    let totalArea = 0;
    let totalHarvest = 0;
    let totalIrrigation = 0;
    let totalSalinity = 0;
    let fieldWeight = 0;
    const riverPulse = state.riverPulse;

    for (const field of fields) {
      const canalReach = clamp(1 - field.riverDistance * (5.2 - city.canalHealth * 2.4), 0, 1);
      const floodContribution = field.floodplain * riverPulse * 0.34;
      const irrigation = clamp((0.20 + riverPulse * 0.62) * city.canalHealth * canalReach + floodContribution, 0, 1.25);
      const drainage = clamp(field.floodplain * 0.45 + city.canalHealth * 0.20, 0, 0.72);
      field.moisture = clamp(field.moisture * 0.42 + irrigation * 0.47 + riverPulse * 0.09, 0.08, 1.15);
      const saltLoad = irrigation * (0.00065 + field.y * 0.00080);
      const drainageFlush = drainage * riverPulse * (0.00135 + city.canalHealth * 0.00045);
      const fallowFlush = Math.max(0, 0.52 - irrigation) * 0.00140;
      field.salinity = clamp(
        field.salinity + saltLoad - drainageFlush - fallowFlush,
        0.02,
        0.72,
      );
      const cultivated = field.area * sowFraction * clamp(0.42 + canalReach * 0.72, 0.15, 1);
      const salinityPenalty = clamp(1 - field.salinity * 0.92, 0.18, 1);
      const waterResponse = clamp(0.30 + field.moisture * 0.86, 0.25, 1.12);
      const weatherNoise = 0.86 + random() * 0.28;
      const yieldPerArea = 2.9 * field.fertility * salinityPenalty * waterResponse * weatherNoise;
      const produced = cultivated * yieldPerArea;
      field.lastYield = produced;
      field.lastIrrigation = irrigation;
      totalArea += cultivated;
      totalHarvest += produced;
      totalIrrigation += irrigation * field.area;
      totalSalinity += field.salinity * field.area;
      fieldWeight += field.area;
    }

    city.cultivatedArea = totalArea;
    city.harvest = totalHarvest;
    city.irrigation = fields.length ? totalIrrigation / fields.reduce((sum, field) => sum + field.area, 0) : 0;
    city.meanSalinity = fieldWeight > 0 ? totalSalinity / fieldWeight : 0;

    transact(SUMER_TRANSACTION_TYPES.IRRIGATE, {
      cityId: city.id,
      canalHealth: city.canalHealth,
      meanIrrigation: city.irrigation,
      cultivatedArea: totalArea,
    }, { waterDelivery: totalIrrigation });

    // Reconstitute productive seed stock before exposing the harvest to tax or
    // consumption. This preserves a causal seed stock without inventing grain.
    const seedTarget = Math.max(seedUsed * 1.15, city.population * 0.075);
    const seedRetained = Math.min(totalHarvest * 0.12, Math.max(0, seedTarget - city.seedReserve));
    city.seedReserve += seedRetained;
    const edibleHarvest = Math.max(0, totalHarvest - seedRetained);
    city.grain += edibleHarvest;
    transact(SUMER_TRANSACTION_TYPES.HARVEST, {
      cityId: city.id,
      cultivatedArea: totalArea,
      meanSalinity: city.meanSalinity,
      riverPulse,
    }, { grainProduced: totalHarvest, seedRetained, edibleGrain: edibleHarvest });

    const taxRate = clamp(0.07 + city.administration * 0.11 + city.templeComplexity * 0.035, 0.06, 0.21);
    const tax = Math.min(city.grain, edibleHarvest * taxRate);
    city.grain -= tax;
    city.institutionalGrain += tax;
    transact(SUMER_TRANSACTION_TYPES.TAX, {
      cityId: city.id,
      rate: taxRate,
      harvest: edibleHarvest,
    }, { grainTransferred: tax });

    const rationNeed = city.population * 0.82;
    const householdRation = Math.min(city.grain, rationNeed);
    city.grain -= householdRation;
    const remainingNeed = Math.max(0, rationNeed - householdRation);
    const institutionalRation = Math.min(city.institutionalGrain, remainingNeed);
    city.institutionalGrain -= institutionalRation;
    const rationed = householdRation + institutionalRation;
    city.foodRatio = rationNeed > 0 ? rationed / rationNeed : 1;

    transact(SUMER_TRANSACTION_TYPES.RATION, {
      cityId: city.id,
      population: city.population,
      requested: rationNeed,
    }, { grainRationed: rationed, foodRatio: city.foodRatio });

    const carryingCapacity = 2600 + totalArea * (10.5 + city.storage * 2.8) + city.administration * 12000;
    const shortage = clamp(1 - city.foodRatio, 0, 1);
    const crowding = clamp(city.population / Math.max(1, carryingCapacity), 0, 2);
    const growthRate = clamp(
      0.010 * (city.foodRatio - 0.78) * (1 - Math.min(0.92, crowding * 0.58))
        - shortage * 0.028
        - state.climateStress * 0.0025,
      -0.07,
      0.018,
    );
    city.population = Math.max(300, city.population * (1 + growthRate * dt));

    city.pendingMigrants = 0;
    if (city.foodRatio < 0.76) {
      const desiredMigrants = Math.min(city.population * 0.035, city.population * (0.76 - city.foodRatio) * 0.09);
      city.pendingMigrants = Math.min(Math.max(0, city.population - 300), desiredMigrants);
      city.population -= city.pendingMigrants;
      city.migrationPressure = clamp((0.76 - city.foodRatio) * 2.2, 0, 1);
    } else {
      city.migrationPressure *= 0.65;
    }

    const foodReserve = cityFoodAvailable(city);
    city.foodYears = foodReserve / Math.max(1, city.population * 0.82);

    if (city.foodYears > 1.15 && city.grain > city.population * 0.18) {
      const investment = Math.min(city.grain * 0.018, city.population * 0.018);
      city.grain -= investment;
      const buildBias = deterministicRandom(seed, 'build', state.yearIndex, city.id);
      if (buildBias < 0.42) city.canalHealth = clamp(city.canalHealth + investment / Math.max(1, city.population) * 0.12, 0, 1);
      else if (buildBias < 0.72) city.storage = clamp(city.storage + investment / Math.max(1, city.population) * 0.10, 0, 1);
      else if (buildBias < 0.90) city.templeComplexity = clamp(city.templeComplexity + investment / Math.max(1, city.population) * 0.08, 0, 1);
      else city.administration = clamp(city.administration + investment / Math.max(1, city.population) * 0.075, 0, 1);
      transact(SUMER_TRANSACTION_TYPES.BUILD, {
        cityId: city.id,
        investment,
        canalHealth: city.canalHealth,
        storage: city.storage,
        administration: city.administration,
      }, {});
    }

    const administrativeDemand = city.population / 5000 + city.foodYears * 0.25 + city.tradeGoods / Math.max(1, city.population) * 0.4;
    if (administrativeDemand > 0.72) {
      const recordBatches = Math.max(1, Math.floor(administrativeDemand * (0.8 + city.administration * 2.5)));
      city.records += recordBatches;
      city.administration = clamp(city.administration + recordBatches * 0.00003, 0, 1);
      transact(SUMER_TRANSACTION_TYPES.RECORD, {
        cityId: city.id,
        administrativeDemand,
      }, { recordBatches });
    }

    const craftOutput = city.population * city.craftCapacity * clamp(city.foodRatio, 0.3, 1.15) * 0.010;
    city.tradeGoods += craftOutput;
    city.prestige = clamp(city.prestige * 0.996 + city.templeComplexity * 0.003 + city.records * 0.0000005, 0, 5);
    city.military = clamp(0.05 + city.administration * 0.26 + Math.min(0.36, city.institutionalGrain / Math.max(1, city.population) * 0.09), 0.04, 0.72);
    city.lastEvent = `harvest ${Math.round(totalHarvest)}; food ${(city.foodRatio * 100).toFixed(0)}%`;

    if (!Number.isFinite(city.population) || city.population <= 0) {
      throw new Error(`Invalid population for ${city.id}: ${city.population}`);
    }
    if (populationBefore > 0 && city.population > populationBefore * 1.20) {
      throw new Error(`Unstable annual population jump for ${city.id}`);
    }
  }

  kernel.registerSolver({
    id: 'sumer-city-year',
    minScale: 1000,
    maxScale: 100000,
    maxDt: 1,
    step: ({ node, dt, random }) => advanceCity(node.state, dt, random),
  });

  kernel.addNode({
    id: 'lower-mesopotamian-alluvium',
    label: 'Lower Mesopotamian alluvium',
    scale: 520000,
    characteristicTime: 10,
    state: { scenario: 'historically-constrained-emergent-sumer' },
    conserved: {},
  });
  for (const city of cities) {
    kernel.addNode({
      id: `city:${city.id}`,
      parentId: 'lower-mesopotamian-alluvium',
      label: city.name,
      scale: 24000,
      characteristicTime: 1,
      state: city,
      conserved: {},
      solverId: 'sumer-city-year',
    });
  }

  function tradeAndMigration() {
    const needy = cities.filter(city => city.foodYears < 0.92).sort((a, b) => a.foodYears - b.foodYears);
    const surplus = cities.filter(city => city.foodYears > 1.28).sort((a, b) => b.foodYears - a.foodYears);
    for (const buyer of needy) {
      for (const seller of surplus) {
        if (seller.id === buyer.id || buyer.foodYears >= 0.98 || seller.foodYears <= 1.16) continue;
        const d = distance(buyer, seller);
        const routeFactor = clamp(1.18 - d * 1.35, 0.18, 1);
        const buyerNeed = Math.max(0, buyer.population * 0.82 * (1.02 - buyer.foodYears));
        const sellerExcess = Math.max(0, cityFoodAvailable(seller) - seller.population * 0.82 * 1.12);
        const moved = Math.min(buyerNeed, sellerExcess, seller.grain * 0.18) * routeFactor;
        if (moved <= 1) continue;
        seller.grain -= moved;
        buyer.grain += moved;
        const payment = Math.min(buyer.tradeGoods, moved * (0.05 + d * 0.08));
        buyer.tradeGoods -= payment;
        seller.tradeGoods += payment;
        seller.prestige = clamp(seller.prestige + moved / Math.max(1, seller.population) * 0.012, 0, 5);
        buyer.foodYears = cityFoodAvailable(buyer) / Math.max(1, buyer.population * 0.82);
        seller.foodYears = cityFoodAvailable(seller) / Math.max(1, seller.population * 0.82);
        state.totalTrade += moved;
        transact(SUMER_TRANSACTION_TYPES.TRADE, {
          fromCityId: seller.id,
          toCityId: buyer.id,
          distance: d,
        }, { grainMoved: moved, tradeGoodsMoved: payment });
      }
    }

    const destinations = cities.slice().sort((a, b) => (b.foodYears + b.canalHealth * 0.35) - (a.foodYears + a.canalHealth * 0.35));
    for (const origin of cities) {
      const migrants = origin.pendingMigrants;
      if (!(migrants > 0)) continue;
      const destination = destinations.find(city => city.id !== origin.id && city.foodYears > origin.foodYears + 0.12);
      if (!destination) continue;
      const moved = migrants * clamp(1 - distance(origin, destination) * 0.75, 0.25, 0.92);
      destination.population += moved;
      origin.pendingMigrants -= moved;
      transact(SUMER_TRANSACTION_TYPES.MIGRATE, {
        fromCityId: origin.id,
        toCityId: destination.id,
      }, { peopleMoved: moved });
    }
  }

  function conflict() {
    for (let i = 0; i < cities.length; i += 1) {
      for (let j = i + 1; j < cities.length; j += 1) {
        const a = cities[i];
        const b = cities[j];
        const d = distance(a, b);
        if (d > 0.34) continue;
        const scarcityA = clamp(0.92 - a.foodYears, 0, 0.8);
        const scarcityB = clamp(0.92 - b.foodYears, 0, 0.8);
        const lootPerPerson = (a.grain + b.grain) / Math.max(1, a.population + b.population);
        const lootOpportunity = clamp(lootPerPerson / 0.70, 0.05, 1);
        const pressure = (
          (scarcityA + scarcityB) * 0.025
          + (a.military + b.military) * 0.004
          + Math.max(0, 0.23 - d) * 0.006
        ) * lootOpportunity;
        const roll = deterministicRandom(seed, 'raid', state.yearIndex, a.id, b.id);
        if (roll >= pressure) continue;
        const attacker = (scarcityA + a.military * 0.18) >= (scarcityB + b.military * 0.18) ? a : b;
        const defender = attacker === a ? b : a;
        const attackerPower = attacker.population * (0.05 + attacker.military) * (0.7 + attacker.foodRatio * 0.3);
        const defenderPower = defender.population * (0.05 + defender.military) * (0.7 + defender.foodRatio * 0.3);
        const success = attackerPower / Math.max(1, attackerPower + defenderPower);
        const successRoll = deterministicRandom(seed, 'raid-outcome', state.yearIndex, attacker.id, defender.id);
        const winner = successRoll < success ? attacker : defender;
        const loser = winner === attacker ? defender : attacker;
        const loot = Math.min(loser.grain * 0.045, winner.population * 0.018);
        loser.grain -= loot;
        winner.grain += loot;
        const casualties = Math.min(loser.population * 0.0025, 5 + deterministicRandom(seed, 'casualties', state.yearIndex, a.id, b.id) * 28);
        loser.population = Math.max(300, loser.population - casualties);
        winner.prestige = clamp(winner.prestige + 0.025, 0, 5);
        loser.prestige = clamp(loser.prestige - 0.012, 0, 5);
        state.totalRaids += 1;
        transact(SUMER_TRANSACTION_TYPES.RAID, {
          attackerId: attacker.id,
          defenderId: defender.id,
          winnerId: winner.id,
        }, { grainLooted: loot, casualties });
      }
    }
  }

  function politicalConsolidation() {
    const ranked = cities.map(city => ({
      city,
      power: city.population * (0.45 + city.military * 0.55)
        + city.institutionalGrain * 0.32
        + city.administration * 15000
        + city.prestige * 3200,
    })).sort((a, b) => b.power - a.power);
    const first = ranked[0];
    const second = ranked[1];
    const dominance = first.power / Math.max(1, second.power);
    const eligible = dominance > 1.28 && first.city.administration > 0.24 && first.city.population > 5200;
    const nextHegemon = eligible ? first.city.id : null;
    if (nextHegemon === state.hegemonId) {
      if (nextHegemon) state.hegemonYears += 1;
      else state.hegemonYears = 0;
      return;
    }
    const previousHegemonId = state.hegemonId;
    state.hegemonId = nextHegemon;
    state.hegemonYears = nextHegemon ? 1 : 0;
    transact(SUMER_TRANSACTION_TYPES.HEGEMONY, {
      previousCityId: previousHegemonId,
      cityId: nextHegemon,
      dominance,
    }, { established: Boolean(nextHegemon) });
  }

  function appendChronicle() {
    const recent = transactions.snapshot().recent.filter(record => record.tick === state.yearIndex);
    const notable = recent.filter(record => [
      SUMER_TRANSACTION_TYPES.RAID,
      SUMER_TRANSACTION_TYPES.HEGEMONY,
      SUMER_TRANSACTION_TYPES.MIGRATE,
    ].includes(record.type));
    if (!notable.length && state.yearIndex % 25 !== 0) return;
    const top = cities.slice().sort((a, b) => b.population - a.population)[0];
    state.chronicle.push({
      yearBCE: state.yearBCE,
      period: referencePeriod(state.yearBCE),
      largestCity: top.name,
      population: Math.round(top.population),
      hegemon: state.hegemonId ? cityById.get(state.hegemonId)?.name || state.hegemonId : null,
      events: notable.slice(-5).map(record => ({ type: record.type, payload: { ...record.payload }, result: { ...record.result } })),
    });
    if (state.chronicle.length > 160) state.chronicle.splice(0, state.chronicle.length - 160);
  }

  function stepOneYear() {
    if (state.yearBCE <= endBCE) return false;
    transactions.runBeforeStep({ simulation: api, state });
    climateForYear();
    kernel.step(1);
    tradeAndMigration();
    conflict();
    politicalConsolidation();
    state.elapsedYears += 1;
    state.yearIndex += 1;
    state.yearBCE = startBCE - state.elapsedYears;
    for (const city of cities) city.foodYears = cityFoodAvailable(city) / Math.max(1, city.population * 0.82);
    appendChronicle();
    transactions.runAfterStep({ simulation: api, state });
    return true;
  }

  function advance(years = 1) {
    const requested = Math.max(0, Math.floor(finite(years)));
    let advanced = 0;
    while (advanced < requested && state.yearBCE > endBCE) {
      if (!stepOneYear()) break;
      advanced += 1;
    }
    return snapshot();
  }

  function observeCity(cityId, observerId = 'sumer-viewer') {
    if (!cityById.has(cityId)) throw new Error(`Unknown Sumer city: ${cityId}`);
    return kernel.requestResolution({
      observerId,
      nodeId: 'lower-mesopotamian-alluvium',
      spatialScale: 24000,
      temporalScale: 1,
      selectChild: children => children.find(child => child.id === `city:${cityId}`)?.id || null,
    });
  }

  function clearObserver(observerId = 'sumer-viewer') {
    if (kernel.observers.has(observerId)) kernel.clearResolution(observerId, { coarsen: false });
  }

  function snapshot() {
    const totalPopulation = cities.reduce((sum, city) => sum + city.population, 0);
    const totalGrain = cities.reduce((sum, city) => sum + city.grain + city.institutionalGrain + city.seedReserve, 0);
    const weightedSalinity = cities.reduce((sum, city) => sum + city.meanSalinity * city.cultivatedArea, 0)
      / Math.max(1, cities.reduce((sum, city) => sum + city.cultivatedArea, 0));
    return {
      version: 1,
      scenario: 'Sumerian civilization',
      mode: 'historically-constrained-emergent',
      exactHistoricalReplay: false,
      syntheticInitialPopulations: true,
      seed,
      startBCE,
      endBCE,
      yearBCE: state.yearBCE,
      elapsedYears: state.elapsedYears,
      referencePeriod: referencePeriod(state.yearBCE),
      climate: {
        riverPulse: state.riverPulse,
        stress: state.climateStress,
      },
      totals: {
        population: totalPopulation,
        grain: totalGrain,
        meanSalinity: weightedSalinity,
        raids: state.totalRaids,
        tradeVolume: state.totalTrade,
      },
      politics: {
        hegemonId: state.hegemonId,
        hegemonName: state.hegemonId ? cityById.get(state.hegemonId)?.name || null : null,
        hegemonYears: state.hegemonYears,
      },
      cities: cities.map(city => ({
        id: city.id,
        name: city.name,
        x: city.x,
        y: city.y,
        population: city.population,
        grain: city.grain,
        institutionalGrain: city.institutionalGrain,
        seedReserve: city.seedReserve,
        foodRatio: city.foodRatio,
        foodYears: city.foodYears,
        canalHealth: city.canalHealth,
        administration: city.administration,
        templeComplexity: city.templeComplexity,
        storage: city.storage,
        tradeGoods: city.tradeGoods,
        prestige: city.prestige,
        records: city.records,
        cultivatedArea: city.cultivatedArea,
        harvest: city.harvest,
        meanSalinity: city.meanSalinity,
        irrigation: city.irrigation,
        military: city.military,
        migrationPressure: city.migrationPressure,
        lastEvent: city.lastEvent,
      })),
      plain: {
        columns: plain.columns,
        rows: plain.rows,
        fields: plain.fields.map(field => ({
          id: field.id,
          x: field.x,
          y: field.y,
          ownerId: field.ownerId,
          riverDistance: field.riverDistance,
          floodplain: field.floodplain,
          fertility: field.fertility,
          salinity: field.salinity,
          moisture: field.moisture,
          lastYield: field.lastYield,
          lastIrrigation: field.lastIrrigation,
        })),
      },
      transactions: transactions.snapshot(),
      kernel: kernel.snapshot(),
      chronicle: state.chronicle.slice(),
    };
  }

  function reset() {
    throw new Error('Create a new simulation instance to reset deterministically.');
  }

  const api = {
    version: 1,
    seed,
    state,
    cities,
    fields: plain.fields,
    kernel,
    transactions,
    advance,
    stepOneYear,
    observeCity,
    clearObserver,
    snapshot,
    reset,
  };

  return api;
}
