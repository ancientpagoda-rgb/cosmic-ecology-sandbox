const MODEL_VERSION = 1;
const CULTURE_CELL = 90;
const RESCAN_TICKS = 60;
const ESTABLISHED_DEPTH = 2;

async function start() {
  try {
    if (window.realitySandboxReady) await window.realitySandboxReady;
    await waitForSocialLearning();
    const planet = window.realitySandboxPlanet;
    if (!planet?.world?.ecs) return;

    const api = installCulturalTraditions({ world: planet.world });
    planet.culturalTraditions = api;
    planet.world.culturalTraditions = api;
    window.realitySandboxCulturalTraditions = api;
    window.dispatchEvent(new CustomEvent('eidolon-cultural-traditions-ready', { detail: api.getSnapshot() }));
    window.addEventListener('pagehide', api.destroy, { once: true });
  } catch (error) {
    console.warn('[cultural-traditions] disabled:', error);
  }
}

function waitForSocialLearning() {
  if (window.realitySandboxSocialLearning) return Promise.resolve();
  return new Promise(resolve => {
    const timeout = setTimeout(resolve, 3600);
    window.addEventListener('eidolon-social-learning-ready', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

export function installCulturalTraditions({ world }) {
  const previousStep = world.step;
  if (typeof previousStep !== 'function') return emptyApi();

  const traditionHistory = new Map();
  let transmissions = 0;
  let innovationsAdopted = 0;
  let establishedEvents = 0;
  let lostEvents = 0;
  let lastScanTick = -Infinity;
  let activeTraditions = [];
  let lastEvent = null;
  let active = true;

  function wrappedStep(dt) {
    previousStep.call(world, dt);
    if (!active || !(dt > 0)) return;

    const rows = livingRows(world.ecs.components);
    for (const row of rows) updateCulturalTrace(row);

    if (world.tick - lastScanTick >= RESCAN_TICKS || world.tick < lastScanTick) {
      rescan(rows);
    }

    reinforceLivingTraditions(rows, dt);
  }

  world.step = wrappedStep;

  function updateCulturalTrace(row) {
    const organism = row.organism;
    organism.culturalTrace ||= {};

    for (const kind of ['reward', 'danger']) {
      const memory = organism[`${kind}Memory`];
      if (!validMemory(memory)) {
        delete organism.culturalTrace[kind];
        continue;
      }

      const signature = memorySignature(kind, memory, world.width);
      const current = organism.culturalTrace[kind];
      if (memory.source !== 'social' || memory.teacherId == null) {
        if (!current || current.signature !== signature) {
          organism.culturalTrace[kind] = {
            signature,
            depth: 0,
            originEntityId: row.id,
            teacherId: null,
            acquiredTick: world.tick,
          };
        }
        continue;
      }

      if (current?.signature === signature && current.teacherId === memory.teacherId) continue;
      const teacher = findOrganism(world.ecs.components, memory.teacherId);
      const teacherTrace = teacher?.culturalTrace?.[kind];
      const depth = teacherTrace?.signature === signature
        ? Math.max(1, finite(teacherTrace.depth) + 1)
        : 1;
      const originEntityId = teacherTrace?.signature === signature
        ? teacherTrace.originEntityId
        : memory.teacherId;

      organism.culturalTrace[kind] = {
        signature,
        depth,
        originEntityId,
        teacherId: memory.teacherId,
        acquiredTick: world.tick,
      };
      transmissions += 1;
      if (!traditionHistory.has(signature)) innovationsAdopted += 1;
    }
  }

  function rescan(rows = livingRows(world.ecs.components)) {
    lastScanTick = world.tick;
    const groups = new Map();

    for (const row of rows) {
      const trace = row.organism.culturalTrace || {};
      for (const kind of ['reward', 'danger']) {
        const item = trace[kind];
        const memory = row.organism[`${kind}Memory`];
        if (!item?.signature || !validMemory(memory)) continue;
        let group = groups.get(item.signature);
        if (!group) {
          group = {
            id: item.signature,
            kind,
            carriers: 0,
            maxDepth: 0,
            totalDepth: 0,
            strength: 0,
            originEntityId: item.originEntityId ?? null,
            x: memory.x,
            y: memory.y,
          };
          groups.set(item.signature, group);
        }
        group.carriers += 1;
        group.maxDepth = Math.max(group.maxDepth, finite(item.depth));
        group.totalDepth += finite(item.depth);
        group.strength += memoryValue(memory);
      }
    }

    const next = [];
    const nowEstablished = new Set();
    for (const group of groups.values()) {
      const established = group.carriers >= 2 && group.maxDepth >= ESTABLISHED_DEPTH;
      const summary = {
        id: group.id,
        kind: group.kind,
        carriers: group.carriers,
        maxTransmissionDepth: group.maxDepth,
        meanTransmissionDepth: round(group.totalDepth / Math.max(1, group.carriers)),
        meanMemoryStrength: round(group.strength / Math.max(1, group.carriers)),
        originEntityId: group.originEntityId,
        x: round(group.x),
        y: round(group.y),
        established,
      };
      next.push(summary);

      const history = traditionHistory.get(group.id) || {
        firstSeenTick: world.tick,
        firstEstablishedTick: null,
        lastSeenTick: world.tick,
        peakCarriers: 0,
        established: false,
      };
      history.lastSeenTick = world.tick;
      history.peakCarriers = Math.max(history.peakCarriers, group.carriers);
      if (established) {
        nowEstablished.add(group.id);
        if (!history.established) {
          history.established = true;
          history.firstEstablishedTick ??= world.tick;
          establishedEvents += 1;
          lastEvent = { type: 'tradition-established', traditionId: group.id, tick: world.tick };
        }
      }
      traditionHistory.set(group.id, history);
    }

    for (const [id, history] of traditionHistory) {
      if (history.established && !nowEstablished.has(id) && history.lastSeenTick < world.tick) {
        history.established = false;
        lostEvents += 1;
        lastEvent = { type: 'tradition-lost', traditionId: id, tick: world.tick };
      }
    }

    activeTraditions = next.sort((a, b) => Number(b.established) - Number(a.established) || b.carriers - a.carriers);
  }

  function reinforceLivingTraditions(rows, dt) {
    const established = new Set(activeTraditions.filter(item => item.established).map(item => item.id));
    if (!established.size) return;

    for (const row of rows) {
      const trace = row.organism.culturalTrace || {};
      let load = 0;
      for (const kind of ['reward', 'danger']) {
        const item = trace[kind];
        const memory = row.organism[`${kind}Memory`];
        if (!item?.signature || !established.has(item.signature) || !validMemory(memory)) continue;
        const sociality = clamp(finite(row.organism.sociality, 0.5), 0, 1);
        memory.strength = clamp(memory.strength + dt * 0.0012 * (0.35 + sociality), 0, 1);
        load += 1;
      }
      row.organism.culturalTraditionLoad = load;
    }
  }

  function getSnapshot() {
    const established = activeTraditions.filter(item => item.established);
    return {
      version: MODEL_VERSION,
      model: 'socially-transmitted-local-traditions-without-genetic-inheritance',
      transmissions,
      innovationsAdopted,
      establishedEvents,
      lostEvents,
      activeTraditions: activeTraditions.map(item => ({ ...item })),
      establishedTraditions: established.length,
      deepestTransmissionChain: activeTraditions.reduce((max, item) => Math.max(max, item.maxTransmissionDepth), 0),
      lastEvent,
      geneticInheritance: false,
      persistenceRequiresLivingCarriers: true,
      populationCap: null,
    };
  }

  function destroy() {
    active = false;
    if (world.step === wrappedStep) world.step = previousStep;
  }

  rescan();
  return { getSnapshot, rescan, destroy };
}

export function memorySignature(kind, memory, worldWidth = 1200) {
  const x = wrap(finite(memory?.x), worldWidth);
  const y = Math.max(0, finite(memory?.y));
  const qx = Math.floor(x / CULTURE_CELL);
  const qy = Math.floor(y / CULTURE_CELL);
  return `${kind}-${qx.toString(36)}-${qy.toString(36)}`;
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

function wrap(value, width) {
  return ((value % width) + width) % width;
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value) {
  return Math.round(finite(value) * 1000) / 1000;
}

function emptyApi() {
  return {
    getSnapshot: () => ({ version: MODEL_VERSION, model: 'socially-transmitted-local-traditions-without-genetic-inheritance', disabled: true }),
    rescan() {},
    destroy() {},
  };
}

if (typeof window !== 'undefined') start();
