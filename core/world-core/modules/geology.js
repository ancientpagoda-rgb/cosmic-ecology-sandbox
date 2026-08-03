import { clamp, localSlope } from '../grid-state.js';

export function createGeologyModule(grid, options = {}) {
  const uplift = options.uplift ?? 0.55;
  let initialized = false;

  return {
    id: 'world.geology',
    initialize(world) {
      if (initialized) return;
      initialized = true;
      generateTerrain(grid, world);
      world.history.record({ type: 'terrain-generated', time: world.getTimeYears(), title: 'Continents and mountain belts form' });
    },
    step(years, world) {
      const phase = world.getTimeYears() * 0.00004;
      for (let y = 1; y < grid.height - 1; y++) for (let x = 1; x < grid.width - 1; x++) {
        const i = grid.index(x, y);
        const wave = Math.sin((x / grid.width) * Math.PI * 4 + phase) * Math.cos((y / grid.height) * Math.PI * 3 - phase * 0.7);
        const boundary = Math.max(0, 1 - Math.abs(wave) * 2.8);
        grid.elevation[i] = clamp(grid.elevation[i] + boundary * uplift * 0.00045 * years, 0, 1.4);
        const erosion = Math.min(grid.elevation[i], grid.flow[i] * localSlope(grid, x, y) * 0.00019 * years);
        grid.elevation[i] -= erosion;
        grid.sediment[i] += erosion * 0.7;
        grid.soil[i] = clamp(grid.soil[i] - erosion * 2.5, 0, 1);
        if (localSlope(grid, x, y) < 0.025 && grid.sediment[i] > 0) {
          const deposit = Math.min(grid.sediment[i], 0.0001 * years * (1 + grid.flood[i]));
          grid.elevation[i] += deposit;
          grid.sediment[i] -= deposit;
          grid.soil[i] = clamp(grid.soil[i] + deposit * 9, 0, 1);
        }
      }
    },
    save: () => ({ initialized }),
    load(state) { initialized = Boolean(state?.initialized); },
  };
}

function generateTerrain(grid, world) {
  const values = grid.elevation;
  let min = Infinity;
  let max = -Infinity;
  for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) {
    const i = grid.index(x, y);
    const nx = x / grid.width - 0.5;
    const ny = y / grid.height - 0.5;
    const continental = fbm(nx * 2.1, ny * 2.1, world.seed) * 0.58;
    const ridges = Math.abs(fbm(nx * 5.8 + 11, ny * 5.8 - 7, `${world.seed}:ridges`) - 0.5) * 0.55;
    const falloff = Math.max(0, 1 - Math.pow(Math.hypot(nx * 1.25, ny * 1.1), 2.2));
    values[i] = clamp(0.2 + continental + ridges * 0.32 + falloff * 0.3, 0, 1);
    grid.resources[i] = fbm(nx * 9 + 31, ny * 9 - 19, `${world.seed}:resources`);
    grid.moisture[i] = 0.18 + world.rng.next() * 0.08;
    grid.soil[i] = 0.25 + world.rng.next() * 0.25;
    min = Math.min(min, values[i]);
    max = Math.max(max, values[i]);
  }
  const span = max - min || 1;
  for (let i = 0; i < values.length; i++) values[i] = (values[i] - min) / span;
}

function fbm(x, y, seed) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let octave = 0; octave < 5; octave++) {
    value += noise2(x * frequency, y * frequency, `${seed}:${octave}`) * amplitude;
    frequency *= 2;
    amplitude *= 0.5;
  }
  return value;
}
function noise2(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), tx = x - xi, ty = y - yi;
  const a = hashNoise(xi, yi, seed), b = hashNoise(xi + 1, yi, seed), c = hashNoise(xi, yi + 1, seed), d = hashNoise(xi + 1, yi + 1, seed);
  const ux = tx * tx * (3 - 2 * tx), uy = ty * ty * (3 - 2 * ty);
  return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy;
}
function hashNoise(x, y, seed) {
  let h = 2166136261;
  const text = `${seed}:${x}:${y}`;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}
