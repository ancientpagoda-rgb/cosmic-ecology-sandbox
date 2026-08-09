import { samplePlanet } from './planet.js';

const ROOT_SPECIES = [
  { id: 'azure-grazer', name: 'Azure Grazer', guild: 'grazer', color: 0x69d8ff, temp: 0.58, social: 0.82, diseaseResistance: 0.58 },
  { id: 'ember-stalker', name: 'Ember Stalker', guild: 'predator', color: 0xff705e, temp: 0.54, social: 0.48, diseaseResistance: 0.66 },
  { id: 'violet-apex', name: 'Violet Apex', guild: 'apex', color: 0xcf8dff, temp: 0.47, social: 0.22, diseaseResistance: 0.76 },
];

export function createBiosphere(world, rng = Math.random, options = {}) {
  const random = typeof rng === 'function' ? rng : rng.float.bind(rng);
  const species = new Map(ROOT_SPECIES.map(s => [s.id, { ...s, parentId: null, generation: 0, population: 0 }]));
  const organismSpecies = new Map();
  const ancestry = [];
  let clock = 0;
  let diseaseClock = 0;
  let speciationClock = 0;
  let previousPopulation = new Map();
  let seasonalResources = options.seasonalResources || null;

  assignInitialSpecies();
  recount();

  function step(dt) {
    clock += dt;
    diseaseClock += dt;
    speciationClock += dt;
    assignUnclassifiedOrganisms();
    applySocialMigration(dt);
    applyFoodWebPressure(dt);

    if (diseaseClock >= 9) {
      diseaseClock = 0;
      diseaseCycle();
    }
    if (speciationClock >= 24) {
      speciationClock = 0;
      speciationCycle();
      populationEvents();
    }
  }

  function assignInitialSpecies() {
    const c = world.ecs.components;
    for (const [id] of c.agent) organismSpecies.set(id, 'azure-grazer');
    for (const [id] of c.predator) organismSpecies.set(id, 'ember-stalker');
    for (const [id] of c.apex) organismSpecies.set(id, 'violet-apex');
  }

  function assignUnclassifiedOrganisms() {
    const c = world.ecs.components;
    const groups = [
      [c.agent, 'grazer', 'azure-grazer'],
      [c.predator, 'predator', 'ember-stalker'],
      [c.apex, 'apex', 'violet-apex'],
    ];
    for (const [group, guild, fallback] of groups) {
      for (const [id, organism] of group) {
        if (organismSpecies.has(id)) continue;
        const parent = nearestClassified(id, guild, 80);
        const speciesId = parent ? organismSpecies.get(parent) : fallback;
        organismSpecies.set(id, speciesId);
        inheritSpeciesTraits(organism, species.get(speciesId));
      }
    }
    for (const id of [...organismSpecies.keys()]) {
      if (!c.position.has(id)) organismSpecies.delete(id);
    }
  }

  function inheritSpeciesTraits(organism, spec) {
    organism.speciesId = spec.id;
    organism.preferredTemperature ??= spec.temp;
    organism.diseaseResistance ??= spec.diseaseResistance;
    organism.sociality ??= spec.social;
  }

  function nearestClassified(id, guild, radius) {
    const c = world.ecs.components;
    const pos = c.position.get(id);
    if (!pos) return null;
    let best = null;
    let bestD = radius;
    for (const [otherId, speciesId] of organismSpecies) {
      if (otherId === id || species.get(speciesId)?.guild !== guild) continue;
      const other = c.position.get(otherId);
      if (!other) continue;
      const d = sphericalDistance(pos, other);
      if (d < bestD) { bestD = d; best = otherId; }
    }
    return best;
  }

  function applySocialMigration(dt) {
    const c = world.ecs.components;
    for (const [id, speciesId] of organismSpecies) {
      const spec = species.get(speciesId);
      const pos = c.position.get(id);
      const vel = c.velocity.get(id);
      const organism = c.agent.get(id) || c.predator.get(id) || c.apex.get(id);
      if (!spec || !pos || !vel || !organism) continue;

      const climate = samplePlanet(pos.x, pos.y, world.width, world.height);
      const tempStress = Math.abs(climate.temperature - (organism.preferredTemperature ?? spec.temp));
      if (tempStress > 0.2) {
        const northOrSouth = climate.temperature > spec.temp ? (pos.y < world.height / 2 ? -1 : 1) : (pos.y < world.height / 2 ? 1 : -1);
        vel.vy += northOrSouth * 3.2 * dt;
      }

      if ((organism.sociality ?? spec.social) > 0.5) {
        let cx = 0, cy = 0, n = 0;
        for (const [otherId, otherSpecies] of organismSpecies) {
          if (otherId === id || otherSpecies !== speciesId) continue;
          const p = c.position.get(otherId);
          if (!p || sphericalDistance(pos, p) > 75) continue;
          cx += wrappedDelta(pos.x, p.x, world.width);
          cy += p.y - pos.y;
          n++;
        }
        if (n) {
          vel.vx += (cx / n) * 0.012 * dt;
          vel.vy += (cy / n) * 0.012 * dt;
        }
      }
    }
  }

  function applyFoodWebPressure(dt) {
    const c = world.ecs.components;
    const plantCount = [...c.resource.values()].filter(r => r.amount > 0.2).length;
    const grazers = c.agent.size;
    const predators = c.predator.size + c.apex.size;
    const grazerPressure = grazers / Math.max(1, plantCount);
    const predatorPressure = predators / Math.max(1, grazers);

    for (const [id, organism] of c.agent) {
      const food = localFood(id);
      organism.resourceOpportunity = food;
      if ('energy' in organism) organism.energy = Math.max(0.04, organism.energy + dt * (food - 0.5) * 0.003 - (grazerPressure > 0.75 ? dt * 0.0015 * grazerPressure : 0));
    }
    for (const group of [c.predator, c.apex]) {
      for (const [id, organism] of group) {
        organism.resourceOpportunity = localFood(id);
        if (predatorPressure > 0.5 && 'energy' in organism) organism.energy = Math.max(0.04, organism.energy - dt * 0.0018 * predatorPressure);
      }
    }
  }

  function diseaseCycle() {
    recount();
    const crowded = [...species.values()].filter(s => s.population >= 8);
    if (!crowded.length || random() > 0.34) return;
    const target = crowded[Math.floor(random() * crowded.length)];
    let infected = 0;
    const c = world.ecs.components;
    for (const [id, speciesId] of organismSpecies) {
      if (speciesId !== target.id) continue;
      const organism = c.agent.get(id) || c.predator.get(id) || c.apex.get(id);
      if (!organism) continue;
      const resistance = organism.diseaseResistance ?? target.diseaseResistance;
      if (random() > resistance) {
        organism.energy = Math.max(0.05, (organism.energy ?? 1) * 0.72);
        organism.infected = 10 + random() * 15;
        infected++;
      }
    }
    if (infected >= 2) emit('Disease outbreak', `${infected} ${target.name.toLowerCase()} individuals were affected by a contagious illness.`);
  }

  function speciationCycle() {
    recount();
    const candidates = [...species.values()].filter(s => s.population >= 7 && s.generation < 5);
    if (!candidates.length || random() > 0.42) return;
    const parent = candidates[Math.floor(random() * candidates.length)];
    const members = [...organismSpecies.entries()].filter(([, sid]) => sid === parent.id);
    if (members.length < 7) return;

    members.sort((a, b) => {
      const pa = world.ecs.components.position.get(a[0]);
      const pb = world.ecs.components.position.get(b[0]);
      return (pa?.x ?? 0) - (pb?.x ?? 0);
    });
    const branch = members.slice(Math.floor(members.length * 0.68));
    if (branch.length < 2) return;

    const id = `${parent.id}-${species.size + 1}`;
    const child = {
      id,
      name: generateSpeciesName(parent.guild, species.size),
      guild: parent.guild,
      color: mutateColor(parent.color, random),
      temp: clamp(parent.temp + (random() - 0.5) * 0.18, 0.08, 0.92),
      social: clamp(parent.social + (random() - 0.5) * 0.22, 0.05, 0.95),
      diseaseResistance: clamp(parent.diseaseResistance + (random() - 0.5) * 0.16, 0.2, 0.95),
      parentId: parent.id,
      generation: parent.generation + 1,
      population: branch.length,
    };
    species.set(id, child);
    for (const [entityId] of branch) {
      organismSpecies.set(entityId, id);
      const organism = getOrganism(entityId);
      if (organism) inheritSpeciesTraits(organism, child);
    }
    ancestry.push({ parentId: parent.id, childId: id, time: world.tick });
    emit('New species', `${child.name} diverged from ${parent.name} after geographic and environmental isolation.`);
  }

  function populationEvents() {
    recount();
    for (const spec of species.values()) {
      const before = previousPopulation.get(spec.id) ?? spec.population;
      if (before >= 3 && spec.population === 0) emit('Species extinction', `${spec.name} has disappeared from the planet.`);
      else if (before > 0 && spec.population >= before * 1.7 && spec.population - before >= 3) emit('Species expansion', `${spec.name} rapidly expanded into new habitat.`);
      previousPopulation.set(spec.id, spec.population);
    }
  }

  function recount() {
    for (const spec of species.values()) spec.population = 0;
    for (const speciesId of organismSpecies.values()) {
      const spec = species.get(speciesId);
      if (spec) spec.population++;
    }
  }

  function getOrganism(id) {
    const c = world.ecs.components;
    return c.agent.get(id) || c.predator.get(id) || c.apex.get(id);
  }

  function getSpeciesForEntity(id) {
    return species.get(organismSpecies.get(id)) || null;
  }

  function getNearbySpecies(x, y, radius = 100) {
    const counts = new Map();
    const c = world.ecs.components;
    for (const [id, sid] of organismSpecies) {
      const pos = c.position.get(id);
      if (!pos || sphericalDistance(pos, { x, y }) > radius) continue;
      counts.set(sid, (counts.get(sid) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([id, population]) => ({ ...species.get(id), population }))
      .sort((a, b) => b.population - a.population);
  }

  function localFood(id) {
    const position = world.ecs.components.position.get(id);
    return position && seasonalResources ? seasonalResources.sample(position.x, position.y).food : 0.5;
  }

  function getTraitCards(limit = 3) {
    recount();
    return [...species.values()]
      .filter(spec => spec.population > 0)
      .sort((a, b) => b.population - a.population)
      .slice(0, limit)
      .map(spec => {
        const members = [...organismSpecies.entries()]
          .filter(([, speciesId]) => speciesId === spec.id)
          .map(([id]) => getOrganism(id))
          .filter(Boolean);
        const average = key => members.reduce((sum, organism) => sum + (organism.dna?.[key] ?? 1), 0) / Math.max(1, members.length);
        const thermal = members.reduce((sum, organism) => sum + (organism.preferredTemperature ?? spec.temp), 0) / Math.max(1, members.length);
        return {
          id: spec.id,
          name: spec.name,
          guild: spec.guild,
          color: spec.color,
          population: spec.population,
          generation: spec.generation,
          traits: {
            speed: average('speed'),
            sense: average('sense'),
            metabolism: average('metabolism'),
            thermal,
          },
        };
      });
  }

  // Capsules are declarative data, never user-provided behavior. The
  // authoritative biosphere translates their bounded traits into ordinary ECS
  // organisms, so released lineages obey the same food web as native life.
  function releaseLineage(capsule, placement = {}) {
    if (!capsule || !['grazer', 'predator', 'apex'].includes(capsule.guild)) throw new Error('Invalid lineage guild.');
    const traits = capsule.traits || {};
    const speed = clamp(Number(traits.speed) || 1, 0.6, 1.4);
    const sense = clamp(Number(traits.sense) || 1, 0.6, 1.5);
    const metabolism = clamp(Number(traits.metabolism) || 1, 0.6, 1.6);
    const temp = clamp(Number(traits.thermal) || 0.55, 0.08, 0.92);
    const sourceId = String(capsule.id || 'lineage').replace(/[^a-z0-9-]/gi, '').slice(0, 48) || 'lineage';
    const id = species.has(sourceId) ? `${sourceId}-${species.size + 1}` : sourceId;
    const colorText = String(capsule.visual?.color || '#69d8ff').replace('#', '');
    const color = /^[0-9a-f]{6}$/i.test(colorText) ? Number.parseInt(colorText, 16) : 0x69d8ff;
    const spec = {
      id,
      name: String(capsule.name || 'Unnamed Wanderer').slice(0, 32),
      guild: capsule.guild,
      color,
      temp,
      social: clamp(0.28 + sense * 0.34, 0.16, 0.88),
      diseaseResistance: clamp(1.12 - metabolism * 0.26, 0.3, 0.9),
      parentId: species.has(capsule.ancestry?.parentId) ? capsule.ancestry.parentId : null,
      generation: species.get(capsule.ancestry?.parentId)?.generation + 1 || 0,
      population: 0,
      lineageCapsuleId: sourceId,
      visualForm: capsule.visual?.form || 'kite',
    };
    species.set(id, spec);

    const c = world.ecs.components;
    const x = ((Number(placement.x) || world.width * 0.5) % world.width + world.width) % world.width;
    const y = clamp(Number(placement.y) || world.height * 0.5, 0, world.height);
    const count = clamp(Math.round(Number(placement.count) || 5), 3, 8);
    for (let index = 0; index < count; index++) {
      const entityId = world.ecs.createEntity();
      const angle = random() * Math.PI * 2;
      const radius = 4 + random() * 18;
      c.position.set(entityId, { x: (x + Math.cos(angle) * radius + world.width) % world.width, y: clamp(y + Math.sin(angle) * radius, 0, world.height) });
      const velocity = 28 * speed * (0.7 + random() * 0.5);
      c.velocity.set(entityId, { vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity });
      const organism = {
        colorHue: hueFromColor(color), energy: capsule.guild === 'grazer' ? 1 : capsule.guild === 'predator' ? 2 : 3,
        age: 0, dna: { speed, sense, metabolism, hueShift: 0 }, lineageCapsuleId: sourceId, foundryGrace: 12,
      };
      if (capsule.guild === 'grazer') c.agent.set(entityId, organism);
      else if (capsule.guild === 'predator') c.predator.set(entityId, organism);
      else c.apex.set(entityId, { ...organism, rest: 0 });
      organismSpecies.set(entityId, id);
      inheritSpeciesTraits(organism, spec);
    }
    if (spec.parentId) ancestry.push({ parentId: spec.parentId, childId: id, time: world.tick });
    recount();
    emit('Lineage released', `${spec.name} entered Nysa as a ${spec.guild} lineage.`);
    return { ...spec };
  }

  function emit(title, description) {
    options.journal?.record(title, description, title.includes('extinction') ? 'extinction' : title.includes('species') ? 'lineage' : 'ecology');
    globalThis.window?.dispatchEvent?.(new CustomEvent('biosphere-event', { detail: { title, description } }));
  }

  function sphericalDistance(a, b) {
    const dx = Math.min(Math.abs(a.x - b.x), world.width - Math.abs(a.x - b.x));
    return Math.hypot(dx, a.y - b.y);
  }

  return {
    step,
    getSpeciesForEntity,
    getNearbySpecies,
    getSpecies: () => [...species.values()].map(s => ({ ...s })),
    getAncestry: () => ancestry.slice(),
    getTraitCards,
    releaseLineage,
    setSeasonalResources: value => { seasonalResources = value; },
  };
}

function generateSpeciesName(guild, index) {
  const prefixes = ['Frost', 'River', 'Dune', 'Moss', 'Storm', 'Cinder', 'Silver', 'Shadow', 'Sun', 'Marsh'];
  const suffixes = guild === 'grazer' ? ['Grazer', 'Runner', 'Browser', 'Hopper'] : guild === 'predator' ? ['Stalker', 'Hunter', 'Fang', 'Prowler'] : ['Crown', 'Titan', 'Maw', 'Warden'];
  return `${prefixes[index % prefixes.length]} ${suffixes[(index * 3) % suffixes.length]}`;
}

function mutateColor(color, random) {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  const shift = () => Math.round(clamp((random() - 0.5) * 70, -40, 40));
  return (clamp(r + shift(), 25, 255) << 16) | (clamp(g + shift(), 25, 255) << 8) | clamp(b + shift(), 25, 255);
}

function hueFromColor(color) {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const hue = max === r ? (g - b) / (max - min) : max === g ? 2 + (b - r) / (max - min) : 4 + (r - g) / (max - min);
  return Math.round((hue * 60 + 360) % 360);
}

function wrappedDelta(a, b, width) {
  let d = b - a;
  if (d > width / 2) d -= width;
  if (d < -width / 2) d += width;
  return d;
}

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
