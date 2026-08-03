import { samplePlanet } from './planet.js';
import { sampleHydrology } from './hydrology.js';

export function createDeepHistory(world, biosphere, dynamics) {
  const snapshots = [];
  const bookmarks = [];
  const encyclopedia = new Map();
  const geography = new Map();
  let clock = 0;
  let snapshotClock = 0;

  seedGeography();

  function step(dt, civilizations = []) {
    clock += dt;
    snapshotClock += dt;
    if (snapshotClock >= 12) {
      snapshotClock = 0;
      capture(civilizations);
    }
  }

  function capture(civilizations = []) {
    const c = world.ecs.components;
    const plants = [...c.resource.values()].filter(r => r.amount > 0).length;
    const species = biosphere.getSpecies();
    const snapshot = {
      time: Math.round(clock),
      tick: world.tick,
      species: species.filter(s => s.population > 0).length,
      biodiversity: species.reduce((sum, s) => sum + Math.sqrt(s.population || 0), 0),
      plants,
      animals: c.agent.size + c.predator.size + c.apex.size,
      civilizations: civilizations.length,
      population: civilizations.reduce((sum, civ) => sum + civ.population, 0),
      averageTemperature: estimateTemperature(),
      forestCover: Math.min(100, Math.round(plants / 2.8)),
    };
    snapshots.push(snapshot);
    if (snapshots.length > 180) snapshots.shift();
    updateEncyclopedia(species, civilizations);
    window.dispatchEvent(new CustomEvent('deep-history-update', { detail: getSummary() }));
  }

  function recordEvent(event) {
    const important = /species|extinction|volcan|earthquake|tsunami|storm|civilization|city|village|war|collapse|writing|agriculture/i.test(`${event.title} ${event.description}`);
    if (!important) return;
    bookmarks.unshift({ ...event, id: `${Date.now()}-${Math.random()}` });
    if (bookmarks.length > 40) bookmarks.length = 40;
  }

  function seedGeography() {
    const points = [
      [0.16, 0.28], [0.42, 0.2], [0.68, 0.3], [0.82, 0.56],
      [0.58, 0.7], [0.3, 0.72], [0.08, 0.58], [0.5, 0.5],
    ];
    const adjectives = ['Crimson', 'Emerald', 'Whispering', 'Silver', 'Azure', 'Ancient', 'Storm', 'Golden'];
    for (let i = 0; i < points.length; i++) {
      const x = points[i][0] * world.width;
      const y = points[i][1] * world.height;
      const p = samplePlanet(x, y, world.width, world.height);
      const h = sampleHydrology(x, y, world.width, world.height);
      let type = !p.land ? 'Sea' : p.elevation > 0.76 ? 'Mountains' : h.river > 0.2 ? 'River Basin' : p.rainfall > 0.62 ? 'Forest' : p.rainfall < 0.28 ? 'Drylands' : 'Plains';
      const name = `${adjectives[i % adjectives.length]} ${type}`;
      geography.set(name, { name, type, x, y, biome: p.biome, elevation: p.elevation, rainfall: p.rainfall });
      encyclopedia.set(`geo:${name}`, {
        title: name,
        category: 'Geography',
        description: describeGeography(name, type, p, h),
      });
    }
  }

  function updateEncyclopedia(species, civilizations) {
    for (const s of species) {
      encyclopedia.set(`species:${s.id}`, {
        title: s.name,
        category: 'Species',
        description: `${capitalize(s.guild)} species with a population of ${s.population}. Generation ${s.generation}${s.parentId ? `, descended from ${species.find(p => p.id === s.parentId)?.name || s.parentId}` : ''}.`,
      });
    }
    for (const civ of civilizations) {
      encyclopedia.set(`civ:${civ.id}`, {
        title: civ.name,
        category: 'Civilization',
        description: `${capitalize(civ.stage)} society with ${civ.population} people, technology level ${civ.technology.toFixed(1)}, and ${civ.settlements.length} settlements.`,
      });
    }
  }

  function estimateTemperature() {
    let total = 0;
    const samples = 24;
    for (let i = 0; i < samples; i++) {
      const x = ((i * 47) % samples) / samples * world.width;
      const y = ((i * 13) % samples) / samples * world.height;
      total += samplePlanet(x, y, world.width, world.height).temperature;
    }
    return Math.round(((total / samples) * 48 - 14) * 10) / 10;
  }

  function getSummary() {
    return {
      latest: snapshots.at(-1) || null,
      snapshots: snapshots.slice(),
      bookmarks: bookmarks.slice(),
      encyclopedia: [...encyclopedia.values()],
      geography: [...geography.values()],
      ancestry: biosphere.getAncestry(),
    };
  }

  return { step, recordEvent, getSummary };
}

function describeGeography(name, type, p, h) {
  const water = h.lake > 0.2 ? 'It contains a major lake system.' : h.river > 0.2 ? 'A large river network crosses the region.' : h.delta > 0.2 ? 'Its coast contains a broad delta.' : '';
  return `${name} is a ${type.toLowerCase()} region in the ${p.biome.replaceAll('-', ' ')} biome. ${water}`.trim();
}

const capitalize = value => value.charAt(0).toUpperCase() + value.slice(1);
