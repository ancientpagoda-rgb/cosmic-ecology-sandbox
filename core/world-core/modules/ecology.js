import { clamp } from '../grid-state.js';

export function createEcologyModule(grid, options = {}) {
  const temperature = options.temperature ?? 0.58;
  return {
    id: 'world.ecology',
    step(years) {
      for (let y = 0; y < grid.height; y++) {
        const latitude = Math.abs(y / (grid.height - 1) - 0.5) * 2;
        for (let x = 0; x < grid.width; x++) {
          const i = grid.index(x, y);
          const localTemp = clamp(temperature - latitude * 0.48 - Math.max(0, grid.elevation[i] - 0.5) * 0.42, 0, 1);
          const suitability = clamp(grid.moisture[i] * 1.35 * localTemp * grid.soil[i] * (1 - grid.farms[i]) * (1 - Math.max(0, grid.flow[i] - 0.35)), 0, 1);
          grid.vegetation[i] = clamp(grid.vegetation[i] + suitability * (1 - grid.vegetation[i]) * 0.008 * years, 0, 1);
          grid.vegetation[i] = clamp(grid.vegetation[i] - (Math.max(0, 0.22 - grid.moisture[i]) + Math.max(0, 0.2 - localTemp)) * 0.006 * years, 0, 1);
          grid.moisture[i] = clamp(grid.moisture[i] - grid.vegetation[i] * 0.0015 * years + grid.flood[i] * 0.015, 0, 1);
        }
      }
    },
    save: () => ({}),
    load() {},
  };
}

export function createFireModule(grid, options = {}) {
  const temperature = options.temperature ?? 0.58;
  return {
    id: 'world.fire',
    step(years, world) {
      const nextFire = new Float32Array(grid.size);
      let ignitions = 0;
      for (let y = 0; y < grid.height; y++) {
        const latitude = Math.abs(y / (grid.height - 1) - 0.5) * 2;
        for (let x = 0; x < grid.width; x++) {
          const i = grid.index(x, y);
          const localTemp = clamp(temperature - latitude * 0.48 - Math.max(0, grid.elevation[i] - 0.5) * 0.42, 0, 1);
          const ignition = grid.vegetation[i] * Math.max(0, 0.34 - grid.moisture[i]) * Math.max(0, localTemp - 0.42) * 0.025 * years;
          if (world.rng.chance(ignition)) { nextFire[i] = 1; ignitions++; }
          if (grid.fire[i] > 0.04) {
            grid.vegetation[i] *= Math.pow(0.2, grid.fire[i] * years / 20);
            grid.farms[i] *= Math.pow(0.55, grid.fire[i] * years / 20);
            grid.soil[i] = clamp(grid.soil[i] + grid.fire[i] * 0.025, 0, 1);
            for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
              if (!ox && !oy) continue;
              const j = grid.safeIndex(x + ox, y + oy);
              if (j >= 0 && world.rng.chance(grid.fire[i] * grid.vegetation[j] * Math.max(0, 0.45 - grid.moisture[j]) * 0.22)) nextFire[j] = Math.max(nextFire[j], 0.75);
            }
          }
          grid.fire[i] = Math.max(nextFire[i], grid.fire[i] * 0.35);
        }
      }
      if (ignitions > 0) world.history.record({ type: 'wildfire-outbreak', time: world.getTimeYears(), title: `${ignitions} wildfire fronts ignite`, data: { ignitions } });
    },
    save: () => ({}),
    load() {},
  };
}
