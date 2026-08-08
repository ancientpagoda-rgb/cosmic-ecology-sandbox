import {
  configureTectonics,
  getTectonicState,
  loadTectonics,
  sampleTectonics,
  saveTectonics,
  stepTectonics,
} from './plate-tectonics.js';

export const PLANET_SEED = 734221;
let activeTerrainSeed = PLANET_SEED;
let activeWorldSeed = String(PLANET_SEED);

export function configurePlanetGeneration(options = {}) {
  activeTerrainSeed = normalizeSeed(options.seed ?? PLANET_SEED);
  activeWorldSeed = String(options.worldSeed ?? options.seed ?? PLANET_SEED);
  const tectonics = configureTectonics({ ...options, seed: activeTerrainSeed });
  return getPlanetGenerationState(tectonics);
}

export function stepPlanetGeology(dt) { stepTectonics(dt); }
export function savePlanetGeology() { return { version: 2, terrainSeed: activeTerrainSeed, worldSeed: activeWorldSeed, tectonics: saveTectonics() }; }
export function loadPlanetGeology(state = {}) {
  if (state?.version !== 2) return false;
  if (Number.isFinite(state.terrainSeed) && normalizeSeed(state.terrainSeed) !== activeTerrainSeed) return false;
  if (state.worldSeed && String(state.worldSeed) !== activeWorldSeed) return false;
  return loadTectonics(state.tectonics);
}
export function getPlanetGenerationState(tectonics = getTectonicState()) { return { version: 2, terrainSeed: activeTerrainSeed, worldSeed: activeWorldSeed, tectonics }; }

export function samplePlanet(x, y, width = 1200, height = 720) {
  const lon = (x / width) * Math.PI * 2;
  const lat = (0.5 - y / height) * Math.PI;
  const nx = Math.cos(lat) * Math.cos(lon), ny = Math.sin(lat), nz = Math.cos(lat) * Math.sin(lon);
  const tectonics = sampleTectonics(nx, ny, nz);
  const continentalNoise = fbm3(nx * 1.18, ny * 1.18, nz * 1.18, activeTerrainSeed, 5);
  const provinceNoise = fbm3(nx * 2.85 + 4, ny * 2.85 - 7, nz * 2.85 + 2, activeTerrainSeed + 89, 4);
  const detail = fbm3(nx * 7.5, ny * 7.5, nz * 7.5, activeTerrainSeed + 203, 3);
  const crustBase = tectonics.continentalBias * 0.34 + continentalNoise * 0.35 + provinceNoise * 0.08;
  const mountainUplift = Math.min(0.34, tectonics.uplift * 1.52);
  const ridgeRise = Math.min(0.16, tectonics.rift * 0.62);
  const trenchDrop = Math.min(0.20, tectonics.convergence * tectonics.boundaryStrength * 0.72);
  const transformRoughness = tectonics.shear * (detail - 0.5) * 0.13;
  const boundaryRoughness = tectonics.boundaryStrength * detail * 0.08;
  const volcanicConstruction = tectonics.volcanism * (0.035 + detail * 0.075);
  const oceanicCooling = tectonics.continentalBias < 0.48 ? clamp(tectonics.crustAgeMyr / 220, 0, 1) * 0.08 : 0;
  const stagnantLidRelief = tectonics.tectonicMode === 'stagnant lid' ? (tectonics.mantleHeat - 0.45) * 0.07 : 0;
  const heatPipeRelief = tectonics.tectonicMode === 'heat-pipe volcanism' ? tectonics.volcanism * 0.11 : 0;
  const elevation = clamp(0.205 + crustBase + mountainUplift + ridgeRise + boundaryRoughness + transformRoughness + volcanicConstruction + stagnantLidRelief + heatPipeRelief - trenchDrop - oceanicCooling + detail * 0.045, 0, 1);
  const seaLevel = 0.53;
  const land = elevation >= seaLevel;
  const latitudeCooling = Math.pow(Math.abs(lat) / (Math.PI / 2), 1.35);
  const altitudeCooling = land ? Math.max(0, elevation - 0.62) * 1.65 : 0;
  const geothermalOffset = tectonics.volcanism * 0.035 + tectonics.mantleHeat * 0.018;
  const temperature = clamp(1 - latitudeCooling - altitudeCooling + geothermalOffset, 0, 1);
  const moistureNoise = fbm3(nx * 2.2 + 9, ny * 2.2 - 4, nz * 2.2 + 2, activeTerrainSeed + 417, 4);
  const coastalMoisture = land ? clamp(1 - (elevation - seaLevel) * 2.8, 0, 1) : 1;
  const rainShadow = land ? tectonics.uplift * 0.18 : 0;
  const volcanicRainBoost = land ? tectonics.volcanism * 0.035 : 0;
  const rainfall = clamp(moistureNoise * 0.68 + coastalMoisture * 0.3 - rainShadow + volcanicRainBoost, 0, 1);
  let biome;
  if (!land) biome = elevation > seaLevel - 0.055 ? 'shallow-ocean' : 'deep-ocean';
  else if (temperature < 0.12) biome = 'ice';
  else if (temperature < 0.25) biome = rainfall > 0.45 ? 'tundra' : 'cold-desert';
  else if (elevation > 0.76) biome = temperature < 0.45 ? 'snow-mountain' : 'mountain';
  else if (rainfall < 0.25) biome = temperature > 0.62 ? 'desert' : 'steppe';
  else if (rainfall > 0.68 && temperature > 0.58) biome = 'rainforest';
  else if (rainfall > 0.58) biome = 'forest';
  else biome = 'grassland';
  return { elevation, temperature, rainfall, biome, land, plateId: tectonics.plateId, neighborPlateId: tectonics.neighborPlateId, plateBoundary: tectonics.boundaryStrength, boundaryType: tectonics.boundaryType, convergence: tectonics.convergence, divergence: tectonics.divergence, transform: tectonics.transform, volcanism: tectonics.volcanism, mantleHeat: tectonics.mantleHeat, tectonicMode: tectonics.tectonicMode, crustAgeMyr: tectonics.crustAgeMyr };
}

export function biomeColor(sample) {
  const colors = {
    'deep-ocean': [10, 62, 112], 'shallow-ocean': [22, 132, 170], ice: [236, 248, 255], tundra: [166, 184, 160],
    'cold-desert': [184, 169, 133], 'snow-mountain': [224, 232, 238], mountain: [126, 119, 105], desert: [222, 181, 91],
    steppe: [171, 158, 78], rainforest: [24, 126, 65], forest: [45, 139, 70], grassland: [117, 164, 74],
  };
  const base = colors[sample.biome] || [110, 110, 110];
  const elevationRelief = sample.land ? (sample.elevation - 0.53) * 0.72 : (sample.elevation - 0.30) * 0.45;
  const climateRelief = sample.land ? (sample.rainfall - 0.5) * 0.10 + (sample.temperature - 0.5) * 0.05 : 0;
  const shade = clamp(0.94 + elevationRelief + climateRelief, 0.72, 1.24);
  const boundaryHighlight = sample.plateBoundary > 0.45 ? 1 + Math.min(0.13, sample.plateBoundary * 0.12) : 1;
  const volcanicWarmth = sample.volcanism > 0.45 && sample.land ? [18, -3, -9] : [0, 0, 0];
  return base.map((value, index) => Math.round(clamp((value + volcanicWarmth[index]) * shade * boundaryHighlight, 0, 255)));
}

export function randomHabitablePoint(width, height, random = Math.random, preference = 'land') {
  for (let i = 0; i < 1000; i++) {
    const x = random() * width, y = random() * height;
    const sample = samplePlanet(x, y, width, height);
    if (preference === 'plant') { if (sample.land && !['ice', 'cold-desert', 'snow-mountain', 'mountain', 'desert'].includes(sample.biome)) return { x, y, sample }; }
    else if (preference === 'land') { if (sample.land && sample.biome !== 'ice') return { x, y, sample }; }
    else if (preference === 'ocean') { if (!sample.land) return { x, y, sample }; }
    else return { x, y, sample };
  }
  return { x: width * 0.5, y: height * 0.5, sample: samplePlanet(width * 0.5, height * 0.5, width, height) };
}

export function placeExistingEntitiesOnBiomes(world, random = Math.random) {
  const { position, resource, agent, predator, apex } = world.ecs.components;
  for (const [id] of resource.entries()) { const point = randomHabitablePoint(world.width, world.height, random, 'plant'); const pos = position.get(id); if (pos) Object.assign(pos, point); }
  for (const collection of [agent, predator, apex]) for (const [id] of collection.entries()) { const point = randomHabitablePoint(world.width, world.height, random, 'land'); const pos = position.get(id); if (pos) Object.assign(pos, point); }
}

function fbm3(x, y, z, seed, octaves) {
  let value = 0, amplitude = 0.5, frequency = 1, total = 0;
  for (let i = 0; i < octaves; i++) { value += valueNoise3(x * frequency, y * frequency, z * frequency, seed + i * 1013) * amplitude; total += amplitude; amplitude *= 0.5; frequency *= 2.03; }
  return value / total;
}
function valueNoise3(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = smooth(x - xi), yf = smooth(y - yi), zf = smooth(z - zi);
  const c000 = hash3(xi, yi, zi, seed), c100 = hash3(xi + 1, yi, zi, seed), c010 = hash3(xi, yi + 1, zi, seed), c110 = hash3(xi + 1, yi + 1, zi, seed), c001 = hash3(xi, yi, zi + 1, seed), c101 = hash3(xi + 1, yi, zi + 1, seed), c011 = hash3(xi, yi + 1, zi + 1, seed), c111 = hash3(xi + 1, yi + 1, zi + 1, seed);
  const x00 = lerp(c000, c100, xf), x10 = lerp(c010, c110, xf), x01 = lerp(c001, c101, xf), x11 = lerp(c011, c111, xf);
  return lerp(lerp(x00, x10, yf), lerp(x01, x11, yf), zf);
}
function hash3(x, y, z, seed) { let hash = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647); hash = Math.imul(hash ^ (hash >>> 13), 1274126177); return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295; }
function normalizeSeed(value) { const numeric = Number(value); if (Number.isFinite(numeric)) return (Math.floor(numeric) >>> 0) || PLANET_SEED; const text = String(value || PLANET_SEED); let hash = 2166136261; for (let index = 0; index < text.length; index++) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); } return hash >>> 0 || PLANET_SEED; }
const smooth = value => value * value * (3 - 2 * value);
const lerp = (a, b, amount) => a + (b - a) * amount;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
