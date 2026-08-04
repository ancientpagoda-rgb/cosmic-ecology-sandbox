import { samplePlanet } from './planet.js';
import { sampleHydrology } from './hydrology.js';

const DEFAULT_COLUMNS = 28;
const DEFAULT_ROWS = 14;
const FIELD_NAMES = [
  'organics',
  'membranes',
  'replicators',
  'microbes',
  'photoTrait',
  'cooperationTrait',
  'oxygen',
  'plants',
  'diversity',
];

export function createAbiogenesisField(world, orbitalSystem, options = {}) {
  const columns = options.columns || DEFAULT_COLUMNS;
  const rows = options.rows || DEFAULT_ROWS;
  const size = columns * rows;
  const seed = options.seed ?? 41739;
  const rng = mulberry32(seed);
  const rate = options.rate || 8.2;

  const environment = {
    water: new Float32Array(size),
    land: new Float32Array(size),
    temperature: new Float32Array(size),
    temperatureFit: new Float32Array(size),
    minerals: new Float32Array(size),
    hydrothermal: new Float32Array(size),
    wetDry: new Float32Array(size),
    light: new Float32Array(size),
    ultraviolet: new Float32Array(size),
    habitability: new Float32Array(size),
  };

  const fields = Object.fromEntries(FIELD_NAMES.map(name => [name, new Float32Array(size)]));
  const scratch = Object.fromEntries([
    'organics',
    'replicators',
    'microbes',
    'oxygen',
    'plants',
  ].map(name => [name, new Float32Array(size)]));

  let clock = 0;
  let generation = 0;
  let visualRevision = 0;
  let lastVisualBucket = -1;
  let metrics = emptyMetrics();

  seedEnvironment();
  seedAbioticChemistry();
  recalculateMetrics();

  function seedEnvironment() {
    const star = orbitalSystem.getStar?.() || { luminosity: 1, temperature: 5772 };
    const home = orbitalSystem.getHomePlanet?.() || { waterFraction: 0.25, atmosphereRetention: 0.6 };
    const uvScale = clamp((star.temperature - 2500) / 9000, 0.08, 1.6) * (1 - (home.atmosphereRetention || 0.5) * 0.48);

    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const index = row * columns + column;
        const u = (column + 0.5) / columns;
        const v = (row + 0.5) / rows;
        const x = u * world.width;
        const y = v * world.height;
        const terrain = samplePlanet(x, y, world.width, world.height);
        const hydro = sampleHydrology(x, y, world.width, world.height);
        const latitudeLight = clamp(Math.cos((v - 0.5) * Math.PI), 0.05, 1);
        const surfaceWater = terrain.land
          ? clamp(Math.max(hydro.river * 0.9, hydro.delta, hydro.lake * 0.78, terrain.rainfall * 0.18), 0, 1)
          : 1;
        const coast = clamp(1 - Math.abs(terrain.elevation - 0.53) * 12, 0, 1);
        const wetDry = clamp(
          coast * 0.62 +
          hydro.delta * 0.75 +
          hydro.river * 0.44 +
          (terrain.land ? terrain.rainfall * 0.18 : 0.04),
          0,
          1,
        );
        const hydrothermal = clamp(
          (!terrain.land ? 0.18 : 0.02) +
          terrain.plateBoundary * 0.66 +
          terrain.convergence * 0.24 +
          hydro.erosion * 0.16,
          0,
          1,
        );
        const minerals = clamp(
          0.18 +
          terrain.plateBoundary * 0.52 +
          terrain.elevation * 0.2 +
          hydro.erosion * 0.24,
          0,
          1,
        );
        const temperatureFit = clamp(1 - Math.abs(terrain.temperature - 0.58) * 1.75, 0, 1);
        const light = clamp(latitudeLight * (0.6 + star.luminosity ** 0.16 * 0.4), 0.05, 1);
        const ultraviolet = clamp(light * uvScale, 0.02, 1.5);
        const habitability = clamp(
          surfaceWater * 0.31 +
          temperatureFit * 0.24 +
          minerals * 0.17 +
          Math.max(wetDry, hydrothermal) * 0.28,
          0,
          1,
        );

        environment.water[index] = surfaceWater;
        environment.land[index] = terrain.land ? 1 : 0;
        environment.temperature[index] = terrain.temperature;
        environment.temperatureFit[index] = temperatureFit;
        environment.minerals[index] = minerals;
        environment.hydrothermal[index] = hydrothermal;
        environment.wetDry[index] = wetDry;
        environment.light[index] = light;
        environment.ultraviolet[index] = ultraviolet;
        environment.habitability[index] = habitability;
      }
    }
  }

  function seedAbioticChemistry() {
    for (let index = 0; index < size; index++) {
      const energy = environment.hydrothermal[index] * 0.7 + environment.ultraviolet[index] * 0.2;
      fields.organics[index] = clamp(
        energy * environment.minerals[index] * environment.water[index] * (0.006 + rng() * 0.012),
        0,
        0.04,
      );
      fields.diversity[index] = rng() * 0.004;
    }
  }

  function step(dt, context = {}) {
    const surfaceProgress = clamp(context.surfaceProgress ?? 1, 0, 1);
    if (surfaceProgress < 0.86) return metrics;

    const simDt = Math.min(0.7, Math.max(0, dt) * rate);
    clock += simDt;
    generation += simDt * 0.18;

    copyDiffused('organics', 0.026);
    copyDiffused('replicators', 0.034);
    copyDiffused('microbes', 0.048);
    copyDiffused('oxygen', 0.08);
    copyDiffused('plants', 0.012);

    for (let index = 0; index < size; index++) {
      const water = environment.water[index];
      const temp = environment.temperatureFit[index];
      const mineral = environment.minerals[index];
      const hydrothermal = environment.hydrothermal[index];
      const wetDry = environment.wetDry[index];
      const light = environment.light[index];
      const uv = environment.ultraviolet[index];
      const habitability = environment.habitability[index];
      const land = environment.land[index];

      let organics = scratch.organics[index];
      let membranes = fields.membranes[index];
      let replicators = scratch.replicators[index];
      let microbes = scratch.microbes[index];
      let photoTrait = fields.photoTrait[index];
      let cooperation = fields.cooperationTrait[index];
      let oxygen = scratch.oxygen[index];
      let plants = scratch.plants[index];
      let diversity = fields.diversity[index];

      const chemicalEnergy = hydrothermal * 0.62 + uv * 0.18 + wetDry * 0.36;
      const organicSource = water * temp * mineral * chemicalEnergy * 0.035;
      const organicDecay = organics * (0.006 + uv * 0.006 + (1 - water) * 0.009);
      organics = clamp(organics + (organicSource - organicDecay) * simDt, 0, 1);

      const membraneAssembly = organics * wetDry * mineral * (1 - membranes) * 0.052;
      const membraneDecay = membranes * (0.0025 + (1 - water) * 0.003);
      membranes = clamp(membranes + (membraneAssembly - membraneDecay) * simDt, 0, 1);

      const catalyticWindow = organics * membranes * mineral * Math.max(wetDry, hydrothermal) * temp;
      if (replicators < 0.0005 && catalyticWindow > 0.025) {
        const nucleationChance = catalyticWindow * 0.01 * simDt;
        if (rng() < nucleationChance) {
          replicators = 0.004 + rng() * 0.009;
          diversity = Math.max(diversity, 0.015 + rng() * 0.025);
        }
      }

      const replicationFitness = clamp(
        0.28 + habitability * 0.45 + membranes * 0.25 - uv * 0.08,
        0.05,
        1,
      );
      const replicationGrowth = replicators * organics * replicationFitness * (1 - replicators) * 0.17;
      const replicationDecay = replicators * (0.009 + (1 - membranes) * 0.018 + (1 - temp) * 0.01);
      replicators = clamp(replicators + (replicationGrowth - replicationDecay) * simDt, 0, 1);
      organics = clamp(organics - replicationGrowth * simDt * 0.13, 0, 1);

      const protocellIntegrity = membranes * replicators * temp * water;
      const chemoYield = hydrothermal * 0.42 + organics * 0.4 + mineral * 0.12;
      const photoYield = photoTrait * light * 0.84;
      const microbialGrowth = microbes * (chemoYield + photoYield) * protocellIntegrity * (1 - microbes) * 0.16;
      const microbialBirth = Math.max(0, protocellIntegrity - 0.018) * organics * 0.024;
      const microbialDecay = microbes * (0.005 + (1 - habitability) * 0.025 + uv * (1 - photoTrait) * 0.004);
      microbes = clamp(microbes + (microbialGrowth + microbialBirth - microbialDecay) * simDt, 0, 1);

      const reproductionFlux = microbialGrowth + microbialBirth;
      if (microbes > 0.012 && rng() < reproductionFlux * simDt * 0.15) {
        const mutation = (rng() - 0.46) * 0.035;
        photoTrait = clamp(photoTrait + mutation, 0, 1);
        diversity = clamp(diversity + Math.abs(mutation) * 0.7 + rng() * 0.002, 0, 1);
      }

      const photoSelection = microbes * light * temp * (0.025 + oxygen * 0.012) * (1 - photoTrait);
      const photoCost = photoTrait * (1 - light) * 0.012;
      photoTrait = clamp(photoTrait + (photoSelection - photoCost) * simDt, 0, 1);

      const oxygenProduction = microbes * photoTrait * light * 0.055;
      const mineralSink = oxygen * mineral * (0.025 - clamp(clock / 180, 0, 0.018));
      const respiration = oxygen * microbes * (1 - photoTrait * 0.45) * 0.012;
      oxygen = clamp(oxygen + (oxygenProduction - mineralSink - respiration) * simDt, 0, 1);

      if (microbes > 0.07 && oxygen > 0.015 && rng() < microbes * oxygen * simDt * 0.012) {
        cooperation = clamp(cooperation + 0.008 + rng() * 0.028, 0, 1);
        diversity = clamp(diversity + 0.006 + rng() * 0.01, 0, 1);
      }
      const cooperationSelection = microbes * oxygen * photoTrait * (0.018 + wetDry * 0.018) * (1 - cooperation);
      const cooperationCost = cooperation * (1 - oxygen) * 0.004;
      cooperation = clamp(cooperation + (cooperationSelection - cooperationCost) * simDt, 0, 1);

      const terrestrialWater = clamp(wetDry * 0.72 + environment.water[index] * 0.28, 0, 1);
      const plantNiche = land * terrestrialWater * temp * light * oxygen * cooperation * photoTrait;
      const plantBirth = Math.max(0, plantNiche - 0.012) * microbes * 0.06;
      const plantGrowth = plants * plantNiche * (1 - plants) * 0.12;
      const plantDecay = plants * (0.004 + (1 - terrestrialWater) * 0.018 + (1 - temp) * 0.014);
      plants = clamp(plants + (plantBirth + plantGrowth - plantDecay) * simDt, 0, 1);

      fields.organics[index] = organics;
      fields.membranes[index] = membranes;
      fields.replicators[index] = replicators;
      fields.microbes[index] = microbes;
      fields.photoTrait[index] = photoTrait;
      fields.cooperationTrait[index] = cooperation;
      fields.oxygen[index] = oxygen;
      fields.plants[index] = plants;
      fields.diversity[index] = diversity;
    }

    recalculateMetrics();
    updateVisualRevision();
    return metrics;
  }

  function copyDiffused(name, coefficient) {
    const source = fields[name];
    const target = scratch[name];
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const index = row * columns + column;
        const north = Math.max(0, row - 1) * columns + column;
        const south = Math.min(rows - 1, row + 1) * columns + column;
        const west = row * columns + ((column - 1 + columns) % columns);
        const east = row * columns + ((column + 1) % columns);
        const average = (source[north] + source[south] + source[west] + source[east]) * 0.25;
        target[index] = clamp(source[index] + (average - source[index]) * coefficient, 0, 1);
      }
    }
  }

  function recalculateMetrics() {
    let organics = 0;
    let protocells = 0;
    let replicators = 0;
    let microbes = 0;
    let photosynthesis = 0;
    let oxygen = 0;
    let cooperation = 0;
    let plants = 0;
    let diversity = 0;
    let organicCoverage = 0;
    let protocellCoverage = 0;
    let microbialCoverage = 0;
    let photoCoverage = 0;
    let oxygenatedCoverage = 0;
    let plantCoverage = 0;
    let activeNiches = 0;

    for (let index = 0; index < size; index++) {
      const protocell = fields.membranes[index] * fields.replicators[index];
      const photo = fields.microbes[index] * fields.photoTrait[index];
      organics += fields.organics[index];
      protocells += protocell;
      replicators += fields.replicators[index];
      microbes += fields.microbes[index];
      photosynthesis += photo;
      oxygen += fields.oxygen[index];
      cooperation += fields.cooperationTrait[index] * fields.microbes[index];
      plants += fields.plants[index];
      diversity += fields.diversity[index] * fields.microbes[index];
      if (fields.organics[index] > 0.08) organicCoverage++;
      if (protocell > 0.008) protocellCoverage++;
      if (fields.microbes[index] > 0.025) microbialCoverage++;
      if (photo > 0.012) photoCoverage++;
      if (fields.oxygen[index] > 0.025) oxygenatedCoverage++;
      if (fields.plants[index] > 0.025) plantCoverage++;
      if (environment.habitability[index] > 0.58) activeNiches++;
    }

    const diversityMean = microbes > 0 ? diversity / Math.max(0.0001, microbes) : 0;
    const cooperationMean = cooperation / size;

    metrics = {
      clock,
      generation,
      organics: organics / size,
      organicCoverage: organicCoverage / size,
      protocells: protocells / size,
      protocellCoverage: protocellCoverage / size,
      replicators: replicators / size,
      microbes: microbes / size,
      microbialCoverage: microbialCoverage / size,
      photosynthesis: photosynthesis / size,
      photoCoverage: photoCoverage / size,
      oxygen: oxygen / size,
      oxygenatedCoverage: oxygenatedCoverage / size,
      cooperation: cooperationMean,
      plants: plants / size,
      plantCoverage: plantCoverage / size,
      diversity: diversityMean,
      activeNiches,
      cells: size,
      lineageEstimate: Math.max(0, Math.round((diversityMean * 0.72 + cooperationMean * 0.28) * 180)),
    };
  }

  function updateVisualRevision() {
    const bucket =
      Math.floor(metrics.organicCoverage * 8) +
      Math.floor(metrics.microbialCoverage * 12) * 11 +
      Math.floor(metrics.photoCoverage * 12) * 137 +
      Math.floor(metrics.plantCoverage * 16) * 1699;
    if (bucket !== lastVisualBucket) {
      lastVisualBucket = bucket;
      visualRevision++;
    }
  }

  function getSurfaceSignal(u, v) {
    const x = wrap(u, 1) * columns - 0.5;
    const y = clamp(v, 0, 1) * rows - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;

    const sample = name => {
      const values = fields[name] || environment[name];
      const a = values[indexAt(x0, y0)];
      const b = values[indexAt(x0 + 1, y0)];
      const c = values[indexAt(x0, y0 + 1)];
      const d = values[indexAt(x0 + 1, y0 + 1)];
      return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
    };

    const membranes = sample('membranes');
    const replicators = sample('replicators');
    const microbes = sample('microbes');
    const photoTrait = sample('photoTrait');
    const cooperation = sample('cooperationTrait');

    return {
      organics: sample('organics'),
      membranes,
      replicators,
      protocells: membranes * replicators,
      microbes,
      photoTrait,
      photosynthesis: microbes * photoTrait,
      cooperation,
      oxygen: sample('oxygen'),
      plants: sample('plants'),
      diversity: sample('diversity'),
      water: sample('water'),
      land: sample('land'),
      temperature: sample('temperature'),
      minerals: sample('minerals'),
      hydrothermal: sample('hydrothermal'),
      wetDry: sample('wetDry'),
      light: sample('light'),
      habitability: sample('habitability'),
    };
  }

  function findHotspots(fieldName, limit = 16, constraints = {}) {
    const values = fields[fieldName];
    if (!values) return [];
    const candidates = [];
    for (let index = 0; index < size; index++) {
      if (constraints.land && environment.land[index] < 0.5) continue;
      if (constraints.water && environment.water[index] < constraints.water) continue;
      if (constraints.habitability && environment.habitability[index] < constraints.habitability) continue;
      const row = Math.floor(index / columns);
      const column = index % columns;
      candidates.push({
        index,
        value: values[index],
        u: (column + 0.5) / columns,
        v: (row + 0.5) / rows,
        x: (column + 0.5) / columns * world.width,
        y: (row + 0.5) / rows * world.height,
      });
    }
    return candidates.sort((a, b) => b.value - a.value).slice(0, limit);
  }

  function resetBiology({ preserveChemistry = true } = {}) {
    for (let index = 0; index < size; index++) {
      if (!preserveChemistry) fields.organics[index] *= 0.18;
      fields.membranes[index] *= preserveChemistry ? 0.18 : 0;
      fields.replicators[index] = 0;
      fields.microbes[index] = 0;
      fields.photoTrait[index] = 0;
      fields.cooperationTrait[index] = 0;
      fields.oxygen[index] *= preserveChemistry ? 0.35 : 0;
      fields.plants[index] = 0;
      fields.diversity[index] *= preserveChemistry ? 0.12 : 0;
    }
    generation = 0;
    visualRevision++;
    recalculateMetrics();
  }

  function save() {
    return {
      columns,
      rows,
      clock,
      generation,
      visualRevision,
      fields: Object.fromEntries(FIELD_NAMES.map(name => [name, pack(fields[name])])),
    };
  }

  function load(state) {
    if (!state || state.columns !== columns || state.rows !== rows || !state.fields) return false;
    for (const name of FIELD_NAMES) unpack(state.fields[name], fields[name]);
    clock = Math.max(0, Number(state.clock) || 0);
    generation = Math.max(0, Number(state.generation) || 0);
    visualRevision = Math.max(0, Math.floor(state.visualRevision || 0));
    lastVisualBucket = -1;
    recalculateMetrics();
    updateVisualRevision();
    return true;
  }

  function indexAt(column, row) {
    const wrappedColumn = ((column % columns) + columns) % columns;
    const clampedRow = Math.max(0, Math.min(rows - 1, row));
    return clampedRow * columns + wrappedColumn;
  }

  return {
    step,
    getMetrics: () => ({ ...metrics }),
    getSurfaceSignal,
    findHotspots,
    getVisualRevision: () => visualRevision,
    resetBiology,
    save,
    load,
    getGrid: () => ({ columns, rows, size }),
  };
}

function emptyMetrics() {
  return {
    clock: 0,
    generation: 0,
    organics: 0,
    organicCoverage: 0,
    protocells: 0,
    protocellCoverage: 0,
    replicators: 0,
    microbes: 0,
    microbialCoverage: 0,
    photosynthesis: 0,
    photoCoverage: 0,
    oxygen: 0,
    oxygenatedCoverage: 0,
    cooperation: 0,
    plants: 0,
    plantCoverage: 0,
    diversity: 0,
    activeNiches: 0,
    cells: 0,
    lineageEstimate: 0,
  };
}

function pack(array) {
  return Array.from(array, value => Math.round(clamp(value, 0, 1) * 1000));
}

function unpack(values, target) {
  if (!Array.isArray(values)) return;
  const length = Math.min(values.length, target.length);
  for (let index = 0; index < length; index++) target[index] = clamp(Number(values[index]) / 1000, 0, 1);
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
const wrap = (value, max) => ((value % max) + max) % max;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
