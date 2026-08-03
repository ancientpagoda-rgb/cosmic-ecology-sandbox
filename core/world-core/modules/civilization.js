import { clamp, lerp, localSlope, sumAround } from '../grid-state.js';

export function createAgricultureModule(grid) {
  return {
    id: 'world.agriculture',
    step(years) {
      for (const city of grid.settlements) {
        if (!city.alive) continue;
        const pressure = clamp(city.population / 900, 0, 1);
        for (let oy = -4; oy <= 4; oy++) for (let ox = -4; ox <= 4; ox++) {
          const x = city.x + ox, y = city.y + oy;
          const i = grid.safeIndex(x, y);
          if (i < 0 || grid.elevation[i] < grid.seaLevel || localSlope(grid, x, y) > 0.08 || grid.flood[i] > 0.65) continue;
          const fertility = grid.soil[i] * grid.moisture[i] * (0.5 + grid.flow[i]);
          const expansion = pressure * fertility * 0.004 * years / Math.max(1, Math.hypot(ox, oy));
          grid.farms[i] = clamp(grid.farms[i] + expansion, 0, 1);
          grid.vegetation[i] = clamp(grid.vegetation[i] - expansion * 0.7, 0, 1);
          grid.soil[i] = clamp(grid.soil[i] - grid.farms[i] * 0.0009 * years + grid.flood[i] * 0.004 * years, 0, 1);
        }
      }
    },
    save: () => ({}),
    load() {},
  };
}

export function createSettlementModule(grid) {
  return {
    id: 'world.settlements',
    step(years, world) {
      if (world.getTimeYears() > 1500 && grid.settlements.length < 22 && world.rng.chance(0.08 * years / 20)) foundSettlement(grid, world);
      for (const city of grid.settlements) {
        if (!city.alive) continue;
        city.age += years;
        const i = grid.index(city.x, city.y);
        const nearbyFarm = sumAround(grid, grid.farms, city.x, city.y, 4) / 81;
        const waterAccess = clamp(grid.flow[i] * 1.5 + grid.moisture[i] * 0.45, 0, 1.5);
        const stress = grid.flood[i] * 0.7 + grid.fire[i] * 1.2 + Math.max(0, 0.18 - grid.moisture[i]) * 1.4;
        const trade = roadTrade(grid, city);
        const food = nearbyFarm * 1.4 + grid.vegetation[i] * 0.25 + waterAccess * 0.45;
        const carrying = 40 + food * 1200 + grid.resources[i] * 350 + trade * 500;
        const growthRate = 0.0017 * clamp(1 - city.population / Math.max(1, carrying), -0.55, 1) - stress * 0.0012;
        city.population = Math.max(0, city.population + city.population * growthRate * years);
        city.wealth = clamp(city.wealth + (trade + grid.resources[i] * 0.25 + nearbyFarm * 0.35 - stress * 0.3) * years * 0.02, 0, 1000);
        if (city.population < 10 || (stress > 1.2 && city.wealth < 8)) {
          city.alive = false;
          grid.collapsedCount++;
          world.history.record({ type: 'city-collapse', time: world.getTimeYears(), title: `${city.name} collapses`, entities: [city.entityId], data: { stress, population: city.population } });
        }
      }
    },
    save: () => ({}),
    load() {},
  };
}

export function createRoadTradeModule(grid) {
  return {
    id: 'world.roads-trade',
    step() {
      const active = grid.settlements.filter(city => city.alive && city.population > 60);
      const wanted = new Map();
      for (const city of active) {
        const candidates = active.filter(other => other !== city).sort((a, b) => roadCost(grid, city, a) - roadCost(grid, city, b)).slice(0, 2);
        for (const other of candidates) {
          const key = [city.id, other.id].sort().join('|');
          wanted.set(key, { id: key, aId: city.id, bId: other.id });
        }
      }
      grid.roads = [...wanted.values()];
    },
    save: () => ({}),
    load() {},
  };
}

function foundSettlement(grid, world) {
  let best = null;
  for (let attempt = 0; attempt < 220; attempt++) {
    const x = 2 + world.rng.int(grid.width - 4);
    const y = 2 + world.rng.int(grid.height - 4);
    const i = grid.index(x, y);
    const score = grid.flow[i] * 1.9 + grid.moisture[i] * 0.9 + grid.vegetation[i] * 0.35 + grid.resources[i] * 0.8 + grid.soil[i] * 0.8 - localSlope(grid, x, y) * 3 - grid.flood[i] * 1.1;
    if (!best || score > best.score) best = { x, y, score };
  }
  if (!best || best.score <= 0.5 || !grid.settlements.filter(city => city.alive).every(city => Math.hypot(city.x - best.x, city.y - best.y) > 8)) return;
  const entity = world.createEntity('city', { x: best.x, y: best.y, population: 30 + world.rng.range(0, 70) });
  const city = { id: entity.id, entityId: entity.id, name: `Settlement ${grid.settlements.length + 1}`, x: best.x, y: best.y, population: entity.components.population, wealth: 12, age: 0, alive: true };
  grid.settlements.push(city);
  world.history.record({ type: 'city-founded', time: world.getTimeYears(), title: `${city.name} is founded`, entities: [entity.id], location: { x: city.x, y: city.y }, data: { score: best.score } });
}

function roadTrade(grid, city) {
  let value = 0;
  for (const road of grid.roads) {
    if (road.aId !== city.id && road.bId !== city.id) continue;
    const otherId = road.aId === city.id ? road.bId : road.aId;
    const other = grid.settlements.find(item => item.id === otherId);
    if (other?.alive) value += Math.log10(other.population + 10) / Math.max(4, Math.hypot(city.x - other.x, city.y - other.y));
  }
  return value;
}

function roadCost(grid, a, b) {
  const distance = Math.hypot(a.x - b.x, a.y - b.y);
  const steps = Math.max(2, Math.ceil(distance));
  let terrain = 0;
  for (let n = 0; n <= steps; n++) {
    const t = n / steps;
    const x = Math.round(lerp(a.x, b.x, t));
    const y = Math.round(lerp(a.y, b.y, t));
    terrain += localSlope(grid, x, y) * 8 + grid.flood[grid.index(x, y)] * 2;
  }
  return distance + terrain;
}
