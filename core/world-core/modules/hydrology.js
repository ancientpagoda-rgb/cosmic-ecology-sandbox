import { clamp, localSlope } from '../grid-state.js';

export function createHydrologyModule(grid, options = {}) {
  const rainfall = options.rainfall ?? 0.62;
  return {
    id: 'world.hydrology',
    step(years) {
      applyRainfall(grid, rainfall, years);
      for (let pass = 0; pass < 3; pass++) routeWater(grid, years);
      updateFloodplains(grid, years);
    },
    save: () => ({}),
    load() {},
  };
}

function applyRainfall(grid, strength, years) {
  for (let y = 0; y < grid.height; y++) {
    let shadow = 0;
    for (let x = 0; x < grid.width; x++) {
      const i = grid.index(x, y);
      const windward = Math.max(0, grid.elevation[i] - (x ? grid.elevation[grid.index(x - 1, y)] : grid.elevation[i]));
      shadow = Math.max(0, shadow * 0.96 + windward * 0.8);
      const rain = clamp(strength * (0.72 + windward * 2.2 - shadow * 0.42), 0, 1);
      grid.water[i] += rain * 0.012 * years;
      grid.moisture[i] = clamp(grid.moisture[i] * 0.985 + rain * 0.018 * years, 0, 1);
      grid.flow[i] *= 0.78;
      grid.flood[i] *= 0.72;
    }
  }
}

function routeWater(grid, years) {
  const delta = new Float32Array(grid.size);
  for (let y = 1; y < grid.height - 1; y++) for (let x = 1; x < grid.width - 1; x++) {
    const i = grid.index(x, y);
    if (grid.water[i] <= 0.00001) continue;
    let best = i;
    let bestHeight = grid.elevation[i] + grid.water[i];
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const j = grid.index(x + ox, y + oy);
      const height = grid.elevation[j] + grid.water[j];
      if (height < bestHeight) { bestHeight = height; best = j; }
    }
    if (best !== i) {
      const moved = Math.min(grid.water[i], Math.max(0, (grid.elevation[i] + grid.water[i] - bestHeight) * 0.42));
      delta[i] -= moved;
      delta[best] += moved;
      grid.flow[i] += moved * (0.5 + years * 0.01);
      if (moved > 0.035) grid.flood[best] = clamp(grid.flood[best] + moved * 0.45, 0, 1);
    }
  }
  for (let i = 0; i < grid.size; i++) grid.water[i] = Math.max(0, grid.water[i] + delta[i]);
}

function updateFloodplains(grid, years) {
  for (let y = 1; y < grid.height - 1; y++) for (let x = 1; x < grid.width - 1; x++) {
    const i = grid.index(x, y);
    if (grid.flow[i] > 0.12 && localSlope(grid, x, y) < 0.035) {
      const spread = Math.min(0.12, grid.flow[i] * 0.08);
      grid.flood[i] = clamp(grid.flood[i] + spread, 0, 1);
      grid.soil[i] = clamp(grid.soil[i] + spread * 0.14, 0, 1);
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const j = grid.index(x + ox, y + oy);
        grid.flood[j] = clamp(grid.flood[j] + spread * 0.35, 0, 1);
      }
    }
    grid.flood[i] *= Math.pow(0.97, years);
    grid.water[i] *= Math.pow(0.985, years);
  }
}
