const MODEL_VERSION = 1;
const MIN_COMPATIBILITY = 0.43;
const FLOW_DECAY_TICKS = 1800;

async function start() {
  try {
    if (window.realitySandboxReady) await window.realitySandboxReady;
    await waitForCausalParentage();

    const planet = window.realitySandboxPlanet;
    if (!planet?.world?.ecs || !planet?.biosphere) return;

    const api = installReproductiveIsolation({
      world: planet.world,
      biosphere: planet.biosphere,
    });

    planet.reproductiveIsolation = api;
    planet.world.reproductiveIsolation = api;
    window.realitySandboxReproductiveIsolation = api;
    window.dispatchEvent(new CustomEvent('eidolon-reproductive-isolation-ready', {
      detail: api.getSnapshot(),
    }));
    window.addEventListener('pagehide', api.destroy, { once: true });
  } catch (error) {
    console.warn('[reproductive-isolation] disabled:', error);
  }
}

function waitForCausalParentage() {
  if (window.realitySandboxCausalBirthLineage) return Promise.resolve();
  return new Promise(resolve => {
    const timeout = setTimeout(resolve, 2600);
    window.addEventListener('eidolon-causal-birth-lineage-ready', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

export function installReproductiveIsolation({ world, biosphere }) {
  const previousStep = world.step;
  if (typeof previousStep !== 'function') return emptyApi();

  const known = new Set(livingRows(world.ecs.components).map(row => row.id));
  const geneFlow = new Map();
  let sexualBirths = 0;
  let clonalFallbackBirths = 0;
  let crossSpeciesBirths = 0;
  let recombinedVisualGenomes = 0;
  let lastBirth = null;
  let active = true;

  function wrappedStep(dt) {
    previousStep.call(world, dt);
    if (!active) return;

    const rows = livingRows(world.ecs.components);
    for (const row of rows) {
      if (known.has(row.id)) continue;
      if (row.organism.parentageMethod !== 'causal-reproduction-event') continue;
      processBirth(row);
    }

    known.clear();
    for (const row of rows) known.add(row.id);
  }

  world.step = wrappedStep;

  function processBirth(row) {
    const child = row.organism;
    const parentId = child.parentEntityId;
    const parent = findOrganism(world.ecs.components, parentId);
    const childPos = world.ecs.components.position.get(row.id);
    const parentPos = world.ecs.components.position.get(parentId);

    if (!parent || !childPos || !parentPos) {
      markClonal(row, parentId);
      return;
    }

    const parentSpecies = speciesOf(biosphere, parentId, parent);
    const mate = chooseMate({
      world,
      biosphere,
      guild: row.guild,
      childId: row.id,
      parentId,
      parent,
      parentPos,
      parentSpecies,
    });

    if (!mate) {
      markClonal(row, parentId, parentSpecies?.id || parent.speciesId || null);
      return;
    }

    const key = `${world.seed || 'eidolon'}|mate|${world.tick}|${parentId}|${mate.id}|${row.id}`;
    child.dna = recombineDna(parent.dna, mate.organism.dna, key, row.guild);
    child.preferredTemperature = recombineScalar(
      parent.preferredTemperature,
      mate.organism.preferredTemperature,
      `${key}|thermal`,
      0.05,
      0.95,
      0.018,
    );
    child.sociality = recombineScalar(
      parent.sociality,
      mate.organism.sociality,
      `${key}|social`,
      0.02,
      0.98,
      0.025,
    );
    child.diseaseResistance = recombineScalar(
      parent.diseaseResistance,
      mate.organism.diseaseResistance,
      `${key}|resistance`,
      0.05,
      0.99,
      0.02,
    );

    const originalGenome = cloneGenome(child.visualGenome);
    const mateGenome = cloneGenome(mate.organism.visualGenome);
    if (originalGenome && mateGenome) {
      child.visualGenome = recombineVisualGenome(
        originalGenome,
        mateGenome,
        key,
        parentId,
        mate.id,
        world.tick,
      );
      recombinedVisualGenomes += 1;
    }

    const mateSpecies = mate.species;
    const parentSpeciesId = parentSpecies?.id || parent.speciesId || null;
    const mateSpeciesId = mateSpecies?.id || mate.organism.speciesId || null;
    const crossSpecies = Boolean(
      parentSpeciesId &&
      mateSpeciesId &&
      parentSpeciesId !== mateSpeciesId
    );

    child.parentEntityIds = [parentId, mate.id];
    child.secondParentEntityId = mate.id;
    child.reproductionMode = 'sexual-recombination';
    child.mateCompatibility = round(mate.compatibility);
    child.mateDistance = round(mate.distance);
    child.geneFlowBridge = crossSpecies;
    child.parentSpeciesIds = [parentSpeciesId, mateSpeciesId].filter(Boolean);
    child.hybridSpeciesIds = crossSpecies
      ? [parentSpeciesId, mateSpeciesId]
      : null;

    if (parent.lineageCapsuleId || mate.organism.lineageCapsuleId) {
      child.parentLineageIds = [
        parent.lineageCapsuleId || null,
        mate.organism.lineageCapsuleId || null,
      ];
    }

    sexualBirths += 1;
    if (crossSpecies) crossSpeciesBirths += 1;
    recordGeneFlow(parentSpeciesId, mateSpeciesId, mate.compatibility, crossSpecies);

    lastBirth = {
      childId: row.id,
      parentIds: [parentId, mate.id],
      guild: row.guild,
      tick: world.tick,
      mode: 'sexual-recombination',
      compatibility: round(mate.compatibility),
      distance: round(mate.distance),
      parentSpeciesIds: [parentSpeciesId, mateSpeciesId],
      crossSpecies,
    };
  }

  function markClonal(row, parentId, speciesId = null) {
    const child = row.organism;
    child.parentEntityIds = parentId == null ? [] : [parentId];
    child.secondParentEntityId = null;
    child.reproductionMode = 'facultative-clonal-fallback';
    child.mateCompatibility = null;
    child.geneFlowBridge = false;
    clonalFallbackBirths += 1;
    lastBirth = {
      childId: row.id,
      parentIds: child.parentEntityIds.slice(),
      guild: row.guild,
      tick: world.tick,
      mode: 'facultative-clonal-fallback',
      parentSpeciesIds: speciesId ? [speciesId] : [],
      crossSpecies: false,
    };
  }

  function recordGeneFlow(a, b, compatibility, crossSpecies) {
    if (!a || !b) return;
    const key = pairKey(a, b);
    const previous = geneFlow.get(key) || {
      speciesA: a < b ? a : b,
      speciesB: a < b ? b : a,
      births: 0,
      crossSpeciesBirths: 0,
      meanCompatibility: 0,
      lastTick: world.tick,
    };
    const births = previous.births + 1;
    previous.meanCompatibility =
      (previous.meanCompatibility * previous.births + compatibility) / births;
    previous.births = births;
    previous.crossSpeciesBirths += crossSpecies ? 1 : 0;
    previous.lastTick = world.tick;
    geneFlow.set(key, previous);
  }

  function flowStrength(record) {
    const age = Math.max(0, world.tick - record.lastTick);
    const recency = Math.exp(-age / FLOW_DECAY_TICKS);
    const evidence = 1 - Math.exp(-record.births / 4);
    return clamp(recency * evidence * record.meanCompatibility, 0, 1);
  }

  function getFlowBetween(speciesA, speciesB) {
    const record = geneFlow.get(pairKey(speciesA, speciesB));
    if (!record) return 0;
    return round(flowStrength(record));
  }

  function getSpeciesFlow(speciesId) {
    let strongest = 0;
    let total = 0;
    let links = 0;
    for (const record of geneFlow.values()) {
      if (record.speciesA !== speciesId && record.speciesB !== speciesId) continue;
      const strength = flowStrength(record);
      strongest = Math.max(strongest, strength);
      total += strength;
      links += 1;
    }
    return {
      strongest: round(strongest),
      mean: links ? round(total / links) : 0,
      links,
    };
  }

  function getSnapshot() {
    const activeFlows = [...geneFlow.values()]
      .map(record => ({
        ...record,
        meanCompatibility: round(record.meanCompatibility),
        strength: round(flowStrength(record)),
      }))
      .filter(record => record.strength >= 0.03)
      .sort((a, b) => b.strength - a.strength);

    return {
      version: MODEL_VERSION,
      model: 'mate-choice-recombination-gene-flow',
      sexualBirths,
      clonalFallbackBirths,
      crossSpeciesBirths,
      recombinedVisualGenomes,
      activeGeneFlowLinks: activeFlows.length,
      activeFlows,
      lastBirth,
      mateChoice: 'distance-genetic-thermal-compatibility',
      reproduction: 'facultative-sexual-with-isolated-clonal-fallback',
      populationCap: null,
    };
  }

  function destroy() {
    active = false;
    if (world.step === wrappedStep) world.step = previousStep;
  }

  return { getSnapshot, getFlowBetween, getSpeciesFlow, destroy };
}

export function chooseMate({
  world,
  biosphere,
  guild,
  childId,
  parentId,
  parent,
  parentPos,
  parentSpecies,
}) {
  const components = world.ecs.components;
  const radius = matingRadius(guild, parent);
  let best = null;

  for (const row of livingRows(components)) {
    if (row.guild !== guild || row.id === parentId || row.id === childId) continue;
    const pos = components.position.get(row.id);
    if (!pos) continue;
    const distance = sphericalDistance(parentPos, pos, world.width);
    if (distance > radius) continue;

    const genetic = dnaDistance(parent.dna, row.organism.dna);
    const thermal = Math.abs(
      finite(parent.preferredTemperature, finite(parentSpecies?.temp, 0.55)) -
      finite(
        row.organism.preferredTemperature,
        finite(speciesOf(biosphere, row.id, row.organism)?.temp, 0.55),
      )
    );
    const distanceCost = distance / radius;
    const compatibility = clamp(
      1 - genetic * 0.64 - thermal * 0.22 - distanceCost * 0.14,
      0,
      1,
    );
    if (compatibility < MIN_COMPATIBILITY) continue;

    const species = speciesOf(biosphere, row.id, row.organism);
    const score =
      compatibility +
      clamp(finite(row.organism.energy, 1) / 5, 0, 0.12) +
      clamp(finite(row.organism.sociality, 0.5), 0, 1) * 0.025;

    if (!best || score > best.score) {
      best = {
        id: row.id,
        organism: row.organism,
        species,
        compatibility,
        distance,
        score,
      };
    }
  }

  return best;
}

function matingRadius(guild, organism) {
  const sense = clamp(finite(organism?.dna?.sense, 1), 0.35, 2.2);
  const sociality = clamp(finite(organism?.sociality, 0.5), 0, 1);
  const base = guild === 'apex' ? 150 : guild === 'predator' ? 120 : 92;
  return base * (0.72 + sense * 0.24 + sociality * 0.12);
}

export function recombineDna(a, b, key, guild = 'grazer') {
  const random = seededRandom(hashText(key));
  const ranges = guild === 'predator'
    ? { speed: [0.45, 2.0], sense: [0.35, 2.1], metabolism: [0.4, 2.2], hueShift: [-80, 80] }
    : guild === 'apex'
      ? { speed: [0.5, 1.4], sense: [0.7, 1.8], metabolism: [0.5, 1.6], hueShift: [-30, 30] }
      : { speed: [0.6, 1.4], sense: [0.6, 1.5], metabolism: [0.6, 1.6], hueShift: [-60, 60] };

  return {
    speed: locus(a?.speed, b?.speed, random, ranges.speed, 0.028),
    sense: locus(a?.sense, b?.sense, random, ranges.sense, 0.032),
    metabolism: locus(a?.metabolism, b?.metabolism, random, ranges.metabolism, 0.026),
    hueShift: Math.round(locus(a?.hueShift, b?.hueShift, random, ranges.hueShift, 2.4)),
  };
}

function locus(a, b, random, range, mutation) {
  const first = finite(a, midpoint(range));
  const second = finite(b, midpoint(range));
  const alpha = 0.35 + random() * 0.30;
  const blended = first * alpha + second * (1 - alpha);
  return clamp(blended + gaussianish(random) * mutation, range[0], range[1]);
}

function recombineScalar(a, b, key, min, max, mutation) {
  const random = seededRandom(hashText(key));
  const first = finite(a, (min + max) / 2);
  const second = finite(b, first);
  const alpha = 0.38 + random() * 0.24;
  return clamp(
    first * alpha + second * (1 - alpha) + gaussianish(random) * mutation,
    min,
    max,
  );
}

export function recombineVisualGenome(first, second, key, parentA, parentB, tick) {
  const a = normalizeGenome(first);
  const b = normalizeGenome(second);
  if (!a || !b || a.sprite.width !== b.sprite.width || a.sprite.height !== b.sprite.height) {
    return a || b || first;
  }

  const random = seededRandom(hashText(`${key}|sprite`));
  const pixelsA = a.sprite.pixels;
  const pixelsB = b.sprite.pixels;
  const pixels = [];

  for (let index = 0; index < pixelsA.length; index += 1) {
    const pa = pixelsA[index];
    const pb = pixelsB[index];
    if (pa === pb) {
      pixels.push(pa);
      continue;
    }

    if (pa === '0' || pb === '0') {
      const occupied = pa === '0' ? pb : pa;
      pixels.push(random() < 0.66 ? occupied : '0');
    } else {
      pixels.push(random() < 0.5 ? pa : pb);
    }
  }

  if (!pixels.some(value => value === '1' || value === '2')) {
    return cloneGenome(first);
  }

  return {
    ...cloneGenome(first),
    sprite: {
      width: a.sprite.width,
      height: a.sprite.height,
      pixels: pixels.join(''),
    },
    generation: Math.max(finite(a.generation), finite(b.generation)) + 1,
    parentEntityId: parentA,
    secondParentEntityId: parentB,
    parentEntityIds: [parentA, parentB],
    birthTick: tick,
    mutations: Math.max(finite(a.mutations), finite(b.mutations)),
    recombined: true,
  };
}

function speciesOf(biosphere, id, organism) {
  return biosphere.getSpeciesForEntity?.(id) || (
    organism?.speciesId ? biosphere.getSpecies?.(organism.speciesId) : null
  );
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

function normalizeGenome(input) {
  if (!input?.sprite) return null;
  const width = Math.max(1, Math.floor(finite(input.sprite.width)));
  const height = Math.max(1, Math.floor(finite(input.sprite.height)));
  const count = width * height;
  const pixels = String(input.sprite.pixels || '').replace(/[^012]/g, '').slice(0, count);
  if (pixels.length !== count || !/[12]/.test(pixels)) return null;
  return {
    ...cloneGenome(input),
    sprite: { width, height, pixels },
    generation: Math.max(0, finite(input.generation)),
    mutations: Math.max(0, finite(input.mutations)),
  };
}

function cloneGenome(value) {
  if (!value || typeof value !== 'object') return null;
  return JSON.parse(JSON.stringify(value));
}

function dnaDistance(a, b) {
  const speed = Math.abs(finite(a?.speed, 1) - finite(b?.speed, 1)) / 0.95;
  const sense = Math.abs(finite(a?.sense, 1) - finite(b?.sense, 1)) / 1.0;
  const metabolism = Math.abs(finite(a?.metabolism, 1) - finite(b?.metabolism, 1)) / 1.15;
  const hue = Math.abs(finite(a?.hueShift, 0) - finite(b?.hueShift, 0)) / 140;
  return clamp((speed + sense + metabolism + hue * 0.25) / 3.25, 0, 1);
}

function sphericalDistance(a, b, width) {
  const raw = Math.abs(a.x - b.x);
  const dx = Math.min(raw, Math.max(0, width - raw));
  return Math.hypot(dx, a.y - b.y);
}

function pairKey(a, b) {
  const first = String(a ?? '');
  const second = String(b ?? '');
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function midpoint(range) {
  return (range[0] + range[1]) / 2;
}

function gaussianish(random) {
  return (random() + random() + random() - 1.5) / 1.5;
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
      version: MODEL_VERSION,
      model: 'mate-choice-recombination-gene-flow',
      disabled: true,
    }),
    getFlowBetween: () => 0,
    getSpeciesFlow: () => ({ strongest: 0, mean: 0, links: 0 }),
    destroy() {},
  };
}

if (typeof window !== 'undefined') start();
