const DEFAULT_UNIVERSE_SEED = 'chaisson-734221';
const MIN_PARAMETER = 0.45;
const MAX_PARAMETER = 1.65;

export const ORIGIN_EPOCHS = [
  ['Particle', 'Expansion and cooling make stable atoms possible.'],
  ['Galactic', 'Density fluctuations collect matter into galaxies and stars.'],
  ['Stellar', 'Stars forge and distribute the heavier elements.'],
  ['Planetary', 'Metal-rich disks assemble worlds with distinct climates and interiors.'],
  ['Chemical', 'Energy-fed chemistry explores contingent pathways toward self-maintaining systems.'],
  ['Biological', 'Inheritance, ecology, and selection diversify a living planet.'],
  ['Cultural', 'This layer ends at the threshold of cumulative culture; it is not simulated in Eidolon.'],
];

export function createOriginScenario(input = {}) {
  const universeSeed = normalizeSeed(input.universeSeed) || DEFAULT_UNIVERSE_SEED;
  const densityFluctuations = normalizeParameter(input.densityFluctuations, 1);
  const energyThroughput = normalizeParameter(input.energyThroughput, 1);
  const selectionPressure = normalizeParameter(input.selectionPressure, 1);
  const random = createRandom(`${universeSeed}:${densityFluctuations}:${energyThroughput}:${selectionPressure}`);

  const mass = clamp(0.78 + random() * 0.34 + (energyThroughput - 1) * 0.08, 0.72, 1.2);
  const metallicity = clamp(-0.34 + random() * 0.42 + (densityFluctuations - 1) * 0.18, -0.48, 0.24);
  const age = clamp(2.4 + random() * 5.2 + (selectionPressure - 1) * 0.45, 1.2, 9.2);
  const luminosity = Number(Math.pow(mass, 3.7).toFixed(3));
  const temperature = Math.round(4200 + mass * 1500 + random() * 220);
  const spectralClass = temperature >= 6000 ? 'F9V' : temperature >= 5300 ? 'G8V' : 'K1V';
  const token = hash32(`${universeSeed}:planet:${densityFluctuations}:${energyThroughput}:${selectionPressure}`).toString(36);

  return {
    version: 1,
    universeSeed,
    densityFluctuations,
    energyThroughput,
    selectionPressure,
    planetSeed: `eidolon-origin-${token}`,
    star: {
      id: `origin-star-${token}`,
      name: 'Origin Star',
      mass: Number(mass.toFixed(3)),
      luminosity,
      age: Number(age.toFixed(2)),
      metallicity: Number(metallicity.toFixed(3)),
      temperature,
      spectralClass,
      color: starColor(temperature),
    },
  };
}

export function readOriginScenario(search = globalThis.location?.search || '') {
  const params = new URLSearchParams(search);
  if (params.get('origin') !== 'epic') return null;
  return createOriginScenario({
    universeSeed: params.get('universe'),
    densityFluctuations: params.get('density'),
    energyThroughput: params.get('energy'),
    selectionPressure: params.get('selection'),
  });
}

export function originScenarioParams(scenario) {
  const normalized = createOriginScenario(scenario);
  return new URLSearchParams({
    origin: 'epic',
    universe: normalized.universeSeed,
    density: String(normalized.densityFluctuations),
    energy: String(normalized.energyThroughput),
    selection: String(normalized.selectionPressure),
  });
}

export function normalizeSeed(value) {
  return String(value || '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 96);
}

function normalizeParameter(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(clamp(number, MIN_PARAMETER, MAX_PARAMETER).toFixed(2)) : fallback;
}

function hash32(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function createRandom(seed) {
  let state = hash32(seed) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function starColor(temperature) {
  if (temperature >= 6000) return [0.82, 0.9, 1];
  if (temperature >= 5300) return [1, 0.9, 0.7];
  return [1, 0.72, 0.48];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
