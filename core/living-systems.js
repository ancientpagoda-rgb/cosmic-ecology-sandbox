import { samplePlanet, randomHabitablePoint } from './planet.js';
import { sampleHydrology } from './hydrology.js';

export function createLivingSystems(world, rng = Math.random) {
  const random = typeof rng === 'function' ? rng : rng.float.bind(rng);
  const history = [];
  let season = 0;
  let climatePhase = 0;
  let vegetationClock = 0;
  let evolutionClock = 0;
  let hydrologyClock = 0;
  let lastCounts = countLife(world);

  function step(dt) {
    season = (season + dt / 90) % 1;
    climatePhase += dt;
    vegetationClock += dt;
    evolutionClock += dt;
    hydrologyClock += dt;

    applyTerrainAndClimate(dt);

    if (vegetationClock >= 2.5) {
      vegetationClock = 0;
      vegetationCycle();
    }

    if (hydrologyClock >= 18) {
      hydrologyClock = 0;
      hydrologyCycle();
    }

    if (evolutionClock >= 12) {
      evolutionClock = 0;
      evolutionCycle();
      recordPopulationEvents();
    }
  }

  function applyTerrainAndClimate(dt) {
    const { position, velocity, agent, predator, apex, resource } = world.ecs.components;
    const creatures = [agent, predator, apex];

    for (const collection of creatures) {
      for (const [id, organism] of collection.entries()) {
        const pos = position.get(id);
        const vel = velocity.get(id);
        if (!pos || !vel) continue;

        const terrain = sampleDynamicPlanet(pos.x, pos.y);
        const water = sampleHydrology(pos.x, pos.y, world.width, world.height);
        if (!terrain.land || terrain.biome === 'ice' || water.lake > 0.65) {
          const safe = randomHabitablePoint(world.width, world.height, random, 'land');
          pos.x = safe.x;
          pos.y = safe.y;
          vel.vx *= -0.35;
          vel.vy *= -0.35;
          continue;
        }

        const slopePenalty = terrain.elevation > 0.72 ? 0.972 : terrain.elevation > 0.64 ? 0.988 : 1;
        const erosionPenalty = 1 - water.erosion * 0.018;
        const heatPenalty = terrain.temperature > 0.82 ? 0.991 : 1;
        const coldPenalty = terrain.temperature < 0.22 ? 0.988 : 1;
        vel.vx *= slopePenalty * erosionPenalty * heatPenalty * coldPenalty;
        vel.vy *= slopePenalty * erosionPenalty * heatPenalty * coldPenalty;

        const waterRelief = clamp(water.river * 0.16 + water.lake * 0.2 + water.delta * 0.12, 0, 0.22);
        organism.climateStress = Math.max(0, Math.abs((organism.preferredTemperature ?? 0.55) - terrain.temperature) - 0.2 - waterRelief);
        if ('energy' in organism) organism.energy = Math.max(0.05, organism.energy - organism.climateStress * dt * 0.006);
      }
    }

    for (const [id, plant] of resource.entries()) {
      const pos = position.get(id);
      if (!pos) continue;
      const terrain = sampleDynamicPlanet(pos.x, pos.y);
      const water = sampleHydrology(pos.x, pos.y, world.width, world.height);
      const suitability = plantSuitability(terrain, water);
      plant.growthSuitability = suitability;
      if (suitability < 0.18 || water.lake > 0.72) plant.amount = Math.max(0, plant.amount - dt * 0.015);
      else plant.amount = Math.min(1, plant.amount + dt * 0.006 * suitability);
    }
  }

  function vegetationCycle() {
    const { position, resource } = world.ecs.components;
    const plants = [...resource.entries()].filter(([, r]) => r.amount > 0.65);
    let births = 0;
    let fires = 0;

    for (const [id, plant] of plants) {
      const pos = position.get(id);
      if (!pos) continue;
      const terrain = sampleDynamicPlanet(pos.x, pos.y);
      const water = sampleHydrology(pos.x, pos.y, world.width, world.height);

      const waterProtection = clamp(water.river * 0.75 + water.lake * 0.9 + water.delta * 0.65, 0, 0.9);
      const dryFireRisk = terrain.temperature * (1 - terrain.rainfall) * 0.018 * (1 - waterProtection);
      if (random() < dryFireRisk) {
        plant.amount *= 0.18;
        fires++;
        continue;
      }

      if (plants.length + births > 280) break;
      if (random() < plantSuitability(terrain, water) * 0.06) {
        const angle = random() * Math.PI * 2;
        const distance = 6 + random() * 28;
        const x = wrap(pos.x + Math.cos(angle) * distance, world.width);
        const y = Math.max(0, Math.min(world.height, pos.y + Math.sin(angle) * distance));
        const target = sampleDynamicPlanet(x, y);
        const targetWater = sampleHydrology(x, y, world.width, world.height);
        if (plantSuitability(target, targetWater) > 0.38 && targetWater.lake < 0.55) {
          world.makeResourceAt?.(x, y);
          births++;
        }
      }
    }

    if (fires >= 3) addHistory('Wildfire', `${fires} vegetation patches burned during a dry climate interval.`);
    if (births >= 8) addHistory('River-valley expansion', `${births} new vegetation patches spread through moist terrain and drainage corridors.`);
  }

  function hydrologyCycle() {
    const wetSeason = Math.max(0, Math.sin(season * Math.PI * 2));
    const floodChance = 0.08 + wetSeason * 0.2;
    if (random() < floodChance) {
      const severity = 1 + Math.floor(random() * 4);
      addHistory('Seasonal flooding', `${severity} major river basin${severity === 1 ? '' : 's'} overflowed, enriching floodplains and disturbing nearby life.`);
    }

    if (random() < 0.06) {
      addHistory('Erosion cycle', 'Rivers cut deeper channels through uplifted terrain and carried sediment toward lakes and coastal deltas.');
    }
  }

  function evolutionCycle() {
    const groups = [world.ecs.components.agent, world.ecs.components.predator, world.ecs.components.apex];
    let mutations = 0;
    for (const group of groups) {
      for (const [, organism] of group.entries()) {
        const dna = organism.dna;
        if (!dna || random() > 0.22) continue;
        const stress = organism.climateStress ?? 0;
        dna.speed = clamp(dna.speed + (random() - 0.5) * (0.025 + stress * 0.04), 0.45, 2.1);
        dna.sense = clamp(dna.sense + (random() - 0.5) * 0.035, 0.35, 2.2);
        dna.metabolism = clamp(dna.metabolism + (random() - 0.5) * 0.025, 0.4, 2.2);
        organism.preferredTemperature = clamp((organism.preferredTemperature ?? 0.55) + (random() - 0.5) * 0.04, 0.05, 0.95);
        mutations++;
      }
    }
    if (mutations >= 5) addHistory('Adaptive shift', `${mutations} organisms developed small inherited trait changes.`);
  }

  function recordPopulationEvents() {
    const counts = countLife(world);
    for (const key of Object.keys(counts)) {
      const before = lastCounts[key] || 0;
      const now = counts[key];
      if (before > 4 && now === 0) addHistory('Extinction', `${capitalize(key)} disappeared from the planet.`);
      else if (before > 0 && now > before * 1.55 && now - before >= 4) addHistory('Population boom', `${capitalize(key)} expanded from ${before} to ${now}.`);
    }
    lastCounts = counts;
  }

  function sampleDynamicPlanet(x, y) {
    const base = samplePlanet(x, y, world.width, world.height);
    const latitude = Math.abs(0.5 - y / world.height) * 2;
    const seasonalSwing = Math.sin(season * Math.PI * 2) * (0.12 * latitude);
    const longCycle = Math.sin(climatePhase / 180) * 0.035;
    return {
      ...base,
      temperature: clamp(base.temperature + seasonalSwing + longCycle, 0, 1),
      rainfall: clamp(base.rainfall + Math.sin(season * Math.PI * 2 + x / world.width * Math.PI * 2) * 0.08, 0, 1),
    };
  }

  function addHistory(title, description) {
    history.unshift({ title, description, tick: world.tick, date: new Date().toISOString() });
    if (history.length > 60) history.length = 60;
    window.dispatchEvent(new CustomEvent('reality-history', { detail: history.slice(0, 12) }));
  }

  addHistory('Hydrological age begins', 'Rain now drains downhill into rivers, lakes, floodplains, and coastal deltas.');
  addHistory('Living planet initialized', 'Terrain, vegetation, climate, evolution, and history systems became active.');

  return {
    step,
    getHistory: () => history.slice(),
    getSeason: () => season,
    sampleDynamicPlanet,
  };
}

function plantSuitability(t, water = { river: 0, lake: 0, delta: 0 }) {
  if (!t.land || ['ice', 'cold-desert', 'snow-mountain', 'mountain'].includes(t.biome)) return 0;
  const temperatureFit = 1 - Math.abs(t.temperature - 0.58) * 1.5;
  const waterBoost = clamp(water.river * 0.5 + water.lake * 0.35 + water.delta * 0.65, 0, 0.65);
  const desertPenalty = t.biome === 'desert' && waterBoost < 0.18 ? 0.18 : 1;
  return clamp((temperatureFit * 0.5 + t.rainfall * 0.55 + waterBoost) * desertPenalty, 0, 1);
}

function countLife(world) {
  const c = world.ecs.components;
  return {
    plants: [...c.resource.values()].filter(r => r.amount > 0).length,
    herbivores: c.agent.size,
    predators: c.predator.size,
    apex: c.apex.size,
  };
}

const wrap = (v, max) => ((v % max) + max) % max;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const capitalize = text => text.charAt(0).toUpperCase() + text.slice(1);
