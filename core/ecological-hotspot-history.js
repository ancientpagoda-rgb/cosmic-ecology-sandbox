const STORAGE_PREFIX = 'eidolon-regional-history-v1';
const IDENTITY_RADIUS = 205;
const MERGE_RADIUS = 235;
const MIGRATION_THRESHOLD = 72;
const SCORE_CHANGE_THRESHOLD = 0.16;
const DORMANT_AFTER_SCANS = 2;
const MAX_REGIONS = 28;
const MAX_EVENTS_PER_REGION = 18;
const POLL_MS = 950;

const TYPE_LABEL = Object.freeze({
  drought: 'drought front',
  flood: 'flood pulse',
  bloom: 'resource bloom',
  diversity: 'diversity refuge',
  predation: 'predator front',
  disease: 'disease cluster',
  lineage: 'lineage frontier',
});

function startWhenReady() {
  const start = async () => {
    try {
      if (window.realitySandboxReady) await window.realitySandboxReady;
      const detector = await waitForHotspotDetector();
      const planet = window.realitySandboxPlanet;
      const runtime = window.realitySandboxUnified;
      if (!detector || !planet?.world || !planet?.biosphere || !runtime) return;

      const history = createRegionalHistory({
        detector,
        world: planet.world,
        biosphere: planet.biosphere,
        seed: window.realitySandboxSeed?.seed || planet.world.seed || 'eidolon',
      });
      planet.regionalHistory = history;
      window.realitySandboxRegionalHistory = history;

      history.observeCurrentScan({ initial: true });
      const ui = installRegionalHistoryUi(history, runtime, planet.world);
      ui.render();

      let lastScanNumber = detector.getSnapshot?.().scanNumber ?? -1;
      const interval = window.setInterval(() => {
        if (document.hidden) return;
        const nextScan = detector.getSnapshot?.().scanNumber ?? lastScanNumber;
        if (nextScan === lastScanNumber) return;
        lastScanNumber = nextScan;
        history.observeCurrentScan();
        ui.render();
      }, POLL_MS);

      window.addEventListener('pagehide', () => window.clearInterval(interval), { once: true });
      window.dispatchEvent(new CustomEvent('eidolon-regional-history-ready', {
        detail: { regions: history.getRegions().length },
      }));
    } catch (error) {
      console.warn('[regional-history] disabled:', error);
    }
  };

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}

async function waitForHotspotDetector() {
  if (window.realitySandboxEcologicalHotspots) return window.realitySandboxEcologicalHotspots;
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      window.removeEventListener('eidolon-hotspots-ready', onReady);
      clearTimeout(timeout);
      resolve(value || null);
    };
    const onReady = () => finish(window.realitySandboxEcologicalHotspots);
    window.addEventListener('eidolon-hotspots-ready', onReady, { once: true });
    const timeout = window.setTimeout(() => finish(window.realitySandboxEcologicalHotspots), 8000);
  });
}

export function createRegionalHistory({ detector, world, biosphere, seed = 'eidolon' }) {
  const storageKey = `${STORAGE_PREFIX}:${seed}`;
  const state = readState(storageKey);
  let eventCounter = state.eventCounter || 0;

  function observeCurrentScan({ initial = false } = {}) {
    const scan = detector.getSnapshot?.() || {};
    const hotspots = detector.getHotspots?.() || [];
    if (!hotspots.length) {
      markUnmatched(new Set(), scan.scanNumber || 0, initial);
      persistState();
      return getRegions();
    }

    const previousActive = state.regions.filter(region => region.status === 'active' && !region.mergedInto);
    const matchedRegionIds = new Set();
    const claimedRegionIds = new Set();

    for (const hotspot of hotspots) {
      const candidates = state.regions
        .filter(region => !region.mergedInto && !claimedRegionIds.has(region.id))
        .map(region => ({ region, distance: distance(region, hotspot) }))
        .filter(candidate => candidate.distance <= IDENTITY_RADIUS)
        .sort((a, b) => identityCost(a.region, hotspot, a.distance) - identityCost(b.region, hotspot, b.distance));

      let region = candidates[0]?.region || null;
      if (!region) region = createRegion(hotspot, scan.scanNumber || 0);
      const wasDormant = region.status === 'dormant';
      const before = clone(region.latest);
      const movement = before ? distance(before, hotspot) : 0;
      const previousType = region.type;

      claimedRegionIds.add(region.id);
      matchedRegionIds.add(region.id);
      region.status = 'active';
      region.missedScans = 0;
      region.lastSeenTick = world.tick;
      region.lastSeenScan = scan.scanNumber || 0;
      region.observations += 1;
      region.peakScore = Math.max(finite(region.peakScore), finite(hotspot.score));
      region.x = hotspot.x;
      region.y = hotspot.y;
      region.biome = hotspot.biome;
      region.type = hotspot.type;
      region.latest = clone(hotspot);

      if (wasDormant) {
        addEvent(region, 'return', `${region.name} re-emerged as a ${label(hotspot.type)} after falling below the planet-wide hotspot threshold.`, hotspot);
      }
      if (before && movement >= MIGRATION_THRESHOLD) {
        addEvent(region, 'migration', `${region.name} shifted ${direction(before, hotspot)} by ${formatDistance(movement)}.`, hotspot);
      }
      if (before && previousType !== hotspot.type) {
        addEvent(region, 'transition', `${region.name} changed from ${label(previousType)} to ${label(hotspot.type)} as local conditions reorganized.`, hotspot);
      }
      if (before) recordScoreChange(region, before, hotspot);
      recordSpeciesChanges(region, before, hotspot);
    }

    recordMerges(previousActive, hotspots, matchedRegionIds);
    markUnmatched(matchedRegionIds, scan.scanNumber || 0, initial);
    trimRegions();
    persistState();
    return getRegions();
  }

  function createRegion(hotspot, scanNumber) {
    const region = {
      id: persistentId(seed, hotspot),
      name: hotspot.name,
      type: hotspot.type,
      x: hotspot.x,
      y: hotspot.y,
      biome: hotspot.biome,
      status: 'active',
      firstSeenTick: world.tick,
      lastSeenTick: world.tick,
      firstSeenScan: scanNumber,
      lastSeenScan: scanNumber,
      observations: 0,
      missedScans: 0,
      peakScore: hotspot.score,
      mergedInto: null,
      latest: clone(hotspot),
      events: [],
    };
    state.regions.unshift(region);
    addEvent(region, 'birth', `${region.name} first emerged as a ${label(hotspot.type)} in ${readableBiome(hotspot.biome)}.`, hotspot);
    return region;
  }

  function recordScoreChange(region, before, after) {
    const delta = finite(after.score) - finite(before.score);
    if (Math.abs(delta) < SCORE_CHANGE_THRESHOLD) return;
    if (delta > 0) addEvent(region, 'intensify', `${region.name}'s ${label(after.type)} signal strengthened to ${percent(after.score)}.`, after);
    else addEvent(region, 'weaken', `${region.name}'s ${label(after.type)} signal weakened to ${percent(after.score)}.`, after);
  }

  function recordSpeciesChanges(region, before, after) {
    if (!before?.species || !after?.species) return;
    const oldSpecies = new Map(before.species.map(species => [species.id, species]));
    const newSpecies = new Map(after.species.map(species => [species.id, species]));
    const globalSpecies = new Map((biosphere.getSpecies?.() || []).map(species => [species.id, species]));
    const ancestry = new Map((biosphere.getAncestry?.() || []).map(branch => [branch.childId, branch]));

    for (const [id, species] of oldSpecies) {
      if (finite(species.population) < 2 || newSpecies.has(id)) continue;
      const global = globalSpecies.get(id);
      const kind = global && finite(global.population) === 0 ? 'extinction' : 'local-loss';
      const text = kind === 'extinction'
        ? `${species.name} disappeared globally while ${region.name} was under observation.`
        : `${species.name} disappeared from the observed community at ${region.name}.`;
      addEvent(region, kind, text, after);
    }

    for (const [id, species] of newSpecies) {
      if (finite(species.population) < 2 || oldSpecies.has(id)) continue;
      const branch = ancestry.get(id);
      if (branch) {
        const parent = globalSpecies.get(branch.parentId);
        addEvent(region, 'speciation', `${species.name} appeared at ${region.name} as a descendant of ${parent?.name || 'an older lineage'}.`, after);
      } else {
        addEvent(region, 'colonization', `${species.name} newly appeared in the observed community at ${region.name}.`, after);
      }
    }
  }

  function recordMerges(previousActive, hotspots, matchedRegionIds) {
    for (const hotspot of hotspots) {
      const nearby = previousActive
        .filter(region => distance(region, hotspot) <= MERGE_RADIUS)
        .sort((a, b) => distance(a, hotspot) - distance(b, hotspot));
      if (nearby.length < 2) continue;
      const keeper = nearby.find(region => matchedRegionIds.has(region.id)) || nearby[0];
      for (const absorbed of nearby) {
        if (absorbed.id === keeper.id || absorbed.mergedInto) continue;
        absorbed.mergedInto = keeper.id;
        absorbed.status = 'merged';
        absorbed.lastSeenTick = world.tick;
        addEvent(absorbed, 'merge', `${absorbed.name} merged into the larger ecological pattern remembered as ${keeper.name}.`, hotspot);
        addEvent(keeper, 'merge', `${keeper.name} absorbed the neighboring pattern formerly tracked as ${absorbed.name}.`, hotspot);
      }
    }
  }

  function markUnmatched(matchedRegionIds, scanNumber, initial) {
    for (const region of state.regions) {
      if (region.mergedInto || matchedRegionIds.has(region.id) || region.status === 'merged') continue;
      region.missedScans = finite(region.missedScans) + 1;
      if (region.status === 'active' && region.missedScans >= DORMANT_AFTER_SCANS) {
        region.status = 'dormant';
        region.lastSeenScan = scanNumber;
        if (!initial) addEvent(region, 'collapse', `${region.name} fell below the planet-wide hotspot threshold; its geographic memory remains.`, region.latest);
      }
    }
  }

  function addEvent(region, kind, text, snapshot) {
    const previous = region.events?.[0];
    if (previous && previous.kind === kind && previous.text === text && previous.tick === world.tick) return;
    eventCounter += 1;
    region.events ??= [];
    region.events.unshift({
      id: `${region.id}:${world.tick}:${eventCounter}`,
      tick: world.tick,
      kind,
      text,
      snapshot: snapshot ? compactSnapshot(snapshot) : null,
    });
    region.events.length = Math.min(region.events.length, MAX_EVENTS_PER_REGION);
  }

  function identityCost(region, hotspot, separation) {
    const typePenalty = region.type === hotspot.type ? 0 : 42;
    const dormantPenalty = region.status === 'dormant' ? 12 : 0;
    return separation + typePenalty + dormantPenalty;
  }

  function trimRegions() {
    state.regions.sort((a, b) => {
      const statusRank = status => status === 'active' ? 0 : status === 'dormant' ? 1 : 2;
      return statusRank(a.status) - statusRank(b.status)
        || finite(b.lastSeenTick) - finite(a.lastSeenTick)
        || finite(b.peakScore) - finite(a.peakScore);
    });
    state.regions.length = Math.min(state.regions.length, MAX_REGIONS);
  }

  function getRegions({ includeMerged = false } = {}) {
    return state.regions
      .filter(region => includeMerged || !region.mergedInto)
      .map(clone);
  }

  function getActiveRegions() {
    return state.regions.filter(region => region.status === 'active' && !region.mergedInto).map(clone);
  }

  function getRegion(id) {
    const region = state.regions.find(item => item.id === id);
    return region ? clone(region) : null;
  }

  function getSnapshot() {
    return {
      version: 1,
      regions: getRegions(),
      active: getActiveRegions(),
      totalEvents: state.regions.reduce((sum, region) => sum + (region.events?.length || 0), 0),
    };
  }

  function persistState() {
    state.eventCounter = eventCounter;
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* memory is optional */ }
  }

  return { observeCurrentScan, getRegions, getActiveRegions, getRegion, getSnapshot };
}

function installRegionalHistoryUi(history, runtime, world) {
  const pulse = document.querySelector('.planet-pulse');
  const actions = pulse?.querySelector('.planet-pulse__actions');
  if (!pulse || !actions) return { render() {} };

  injectStyles();
  let details = pulse.querySelector('[data-regional-history]');
  if (!details) {
    details = document.createElement('details');
    details.className = 'planet-pulse__memory planet-regional-history';
    details.dataset.regionalHistory = '';
    details.innerHTML = '<summary>Regional histories</summary><ol data-regional-history-list></ol>';
    pulse.insertBefore(details, actions);
  }
  const list = details.querySelector('[data-regional-history-list]');

  function render() {
    const regions = history.getRegions().slice(0, 6);
    list.replaceChildren(...regions.map(region => {
      const item = document.createElement('li');
      item.className = `planet-regional-history__item is-${region.status}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'planet-regional-history__button';
      const latest = region.events?.[0];
      button.innerHTML = `<b>${escapeHtml(region.name)}</b><span>${escapeHtml(label(region.type))} · ${escapeHtml(region.status)}</span><small>${escapeHtml(latest?.text || 'No recorded transition yet.')}</small>`;
      button.addEventListener('click', () => focusRegion(region, runtime, world));
      item.append(button);
      return item;
    }));
  }

  return { render };
}

function focusRegion(region, runtime, world) {
  const current = runtime.getCamera?.() || {};
  runtime.setCamera?.({
    ...current,
    centerX: finite(region.x) / world.width,
    centerY: finite(region.y) / world.height,
    zoom: Math.max(2.4, finite(current.zoom) || 1),
  });
  runtime.updateInterface?.(true);
}

function injectStyles() {
  if (document.getElementById('eidolonRegionalHistoryStyles')) return;
  const style = document.createElement('style');
  style.id = 'eidolonRegionalHistoryStyles';
  style.textContent = `
    .planet-regional-history ol { display:grid; gap:6px; margin:9px 0 0; padding:0; list-style:none; }
    .planet-regional-history__button { width:100%; padding:7px 8px; border:1px solid rgb(139 184 168 / .2); border-radius:8px; background:rgb(3 8 6 / .28); color:inherit; text-align:left; cursor:pointer; }
    .planet-regional-history__button:hover { background:rgb(139 184 168 / .1); }
    .planet-regional-history__button b,.planet-regional-history__button span,.planet-regional-history__button small { display:block; }
    .planet-regional-history__button b { color:#e8eddf; font:700 10px/1.25 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
    .planet-regional-history__button span { margin-top:2px; color:#d8b56d; font:700 8px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; text-transform:uppercase; letter-spacing:.05em; }
    .planet-regional-history__button small { margin-top:4px; color:#aebbb1; font:10px/1.3 system-ui,sans-serif; }
    .planet-regional-history__item.is-dormant { opacity:.66; }
  `;
  document.head.append(style);
}

function compactSnapshot(snapshot) {
  return {
    tick: snapshot.tick,
    type: snapshot.type,
    score: snapshot.score,
    x: snapshot.x,
    y: snapshot.y,
    biome: snapshot.biome,
    animals: snapshot.animals,
    predators: snapshot.predators,
    infected: snapshot.infected,
    lineageAnimals: snapshot.lineageAnimals,
    speciesRichness: snapshot.speciesRichness,
    species: (snapshot.species || []).map(species => ({ id: species.id, name: species.name, guild: species.guild, population: species.population })),
  };
}

function readState(storageKey) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (!saved || !Array.isArray(saved.regions)) return { regions: [], eventCounter: 0 };
    return saved;
  } catch {
    return { regions: [], eventCounter: 0 };
  }
}

function persistentId(seed, hotspot) {
  const key = `${seed}|${Math.round(finite(hotspot.x) / 60)}|${Math.round(finite(hotspot.y) / 60)}|${hotspot.name || ''}`;
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `region-${(hash >>> 0).toString(36)}`;
}

function distance(a, b) {
  const worldWidth = window.realitySandboxPlanet?.world?.width || 1200;
  const dx = Math.min(Math.abs(finite(a.x) - finite(b.x)), worldWidth - Math.abs(finite(a.x) - finite(b.x)));
  return Math.hypot(dx, finite(a.y) - finite(b.y));
}

function direction(from, to) {
  const worldWidth = window.realitySandboxPlanet?.world?.width || 1200;
  let dx = finite(to.x) - finite(from.x);
  if (dx > worldWidth / 2) dx -= worldWidth;
  if (dx < -worldWidth / 2) dx += worldWidth;
  const dy = finite(to.y) - finite(from.y);
  if (Math.abs(dx) > Math.abs(dy) * 1.4) return dx > 0 ? 'east' : 'west';
  if (Math.abs(dy) > Math.abs(dx) * 1.4) return dy > 0 ? 'south' : 'north';
  return `${dy > 0 ? 'south' : 'north'}-${dx > 0 ? 'east' : 'west'}`;
}

function formatDistance(modelUnits) {
  const km = modelUnits * finite(window.realitySandboxPlanet?.world?.geography?.kilometresPerModelUnit || 100);
  return km >= 1000 ? `${Math.round(km / 100) * 100} km` : `${Math.round(km)} km`;
}

function label(type) {
  return TYPE_LABEL[type] || String(type || 'ecological hotspot');
}

function readableBiome(value) {
  return String(value || 'wildland').replace(/[-_]/g, ' ');
}

function percent(value) {
  return `${Math.round(Math.max(0, Math.min(1, finite(value))) * 100)}%`;
}

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

startWhenReady();
