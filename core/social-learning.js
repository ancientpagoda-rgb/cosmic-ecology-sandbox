const MODEL_VERSION = 1;
const MEMORY_HALF_LIFE = 95;
const TEACH_RADIUS = 78;
const PEER_RADIUS = 62;

async function start() {
  try {
    if (window.realitySandboxReady) await window.realitySandboxReady;
    await waitForParentalInvestment();
    const planet = window.realitySandboxPlanet;
    if (!planet?.world?.ecs) return;

    const api = installSocialLearning({ world: planet.world });
    planet.socialLearning = api;
    planet.world.socialLearning = api;
    window.realitySandboxSocialLearning = api;
    window.dispatchEvent(new CustomEvent('eidolon-social-learning-ready', { detail: api.getSnapshot() }));
    window.addEventListener('pagehide', api.destroy, { once: true });
  } catch (error) {
    console.warn('[social-learning] disabled:', error);
  }
}

function waitForParentalInvestment() {
  if (window.realitySandboxParentalInvestment) return Promise.resolve();
  return new Promise(resolve => {
    const timeout = setTimeout(resolve, 3400);
    window.addEventListener('eidolon-parental-investment-ready', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

export function installSocialLearning({ world }) {
  const previousStep = world.step;
  if (typeof previousStep !== 'function') return emptyApi();

  const previousState = new Map();
  let rewardMemoriesFormed = 0;
  let dangerMemoriesFormed = 0;
  let parentTeachingEvents = 0;
  let peerLearningEvents = 0;
  let memoryGuidedMoves = 0;
  let active = true;

  seedPreviousState();

  function wrappedStep(dt) {
    previousStep.call(world, dt);
    if (!active || !(dt > 0)) return;

    const rows = livingRows(world.ecs.components);
    const c = world.ecs.components;
    const spatial = makeSpatialIndex(rows, c.position, world.width, PEER_RADIUS);

    for (const row of rows) {
      const organism = row.organism;
      const pos = c.position.get(row.id);
      if (!pos) continue;
      decayMemory(organism, dt);
      learnFromOutcome(row, pos);
    }

    for (const row of rows) {
      const organism = row.organism;
      const pos = c.position.get(row.id);
      if (!pos) continue;

      if (organism.lifeStage === 'juvenile') learnFromParents(row, pos);
      if (finite(organism.sociality, 0.5) > 0.58) learnFromPeers(row, pos, spatial);
      applyMemoryGuidance(row, pos, dt);
    }

    previousState.clear();
    for (const row of rows) {
      const pos = c.position.get(row.id);
      if (!pos) continue;
      previousState.set(row.id, {
        energy: finite(row.organism.energy),
        x: pos.x,
        y: pos.y,
        infected: finite(row.organism.infected) > 0,
      });
    }
  }

  world.step = wrappedStep;

  function seedPreviousState() {
    const c = world.ecs.components;
    for (const row of livingRows(c)) {
      const pos = c.position.get(row.id);
      if (!pos) continue;
      previousState.set(row.id, {
        energy: finite(row.organism.energy),
        x: pos.x,
        y: pos.y,
        infected: finite(row.organism.infected) > 0,
      });
    }
  }

  function learnFromOutcome(row, pos) {
    const organism = row.organism;
    const before = previousState.get(row.id);
    if (!before) return;
    const energyDelta = finite(organism.energy) - before.energy;
    const learningRate = individualLearningRate(organism);

    if (energyDelta > 0.025) {
      organism.rewardMemory = mergeMemory(
        organism.rewardMemory,
        { x: pos.x, y: pos.y, strength: clamp(energyDelta * 2.8 * learningRate, 0.04, 1), source: 'experience' },
        world.width,
      );
      rewardMemoriesFormed += 1;
    }

    const newlyInfected = finite(organism.infected) > 0 && !before.infected;
    if (energyDelta < -0.12 || newlyInfected) {
      organism.dangerMemory = mergeMemory(
        organism.dangerMemory,
        { x: pos.x, y: pos.y, strength: clamp((Math.abs(Math.min(0, energyDelta)) + (newlyInfected ? 0.3 : 0)) * learningRate, 0.05, 1), source: 'experience' },
        world.width,
      );
      dangerMemoriesFormed += 1;
    }
  }

  function learnFromParents(row, pos) {
    const child = row.organism;
    const parentIds = Array.isArray(child.parentEntityIds)
      ? child.parentEntityIds
      : child.parentEntityId == null ? [] : [child.parentEntityId];
    if (!parentIds.length) return;
    const c = world.ecs.components;

    for (const parentId of parentIds) {
      const parent = findOrganism(c, parentId);
      const parentPos = c.position.get(parentId);
      if (!parent || !parentPos) continue;
      if (sphericalDistance(pos, parentPos, world.width) > TEACH_RADIUS) continue;
      const teaching = clamp(finite(parent.sociality, 0.5) * finite(child.dna?.sense, 1), 0, 1.5);
      if (teaching < 0.22) continue;
      let taught = false;
      if (validMemory(parent.rewardMemory)) {
        child.rewardMemory = copySocialMemory(child.rewardMemory, parent.rewardMemory, teaching * 0.22, parentId, world.width);
        taught = true;
      }
      if (validMemory(parent.dangerMemory)) {
        child.dangerMemory = copySocialMemory(child.dangerMemory, parent.dangerMemory, teaching * 0.26, parentId, world.width);
        taught = true;
      }
      if (taught) {
        child.lastTeacherEntityId = parentId;
        child.socialLearningEvents = finite(child.socialLearningEvents) + 1;
        parentTeachingEvents += 1;
      }
    }
  }

  function learnFromPeers(row, pos, spatial) {
    const organism = row.organism;
    const candidates = nearbyRows(row.id, pos, spatial, world.width, PEER_RADIUS);
    let best = null;
    for (const other of candidates) {
      if (other.guild !== row.guild) continue;
      const kin = sharedAncestry(organism.genomicAncestry, other.organism.genomicAncestry);
      const social = Math.min(finite(organism.sociality, 0.5), finite(other.organism.sociality, 0.5));
      const trust = clamp(kin * 0.58 + social * 0.42, 0, 1);
      if (trust < 0.46) continue;
      const knowledge = memoryValue(other.organism.rewardMemory) + memoryValue(other.organism.dangerMemory);
      const score = trust * knowledge;
      if (!best || score > best.score) best = { other, trust, score };
    }
    if (!best || best.score < 0.08) return;

    let learned = false;
    if (validMemory(best.other.organism.rewardMemory)) {
      organism.rewardMemory = copySocialMemory(organism.rewardMemory, best.other.organism.rewardMemory, best.trust * 0.09, best.other.id, world.width);
      learned = true;
    }
    if (validMemory(best.other.organism.dangerMemory)) {
      organism.dangerMemory = copySocialMemory(organism.dangerMemory, best.other.organism.dangerMemory, best.trust * 0.10, best.other.id, world.width);
      learned = true;
    }
    if (learned) {
      organism.lastTeacherEntityId = best.other.id;
      organism.socialLearningEvents = finite(organism.socialLearningEvents) + 1;
      peerLearningEvents += 1;
    }
  }

  function applyMemoryGuidance(row, pos, dt) {
    const organism = row.organism;
    const velocity = world.ecs.components.velocity.get(row.id);
    if (!velocity) return;
    const sense = clamp(finite(organism.dna?.sense, 1), 0.35, 2.2);
    const hunger = clamp(1.05 - finite(organism.energy, 1), 0, 1);
    let ax = 0;
    let ay = 0;
    let influenced = false;

    if (validMemory(organism.rewardMemory) && hunger > 0.06) {
      const dx = wrappedDelta(pos.x, organism.rewardMemory.x, world.width);
      const dy = organism.rewardMemory.y - pos.y;
      const dist = Math.hypot(dx, dy) || 1;
      const range = 110 + sense * 90;
      if (dist < range) {
        const strength = memoryValue(organism.rewardMemory) * hunger * (1 - dist / range);
        ax += dx / dist * strength * 12;
        ay += dy / dist * strength * 12;
        influenced = true;
        organism.learnedBehavior = 'seek-remembered-reward';
      }
    }

    if (validMemory(organism.dangerMemory)) {
      const dx = wrappedDelta(organism.dangerMemory.x, pos.x, world.width);
      const dy = pos.y - organism.dangerMemory.y;
      const dist = Math.hypot(dx, dy) || 1;
      const range = 80 + sense * 75;
      if (dist < range) {
        const strength = memoryValue(organism.dangerMemory) * (1 - dist / range);
        ax += dx / dist * strength * 15;
        ay += dy / dist * strength * 15;
        influenced = true;
        organism.learnedBehavior = 'avoid-remembered-danger';
      }
    }

    if (influenced) {
      velocity.vx += ax * dt;
      velocity.vy += ay * dt;
      memoryGuidedMoves += 1;
    } else {
      organism.learnedBehavior = null;
    }
  }

  function getSnapshot() {
    let rewardMemories = 0;
    let dangerMemories = 0;
    let sociallyLearned = 0;
    for (const row of livingRows(world.ecs.components)) {
      if (validMemory(row.organism.rewardMemory)) rewardMemories += 1;
      if (validMemory(row.organism.dangerMemory)) dangerMemories += 1;
      if (finite(row.organism.socialLearningEvents) > 0) sociallyLearned += 1;
    }
    return {
      version: MODEL_VERSION,
      model: 'individual-experience-parental-teaching-peer-social-learning',
      rewardMemoriesFormed,
      dangerMemoriesFormed,
      parentTeachingEvents,
      peerLearningEvents,
      memoryGuidedMoves,
      livingRewardMemories: rewardMemories,
      livingDangerMemories: dangerMemories,
      livingSocialLearners: sociallyLearned,
      memoryHalfLife: MEMORY_HALF_LIFE,
      geneticMemoryInheritance: false,
      populationCap: null,
    };
  }

  function destroy() {
    active = false;
    if (world.step === wrappedStep) world.step = previousStep;
  }

  return { getSnapshot, destroy };
}

export function mergeMemory(current, incoming, width) {
  if (!validMemory(current)) return { ...incoming };
  const a = clamp(memoryValue(current), 0, 1);
  const b = clamp(memoryValue(incoming), 0, 1);
  const total = Math.max(0.0001, a + b);
  const dx = wrappedDelta(current.x, incoming.x, width);
  return {
    x: wrap(current.x + dx * (b / total), width),
    y: current.y * (a / total) + incoming.y * (b / total),
    strength: clamp(Math.max(a, b) + Math.min(a, b) * 0.18, 0, 1),
    source: incoming.source || current.source || 'experience',
    teacherId: incoming.teacherId ?? current.teacherId ?? null,
  };
}

function copySocialMemory(current, source, amount, teacherId, width) {
  const strength = clamp(memoryValue(source) * amount, 0.01, 0.5);
  return mergeMemory(current, {
    x: source.x,
    y: source.y,
    strength,
    source: 'social',
    teacherId,
  }, width);
}

function decayMemory(organism, dt) {
  const decay = Math.exp(-Math.log(2) * dt / MEMORY_HALF_LIFE);
  for (const key of ['rewardMemory', 'dangerMemory']) {
    if (!validMemory(organism[key])) continue;
    organism[key].strength *= decay;
    if (organism[key].strength < 0.015) organism[key] = null;
  }
}

function individualLearningRate(organism) {
  return clamp(
    0.45 + finite(organism?.dna?.sense, 1) * 0.36 + finite(organism?.sociality, 0.5) * 0.19,
    0.45,
    1.45,
  );
}

function sharedAncestry(a, b) {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return 0;
  let shared = 0;
  for (const [id, share] of Object.entries(a)) {
    shared += Math.min(Math.max(0, finite(share)), Math.max(0, finite(b[id])));
  }
  return clamp(shared, 0, 1);
}

function makeSpatialIndex(rows, positions, width, cellSize) {
  const columns = Math.max(1, Math.ceil(width / cellSize));
  const buckets = new Map();
  const byId = new Map(rows.map(row => [row.id, row]));
  for (const row of rows) {
    const pos = positions.get(row.id);
    if (!pos) continue;
    const cx = Math.floor(pos.x / cellSize) % columns;
    const cy = Math.floor(pos.y / cellSize);
    const key = `${cx}|${cy}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row.id);
  }
  return { buckets, byId, columns, cellSize, positions };
}

function nearbyRows(id, pos, spatial, width, radius) {
  const result = [];
  const cx = Math.floor(pos.x / spatial.cellSize) % spatial.columns;
  const cy = Math.floor(pos.y / spatial.cellSize);
  for (let ox = -1; ox <= 1; ox += 1) {
    const nx = (cx + ox + spatial.columns) % spatial.columns;
    for (let oy = -1; oy <= 1; oy += 1) {
      for (const otherId of spatial.buckets.get(`${nx}|${cy + oy}`) || []) {
        if (otherId === id) continue;
        const other = spatial.byId.get(otherId);
        const otherPos = spatial.positions.get(otherId);
        if (!other || !otherPos) continue;
        if (sphericalDistance(pos, otherPos, width) > radius) continue;
        result.push(other);
      }
    }
  }
  return result;
}

function livingRows(components) {
  const rows = [];
  for (const [id, organism] of components.agent || []) rows.push({ id, organism, guild: 'grazer' });
  for (const [id, organism] of components.predator || []) rows.push({ id, organism, guild: 'predator' });
  for (const [id, organism] of components.apex || []) rows.push({ id, organism, guild: 'apex' });
  return rows;
}

function findOrganism(components, id) {
  if (id == null) return null;
  return components.agent?.get(id) || components.predator?.get(id) || components.apex?.get(id) || null;
}

function validMemory(memory) {
  return memory && Number.isFinite(memory.x) && Number.isFinite(memory.y) && memoryValue(memory) > 0;
}

function memoryValue(memory) {
  return Math.max(0, finite(memory?.strength));
}

function sphericalDistance(a, b, width) {
  const raw = Math.abs(a.x - b.x);
  const dx = Math.min(raw, Math.max(0, width - raw));
  return Math.hypot(dx, a.y - b.y);
}

function wrappedDelta(a, b, width) {
  let delta = b - a;
  if (delta > width / 2) delta -= width;
  if (delta < -width / 2) delta += width;
  return delta;
}

function wrap(value, width) {
  return ((value % width) + width) % width;
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function emptyApi() {
  return {
    getSnapshot: () => ({ version: MODEL_VERSION, model: 'individual-experience-parental-teaching-peer-social-learning', disabled: true }),
    destroy() {},
  };
}

if (typeof window !== 'undefined') start();
