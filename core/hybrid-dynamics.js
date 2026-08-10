const MODEL_VERSION = 1;
const ZONE_RESCAN_TICKS = 90;
const HYBRID_ZONE_RADIUS = 115;
const FLOW_RING_THRESHOLD = 0.08;
const FLOW_SEPARATION_THRESHOLD = 0.035;

async function start() {
  try {
    if (window.realitySandboxReady) await window.realitySandboxReady;
    await waitForReproductiveIsolation();

    const planet = window.realitySandboxPlanet;
    if (!planet?.world?.ecs || !planet?.biosphere || !planet?.reproductiveIsolation) return;

    const api = installHybridDynamics({
      world: planet.world,
      biosphere: planet.biosphere,
      reproductiveIsolation: planet.reproductiveIsolation,
    });

    planet.hybridDynamics = api;
    planet.world.hybridDynamics = api;
    window.realitySandboxHybridDynamics = api;
    window.dispatchEvent(new CustomEvent('eidolon-hybrid-dynamics-ready', {
      detail: api.getSnapshot(),
    }));
    window.addEventListener('pagehide', api.destroy, { once: true });
  } catch (error) {
    console.warn('[hybrid-dynamics] disabled:', error);
  }
}

function waitForReproductiveIsolation() {
  if (window.realitySandboxReproductiveIsolation) return Promise.resolve();
  return new Promise(resolve => {
    const timeout = setTimeout(resolve, 2800);
    window.addEventListener('eidolon-reproductive-isolation-ready', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

export function installHybridDynamics({ world, biosphere, reproductiveIsolation }) {
  const previousStep = world.step;
  if (typeof previousStep !== 'function') return emptyApi();

  const known = new Set(livingRows(world.ecs.components).map(row => row.id));
  let sexualBirthsTracked = 0;
  let introgressedBirths = 0;
  let clonalAncestryCopies = 0;
  let viabilityAdjustedBirths = 0;
  let lastBirth = null;
  let lastZoneScanTick = -Infinity;
  let cachedZones = [];
  let cachedRingCandidates = [];
  let active = true;

  seedPureAncestry();

  function wrappedStep(dt) {
    previousStep.call(world, dt);
    if (!active) return;

    const rows = livingRows(world.ecs.components);
    for (const row of rows) {
      if (known.has(row.id)) continue;
      processBirth(row);
    }

    known.clear();
    for (const row of rows) known.add(row.id);

    if (world.tick - lastZoneScanTick >= ZONE_RESCAN_TICKS || world.tick < lastZoneScanTick) {
      rescanEmergentStructure(rows);
    }
  }

  world.step = wrappedStep;

  function seedPureAncestry() {
    for (const row of livingRows(world.ecs.components)) {
      if (normalizeAncestry(row.organism.genomicAncestry)) continue;
      const spec = speciesOf(biosphere, row.id, row.organism);
      const speciesId = spec?.id || row.organism.speciesId;
      if (!speciesId) continue;
      row.organism.genomicAncestry = { [speciesId]: 1 };
      row.organism.hybridIndex = 0;
      row.organism.introgressed = false;
    }
  }

  function processBirth(row) {
    const child = row.organism;
    const parentIds = Array.isArray(child.parentEntityIds)
      ? child.parentEntityIds.filter(id => id != null)
      : child.parentEntityId == null ? [] : [child.parentEntityId];

    if (child.reproductionMode === 'sexual-recombination' && parentIds.length >= 2) {
      const parentA = findOrganism(world.ecs.components, parentIds[0]);
      const parentB = findOrganism(world.ecs.components, parentIds[1]);
      const speciesIds = Array.isArray(child.parentSpeciesIds) ? child.parentSpeciesIds : [];
      const ancestryA = ancestryForParent(parentA, speciesIds[0]);
      const ancestryB = ancestryForParent(parentB, speciesIds[1]);
      const ancestry = combineAncestry(ancestryA, ancestryB);
      const hybridIndex = ancestryHybridIndex(ancestry);

      child.genomicAncestry = ancestry;
      child.hybridIndex = hybridIndex;
      child.introgressed = Object.keys(ancestry).length > 1;
      child.ancestryGeneration = Math.max(
        finite(parentA?.ancestryGeneration),
        finite(parentB?.ancestryGeneration),
      ) + 1;

      const geneticDistance = parentA && parentB ? dnaDistance(parentA.dna, parentB.dna) : 0;
      const compatibility = clamp(finite(child.mateCompatibility, 0.7), 0, 1);
      const viability = developmentalViability(compatibility, geneticDistance);
      child.developmentalViability = viability;
      child.parentalGeneticDistance = round(geneticDistance);
      if (Number.isFinite(child.energy)) {
        child.energy = Math.max(0.04, child.energy * viability);
        viabilityAdjustedBirths += 1;
      }

      if (Number.isFinite(child.diseaseResistance)) {
        const heterosis = Math.max(0, 1 - Math.abs(geneticDistance - 0.24) / 0.24);
        child.diseaseResistance = clamp(
          child.diseaseResistance + heterosis * compatibility * 0.025,
          0.05,
          0.99,
        );
      }

      sexualBirthsTracked += 1;
      if (child.introgressed) introgressedBirths += 1;
      lastBirth = {
        childId: row.id,
        parentIds: parentIds.slice(0, 2),
        mode: 'sexual-recombination',
        genomicAncestry: { ...ancestry },
        hybridIndex: round(hybridIndex),
        developmentalViability: round(viability),
        geneticDistance: round(geneticDistance),
        tick: world.tick,
      };
      return;
    }

    const parent = parentIds.length ? findOrganism(world.ecs.components, parentIds[0]) : null;
    const fallbackSpecies = child.speciesId || speciesOf(biosphere, row.id, child)?.id || null;
    child.genomicAncestry = ancestryForParent(parent, fallbackSpecies);
    child.hybridIndex = ancestryHybridIndex(child.genomicAncestry);
    child.introgressed = Object.keys(child.genomicAncestry).length > 1;
    child.ancestryGeneration = finite(parent?.ancestryGeneration) + 1;
    clonalAncestryCopies += 1;

    lastBirth = {
      childId: row.id,
      parentIds: parentIds.slice(0, 1),
      mode: child.reproductionMode || 'lineal-inheritance',
      genomicAncestry: { ...child.genomicAncestry },
      hybridIndex: round(child.hybridIndex),
      tick: world.tick,
    };
  }

  function rescanEmergentStructure(rows = livingRows(world.ecs.components)) {
    lastZoneScanTick = world.tick;
    cachedZones = findHybridZones(rows, world);
    cachedRingCandidates = detectRingCandidates(reproductiveIsolation.getSnapshot?.().activeFlows || []);
  }

  function getSnapshot() {
    const rows = livingRows(world.ecs.components);
    let introgressedLiving = 0;
    let ancestryRichness = 0;
    let maxHybridIndex = 0;
    const represented = new Set();

    for (const row of rows) {
      const ancestry = normalizeAncestry(row.organism.genomicAncestry);
      if (!ancestry) continue;
      const keys = Object.keys(ancestry);
      for (const key of keys) represented.add(key);
      if (keys.length > 1) introgressedLiving += 1;
      ancestryRichness = Math.max(ancestryRichness, keys.length);
      maxHybridIndex = Math.max(maxHybridIndex, ancestryHybridIndex(ancestry));
    }

    return {
      version: MODEL_VERSION,
      model: 'multigenerational-introgression-hybrid-zones-ring-bridges',
      sexualBirthsTracked,
      introgressedBirths,
      clonalAncestryCopies,
      viabilityAdjustedBirths,
      livingIntrogressedOrganisms: introgressedLiving,
      representedAncestralSpecies: represented.size,
      maxAncestryRichness: ancestryRichness,
      maxHybridIndex: round(maxHybridIndex),
      hybridZones: cachedZones.map(zone => ({ ...zone, species: zone.species.slice() })),
      ringSpeciesCandidates: cachedRingCandidates.map(candidate => ({ ...candidate, chain: candidate.chain.slice() })),
      lastBirth,
      populationCap: null,
      displayCap: null,
    };
  }

  function destroy() {
    active = false;
    if (world.step === wrappedStep) world.step = previousStep;
  }

  rescanEmergentStructure();
  return { getSnapshot, rescanEmergentStructure, destroy };
}

export function combineAncestry(a, b) {
  const first = normalizeAncestry(a) || {};
  const second = normalizeAncestry(b) || {};
  const merged = {};
  for (const [id, share] of Object.entries(first)) merged[id] = (merged[id] || 0) + share * 0.5;
  for (const [id, share] of Object.entries(second)) merged[id] = (merged[id] || 0) + share * 0.5;
  return normalizeAncestry(merged) || {};
}

function ancestryForParent(parent, fallbackSpeciesId) {
  const inherited = normalizeAncestry(parent?.genomicAncestry);
  if (inherited) return inherited;
  const speciesId = String(fallbackSpeciesId || parent?.speciesId || '').trim();
  return speciesId ? { [speciesId]: 1 } : {};
}

function normalizeAncestry(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const rows = Object.entries(input)
    .map(([id, value]) => [String(id).slice(0, 96), Math.max(0, finite(value))])
    .filter(([id, value]) => id && value > 0.0005);
  if (!rows.length) return null;
  const total = rows.reduce((sum, [, value]) => sum + value, 0);
  if (!(total > 0)) return null;
  return Object.fromEntries(rows.map(([id, value]) => [id, value / total]));
}

function ancestryHybridIndex(input) {
  const ancestry = normalizeAncestry(input);
  if (!ancestry) return 0;
  const shares = Object.values(ancestry);
  if (shares.length <= 1) return 0;
  return clamp(1 - Math.max(...shares), 0, 1);
}

export function developmentalViability(compatibility, geneticDistance) {
  const c = clamp(finite(compatibility), 0, 1);
  const d = clamp(finite(geneticDistance), 0, 1);
  const incompatibilityCost = (1 - c) * 0.22;
  const extremeDistanceCost = Math.max(0, d - 0.58) * 0.34;
  const moderateDiversityBenefit = Math.max(0, 1 - Math.abs(d - 0.24) / 0.24) * 0.035 * c;
  return clamp(1 - incompatibilityCost - extremeDistanceCost + moderateDiversityBenefit, 0.72, 1.04);
}

function findHybridZones(rows, world) {
  const hybrids = [];
  for (const row of rows) {
    const ancestry = normalizeAncestry(row.organism.genomicAncestry);
    if (!ancestry || Object.keys(ancestry).length < 2) continue;
    const pos = world.ecs.components.position.get(row.id);
    if (!pos) continue;
    hybrids.push({ id: row.id, pos, ancestry, energy: finite(row.organism.energy, 0) });
  }
  if (!hybrids.length) return [];

  const cellSize = HYBRID_ZONE_RADIUS;
  const columns = Math.max(1, Math.ceil(world.width / cellSize));
  const buckets = new Map();
  for (let index = 0; index < hybrids.length; index += 1) {
    const item = hybrids[index];
    const cx = Math.floor(item.pos.x / cellSize) % columns;
    const cy = Math.floor(item.pos.y / cellSize);
    const key = `${cx}|${cy}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(index);
  }

  const seen = new Set();
  const zones = [];
  for (let start = 0; start < hybrids.length; start += 1) {
    if (seen.has(start)) continue;
    const component = [];
    const queue = [start];
    seen.add(start);

    while (queue.length) {
      const index = queue.pop();
      const item = hybrids[index];
      component.push(item);
      const cx = Math.floor(item.pos.x / cellSize) % columns;
      const cy = Math.floor(item.pos.y / cellSize);

      for (let ox = -1; ox <= 1; ox += 1) {
        const nx = (cx + ox + columns) % columns;
        for (let oy = -1; oy <= 1; oy += 1) {
          const candidates = buckets.get(`${nx}|${cy + oy}`) || [];
          for (const candidateIndex of candidates) {
            if (seen.has(candidateIndex)) continue;
            const other = hybrids[candidateIndex];
            if (sphericalDistance(item.pos, other.pos, world.width) > HYBRID_ZONE_RADIUS) continue;
            seen.add(candidateIndex);
            queue.push(candidateIndex);
          }
        }
      }
    }

    if (component.length < 2) continue;
    zones.push(summarizeZone(component, world));
  }

  return zones.sort((a, b) => b.individuals - a.individuals);
}

function summarizeZone(component, world) {
  let sin = 0;
  let cos = 0;
  let y = 0;
  let energy = 0;
  let hybridIndex = 0;
  const species = new Set();
  for (const item of component) {
    const angle = item.pos.x / world.width * Math.PI * 2;
    sin += Math.sin(angle);
    cos += Math.cos(angle);
    y += item.pos.y;
    energy += item.energy;
    hybridIndex += ancestryHybridIndex(item.ancestry);
    for (const id of Object.keys(item.ancestry)) species.add(id);
  }
  const angle = Math.atan2(sin / component.length, cos / component.length);
  return {
    id: `hybrid-zone-${hashText([...species].sort().join('|') + '|' + Math.round(y / component.length)).toString(36)}`,
    x: round(((angle / (Math.PI * 2)) * world.width + world.width) % world.width),
    y: round(y / component.length),
    individuals: component.length,
    species: [...species].sort(),
    meanHybridIndex: round(hybridIndex / component.length),
    meanEnergy: round(energy / component.length),
  };
}

export function detectRingCandidates(activeFlows) {
  const edges = new Map();
  const nodes = new Set();
  for (const flow of activeFlows || []) {
    const a = String(flow.speciesA || '');
    const b = String(flow.speciesB || '');
    const strength = clamp(finite(flow.strength), 0, 1);
    if (!a || !b || a === b || strength < FLOW_SEPARATION_THRESHOLD) continue;
    nodes.add(a);
    nodes.add(b);
    edges.set(pairKey(a, b), strength);
  }

  const candidates = [];
  const dedupe = new Set();
  const list = [...nodes].sort();
  for (const bridge of list) {
    const neighbors = list.filter(node => node !== bridge && (edges.get(pairKey(bridge, node)) || 0) >= FLOW_RING_THRESHOLD);
    for (let i = 0; i < neighbors.length; i += 1) {
      for (let j = i + 1; j < neighbors.length; j += 1) {
        const a = neighbors[i];
        const c = neighbors[j];
        const direct = edges.get(pairKey(a, c)) || 0;
        if (direct >= FLOW_SEPARATION_THRESHOLD) continue;
        const ab = edges.get(pairKey(a, bridge)) || 0;
        const bc = edges.get(pairKey(bridge, c)) || 0;
        const key = [a, c].sort().join('|') + `|${bridge}`;
        if (dedupe.has(key)) continue;
        dedupe.add(key);
        candidates.push({
          chain: [a, bridge, c],
          bridge,
          endpointFlow: round(direct),
          bridgeFlow: round(Math.min(ab, bc)),
          ringLikeScore: round(Math.min(ab, bc) * (1 - direct)),
        });
      }
    }
  }

  return candidates.sort((a, b) => b.ringLikeScore - a.ringLikeScore);
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

function speciesOf(biosphere, id, organism) {
  return biosphere.getSpeciesForEntity?.(id) || null;
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
    getSnapshot: () => ({ version: MODEL_VERSION, model: 'multigenerational-introgression-hybrid-zones-ring-bridges', disabled: true }),
    rescanEmergentStructure() {},
    destroy() {},
  };
}

if (typeof window !== 'undefined') start();
