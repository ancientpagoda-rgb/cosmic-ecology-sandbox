const FORMAT = 'eidolon-atlas-1';
const COLUMNS = 12;
const ROWS = 8;
const MAX_SIGHTINGS = 48;
const EAST = ['Glass', 'Morrow', 'Lumen', 'Vesper', 'Cinder', 'Viridian', 'Sable', 'Iridescent', 'Pale', 'Hollow', 'Amber', 'Serein'];
const WEST = ['Reach', 'Basin', 'Fold', 'Drift', 'Shoal', 'March', 'Veil', 'Shelf'];

export function createEidolonAtlas({ world, living, biosphere, journal, seed = 'eidolon', relayUrl = '' }) {
  const sites = new Map();
  const sightings = [];
  const remoteSightings = [];
  let relayState = relayUrl ? 'ready to sync' : 'offline-first';

  function regionAt(point = {}) {
    const x = wrap(finite(point.x, world.width * 0.5), world.width);
    const y = clamp(finite(point.y, world.height * 0.5), 0, world.height);
    const column = Math.min(COLUMNS - 1, Math.floor(x / world.width * COLUMNS));
    const row = Math.min(ROWS - 1, Math.floor(y / world.height * ROWS));
    const id = `${String.fromCharCode(65 + row)}${String(column + 1).padStart(2, '0')}`;
    return {
      id,
      column,
      row,
      x: (column + 0.5) / COLUMNS * world.width,
      y: (row + 0.5) / ROWS * world.height,
      name: `${EAST[column]} ${WEST[row]}`,
    };
  }

  function survey(point) {
    const region = regionAt(point);
    const terrain = living?.sampleDynamicPlanet?.(region.x, region.y) || {};
    const nearby = biosphere?.getNearbySpecies?.(region.x, region.y, Math.max(world.width / COLUMNS, world.height / ROWS) * 0.82) || [];
    const site = sites.get(region.id);
    return {
      ...region,
      biome: terrain.biome || 'unclassified',
      temperature: Number(terrain.temperature || 0),
      rainfall: Number(terrain.rainfall || 0),
      population: nearby.reduce((total, species) => total + (species.population || 0), 0),
      lineages: nearby.map(species => ({ id: species.id, name: species.name, guild: species.guild, population: species.population })),
      site: site ? { ...site } : null,
    };
  }

  function markSite(point, note = '') {
    const region = regionAt(point);
    const site = {
      regionId: region.id,
      tick: world.tick,
      note: cleanNote(note) || 'field site established',
    };
    sites.set(region.id, site);
    persist();
    journal?.record('Field site established', `${region.name} (${region.id}) is now charted in the local Eidolon Atlas.`, 'atlas');
    return { ...region, ...site };
  }

  function recordRelease(result) {
    if (!result?.capsule || !result?.release) return null;
    const region = regionAt(result.release);
    const sighting = {
      id: `${result.capsule.id}-${world.tick}-${sightings.length}`,
      lineageId: result.capsule.id,
      speciesId: result.species?.id || null,
      name: result.capsule.name,
      guild: result.capsule.guild,
      regionId: region.id,
      tick: world.tick,
    };
    sightings.unshift(sighting);
    if (sightings.length > MAX_SIGHTINGS) sightings.length = MAX_SIGHTINGS;
    persist();
    journal?.record('Lineage sighted', `${sighting.name} was released into ${region.name} (${region.id}).`, 'atlas');
    return { ...sighting };
  }

  function getLattice(point) {
    const focus = regionAt(point);
    const cells = [];
    for (let row = Math.max(0, focus.row - 1); row <= Math.min(ROWS - 1, focus.row + 1); row += 1) {
      for (let column = Math.max(0, focus.column - 2); column <= Math.min(COLUMNS - 1, focus.column + 2); column += 1) {
        const region = regionAt({ x: (column + 0.5) / COLUMNS * world.width, y: (row + 0.5) / ROWS * world.height });
        const surveyResult = survey(region);
        cells.push({ id: region.id, biome: surveyResult.biome, selected: region.id === focus.id, charted: sites.has(region.id), sightings: allSightings().filter(item => item.regionId === region.id).length });
      }
    }
    return cells;
  }

  async function sync() {
    if (!relayUrl || typeof fetch !== 'function') return { ok: true, state: relayState, sightings: 0 };
    relayState = 'syncing';
    try {
      const url = new URL('/eidolon/sightings', relayUrl);
      url.searchParams.set('seed', seed);
      url.searchParams.set('limit', '48');
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`relay ${response.status}`);
      const payload = await response.json();
      const received = Array.isArray(payload?.events) ? payload.events.map(normalizeRemoteSighting).filter(Boolean) : [];
      remoteSightings.splice(0, remoteSightings.length, ...received);
      relayState = `synced · ${received.length} remote`;
      return { ok: true, state: relayState, sightings: received.length };
    } catch (error) {
      relayState = 'local relay unavailable';
      return { ok: false, state: relayState, error: error?.message || 'sync failed' };
    }
  }

  function allSightings() {
    return [...sightings, ...remoteSightings].filter((item, index, collection) => collection.findIndex(candidate => candidate.id === item.id) === index);
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey(seed)) || '{}');
      for (const site of saved.sites || []) if (site?.regionId) sites.set(site.regionId, site);
      sightings.push(...(saved.sightings || []).slice(0, MAX_SIGHTINGS));
    } catch {
      // Local atlas damage must never stop the planet from loading.
    }
  }

  function persist() {
    try { localStorage.setItem(storageKey(seed), JSON.stringify({ format: FORMAT, sites: [...sites.values()], sightings })); }
    catch { /* An Atlas is still useful for this session when storage is blocked. */ }
  }

  load();
  return {
    format: FORMAT,
    regionAt,
    survey,
    markSite,
    recordRelease,
    getLattice,
    getSites: () => [...sites.values()].map(site => ({ ...site })),
    getSightings: (limit = 6) => allSightings().slice(0, Math.max(0, limit)).map(sighting => ({ ...sighting })),
    getRelayState: () => relayState,
    sync,
  };
}

function finite(value, fallback) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function wrap(value, max) { return ((value % max) + max) % max; }
function cleanNote(value) { return String(value || '').trim().replace(/[^\w\s,.'-]/g, '').replace(/\s+/g, ' ').slice(0, 64); }
function storageKey(seed) { return `eidolon-atlas-v1:${seed}`; }
function normalizeRemoteSighting(event) {
  if (!event || event.kind !== 'lineage-release' || !/^\d{1,8}:[A-H](?:0[1-9]|1[0-2]):lin-[a-z0-9]{8}$/i.test(event.id || '')) return null;
  if (!/^[A-H](?:0[1-9]|1[0-2])$/i.test(event.regionId || '') || typeof event.lineageId !== 'string') return null;
  return { id: event.id, lineageId: event.lineageId, speciesId: null, name: String(event.name || 'Unknown lineage').slice(0, 32), guild: String(event.guild || 'grazer'), regionId: event.regionId, tick: Number(event.tick || 0), remote: true };
}
