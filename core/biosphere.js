import { samplePlanet } from './planet.js';

const SPECIATION_INTERVAL = 12;
const MIN_SPECIATION_POPULATION = 5;
const ISOLATION_THRESHOLD = 0.52;
const STRONG_ISOLATION_THRESHOLD = 0.72;
const REQUIRED_ISOLATION_CYCLES = 2;
const SPECIATION_COOLDOWN = 36;
const FOUNDER_FORMS = ['beetle', 'crawler', 'hopper', 'kite', 'glider', 'serpent', 'tripod', 'orb'];

const GUILD_STYLE = Object.freeze({
  grazer: { color: 0x69d8ff, social: 0.72, resistance: 0.58 },
  predator: { color: 0xff705e, social: 0.44, resistance: 0.66 },
  apex: { color: 0xcf8dff, social: 0.24, resistance: 0.76 },
});

export function createBiosphere(world, rng = Math.random, options = {}) {
  const random = typeof rng === 'function' ? rng : rng.float.bind(rng);
  const species = new Map();
  const organismSpecies = new Map();
  const ancestry = [];
  const isolationMemory = new Map();
  const lastSpeciationAt = new Map();

  let clock = 0;
  let diseaseClock = 0;
  let speciationClock = 0;
  let previousPopulation = new Map();
  let seasonalResources = options.seasonalResources || null;

  seedFounderRadiation();
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

    if (speciationClock >= SPECIATION_INTERVAL) {
      speciationClock = 0;
      speciationCycle();
      populationEvents();
    }
  }

  // Initial biodiversity is inferred from the organisms that actually exist.
  // Spatial position, inherited DNA, and local climate determine founder clusters.
  // There is no fixed "one species per trophic guild" table.
  function seedFounderRadiation() {
    const c = world.ecs.components;
    const groups = [
      [c.agent, 'grazer'],
      [c.predator, 'predator'],
      [c.apex, 'apex'],
    ];

    for (const [group, guild] of groups) {
      const ids = [...group.keys()].filter(id => c.position.has(id));
      if (!ids.length) continue;

      const founderCount = Math.max(1, Math.min(ids.length, Math.round(Math.sqrt(ids.length / 2))));
      const clusters = clusterFounders(ids, founderCount);

      for (let index = 0; index < clusters.length; index += 1) {
        const members = clusters[index];
        if (!members.length) continue;
        const spec = founderSpecies(guild, members, index);
        species.set(spec.id, spec);

        for (const id of members) {
          organismSpecies.set(id, spec.id);
          const organism = getOrganism(id);
          if (organism) inheritSpeciesTraits(organism, spec);
        }
      }
    }
  }

  function clusterFounders(ids, count) {
    if (count <= 1) return [ids.slice()];

    const seeds = [ids[0]];
    while (seeds.length < count) {
      let bestId = null;
      let bestDistance = -Infinity;
      for (const id of ids) {
        if (seeds.includes(id)) continue;
        const nearest = Math.min(...seeds.map(seedId => organismDistance(id, seedId)));
        if (nearest > bestDistance) {
          bestDistance = nearest;
          bestId = id;
        }
      }
      if (bestId == null) break;
      seeds.push(bestId);
    }

    const clusters = seeds.map(() => []);
    for (const id of ids) {
      let best = 0;
      let bestDistance = Infinity;
      for (let index = 0; index < seeds.length; index += 1) {
        const d = organismDistance(id, seeds[index]);
        if (d < bestDistance) {
          bestDistance = d;
          best = index;
        }
      }
      clusters[best].push(id);
    }

    return clusters.filter(cluster => cluster.length);
  }

  function organismDistance(aId, bId) {
    const c = world.ecs.components;
    const aPos = c.position.get(aId);
    const bPos = c.position.get(bId);
    const a = getOrganism(aId);
    const b = getOrganism(bId);
    if (!aPos || !bPos) return 0;

    const spatial = clamp(sphericalDistance(aPos, bPos) / 260, 0, 1.5);
    const trait = dnaDistance(a, b);
    const aClimate = samplePlanet(aPos.x, aPos.y, world.width, world.height);
    const bClimate = samplePlanet(bPos.x, bPos.y, world.width, world.height);
    const climate = environmentDistance(aClimate, bClimate);
    return spatial * 0.58 + trait * 0.27 + climate * 0.15;
  }

  function founderSpecies(guild, members, index) {
    const profile = populationProfile(members);
    const style = GUILD_STYLE[guild] || GUILD_STYLE.grazer;
    const key = `${world.seed || 'world'}|${guild}|${Math.round(profile.centroid.x)}|${Math.round(profile.centroid.y)}|${index}`;
    const hash = hashText(key);
    const id = `founder-${guild}-${hash.toString(36)}`;
    return {
      id,
      name: founderName(guild, hash, profile.environment),
      guild,
      color: mutateColorDeterministic(style.color, hash),
      temp: clamp(profile.preferredTemperature, 0.08, 0.92),
      social: clamp(profile.sociality || style.social, 0.05, 0.95),
      diseaseResistance: clamp(profile.diseaseResistance || style.resistance, 0.2, 0.95),
      parentId: null,
      generation: 0,
      population: members.length,
      visualForm: FOUNDER_FORMS[(hash >>> 4) % FOUNDER_FORMS.length],
      origin: {
        kind: 'natural-founder',
        tick: world.tick,
        x: round(profile.centroid.x),
        y: round(profile.centroid.y),
        members: members.length,
      },
    };
  }

  function assignUnclassifiedOrganisms() {
    const c = world.ecs.components;
    const groups = [
      [c.agent, 'grazer'],
      [c.predator, 'predator'],
      [c.apex, 'apex'],
    ];

    for (const [group, guild] of groups) {
      for (const [id, organism] of group) {
        if (organismSpecies.has(id)) continue;

        const parent = nearestClassified(id, guild, 95);
        let speciesId = parent ? organismSpecies.get(parent) : bestMatchingSpecies(id, guild);

        if (!speciesId) {
          const spec = founderSpecies(guild, [id], species.size);
          species.set(spec.id, spec);
          speciesId = spec.id;
        }

        organismSpecies.set(id, speciesId);
        inheritSpeciesTraits(organism, species.get(speciesId));
      }
    }

    for (const id of [...organismSpecies.keys()]) {
      if (!c.position.has(id)) organismSpecies.delete(id);
    }
  }

  function bestMatchingSpecies(id, guild) {
    const organism = getOrganism(id);
    const position = world.ecs.components.position.get(id);
    if (!organism || !position) return null;
    const climate = samplePlanet(position.x, position.y, world.width, world.height);

    let best = null;
    let bestCost = Infinity;
    for (const spec of species.values()) {
      if (spec.guild !== guild || spec.population <= 0) continue;
      const organismTrait = organism.dna || {};
      const traitCost =
        Math.abs(finite(organismTrait.speed, 1) - finite(spec.meanDna?.speed, 1)) +
        Math.abs(finite(organismTrait.sense, 1) - finite(spec.meanDna?.sense, 1)) +
        Math.abs(finite(organismTrait.metabolism, 1) - finite(spec.meanDna?.metabolism, 1));
      const climateCost = Math.abs(finite(climate.temperature) - finite(spec.temp));
      const cost = traitCost * 0.35 + climateCost * 1.2;
      if (cost < bestCost) {
        bestCost = cost;
        best = spec.id;
      }
    }
    return best;
  }

  function inheritSpeciesTraits(organism, spec) {
    if (!organism || !spec) return;
    organism.speciesId = spec.id;
    organism.preferredTemperature ??= spec.temp;
    organism.diseaseResistance ??= spec.diseaseResistance;
    organism.sociality ??= spec.social;
    if (spec.lineageCapsuleId && !organism.lineageCapsuleId) organism.lineageCapsuleId = spec.lineageCapsuleId;
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
      if (d < bestD) {
        bestD = d;
        best = otherId;
      }
    }
    return best;
  }

  function applySocialMigration(dt) {
    const c = world.ecs.components;
    const centers = speciesCenters();

    for (const [id, speciesId] of organismSpecies) {
      const spec = species.get(speciesId);
      const pos = c.position.get(id);
      const vel = c.velocity.get(id);
      const organism = getOrganism(id);
      if (!spec || !pos || !vel || !organism) continue;

      const climate = samplePlanet(pos.x, pos.y, world.width, world.height);
      const tempStress = Math.abs(finite(climate.temperature) - finite(organism.preferredTemperature, spec.temp));
      if (tempStress > 0.2) {
        const northOrSouth =
          climate.temperature > spec.temp
            ? (pos.y < world.height / 2 ? -1 : 1)
            : (pos.y < world.height / 2 ? 1 : -1);
        vel.vy += northOrSouth * 3.2 * dt;
      }

      if ((organism.sociality ?? spec.social) > 0.5) {
        const center = centers.get(speciesId);
        if (center) {
          const dx = wrappedDelta(pos.x, center.x, world.width);
          const dy = center.y - pos.y;
          if (Math.hypot(dx, dy) < 110) {
            vel.vx += dx * 0.012 * dt;
            vel.vy += dy * 0.012 * dt;
          }
        }
      }
    }
  }

  function speciesCenters() {
    const accum = new Map();
    const c = world.ecs.components;

    for (const [id, speciesId] of organismSpecies) {
      const pos = c.position.get(id);
      if (!pos) continue;
      let item = accum.get(speciesId);
      if (!item) {
        item = { sin: 0, cos: 0, y: 0, n: 0 };
        accum.set(speciesId, item);
      }
      const angle = pos.x / world.width * Math.PI * 2;
      item.sin += Math.sin(angle);
      item.cos += Math.cos(angle);
      item.y += pos.y;
      item.n += 1;
    }

    const result = new Map();
    for (const [speciesId, item] of accum) {
      const angle = Math.atan2(item.sin / item.n, item.cos / item.n);
      const x = ((angle / (Math.PI * 2)) * world.width + world.width) % world.width;
      result.set(speciesId, { x, y: item.y / item.n });
    }
    return result;
  }

  function applyFoodWebPressure(dt) {
    const c = world.ecs.components;
    const plantCount = [...c.resource.values()].filter(resource => resource.amount > 0.2).length;
    const grazers = c.agent.size;
    const predators = c.predator.size + c.apex.size;
    const grazerPressure = grazers / Math.max(1, plantCount);
    const predatorPressure = predators / Math.max(1, grazers);

    for (const [id, organism] of c.agent) {
      const food = localFood(id);
      organism.resourceOpportunity = food;
      if ('energy' in organism) {
        organism.energy = Math.max(
          0.04,
          organism.energy + dt * (food - 0.5) * 0.003 -
            (grazerPressure > 0.75 ? dt * 0.0015 * grazerPressure : 0),
        );
      }
    }

    for (const group of [c.predator, c.apex]) {
      for (const [id, organism] of group) {
        organism.resourceOpportunity = localFood(id);
        if (predatorPressure > 0.5 && 'energy' in organism) {
          organism.energy = Math.max(0.04, organism.energy - dt * 0.0018 * predatorPressure);
        }
      }
    }
  }

  function diseaseCycle() {
    recount();
    const crowded = [...species.values()].filter(spec => spec.population >= 8);
    if (!crowded.length || random() > 0.34) return;

    const target = crowded[Math.floor(random() * crowded.length)];
    let infected = 0;

    for (const [id, speciesId] of organismSpecies) {
      if (speciesId !== target.id) continue;
      const organism = getOrganism(id);
      if (!organism) continue;
      const resistance = organism.diseaseResistance ?? target.diseaseResistance;
      if (random() > resistance) {
        organism.energy = Math.max(0.05, (organism.energy ?? 1) * 0.72);
        organism.infected = 10 + random() * 15;
        infected += 1;
      }
    }

    if (infected >= 2) {
      emit('Disease outbreak', `${infected} ${target.name.toLowerCase()} individuals were affected by a contagious illness.`);
    }
  }

  function speciationCycle() {
    recount();

    const memberships = new Map();
    for (const [id, speciesId] of organismSpecies) {
      let members = memberships.get(speciesId);
      if (!members) {
        members = [];
        memberships.set(speciesId, members);
      }
      members.push(id);
    }

    const evaluations = [];
    for (const parent of species.values()) {
      if (parent.population < MIN_SPECIATION_POPULATION) {
        isolationMemory.delete(parent.id);
        continue;
      }
      if (clock - finite(lastSpeciationAt.get(parent.id), -Infinity) < SPECIATION_COOLDOWN) continue;

      const evaluation = evaluateIsolation(parent, memberships.get(parent.id) || []);
      if (!evaluation) continue;

      const previous = isolationMemory.get(parent.id) || { cycles: 0, score: 0 };
      const persistent = evaluation.score >= ISOLATION_THRESHOLD;
      const memory = {
        cycles: persistent ? previous.cycles + 1 : 0,
        score: evaluation.score,
      };
      isolationMemory.set(parent.id, memory);

      if (
        evaluation.score >= STRONG_ISOLATION_THRESHOLD ||
        (evaluation.score >= ISOLATION_THRESHOLD && memory.cycles >= REQUIRED_ISOLATION_CYCLES)
      ) {
        evaluations.push(evaluation);
      }
    }

    if (!evaluations.length) return;
    evaluations.sort((a, b) => b.score - a.score);
    for (const evaluation of evaluations) speciate(evaluation);
  }

  function evaluateIsolation(parent, candidateMembers) {
    const members = candidateMembers.filter(id => world.ecs.components.position.has(id));
    if (members.length < MIN_SPECIATION_POPULATION) return null;

    const first = members[0];
    const seedA = farthestFrom(first, members);
    const seedB = farthestFrom(seedA, members);
    if (seedA === seedB) return null;

    const clusterA = [];
    const clusterB = [];
    for (const id of members) {
      const a = populationDistance(id, seedA);
      const b = populationDistance(id, seedB);
      (a <= b ? clusterA : clusterB).push(id);
    }

    const branch = clusterA.length <= clusterB.length ? clusterA : clusterB;
    const trunk = branch === clusterA ? clusterB : clusterA;
    if (branch.length < 2 || trunk.length < 2) return null;

    const minorityFraction = branch.length / members.length;
    if (minorityFraction < 0.18) return null;

    const branchProfile = populationProfile(branch);
    const trunkProfile = populationProfile(trunk);
    const geographic = clamp(
      sphericalDistance(branchProfile.centroid, trunkProfile.centroid) / Math.max(90, world.width * 0.2),
      0,
      1,
    );
    const trait = profileDnaDistance(branchProfile, trunkProfile);
    const environment = environmentDistance(branchProfile.environment, trunkProfile.environment);
    const thermalPreference = clamp(
      Math.abs(branchProfile.preferredTemperature - trunkProfile.preferredTemperature) / 0.28,
      0,
      1,
    );

    const score = clamp(
      geographic * 0.48 +
      trait * 0.28 +
      environment * 0.16 +
      thermalPreference * 0.08,
      0,
      1,
    );

    return {
      parent,
      branch,
      trunk,
      branchProfile,
      trunkProfile,
      score,
      evidence: {
        geographic: round(geographic),
        trait: round(trait),
        environment: round(environment),
        thermalPreference: round(thermalPreference),
        separation: round(sphericalDistance(branchProfile.centroid, trunkProfile.centroid)),
        branchPopulation: branch.length,
        parentPopulation: members.length,
      },
    };
  }

  function populationDistance(aId, bId) {
    const c = world.ecs.components;
    const aPos = c.position.get(aId);
    const bPos = c.position.get(bId);
    if (!aPos || !bPos) return Infinity;
    const spatial = clamp(sphericalDistance(aPos, bPos) / 220, 0, 1.4);
    const trait = dnaDistance(getOrganism(aId), getOrganism(bId));
    return spatial * 0.7 + trait * 0.3;
  }

  function farthestFrom(seedId, ids) {
    let bestId = seedId;
    let best = -Infinity;
    for (const id of ids) {
      const d = populationDistance(seedId, id);
      if (d > best) {
        best = d;
        bestId = id;
      }
    }
    return bestId;
  }

  function speciate(evaluation) {
    const { parent, branch, branchProfile, score, evidence } = evaluation;
    const sequence = ancestry.filter(item => item.parentId === parent.id).length + 1;
    const key = `${parent.id}|${world.tick}|${sequence}|${Math.round(branchProfile.centroid.x)}|${Math.round(branchProfile.centroid.y)}`;
    const hash = hashText(key);
    const id = `${parent.id}-branch-${hash.toString(36)}`;

    const child = {
      id,
      name: descendantName(parent, hash, branchProfile.environment),
      guild: parent.guild,
      color: mutateColorDeterministic(parent.color, hash),
      temp: clamp(branchProfile.preferredTemperature, 0.08, 0.92),
      social: clamp(branchProfile.sociality || parent.social, 0.05, 0.95),
      diseaseResistance: clamp(branchProfile.diseaseResistance || parent.diseaseResistance, 0.2, 0.95),
      parentId: parent.id,
      generation: finite(parent.generation) + 1,
      population: branch.length,
      visualForm: parent.visualForm || FOUNDER_FORMS[(hash >>> 7) % FOUNDER_FORMS.length],
      lineageCapsuleId: parent.lineageCapsuleId || null,
      meanDna: { ...branchProfile.meanDna },
      origin: {
        kind: 'natural-speciation',
        tick: world.tick,
        x: round(branchProfile.centroid.x),
        y: round(branchProfile.centroid.y),
        isolationScore: round(score),
        evidence: { ...evidence },
      },
    };

    species.set(id, child);
    for (const entityId of branch) {
      organismSpecies.set(entityId, id);
      const organism = getOrganism(entityId);
      if (organism) inheritSpeciesTraits(organism, child);
    }

    ancestry.push({
      parentId: parent.id,
      childId: id,
      time: world.tick,
      mechanism: 'geographic-trait-environmental-isolation',
      isolationScore: round(score),
      evidence: { ...evidence },
    });

    lastSpeciationAt.set(parent.id, clock);
    lastSpeciationAt.set(id, clock);
    isolationMemory.delete(parent.id);
    isolationMemory.delete(id);
    recount();

    emit(
      'New species',
      `${child.name} naturally diverged from ${parent.name}: isolation ${percent(score)}, ` +
      `${Math.round(evidence.separation * kilometresPerModelUnit())} km between subpopulations, ` +
      `with measurable trait and habitat divergence.`,
    );
  }

  function populationProfile(ids) {
    const c = world.ecs.components;
    const centroid = wrappedCentroid(ids.map(id => c.position.get(id)).filter(Boolean));
    const environments = [];
    let speed = 0;
    let sense = 0;
    let metabolism = 0;
    let preferredTemperature = 0;
    let sociality = 0;
    let diseaseResistance = 0;
    let samples = 0;

    for (const id of ids) {
      const pos = c.position.get(id);
      const organism = getOrganism(id);
      if (!pos || !organism) continue;
      const dna = organism.dna || {};
      speed += finite(dna.speed, 1);
      sense += finite(dna.sense, 1);
      metabolism += finite(dna.metabolism, 1);
      preferredTemperature += finite(organism.preferredTemperature, samplePlanet(pos.x, pos.y, world.width, world.height).temperature);
      sociality += finite(organism.sociality, 0.5);
      diseaseResistance += finite(organism.diseaseResistance, 0.6);
      environments.push(samplePlanet(pos.x, pos.y, world.width, world.height));
      samples += 1;
    }

    const count = Math.max(1, samples);
    return {
      centroid,
      meanDna: {
        speed: speed / count,
        sense: sense / count,
        metabolism: metabolism / count,
      },
      preferredTemperature: preferredTemperature / count,
      sociality: sociality / count,
      diseaseResistance: diseaseResistance / count,
      environment: meanEnvironment(environments),
    };
  }

  function wrappedCentroid(positions) {
    if (!positions.length) return { x: world.width * 0.5, y: world.height * 0.5 };
    let sin = 0;
    let cos = 0;
    let y = 0;

    for (const pos of positions) {
      const angle = pos.x / world.width * Math.PI * 2;
      sin += Math.sin(angle);
      cos += Math.cos(angle);
      y += pos.y;
    }

    const angle = Math.atan2(sin / positions.length, cos / positions.length);
    return {
      x: ((angle / (Math.PI * 2)) * world.width + world.width) % world.width,
      y: y / positions.length,
    };
  }

  function meanEnvironment(values) {
    if (!values.length) return { temperature: 0.5, rainfall: 0.5, elevation: 0.5, biome: 'wildland' };
    const mean = key => values.reduce((sum, value) => sum + finite(value?.[key]), 0) / values.length;
    const biomeCounts = new Map();
    for (const value of values) {
      const biome = String(value?.biome || 'wildland');
      biomeCounts.set(biome, (biomeCounts.get(biome) || 0) + 1);
    }
    const biome = [...biomeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'wildland';
    return {
      temperature: mean('temperature'),
      rainfall: mean('rainfall'),
      elevation: mean('elevation'),
      biome,
    };
  }

  function dnaDistance(a, b) {
    const ad = a?.dna || {};
    const bd = b?.dna || {};
    const speed = Math.abs(finite(ad.speed, 1) - finite(bd.speed, 1)) / 0.8;
    const sense = Math.abs(finite(ad.sense, 1) - finite(bd.sense, 1)) / 0.9;
    const metabolism = Math.abs(finite(ad.metabolism, 1) - finite(bd.metabolism, 1)) / 1.0;
    return clamp((speed + sense + metabolism) / 3, 0, 1);
  }

  function profileDnaDistance(a, b) {
    const speed = Math.abs(a.meanDna.speed - b.meanDna.speed) / 0.8;
    const sense = Math.abs(a.meanDna.sense - b.meanDna.sense) / 0.9;
    const metabolism = Math.abs(a.meanDna.metabolism - b.meanDna.metabolism) / 1.0;
    return clamp((speed + sense + metabolism) / 3, 0, 1);
  }

  function environmentDistance(a, b) {
    const temperature = Math.abs(finite(a?.temperature) - finite(b?.temperature)) / 0.35;
    const rainfall = Math.abs(finite(a?.rainfall) - finite(b?.rainfall)) / 0.7;
    const elevation = Math.abs(finite(a?.elevation) - finite(b?.elevation)) / 0.7;
    const biome = a?.biome && b?.biome && a.biome !== b.biome ? 1 : 0;
    return clamp(temperature * 0.4 + rainfall * 0.24 + elevation * 0.16 + biome * 0.2, 0, 1);
  }

  function populationEvents() {
    recount();
    for (const spec of species.values()) {
      const before = previousPopulation.get(spec.id) ?? spec.population;
      if (before >= 3 && spec.population === 0) {
        emit('Species extinction', `${spec.name} has disappeared from the planet.`);
      } else if (before > 0 && spec.population >= before * 1.7 && spec.population - before >= 3) {
        emit('Species expansion', `${spec.name} rapidly expanded into new habitat.`);
      }
      previousPopulation.set(spec.id, spec.population);
    }
  }

  function recount() {
    for (const spec of species.values()) spec.population = 0;
    const memberships = new Map();

    for (const [id, speciesId] of organismSpecies) {
      const spec = species.get(speciesId);
      if (!spec) continue;
      spec.population += 1;
      let ids = memberships.get(speciesId);
      if (!ids) {
        ids = [];
        memberships.set(speciesId, ids);
      }
      ids.push(id);
    }

    for (const [speciesId, ids] of memberships) {
      const spec = species.get(speciesId);
      if (spec && ids.length) spec.meanDna = populationProfile(ids).meanDna;
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

    for (const [id, speciesId] of organismSpecies) {
      const pos = c.position.get(id);
      if (!pos || sphericalDistance(pos, { x, y }) > radius) continue;
      counts.set(speciesId, (counts.get(speciesId) || 0) + 1);
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
        const average = key =>
          members.reduce((sum, organism) => sum + (organism.dna?.[key] ?? 1), 0) /
          Math.max(1, members.length);
        const thermal =
          members.reduce((sum, organism) => sum + (organism.preferredTemperature ?? spec.temp), 0) /
          Math.max(1, members.length);

        return {
          id: spec.id,
          name: spec.name,
          guild: spec.guild,
          color: spec.color,
          population: spec.population,
          generation: spec.generation,
          origin: spec.origin || null,
          traits: {
            speed: average('speed'),
            sense: average('sense'),
            metabolism: average('metabolism'),
            thermal,
          },
        };
      });
  }

  // Foundry capsules remain declarative. Once released, they participate in the
  // same unlimited natural speciation process as native founder lineages.
  function releaseLineage(capsule, placement = {}) {
    if (!capsule || !['grazer', 'predator', 'apex'].includes(capsule.guild)) {
      throw new Error('Invalid lineage guild.');
    }

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
      meanDna: { speed, sense, metabolism },
      origin: { kind: 'foundry-release', tick: world.tick },
    };

    species.set(id, spec);

    const c = world.ecs.components;
    const x = ((Number(placement.x) || world.width * 0.5) % world.width + world.width) % world.width;
    const y = clamp(Number(placement.y) || world.height * 0.5, 0, world.height);
    const count = clamp(Math.round(Number(placement.count) || 5), 3, 8);

    for (let index = 0; index < count; index += 1) {
      const entityId = world.ecs.createEntity();
      const angle = random() * Math.PI * 2;
      const radius = 4 + random() * 18;
      c.position.set(entityId, {
        x: (x + Math.cos(angle) * radius + world.width) % world.width,
        y: clamp(y + Math.sin(angle) * radius, 0, world.height),
      });

      const velocity = 28 * speed * (0.7 + random() * 0.5);
      c.velocity.set(entityId, { vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity });

      const organism = {
        colorHue: hueFromColor(color),
        energy: capsule.guild === 'grazer' ? 1 : capsule.guild === 'predator' ? 2 : 3,
        age: 0,
        dna: { speed, sense, metabolism, hueShift: 0 },
        lineageCapsuleId: sourceId,
        foundryGrace: 12,
      };

      if (capsule.guild === 'grazer') c.agent.set(entityId, organism);
      else if (capsule.guild === 'predator') c.predator.set(entityId, organism);
      else c.apex.set(entityId, { ...organism, rest: 0 });

      organismSpecies.set(entityId, id);
      inheritSpeciesTraits(organism, spec);
    }

    if (spec.parentId) {
      ancestry.push({
        parentId: spec.parentId,
        childId: id,
        time: world.tick,
        mechanism: 'foundry-release',
      });
    }

    recount();
    emit('Lineage released', `${spec.name} entered Eidolon as a ${spec.guild} lineage.`);
    return { ...spec };
  }

  function emit(title, description) {
    options.journal?.record(
      title,
      description,
      title.toLowerCase().includes('extinction')
        ? 'extinction'
        : title.toLowerCase().includes('species')
          ? 'lineage'
          : 'ecology',
    );
    globalThis.window?.dispatchEvent?.(
      new CustomEvent('biosphere-event', { detail: { title, description } }),
    );
  }

  function sphericalDistance(a, b) {
    const raw = Math.abs(a.x - b.x);
    const dx = Math.min(raw, world.width - raw);
    return Math.hypot(dx, a.y - b.y);
  }

  function kilometresPerModelUnit() {
    return finite(world.geography?.kilometresPerModelUnit, 100);
  }

  return {
    step,
    getSpeciesForEntity,
    getNearbySpecies,
    getSpecies: () => [...species.values()].map(spec => ({ ...spec })),
    getAncestry: () => ancestry.map(branch => ({ ...branch })),
    getTraitCards,
    releaseLineage,
    setSeasonalResources: value => { seasonalResources = value; },
  };
}

function founderName(guild, hash, environment) {
  const habitat = habitatWord(environment);
  const roots = ['Aru', 'Vel', 'Keth', 'Mori', 'Seln', 'Tala', 'Iri', 'Naru', 'Oru', 'Vesh', 'Kora', 'Lume'];
  const guildWords = guild === 'grazer'
    ? ['browser', 'runner', 'grazer', 'hopper']
    : guild === 'predator'
      ? ['stalker', 'hunter', 'fang', 'prowler']
      : ['warden', 'crown', 'maw', 'titan'];
  return `${habitat} ${roots[hash % roots.length]} ${guildWords[(hash >>> 5) % guildWords.length]}`;
}

function descendantName(parent, hash, environment) {
  const habitat = habitatWord(environment);
  const endings = ['kin', 'runner', 'wing', 'crawler', 'strider', 'morph', 'drifter', 'back'];
  const parentRoot = String(parent.name || 'Lineage').split(/\s+/).slice(-2, -1)[0] || 'Lineage';
  return `${habitat} ${parentRoot}${endings[(hash >>> 3) % endings.length]}`;
}

function habitatWord(environment) {
  const biome = String(environment?.biome || '').toLowerCase();
  if (biome.includes('desert') || finite(environment?.rainfall) < 0.22) return 'Dune';
  if (biome.includes('tundra') || finite(environment?.temperature) < 0.22) return 'Frost';
  if (biome.includes('wet') || biome.includes('marsh') || finite(environment?.rainfall) > 0.72) return 'Marsh';
  if (biome.includes('forest')) return 'Moss';
  if (finite(environment?.elevation) > 0.72) return 'Ridge';
  if (finite(environment?.temperature) > 0.74) return 'Sun';
  return 'Wild';
}

function mutateColorDeterministic(color, hash) {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  const shift = channel => (((hash >>> channel) & 31) - 15) * 3;
  return (
    (clamp(Math.round(r + shift(0)), 25, 255) << 16) |
    (clamp(Math.round(g + shift(5)), 25, 255) << 8) |
    clamp(Math.round(b + shift(10)), 25, 255)
  );
}

function hueFromColor(color) {
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const hue =
    max === r
      ? (g - b) / (max - min)
      : max === g
        ? 2 + (b - r) / (max - min)
        : 4 + (r - g) / (max - min);
  return Math.round((hue * 60 + 360) % 360);
}

function hashText(value) {
  let hash = 2166136261;
  const text = String(value ?? '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function percent(value) {
  return `${Math.round(clamp(finite(value), 0, 1) * 100)}%`;
}

function round(value) {
  return Math.round(finite(value) * 1000) / 1000;
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function wrappedDelta(a, b, width) {
  let d = b - a;
  if (d > width / 2) d -= width;
  if (d < -width / 2) d += width;
  return d;
}

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
