const FORMAT = 'nysa-lineage-1';
const MAX_CATALOG = 24;
const TRAIT_LIMITS = Object.freeze({
  speed: [0.6, 1.4],
  sense: [0.6, 1.5],
  metabolism: [0.6, 1.6],
  thermal: [0.08, 0.92],
});
const GUILDS = new Set(['grazer', 'predator', 'apex']);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function createLineageFoundry({ world, biosphere, living, journal, seed = 'nysa' }) {
  const catalog = new Map();
  const releases = [];

  function create(draft = {}) {
    const guild = GUILDS.has(draft.guild) ? draft.guild : 'grazer';
    const traits = normalizeTraits(draft.traits);
    const visual = normalizeVisual(draft.visual);
    const name = cleanName(draft.name || defaultName(guild));
    const parentId = cleanId(draft.ancestry?.parentId);
    const capsule = {
      format: FORMAT,
      id: lineageId({ name, guild, traits, visual, parentId, seed }),
      name,
      guild,
      traits,
      visual,
      ancestry: { parentId: parentId || null },
      provenance: { origin: 'Nysa Lineage Foundry', simulation: 'cosmic-ecology-sandbox' },
    };
    catalog.set(capsule.id, capsule);
    trimCatalog();
    persist();
    return clone(capsule);
  }

  function importCapsule(source) {
    const parsed = typeof source === 'string' ? JSON.parse(source) : source;
    if (!parsed || parsed.format !== FORMAT) throw new Error('This is not a Nysa lineage capsule.');
    const capsule = create({
      name: parsed.name,
      guild: parsed.guild,
      traits: parsed.traits,
      visual: parsed.visual,
      ancestry: parsed.ancestry,
    });
    // Preserve a valid supplied identity so imported capsules remain portable.
    if (typeof parsed.id === 'string' && /^lin-[a-z0-9]{8}$/.test(parsed.id)) {
      catalog.delete(capsule.id);
      capsule.id = parsed.id;
      catalog.set(capsule.id, capsule);
      persist();
    }
    return clone(capsule);
  }

  function release(capsuleOrId, point = {}) {
    const capsule = typeof capsuleOrId === 'string' ? catalog.get(capsuleOrId) : importCapsule(capsuleOrId);
    if (!capsule) throw new Error('Choose a lineage before releasing it.');
    const x = wrap(finite(point.x, world.width * 0.5), world.width);
    const y = clamp(finite(point.y, world.height * 0.5), 0, world.height);
    const habitat = findViableHabitat(living, world, x, y, capsule.traits.thermal);
    const result = biosphere.releaseLineage(capsule, { x: habitat.x, y: habitat.y, count: 5 });
    const release = { lineageId: capsule.id, speciesId: result.id, tick: world.tick, x: habitat.x, y: habitat.y, selectedX: x, selectedY: y };
    releases.unshift(release);
    if (releases.length > 36) releases.length = 36;
    persist();
    return { capsule: clone(capsule), species: result, release: { ...release } };
  }

  function exportCapsule(capsuleOrId) {
    const capsule = typeof capsuleOrId === 'string' ? catalog.get(capsuleOrId) : capsuleOrId;
    if (!capsule) throw new Error('No lineage selected for export.');
    return JSON.stringify(capsule, null, 2);
  }

  function list() { return [...catalog.values()].map(clone); }

  function trimCatalog() {
    while (catalog.size > MAX_CATALOG) catalog.delete(catalog.keys().next().value);
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey(seed)) || '{}');
      for (const capsule of saved.catalog || []) importCapsule(capsule);
      releases.splice(0, releases.length, ...(saved.releases || []).slice(0, 36));
    } catch {
      // A malformed local cache must never prevent the ecosystem from loading.
    }
  }

  function persist() {
    try {
      localStorage.setItem(storageKey(seed), JSON.stringify({ catalog: list(), releases }));
    } catch {
      // Export still works when browser storage is unavailable.
    }
  }

  load();
  return { format: FORMAT, create, import: importCapsule, release, export: exportCapsule, list, getReleases: () => releases.map(item => ({ ...item })) };
}

function normalizeTraits(input = {}) {
  return Object.fromEntries(Object.entries(TRAIT_LIMITS).map(([key, [min, max]]) => [key, clamp(finite(input[key], (min + max) / 2), min, max)]));
}

function normalizeVisual(input = {}) {
  const candidate = typeof input.color === 'string' ? input.color.replace('#', '') : Number(input.color).toString(16);
  const color = /^[0-9a-f]{6}$/i.test(candidate) ? `#${candidate.toLowerCase()}` : '#69d8ff';
  return { color, form: ['kite', 'beetle', 'crown'].includes(input.form) ? input.form : 'kite' };
}

function cleanName(value) {
  const normalized = String(value || '').trim().replace(/[^\w\s'-]/g, '').replace(/\s+/g, ' ').slice(0, 32);
  return normalized || 'Unnamed Wanderer';
}

function cleanId(value) { return typeof value === 'string' && /^[a-z0-9-]{3,64}$/i.test(value) ? value : null; }
function defaultName(guild) { return guild === 'apex' ? 'Glass Crown' : guild === 'predator' ? 'Cinder Prowler' : 'Lumen Grazer'; }
function wrap(value, max) { return ((value % max) + max) % max; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function storageKey(seed) { return `nysa-lineage-foundry-v1:${seed}`; }

function lineageId(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `lin-${(hash >>> 0).toString(36).padStart(8, '0').slice(-8)}`;
}

function findViableHabitat(living, world, x, y, thermal) {
  if (typeof living?.sampleDynamicPlanet !== 'function') return { x, y };
  let best = null;
  for (let ring = 0; ring <= 12; ring++) {
    const radius = ring * 26;
    const samples = ring ? 12 : 1;
    for (let index = 0; index < samples; index++) {
      const angle = index / samples * Math.PI * 2;
      const candidate = { x: wrap(x + Math.cos(angle) * radius, world.width), y: clamp(y + Math.sin(angle) * radius, 0, world.height) };
      const terrain = living.sampleDynamicPlanet(candidate.x, candidate.y);
      if (!terrain?.land || terrain.biome === 'ice') continue;
      const score = 1 - Math.abs((terrain.temperature ?? thermal) - thermal) + (terrain.rainfall ?? 0) * 0.12 - radius / 5000 - localPredatorRisk(world, candidate) * 3;
      if (!best || score > best.score) best = { ...candidate, score };
    }
  }
  return best || { x, y };
}

function localPredatorRisk(world, point) {
  const components = world.ecs?.components;
  if (!components?.position) return 0;
  let risk = 0;
  for (const group of [components.predator, components.apex]) {
    for (const [id] of group || []) {
      const position = components.position.get(id);
      if (!position) continue;
      const dx = Math.min(Math.abs(point.x - position.x), world.width - Math.abs(point.x - position.x));
      const distance = Math.hypot(dx, point.y - position.y);
      if (distance < 85) risk += 1 - distance / 85;
    }
  }
  return Math.min(1, risk);
}
