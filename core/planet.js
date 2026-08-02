import { sampleTectonics } from './plate-tectonics.js';

export const PLANET_SEED = 734221;

export function samplePlanet(x, y, width = 1200, height = 720) {
  const lon = (x / width) * Math.PI * 2;
  const lat = (0.5 - y / height) * Math.PI;
  const nx = Math.cos(lat) * Math.cos(lon);
  const ny = Math.sin(lat);
  const nz = Math.cos(lat) * Math.sin(lon);

  const tectonics = sampleTectonics(nx, ny, nz);
  const continentalNoise = fbm3(nx * 1.25, ny * 1.25, nz * 1.25, PLANET_SEED, 5);
  const detail = fbm3(nx * 7.5, ny * 7.5, nz * 7.5, PLANET_SEED + 203, 3);

  // Plate type establishes broad continental/oceanic crust. Convergent
  // boundaries raise mountain chains; divergent boundaries create rifts.
  const crustBase = tectonics.continentalBias * 0.33 + continentalNoise * 0.43;
  const mountainUplift = Math.min(0.30, tectonics.uplift * 1.55);
  const riftDrop = Math.min(0.18, tectonics.rift * 1.15);
  const boundaryRoughness = tectonics.boundaryStrength * detail * 0.12;
  const elevation = clamp(0.20 + crustBase + mountainUplift + boundaryRoughness - riftDrop + detail * 0.06, 0, 1);

  const seaLevel = 0.53;
  const land = elevation >= seaLevel;
  const latitudeCooling = Math.pow(Math.abs(lat) / (Math.PI / 2), 1.35);
  const altitudeCooling = land ? Math.max(0, elevation - 0.62) * 1.65 : 0;
  const temperature = clamp(1 - latitudeCooling - altitudeCooling, 0, 1);

  const moistureNoise = fbm3(nx * 2.2 + 9, ny * 2.2 - 4, nz * 2.2 + 2, PLANET_SEED + 417, 4);
  const coastalMoisture = land ? clamp(1 - (elevation - seaLevel) * 2.8, 0, 1) : 1;
  const rainShadow = land ? tectonics.uplift * 0.18 : 0;
  const rainfall = clamp(moistureNoise * 0.7 + coastalMoisture * 0.3 - rainShadow, 0, 1);

  let biome;
  if (!land) biome = elevation > seaLevel - 0.055 ? 'shallow-ocean' : 'deep-ocean';
  else if (temperature < 0.12) biome = 'ice';
  else if (temperature < 0.25) biome = rainfall > 0.45 ? 'tundra' : 'cold-desert';
  else if (elevation > 0.76) biome = temperature < 0.45 ? 'snow-mountain' : 'mountain';
  else if (rainfall < 0.25) biome = temperature > 0.62 ? 'desert' : 'steppe';
  else if (rainfall > 0.68 && temperature > 0.58) biome = 'rainforest';
  else if (rainfall > 0.58) biome = 'forest';
  else biome = 'grassland';

  return {
    elevation,
    temperature,
    rainfall,
    biome,
    land,
    plateId: tectonics.plateId,
    plateBoundary: tectonics.boundaryStrength,
    convergence: tectonics.convergence,
  };
}

export function biomeColor(sample) {
  const colors = {
    'deep-ocean': [9, 34, 78],
    'shallow-ocean': [15, 91, 130],
    ice: [232, 244, 255],
    tundra: [154, 169, 148],
    'cold-desert': [165, 153, 126],
    'snow-mountain': [215, 222, 228],
    mountain: [105, 100, 91],
    desert: [205, 166, 91],
    steppe: [151, 142, 79],
    rainforest: [22, 105, 60],
    forest: [42, 116, 64],
    grassland: [102, 145, 69],
  };
  const base = colors[sample.biome] || [100, 100, 100];
  const shade = sample.land ? 0.82 + sample.elevation * 0.30 : 0.82 + sample.elevation * 0.22;
  const boundaryHighlight = sample.plateBoundary > 0.65 && sample.land ? 1.08 : 1;
  return base.map(v => Math.round(clamp(v * shade * boundaryHighlight, 0, 255)));
}

export function randomHabitablePoint(width, height, random = Math.random, preference = 'land') {
  for (let i = 0; i < 1000; i++) {
    const x = random() * width;
    const y = random() * height;
    const s = samplePlanet(x, y, width, height);
    if (preference === 'plant') {
      if (s.land && !['ice', 'cold-desert', 'snow-mountain', 'mountain', 'desert'].includes(s.biome)) return { x, y, sample: s };
    } else if (preference === 'land') {
      if (s.land && s.biome !== 'ice') return { x, y, sample: s };
    } else if (preference === 'ocean') {
      if (!s.land) return { x, y, sample: s };
    } else return { x, y, sample: s };
  }
  return { x: width * 0.5, y: height * 0.5, sample: samplePlanet(width * 0.5, height * 0.5, width, height) };
}

export function placeExistingEntitiesOnBiomes(world, random = Math.random) {
  const { position, resource, agent, predator, apex } = world.ecs.components;
  for (const [id] of resource.entries()) {
    const p = randomHabitablePoint(world.width, world.height, random, 'plant');
    const pos = position.get(id);
    if (pos) Object.assign(pos, p);
  }
  for (const collection of [agent, predator, apex]) {
    for (const [id] of collection.entries()) {
      const p = randomHabitablePoint(world.width, world.height, random, 'land');
      const pos = position.get(id);
      if (pos) Object.assign(pos, p);
    }
  }
}

function fbm3(x, y, z, seed, octaves) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    value += valueNoise3(x * frequency, y * frequency, z * frequency, seed + i * 1013) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return value / total;
}

function valueNoise3(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = smooth(x - xi), yf = smooth(y - yi), zf = smooth(z - zi);
  const c000 = hash3(xi, yi, zi, seed), c100 = hash3(xi + 1, yi, zi, seed);
  const c010 = hash3(xi, yi + 1, zi, seed), c110 = hash3(xi + 1, yi + 1, zi, seed);
  const c001 = hash3(xi, yi, zi + 1, seed), c101 = hash3(xi + 1, yi, zi + 1, seed);
  const c011 = hash3(xi, yi + 1, zi + 1, seed), c111 = hash3(xi + 1, yi + 1, zi + 1, seed);
  const x00 = lerp(c000, c100, xf), x10 = lerp(c010, c110, xf);
  const x01 = lerp(c001, c101, xf), x11 = lerp(c011, c111, xf);
  return lerp(lerp(x00, x10, yf), lerp(x01, x11, yf), zf);
}

function hash3(x, y, z, seed) {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const smooth = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
