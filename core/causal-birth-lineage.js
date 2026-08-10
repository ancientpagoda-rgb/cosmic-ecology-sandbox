const GRID_SIZE = 12;
const PIXEL_COUNT = GRID_SIZE * GRID_SIZE;

async function start() {
  try {
    if (window.realitySandboxReady) await window.realitySandboxReady;
    await waitForIndividualHeredity();

    const planet = window.realitySandboxPlanet;
    if (!planet?.world?.ecs || !planet?.biosphere) return;

    const api = installCausalBirthLineage({
      world: planet.world,
      biosphere: planet.biosphere,
    });

    planet.causalBirthLineage = api;
    window.realitySandboxCausalBirthLineage = api;
    window.dispatchEvent(new CustomEvent('eidolon-causal-birth-lineage-ready', {
      detail: api.getSnapshot(),
    }));
    window.addEventListener('pagehide', api.destroy, { once: true });
  } catch (error) {
    console.warn('[causal-birth-lineage] disabled:', error);
  }
}

function waitForIndividualHeredity() {
  if (window.realitySandboxIndividualCreatureHeredity) return Promise.resolve();
  return new Promise(resolve => {
    const timeout = setTimeout(resolve, 2500);
    window.addEventListener('eidolon-individual-heredity-ready', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

export function installCausalBirthLineage({ world, biosphere }) {
  const previousStep = world.step;
  const ecs = world.ecs;
  if (typeof previousStep !== 'function' || typeof ecs?.createEntity !== 'function') return emptyApi();

  let birthsCaptured = 0;
  let exactParentLinks = 0;
  let visualGenomesInherited = 0;
  let visualMutations = 0;
  let lastBirth = null;
  let active = true;

  function wrappedStep(dt) {
    const created = [];
    const exactBirths = [];
    const restorers = [];
    const originalCreateEntity = ecs.createEntity;

    ecs.createEntity = function causalCreateEntity(...args) {
      const id = originalCreateEntity.apply(ecs, args);
      created.push(id);
      return id;
    };

    try {
      instrumentParents('grazer', ecs.components.agent, 0.50, 1.45, created, exactBirths, restorers);
      instrumentParents('predator', ecs.components.predator, 0.50, 2.35, created, exactBirths, restorers);
      instrumentParents('apex', ecs.components.apex, 0.55, 2.70, created, exactBirths, restorers);

      previousStep.call(world, dt);

      // The older heredity layer runs inside previousStep and may have already
      // inferred parentage from proximity. Re-apply the execution-captured
      // record afterward so causal parentage is authoritative.
      for (const record of exactBirths) applyExactBirth(record);
    } finally {
      ecs.createEntity = originalCreateEntity;
      for (const restore of restorers) restore();
    }
  }

  function instrumentParents(guild, group, reproductionFactor, minimumBefore, created, exactBirths, restorers) {
    if (!group) return;
    for (const [parentId, organism] of Array.from(group.entries())) {
      if (!organism || !Object.prototype.hasOwnProperty.call(organism, 'energy')) continue;
      const descriptor = Object.getOwnPropertyDescriptor(organism, 'energy');
      if (descriptor && descriptor.configurable === false) continue;

      let value = finite(organism.energy);
      Object.defineProperty(organism, 'energy', {
        configurable: true,
        enumerable: true,
        get() { return value; },
        set(nextValue) {
          const previousValue = value;
          value = finite(nextValue);

          if (!active || previousValue < minimumBefore) return;
          const ratio = previousValue > 0 ? value / previousValue : 1;
          if (Math.abs(ratio - reproductionFactor) > 0.035) return;

          const childId = newestCreatureId(created, group, parentId);
          if (childId == null) return;
          if (exactBirths.some(record => record.childId === childId)) return;

          const child = group.get(childId);
          if (!child) return;

          exactBirths.push(makeBirthRecord({
            guild,
            parentId,
            parent: organism,
            childId,
            child,
            ratio,
          }));
        },
      });

      restorers.push(() => {
        const finalValue = value;
        if (descriptor) {
          Object.defineProperty(organism, 'energy', descriptor);
          organism.energy = finalValue;
        } else {
          delete organism.energy;
          organism.energy = finalValue;
        }
      });
    }
  }

  function makeBirthRecord({ guild, parentId, parent, childId, child, ratio }) {
    const species = biosphere.getSpeciesForEntity?.(parentId) || null;
    const lineageId = parent.lineageCapsuleId || species?.lineageCapsuleId || null;
    const speciesId = parent.speciesId || species?.id || null;
    const parentGenome = normalizeGenome(parent.visualGenome);

    let exactGenome = null;
    let mutations = 0;
    if (parentGenome) {
      const result = inheritAndMutateGenome({
        parentGenome,
        parentDna: parent.dna,
        childDna: child.dna,
        key: `${world.seed || 'eidolon'}|${world.tick}|${parentId}|${childId}`,
      });
      exactGenome = {
        sprite: result.sprite,
        generation: Math.max(0, finite(parentGenome.generation)) + 1,
        lineageId: parentGenome.lineageId || lineageId,
        ancestorEntityId: parentGenome.ancestorEntityId ?? parentId,
        parentEntityId: parentId,
        birthTick: world.tick,
        mutations: Math.max(0, finite(parentGenome.mutations)) + result.mutations,
      };
      mutations = result.mutations;
    }

    return {
      guild,
      parentId,
      childId,
      lineageId,
      speciesId,
      exactGenome,
      mutations,
      energyTransferRatio: round(ratio),
      tick: world.tick,
    };
  }

  function applyExactBirth(record) {
    const group = record.guild === 'grazer'
      ? ecs.components.agent
      : record.guild === 'predator'
        ? ecs.components.predator
        : ecs.components.apex;
    const child = group?.get(record.childId);
    if (!child) return;

    child.parentEntityId = record.parentId;
    child.birthTick = record.tick;
    child.parentageMethod = 'causal-reproduction-event';
    child.parentageConfidence = 1;
    if (record.lineageId) child.lineageCapsuleId = record.lineageId;
    if (record.speciesId) child.speciesId = record.speciesId;
    if (record.exactGenome) {
      child.visualGenome = clone(record.exactGenome);
      visualGenomesInherited += 1;
      visualMutations += record.mutations;
    }

    birthsCaptured += 1;
    exactParentLinks += 1;
    lastBirth = {
      childId: record.childId,
      parentId: record.parentId,
      guild: record.guild,
      tick: record.tick,
      speciesId: record.speciesId,
      lineageId: record.lineageId,
      energyTransferRatio: record.energyTransferRatio,
      parentageConfidence: 1,
      parentageMethod: 'causal-reproduction-event',
      mutations: record.mutations,
      visualGeneration: record.exactGenome?.generation ?? null,
    };
  }

  world.step = wrappedStep;

  function getSnapshot() {
    return {
      version: 1,
      model: 'causal-parentage-from-reproduction-event',
      birthsCaptured,
      exactParentLinks,
      visualGenomesInherited,
      visualMutations,
      lastBirth,
      heuristicParentageRequired: false,
      parentageConfidence: exactParentLinks ? 1 : null,
      populationCap: null,
    };
  }

  function destroy() {
    active = false;
    if (world.step === wrappedStep) world.step = previousStep;
  }

  return { getSnapshot, destroy };
}

function newestCreatureId(created, group, parentId) {
  for (let index = created.length - 1; index >= 0; index -= 1) {
    const id = created[index];
    if (id !== parentId && group.has(id)) return id;
  }
  return null;
}

export function inheritAndMutateGenome({ parentGenome, parentDna, childDna, key }) {
  const normalized = normalizeGenome(parentGenome);
  if (!normalized) return { sprite: null, mutations: 0 };

  const shift = dnaDistance(parentDna, childDna);
  const pressure = clamp(0.07 + shift * 0.58, 0.07, 0.38);
  const random = seededRandom(hashText(key));
  const pixels = normalized.sprite.pixels.split('');
  let mutations = 0;

  if (random() < pressure) {
    mutateOnePixel(pixels, random);
    mutations += 1;
  }
  if (random() < pressure * 0.22) {
    mutateOnePixel(pixels, random);
    mutations += 1;
  }

  if (!pixels.some(pixel => pixel === '1' || pixel === '2')) {
    return { sprite: normalized.sprite, mutations: 0 };
  }

  return {
    sprite: { width: GRID_SIZE, height: GRID_SIZE, pixels: pixels.join('') },
    mutations,
  };
}

function mutateOnePixel(pixels, random) {
  const occupied = [];
  const frontier = [];
  for (let index = 0; index < pixels.length; index += 1) {
    if (pixels[index] !== '0') occupied.push(index);
    else if (hasOccupiedNeighbor(pixels, index)) frontier.push(index);
  }

  const mode = random();
  if (mode < 0.46 && frontier.length) {
    const index = frontier[Math.floor(random() * frontier.length)];
    pixels[index] = random() < 0.78 ? '1' : '2';
  } else if (mode < 0.82 && occupied.length) {
    const index = occupied[Math.floor(random() * occupied.length)];
    pixels[index] = pixels[index] === '1' ? '2' : '1';
  } else if (occupied.length > 3) {
    const index = occupied[Math.floor(random() * occupied.length)];
    pixels[index] = '0';
  }
}

function hasOccupiedNeighbor(pixels, index) {
  const x = index % GRID_SIZE;
  const y = Math.floor(index / GRID_SIZE);
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) continue;
      if (pixels[ny * GRID_SIZE + nx] !== '0') return true;
    }
  }
  return false;
}

function normalizeGenome(input) {
  if (!input || typeof input !== 'object') return null;
  const sprite = normalizeSprite(input.sprite);
  if (!sprite) return null;
  return {
    ...input,
    sprite,
    generation: Math.max(0, finite(input.generation)),
    mutations: Math.max(0, finite(input.mutations)),
  };
}

function normalizeSprite(input) {
  if (!input || finite(input.width) !== GRID_SIZE || finite(input.height) !== GRID_SIZE) return null;
  const pixels = String(input.pixels || '').replace(/[^012]/g, '').slice(0, PIXEL_COUNT);
  if (pixels.length !== PIXEL_COUNT || !/[12]/.test(pixels)) return null;
  return { width: GRID_SIZE, height: GRID_SIZE, pixels };
}

function dnaDistance(a, b) {
  const speed = Math.abs(finite(a?.speed, 1) - finite(b?.speed, 1)) / 0.8;
  const sense = Math.abs(finite(a?.sense, 1) - finite(b?.sense, 1)) / 0.9;
  const metabolism = Math.abs(finite(a?.metabolism, 1) - finite(b?.metabolism, 1)) / 1.0;
  const hue = Math.abs(finite(a?.hueShift, 0) - finite(b?.hueShift, 0)) / 120;
  return clamp((speed + sense + metabolism + hue * 0.35) / 3.35, 0, 1);
}

function seededRandom(seed) {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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
    getSnapshot: () => ({
      version: 1,
      model: 'causal-parentage-unavailable',
      birthsCaptured: 0,
      exactParentLinks: 0,
      populationCap: null,
    }),
    destroy() {},
  };
}

start();
