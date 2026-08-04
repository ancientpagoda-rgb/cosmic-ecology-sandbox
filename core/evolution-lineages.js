const ROLES = ['agent', 'predator', 'apex'];
const ROLE_LABEL = { agent: 'grazer', predator: 'predator', apex: 'apex' };
const BASE_SPEED = { agent: 34, predator: 48, apex: 31 };
const ENERGY_BIRTH = { agent: 1.48, predator: 2.55, apex: 3.05 };
const CHILD_ENERGY = { agent: 0.72, predator: 1.25, apex: 1.65 };

export function createEvolutionLedger(world, options = {}) {
  const mobile = Boolean(options.mobile);
  const rng = mulberry32(options.seed ?? 0xE601A6);
  const ancestry = new Map();
  const species = new Map();
  const structures = new Map();
  const living = new Map();
  let savedCreatures = [];
  let reproductionClock = 0;
  let cultureClock = 0;
  let elapsed = 0;
  let births = 0;
  let deaths = 0;
  let speciations = 0;
  let settlements = 0;
  let nextCreatureId = 1;
  let nextSpeciesId = 1;
  let nextStructureId = 1;

  const caps = mobile
    ? { agent: 48, predator: 14, apex: 4 }
    : { agent: 92, predator: 26, apex: 7 };

  function step(dt, sampleNiche) {
    elapsed += Math.max(0, dt);
    reproductionClock += dt;
    cultureClock += dt;
    synchronize(sampleNiche);
    applyMortality(dt);

    if (reproductionClock >= 0.8) {
      const cycles = Math.min(2, Math.floor(reproductionClock / 0.8));
      reproductionClock -= cycles * 0.8;
      for (let index = 0; index < cycles; index++) reproduce(sampleNiche);
    }

    if (cultureClock >= 1.8) {
      const amount = cultureClock;
      cultureClock = 0;
      evolveCulture(amount, sampleNiche);
    }
  }

  function synchronize(sampleNiche) {
    const seen = new Set();
    for (const role of ROLES) {
      const map = world.ecs.components[role];
      for (const [entityId, component] of map.entries()) {
        const position = world.ecs.components.position.get(entityId);
        if (!position) continue;
        seen.add(entityId);
        let record = living.get(entityId);
        if (!record) record = registerCreature(entityId, role, component, position, sampleNiche);
        record.component = component;
        record.position = position;
        component.age = 0;
        component.generation = record.genome.generation;
        component.embodiment = record.genome;
        record.lastEnergy = component.energy ?? record.lastEnergy ?? 1;
      }
    }

    for (const [entityId, record] of living.entries()) {
      if (seen.has(entityId)) continue;
      living.delete(entityId);
      deaths++;
      const node = ancestry.get(record.creatureId);
      if (node && node.diedAt == null) {
        node.diedAt = elapsed;
        node.death = record.lastEnergy <= 0.06 ? 'starvation' : 'predation-or-ecological-loss';
      }
    }
    refreshSpeciesStatistics(sampleNiche);
  }

  function registerCreature(entityId, role, component, position, sampleNiche) {
    const restored = takeSavedCreature(role, position);
    const genome = normalizeGenome(
      restored?.genome || component.embodiment || createFounderGenome(component.dna, role, rng),
      role,
    );
    const creatureId = restored?.creatureId || component.creatureId || `c${nextCreatureId++}`;
    component.creatureId = creatureId;

    if (!genome.speciesId || !species.has(genome.speciesId)) {
      genome.speciesId = rootSpecies(role, genome, position, sampleNiche);
    }
    genome.birthX ??= position.x;
    genome.birthY ??= position.y;
    genome.lifeAge ??= rng() * genome.maturity * 0.7;
    genome.cooldown ??= rng() * 6;

    const record = {
      entityId,
      creatureId,
      role,
      component,
      position,
      genome,
      lastEnergy: component.energy ?? 1,
      starvation: 0,
    };
    living.set(entityId, record);

    if (!ancestry.has(creatureId)) {
      ancestry.set(creatureId, restored?.ancestry || {
        id: creatureId,
        role,
        speciesId: genome.speciesId,
        parents: genome.parents || [],
        generation: genome.generation,
        bornAt: genome.bornAt ?? elapsed,
        birthX: genome.birthX,
        birthY: genome.birthY,
        diedAt: null,
        death: null,
      });
    }
    return record;
  }

  function rootSpecies(role, genome, position, sampleNiche) {
    const existing = [...species.values()].find(item => item.role === role && item.parentSpeciesId == null);
    if (existing) return existing.id;
    const id = `${ROLE_LABEL[role]}-${nextSpeciesId++}`;
    species.set(id, {
      id,
      role,
      parentSpeciesId: null,
      founderCreatureId: null,
      foundedAt: elapsed,
      extinctAt: null,
      centroidX: position.x,
      centroidY: position.y,
      niche: sampleNiche?.(position.x, position.y) || defaultNiche(),
      meanGenome: compactGenome(genome),
      members: 0,
      births: 0,
      deaths: 0,
      culture: baseCulture(),
    });
    return id;
  }

  function applyMortality(dt) {
    const crowd = countRoles();
    for (const [entityId, record] of [...living.entries()]) {
      const { genome, component, role } = record;
      genome.lifeAge += dt;
      genome.cooldown = Math.max(0, genome.cooldown - dt);
      component.age = 0;

      const energy = component.energy ?? 1;
      if (energy <= 0.055) record.starvation += dt;
      else record.starvation = Math.max(0, record.starvation - dt * 0.6);

      const overCapacity = Math.max(0, crowd[role] - caps[role]);
      const senescence = Math.max(0, (genome.lifeAge - genome.lifespan * 0.82) / Math.max(1, genome.lifespan * 0.18));
      const ageDeath = genome.lifeAge > genome.lifespan && rng() < clamp(dt * (0.08 + senescence * 0.18), 0, 0.5);
      const hungerDeath = record.starvation > (role === 'agent' ? 18 : 8);
      const crowdDeath = overCapacity > 0 && rng() < dt * overCapacity / Math.max(12, caps[role]) * 0.035;
      if (!ageDeath && !hungerDeath && !crowdDeath) continue;

      world.ecs.destroyEntity(entityId);
      living.delete(entityId);
      deaths++;
      const node = ancestry.get(record.creatureId);
      if (node) {
        node.diedAt = elapsed;
        node.death = hungerDeath ? 'starvation' : ageDeath ? 'senescence' : 'density-pressure';
      }
    }
  }

  function reproduce(sampleNiche) {
    const counts = countRoles();
    const candidates = [...living.values()]
      .filter(record => isMateReady(record, counts))
      .sort((a, b) => mateFitness(b) - mateFitness(a));
    const used = new Set();
    let budget = mobile ? 1 : 3;

    for (const parentA of candidates) {
      if (!budget || used.has(parentA.entityId)) break;
      const parentB = chooseMate(parentA, candidates, used);
      if (!parentB) continue;
      const fertility = clamp(
        ((parentA.component.energy || 0) + (parentB.component.energy || 0)) /
        (ENERGY_BIRTH[parentA.role] * 2.8),
        0.12,
        0.92,
      );
      const populationPressure = clamp(1 - counts[parentA.role] / caps[parentA.role], 0.05, 1);
      const socialSupport = 0.55 + (parentA.genome.social + parentB.genome.social) * 0.22;
      if (rng() > fertility * populationPressure * socialSupport) continue;

      spawnChild(parentA, parentB, sampleNiche);
      used.add(parentA.entityId);
      used.add(parentB.entityId);
      counts[parentA.role]++;
      budget--;
    }
  }

  function isMateReady(record, counts) {
    const { genome, component, role } = record;
    return counts[role] < caps[role]
      && genome.lifeAge >= genome.maturity
      && genome.lifeAge < genome.lifespan * 0.82
      && genome.cooldown <= 0
      && (component.energy || 0) >= ENERGY_BIRTH[role];
  }

  function chooseMate(parent, candidates, used) {
    let best = null;
    let bestScore = -Infinity;
    for (const candidate of candidates) {
      if (candidate.entityId === parent.entityId || used.has(candidate.entityId)) continue;
      if (candidate.role !== parent.role || candidate.genome.sex === parent.genome.sex) continue;
      const distance = torusDistance(parent.position, candidate.position, world.width, world.height);
      if (distance > 92 * 92) continue;
      const geneticDistance = genomeDistance(parent.genome, candidate.genome);
      if (geneticDistance > 0.46) continue;
      const sameSpecies = parent.genome.speciesId === candidate.genome.speciesId ? 0.34 : 0;
      const health = clamp((candidate.component.energy || 0) / ENERGY_BIRTH[parent.role], 0, 1.4);
      const display = candidate.genome.display * 0.32 + candidate.genome.communication * 0.18;
      const complement = 0.24 - Math.abs(geneticDistance - 0.12);
      const score = sameSpecies + health * 0.32 + display + complement + rng() * 0.08;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
  }

  function spawnChild(parentA, parentB, sampleNiche) {
    const role = parentA.role;
    const midpoint = torusMidpoint(parentA.position, parentB.position, world.width, world.height);
    const position = {
      x: wrap(midpoint.x + (rng() - 0.5) * 8, world.width),
      y: clamp(midpoint.y + (rng() - 0.5) * 8, 0, world.height),
    };
    const childGenome = crossover(parentA.genome, parentB.genome, role, rng);
    childGenome.parents = [parentA.creatureId, parentB.creatureId];
    childGenome.generation = Math.max(parentA.genome.generation, parentB.genome.generation) + 1;
    childGenome.bornAt = elapsed;
    childGenome.birthX = position.x;
    childGenome.birthY = position.y;
    childGenome.lifeAge = 0;
    childGenome.cooldown = childGenome.maturity + 2;
    childGenome.speciesId = resolveChildSpecies(childGenome, parentA, parentB, position, sampleNiche);

    const entityId = world.ecs.createEntity();
    const angle = rng() * Math.PI * 2;
    const speed = BASE_SPEED[role] * childGenome.speed * 0.45;
    world.ecs.components.position.set(entityId, position);
    world.ecs.components.velocity.set(entityId, {
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
    });
    const component = {
      colorHue: childGenome.hue,
      energy: CHILD_ENERGY[role],
      age: 0,
      rest: 0,
      dna: {
        speed: childGenome.speed,
        sense: childGenome.sense,
        metabolism: childGenome.metabolism,
        hueShift: Math.round(childGenome.hue - roleBaseHue(role)),
      },
      embodiment: childGenome,
      generation: childGenome.generation,
      preferredTemperature: childGenome.preferredTemperature,
      diseaseResistance: childGenome.resistance,
      sociality: childGenome.social,
      origin: 'sexual-natural-selection',
    };
    world.ecs.components[role].set(entityId, component);

    parentA.component.energy *= 0.62;
    parentB.component.energy *= 0.68;
    parentA.genome.cooldown = 7 + parentA.genome.metabolism * 4;
    parentB.genome.cooldown = 7 + parentB.genome.metabolism * 4;
    births++;

    const speciesRecord = species.get(childGenome.speciesId);
    if (speciesRecord) speciesRecord.births++;
    emitHistory(
      'Offspring born',
      `${ROLE_LABEL[role]} offspring ${childGenome.generation} inherited traits from ${parentA.genome.speciesId} and ${parentB.genome.speciesId}.`,
    );
  }

  function resolveChildSpecies(child, parentA, parentB, position, sampleNiche) {
    const primaryId = parentA.genome.speciesId;
    const primary = species.get(primaryId);
    if (!primary) return rootSpecies(parentA.role, child, position, sampleNiche);
    const niche = sampleNiche?.(position.x, position.y) || defaultNiche();
    const genetic = genomeDistance(child, primary.meanGenome || parentA.genome);
    const isolation = Math.sqrt(torusDistance(position, primary, world.width, world.height)) / Math.max(world.width, world.height);
    const nicheShift = nicheDistance(niche, primary.niche || defaultNiche());
    const mixedSpecies = parentA.genome.speciesId !== parentB.genome.speciesId ? 0.045 : 0;
    const score = genetic * 1.34 + isolation * 0.78 + nicheShift * 0.72 + mixedSpecies;
    if (score < 0.245) return primaryId;

    const id = `${ROLE_LABEL[parentA.role]}-${nextSpeciesId++}`;
    species.set(id, {
      id,
      role: parentA.role,
      parentSpeciesId: primaryId,
      founderCreatureId: null,
      foundedAt: elapsed,
      extinctAt: null,
      centroidX: position.x,
      centroidY: position.y,
      niche,
      meanGenome: compactGenome(child),
      members: 0,
      births: 1,
      deaths: 0,
      culture: inheritCulture(primary.culture),
    });
    speciations++;
    emitHistory(
      'Speciation',
      `${id} branched from ${primaryId} after genetic change, ecological divergence, and geographic isolation crossed the reproductive threshold.`,
    );
    return id;
  }

  function refreshSpeciesStatistics(sampleNiche) {
    const groups = new Map();
    for (const record of living.values()) {
      const id = record.genome.speciesId;
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(record);
    }

    for (const item of species.values()) {
      const members = groups.get(item.id) || [];
      item.members = members.length;
      if (!members.length) {
        if (item.extinctAt == null && elapsed - item.foundedAt > 5) item.extinctAt = elapsed;
        continue;
      }
      item.extinctAt = null;
      item.centroidX = circularMean(members.map(record => record.position.x), world.width);
      item.centroidY = members.reduce((sum, record) => sum + record.position.y, 0) / members.length;
      item.meanGenome = meanGenome(members.map(record => record.genome));
      item.niche = meanNiche(members.map(record => sampleNiche?.(record.position.x, record.position.y) || defaultNiche()));
    }
  }

  function evolveCulture(dt, sampleNiche) {
    const livingSpecies = [...species.values()].filter(item => item.members > 0);
    for (const item of livingSpecies) {
      const members = [...living.values()].filter(record => record.genome.speciesId === item.id);
      if (!members.length) continue;
      const traits = meanGenome(members.map(record => record.genome));
      const averageEnergy = members.reduce((sum, record) => sum + (record.component.energy || 0), 0) / members.length;
      const scarcity = clamp(1 - averageEnergy / ENERGY_BIRTH[item.role], 0, 1);
      const density = clamp(members.length / (mobile ? 8 : 14), 0, 1.4);
      const threat = item.role === 'agent' ? localThreatPressure(members) : scarcity * 0.45;
      const c = item.culture || (item.culture = baseCulture());

      c.communication += dt * traits.communication * traits.social * density * 0.026;
      c.cooperation += dt * traits.social * (threat + scarcity + 0.12) * 0.018;
      c.nesting += dt * traits.construction * traits.memory * density * 0.019;
      c.tools += dt * traits.intelligence * traits.dexterity * (scarcity + threat + 0.18) * 0.017;
      c.territory += dt * traits.aggression * (density + threat + 0.1) * 0.012;
      c.knowledge += dt * traits.memory * (traits.communication + traits.intelligence) * density * 0.012;

      const center = { x: item.centroidX, y: item.centroidY };
      const niche = sampleNiche?.(center.x, center.y) || defaultNiche();
      if (c.nesting >= 1 && niche.land && !nearStructure(item.id, 'nest', center, 52)) {
        createStructure('nest', item, center, traits);
        c.nesting -= 0.62;
      }
      if (c.tools >= 1 && !nearStructure(item.id, 'tool-cache', center, 70)) {
        createStructure('tool-cache', item, jitterPoint(center, 18), traits);
        c.tools -= 0.58;
      }
      if (c.territory >= 1 && !nearStructure(item.id, 'territory', center, 110)) {
        createStructure('territory', item, center, traits);
        c.territory -= 0.72;
      }

      const nests = [...structures.values()].filter(structure => structure.speciesId === item.id && structure.type === 'nest');
      const settlementsForSpecies = [...structures.values()].filter(structure => structure.speciesId === item.id && structure.type === 'settlement');
      const settlementPressure = c.communication * c.cooperation * c.knowledge * (0.45 + c.tools) * density;
      if (
        nests.length >= 2 &&
        members.length >= 4 &&
        traits.intelligence > 0.58 &&
        traits.communication > 0.5 &&
        settlementPressure > 1.25 &&
        settlementsForSpecies.length < Math.max(1, Math.floor(members.length / 12))
      ) {
        createStructure('settlement', item, center, traits);
        c.communication *= 0.76;
        c.cooperation *= 0.78;
        c.knowledge *= 0.82;
        settlements++;
        emitHistory(
          'Emergent settlement',
          `${item.id} concentrated nests, communication, tools, and cooperative memory into a persistent settlement.`,
        );
      }
    }

    for (const structure of structures.values()) {
      const item = species.get(structure.speciesId);
      const support = item?.members || 0;
      structure.population = support;
      structure.progress = clamp(structure.progress + dt * (0.004 + support * 0.0015), 0, 1);
      if (!support) structure.decay = (structure.decay || 0) + dt * 0.012;
      else structure.decay = Math.max(0, (structure.decay || 0) - dt * 0.02);
    }
    for (const [id, structure] of structures.entries()) {
      if ((structure.decay || 0) > 1) structures.delete(id);
    }
  }

  function createStructure(type, speciesRecord, point, traits) {
    const id = `s${nextStructureId++}`;
    structures.set(id, {
      id,
      type,
      speciesId: speciesRecord.id,
      x: wrap(point.x, world.width),
      y: clamp(point.y, 0, world.height),
      foundedAt: elapsed,
      progress: type === 'settlement' ? 0.18 : 0.35,
      decay: 0,
      population: speciesRecord.members,
      intelligence: traits.intelligence,
      communication: traits.communication,
      construction: traits.construction,
    });
    emitHistory(
      type === 'tool-cache' ? 'Tool use' : type === 'territory' ? 'Territory established' : 'Nest constructed',
      `${speciesRecord.id} produced a ${type.replace('-', ' ')} through accumulated ecological pressure and inherited behavior.`,
    );
  }

  function nearStructure(speciesId, type, point, radius) {
    for (const structure of structures.values()) {
      if (structure.speciesId !== speciesId || structure.type !== type) continue;
      if (torusDistance(point, structure, world.width, world.height) < radius * radius) return true;
    }
    return false;
  }

  function localThreatPressure(members) {
    let encounters = 0;
    for (const member of members) {
      for (const candidate of living.values()) {
        if (!['predator', 'apex'].includes(candidate.role)) continue;
        if (torusDistance(member.position, candidate.position, world.width, world.height) < 130 * 130) encounters++;
      }
    }
    return clamp(encounters / Math.max(1, members.length * 2), 0, 1);
  }

  function countRoles() {
    const counts = { agent: 0, predator: 0, apex: 0 };
    for (const record of living.values()) counts[record.role]++;
    return counts;
  }

  function getGenome(entityId) {
    return living.get(entityId)?.genome || null;
  }

  function getRecord(entityId) {
    return living.get(entityId) || null;
  }

  function getStructures() {
    return [...structures.values()].map(value => ({ ...value }));
  }

  function getSpecies() {
    return [...species.values()].map(value => ({
      ...value,
      meanGenome: { ...value.meanGenome },
      niche: { ...value.niche },
      culture: { ...value.culture },
    }));
  }

  function getCommunication(entityId) {
    const record = living.get(entityId);
    if (!record) return 0;
    const culture = species.get(record.genome.speciesId)?.culture;
    return clamp(record.genome.communication * 0.58 + (culture?.communication || 0) * 0.18, 0, 1);
  }

  function getState() {
    return {
      elapsed,
      creatures: living.size,
      counts: countRoles(),
      species: [...species.values()].filter(item => item.members > 0).length,
      totalSpecies: species.size,
      structures: structures.size,
      settlements,
      births,
      deaths,
      speciations,
      maxGeneration: Math.max(0, ...[...living.values()].map(record => record.genome.generation)),
    };
  }

  function save() {
    return {
      version: 2,
      elapsed,
      births,
      deaths,
      speciations,
      settlements,
      nextCreatureId,
      nextSpeciesId,
      nextStructureId,
      creatures: [...living.values()].map(record => ({
        role: record.role,
        x: record.position.x,
        y: record.position.y,
        creatureId: record.creatureId,
        genome: record.genome,
        ancestry: ancestry.get(record.creatureId),
      })),
      species: [...species.values()],
      structures: [...structures.values()],
      ancestry: [...ancestry.values()].slice(-800),
    };
  }

  function load(state) {
    if (!state) return;
    elapsed = Math.max(0, state.elapsed || 0);
    births = Math.max(0, state.births || 0);
    deaths = Math.max(0, state.deaths || 0);
    speciations = Math.max(0, state.speciations || 0);
    settlements = Math.max(0, state.settlements || 0);
    nextCreatureId = Math.max(1, state.nextCreatureId || 1);
    nextSpeciesId = Math.max(1, state.nextSpeciesId || 1);
    nextStructureId = Math.max(1, state.nextStructureId || 1);
    savedCreatures = Array.isArray(state.creatures) ? state.creatures.slice(0, mobile ? 90 : 180) : [];
    if (Array.isArray(state.species)) for (const item of state.species) species.set(item.id, normalizeSpecies(item));
    if (Array.isArray(state.structures)) for (const item of state.structures) structures.set(item.id, { ...item });
    if (Array.isArray(state.ancestry)) for (const item of state.ancestry) ancestry.set(item.id, { ...item });
  }

  function takeSavedCreature(role, position) {
    let bestIndex = -1;
    let bestDistance = Infinity;
    for (let index = 0; index < savedCreatures.length; index++) {
      const candidate = savedCreatures[index];
      if (candidate.role !== role) continue;
      const distance = torusDistance(position, candidate, world.width, world.height);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) return null;
    return savedCreatures.splice(bestIndex, 1)[0];
  }

  function emitHistory(title, description) {
    window.dispatchEvent(new CustomEvent('reality-history', {
      detail: [{ title, description, tick: world.tick, date: new Date().toISOString() }],
    }));
    window.dispatchEvent(new CustomEvent('evolution-event', {
      detail: { title, description, elapsed },
    }));
  }

  return {
    step,
    getGenome,
    getRecord,
    getStructures,
    getSpecies,
    getCommunication,
    getState,
    save,
    load,
  };

  function jitterPoint(point, radius) {
    const angle = rng() * Math.PI * 2;
    const distance = rng() * radius;
    return {
      x: wrap(point.x + Math.cos(angle) * distance, world.width),
      y: clamp(point.y + Math.sin(angle) * distance, 0, world.height),
    };
  }
}

function createFounderGenome(dna = {}, role, rng) {
  const base = role === 'agent' ? 0 : role === 'predator' ? 1 : 2;
  return {
    speed: dna.speed ?? 0.82 + rng() * 0.42,
    sense: dna.sense ?? 0.78 + rng() * 0.5,
    metabolism: dna.metabolism ?? 0.76 + rng() * 0.5,
    stamina: 0.72 + rng() * 0.58,
    social: role === 'agent' ? 0.52 + rng() * 0.4 : 0.12 + rng() * 0.4,
    caution: role === 'agent' ? 0.52 + rng() * 0.4 : 0.12 + rng() * 0.34,
    aggression: role === 'agent' ? 0.08 + rng() * 0.22 : 0.48 + rng() * 0.44,
    intelligence: 0.28 + rng() * 0.55,
    communication: 0.22 + rng() * 0.62,
    dexterity: 0.22 + rng() * 0.64,
    construction: 0.18 + rng() * 0.62,
    memory: 0.28 + rng() * 0.62,
    curiosity: 0.2 + rng() * 0.72,
    resistance: 0.48 + rng() * 0.42,
    preferredTemperature: 0.45 + (rng() - 0.5) * 0.26,
    size: role === 'apex' ? 1.28 + rng() * 0.28 : role === 'predator' ? 1 + rng() * 0.25 : 0.72 + rng() * 0.34,
    length: 0.48 + rng() * 0.62,
    depth: 0.38 + rng() * 0.62,
    legs: 0.45 + rng() * 0.75,
    limbPairs: role === 'apex' ? 2 : 1 + Math.floor(rng() * 3),
    neck: 0.28 + rng() * 0.72,
    head: 0.34 + rng() * 0.68,
    tail: 0.22 + rng() * 0.86,
    tilt: (rng() - 0.5) * 0.9,
    display: rng(),
    hue: [165, 18, 220][base] + (rng() - 0.5) * [92, 68, 82][base],
    sex: rng() < 0.5 ? 'A' : 'B',
    generation: 0,
    parents: [],
    speciesId: '',
    bornAt: 0,
    birthX: 0,
    birthY: 0,
    lifeAge: 0,
    maturity: role === 'agent' ? 10 + rng() * 8 : role === 'predator' ? 14 + rng() * 9 : 18 + rng() * 12,
    lifespan: role === 'agent' ? 170 + rng() * 130 : role === 'predator' ? 220 + rng() * 150 : 280 + rng() * 190,
    cooldown: 0,
  };
}

function crossover(a, b, role, rng) {
  const keys = [
    'speed', 'sense', 'metabolism', 'stamina', 'social', 'caution', 'aggression',
    'intelligence', 'communication', 'dexterity', 'construction', 'memory', 'curiosity',
    'resistance', 'preferredTemperature', 'size', 'length', 'depth', 'legs', 'neck',
    'head', 'tail', 'tilt', 'display', 'hue', 'maturity', 'lifespan',
  ];
  const child = createFounderGenome({}, role, rng);
  const mutation = 0.045 + Math.max(a.generation, b.generation) * 0.0015;
  for (const key of keys) {
    const av = a[key] ?? child[key];
    const bv = b[key] ?? child[key];
    const dominance = rng() < 0.5 ? 0.62 : 0.38;
    child[key] = av * dominance + bv * (1 - dominance) + gaussian(rng) * mutation * traitScale(key);
  }
  child.limbPairs = rng() < 0.49 ? a.limbPairs : b.limbPairs;
  if (rng() < 0.025) child.limbPairs += rng() < 0.5 ? -1 : 1;
  child.sex = rng() < 0.5 ? 'A' : 'B';
  return normalizeGenome(child, role);
}

function normalizeGenome(g = {}, role) {
  const base = createFounderGenome({}, role, () => 0.5);
  return {
    ...base,
    ...g,
    speed: clamp(g.speed ?? base.speed, 0.42, 1.9),
    sense: clamp(g.sense ?? base.sense, 0.36, 2.1),
    metabolism: clamp(g.metabolism ?? base.metabolism, 0.42, 1.9),
    stamina: clamp(g.stamina ?? base.stamina, 0.4, 1.8),
    social: clamp(g.social ?? base.social, 0, 1),
    caution: clamp(g.caution ?? base.caution, 0, 1),
    aggression: clamp(g.aggression ?? base.aggression, 0, 1),
    intelligence: clamp(g.intelligence ?? base.intelligence, 0, 1),
    communication: clamp(g.communication ?? base.communication, 0, 1),
    dexterity: clamp(g.dexterity ?? base.dexterity, 0, 1),
    construction: clamp(g.construction ?? base.construction, 0, 1),
    memory: clamp(g.memory ?? base.memory, 0, 1),
    curiosity: clamp(g.curiosity ?? base.curiosity, 0, 1),
    resistance: clamp(g.resistance ?? base.resistance, 0, 1),
    preferredTemperature: clamp(g.preferredTemperature ?? base.preferredTemperature, 0.05, 0.95),
    size: clamp(g.size ?? base.size, 0.48, 1.85),
    length: clamp(g.length ?? base.length, 0.18, 1.45),
    depth: clamp(g.depth ?? base.depth, 0.18, 1.4),
    legs: clamp(g.legs ?? base.legs, 0.2, 1.6),
    limbPairs: clamp(Math.round(g.limbPairs ?? base.limbPairs), 1, 3),
    neck: clamp(g.neck ?? base.neck, 0.08, 1.45),
    head: clamp(g.head ?? base.head, 0.18, 1.42),
    tail: clamp(g.tail ?? base.tail, 0.02, 1.6),
    tilt: clamp(g.tilt ?? base.tilt, -1, 1),
    display: clamp(g.display ?? base.display, 0, 1),
    hue: wrap(g.hue ?? base.hue, 360),
    sex: g.sex === 'B' ? 'B' : 'A',
    generation: Math.max(0, Math.floor(g.generation || 0)),
    parents: Array.isArray(g.parents) ? g.parents.slice(0, 2) : [],
    speciesId: String(g.speciesId || ''),
    bornAt: Math.max(0, g.bornAt || 0),
    birthX: Number.isFinite(g.birthX) ? g.birthX : 0,
    birthY: Number.isFinite(g.birthY) ? g.birthY : 0,
    lifeAge: Math.max(0, g.lifeAge || 0),
    maturity: clamp(g.maturity ?? base.maturity, 6, 45),
    lifespan: clamp(g.lifespan ?? base.lifespan, 80, 650),
    cooldown: Math.max(0, g.cooldown || 0),
  };
}

function compactGenome(g) {
  const copy = { ...g };
  delete copy.parents;
  delete copy.cooldown;
  delete copy.lifeAge;
  return copy;
}

function meanGenome(genomes) {
  if (!genomes.length) return {};
  const keys = [
    'speed', 'sense', 'metabolism', 'stamina', 'social', 'caution', 'aggression',
    'intelligence', 'communication', 'dexterity', 'construction', 'memory', 'curiosity',
    'resistance', 'preferredTemperature', 'size', 'length', 'depth', 'legs', 'neck',
    'head', 'tail', 'tilt', 'display', 'hue', 'maturity', 'lifespan',
  ];
  const mean = {};
  for (const key of keys) mean[key] = genomes.reduce((sum, genome) => sum + (genome[key] || 0), 0) / genomes.length;
  mean.limbPairs = Math.round(genomes.reduce((sum, genome) => sum + genome.limbPairs, 0) / genomes.length);
  return mean;
}

function genomeDistance(a, b) {
  const keys = [
    'speed', 'sense', 'metabolism', 'stamina', 'social', 'aggression', 'intelligence',
    'communication', 'dexterity', 'construction', 'memory', 'size', 'length', 'depth',
    'legs', 'neck', 'head', 'tail', 'display',
  ];
  return keys.reduce((sum, key) => sum + Math.abs((a[key] || 0) - (b[key] || 0)), 0) / keys.length;
}

function mateFitness(record) {
  const g = record.genome;
  return (record.component.energy || 0) * 0.35 + g.resistance * 0.15 + g.display * 0.12 + g.intelligence * 0.08 + g.stamina * 0.12;
}

function baseCulture() {
  return { communication: 0, cooperation: 0, nesting: 0, tools: 0, territory: 0, knowledge: 0 };
}

function inheritCulture(culture = baseCulture()) {
  return Object.fromEntries(Object.entries(culture).map(([key, value]) => [key, value * 0.42]));
}

function normalizeSpecies(item) {
  return {
    ...item,
    niche: { ...defaultNiche(), ...(item.niche || {}) },
    meanGenome: { ...(item.meanGenome || {}) },
    culture: { ...baseCulture(), ...(item.culture || {}) },
    members: 0,
  };
}

function defaultNiche() {
  return { temperature: 0.55, moisture: 0.5, elevation: 0.5, water: 0, land: true };
}

function meanNiche(niches) {
  if (!niches.length) return defaultNiche();
  return {
    temperature: niches.reduce((sum, n) => sum + n.temperature, 0) / niches.length,
    moisture: niches.reduce((sum, n) => sum + n.moisture, 0) / niches.length,
    elevation: niches.reduce((sum, n) => sum + n.elevation, 0) / niches.length,
    water: niches.reduce((sum, n) => sum + n.water, 0) / niches.length,
    land: niches.filter(n => n.land).length >= niches.length / 2,
  };
}

function nicheDistance(a, b) {
  return (
    Math.abs(a.temperature - b.temperature) +
    Math.abs(a.moisture - b.moisture) +
    Math.abs(a.elevation - b.elevation) +
    Math.abs(a.water - b.water)
  ) / 4;
}

function circularMean(values, period) {
  if (!values.length) return 0;
  let x = 0;
  let y = 0;
  for (const value of values) {
    const angle = value / period * Math.PI * 2;
    x += Math.cos(angle);
    y += Math.sin(angle);
  }
  return wrap(Math.atan2(y, x) / (Math.PI * 2) * period, period);
}

function torusMidpoint(a, b, width, height) {
  return {
    x: wrap(a.x + shortest(b.x - a.x, width) * 0.5, width),
    y: clamp(a.y + shortest(b.y - a.y, height) * 0.5, 0, height),
  };
}

function torusDistance(a, b, width, height) {
  if (!a || !b) return Infinity;
  const bx = Number.isFinite(b.x) ? b.x : b.centroidX;
  const by = Number.isFinite(b.y) ? b.y : b.centroidY;
  const dx = shortest(bx - a.x, width);
  const dy = shortest(by - a.y, height);
  return dx * dx + dy * dy;
}

function shortest(delta, period) {
  if (delta > period * 0.5) return delta - period;
  if (delta < -period * 0.5) return delta + period;
  return delta;
}

function gaussian(rng) {
  const u = Math.max(1e-6, rng());
  const v = Math.max(1e-6, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function traitScale(key) {
  if (key === 'hue') return 70;
  if (key === 'lifespan') return 80;
  if (key === 'maturity') return 8;
  return 1;
}

function roleBaseHue(role) {
  return role === 'agent' ? 165 : role === 'predator' ? 18 : 220;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

const wrap = (value, max) => ((value % max) + max) % max;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
