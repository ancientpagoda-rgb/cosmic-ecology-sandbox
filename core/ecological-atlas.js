const STORAGE_PREFIX = 'eidolon-ecological-atlas-v1';
const POLL_MS = 700;

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
      const history = await waitForRegionalHistory();
      const planet = window.realitySandboxPlanet;
      const runtime = window.realitySandboxUnified;
      if (!history || !planet?.world || !runtime) return;

      const atlas = createEcologicalAtlas({
        history,
        world: planet.world,
        seed: window.realitySandboxSeed?.seed || planet.world.seed || 'eidolon',
      });
      planet.ecologicalAtlas = atlas;
      window.realitySandboxEcologicalAtlas = atlas;

      const ui = installAtlasUi(atlas, runtime, planet.world);
      const overlay = installAtlasOverlay(atlas, runtime, planet.world);
      ui.render();
      overlay.render();

      let lastSignature = atlas.signature();
      const interval = window.setInterval(() => {
        if (document.hidden) return;
        const signature = atlas.signature();
        if (signature !== lastSignature) {
          lastSignature = signature;
          ui.render();
        }
        overlay.render();
      }, POLL_MS);

      window.addEventListener('pagehide', () => {
        window.clearInterval(interval);
        overlay.destroy();
      }, { once: true });

      window.dispatchEvent(new CustomEvent('eidolon-ecological-atlas-ready', {
        detail: { regions: atlas.getEntries().length },
      }));
    } catch (error) {
      console.warn('[ecological-atlas] disabled:', error);
    }
  };

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}

async function waitForRegionalHistory() {
  if (window.realitySandboxRegionalHistory) return window.realitySandboxRegionalHistory;
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      window.removeEventListener('eidolon-regional-history-ready', onReady);
      clearTimeout(timeout);
      resolve(value || null);
    };
    const onReady = () => finish(window.realitySandboxRegionalHistory);
    window.addEventListener('eidolon-regional-history-ready', onReady, { once: true });
    const timeout = window.setTimeout(() => finish(window.realitySandboxRegionalHistory), 8000);
  });
}

export function createEcologicalAtlas({ history, world, seed = 'eidolon' }) {
  const storageKey = `${STORAGE_PREFIX}:${seed}`;
  let selectedId = readSelected(storageKey);

  function getEntries() {
    return history.getRegions({ includeMerged: true })
      .map(region => profile(region, world))
      .sort((a, b) => statusRank(a.status) - statusRank(b.status)
        || b.lastSeenTick - a.lastSeenTick
        || b.peakScore - a.peakScore);
  }

  function getEntry(id) {
    const region = history.getRegion(id);
    return region ? profile(region, world) : null;
  }

  function getSelected() {
    const entries = getEntries();
    const selected = entries.find(entry => entry.id === selectedId && entry.status !== 'merged')
      || entries.find(entry => entry.status === 'active')
      || entries.find(entry => entry.status === 'dormant')
      || entries[0]
      || null;
    if (selected && selected.id !== selectedId) select(selected.id);
    return selected;
  }

  function select(id) {
    selectedId = id || null;
    try {
      if (selectedId) localStorage.setItem(storageKey, selectedId);
      else localStorage.removeItem(storageKey);
    } catch { /* selection persistence is optional */ }
    return getEntry(selectedId);
  }

  function signature() {
    return history.getRegions({ includeMerged: true })
      .map(region => [region.id, region.status, region.type, region.lastSeenTick, region.events?.[0]?.id || ''].join(':'))
      .join('|');
  }

  function getSnapshot() {
    return {
      version: 1,
      selected: getSelected(),
      entries: getEntries(),
    };
  }

  return { getEntries, getEntry, getSelected, select, signature, getSnapshot };
}

function profile(region, world) {
  const events = Array.isArray(region.events) ? region.events : [];
  const chronological = [...events].reverse();
  const snapshots = chronological.map(event => event.snapshot).filter(Boolean);
  const typeSequence = [];
  for (const event of chronological) {
    const type = event.snapshot?.type;
    if (type && typeSequence[typeSequence.length - 1] !== type) typeSequence.push(type);
  }
  if (!typeSequence.length && region.type) typeSequence.push(region.type);

  let travelled = 0;
  for (let index = 1; index < snapshots.length; index += 1) travelled += modelDistance(snapshots[index - 1], snapshots[index], world);

  const latest = region.latest || snapshots[snapshots.length - 1] || {};
  const species = Array.isArray(latest.species) ? [...latest.species].sort((a, b) => finite(b.population) - finite(a.population)) : [];
  const dominant = species[0] || null;
  const eventCounts = {};
  for (const event of events) eventCounts[event.kind] = (eventCounts[event.kind] || 0) + 1;

  return {
    id: region.id,
    name: region.name,
    type: region.type,
    status: region.status,
    mergedInto: region.mergedInto || null,
    biome: region.biome,
    x: finite(region.x),
    y: finite(region.y),
    geography: geographicLabel(region, world),
    firstSeenTick: finite(region.firstSeenTick),
    lastSeenTick: finite(region.lastSeenTick),
    ageTicks: Math.max(0, finite(world.tick) - finite(region.firstSeenTick)),
    observations: finite(region.observations),
    peakScore: finite(region.peakScore),
    currentScore: finite(latest.score),
    travelledModelUnits: round(travelled),
    travelledKm: Math.round(travelled * kilometresPerModelUnit(world)),
    typeSequence,
    dominantSpecies: dominant ? { ...dominant } : null,
    currentSpecies: species,
    eventCounts,
    events: events.map(event => ({ ...event })),
    latest: clone(latest),
  };
}

function installAtlasUi(atlas, runtime, world) {
  const pulse = document.querySelector('.planet-pulse');
  const actions = pulse?.querySelector('.planet-pulse__actions');
  if (!pulse || !actions) return { render() {} };

  injectStyles();
  let details = pulse.querySelector('[data-ecological-atlas]');
  if (!details) {
    details = document.createElement('details');
    details.className = 'planet-pulse__memory planet-ecological-atlas';
    details.dataset.ecologicalAtlas = '';
    details.innerHTML = `
      <summary>Ecological atlas</summary>
      <div class="planet-atlas__body">
        <div class="planet-atlas__regions" data-atlas-regions></div>
        <article class="planet-atlas__profile" data-atlas-profile></article>
      </div>`;
    pulse.insertBefore(details, actions);
  }

  const regionsNode = details.querySelector('[data-atlas-regions]');
  const profileNode = details.querySelector('[data-atlas-profile]');

  function render() {
    const entries = atlas.getEntries();
    const selected = atlas.getSelected();

    regionsNode.replaceChildren(...entries.map(entry => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `planet-atlas__region is-${entry.status}${selected?.id === entry.id ? ' is-selected' : ''}`;
      button.dataset.regionId = entry.id;
      button.innerHTML = `<b>${escapeHtml(entry.name)}</b><span>${escapeHtml(label(entry.type))} · ${escapeHtml(entry.status)}</span>`;
      button.addEventListener('click', () => {
        atlas.select(entry.id);
        focusRegion(entry, runtime, world);
        render();
      });
      return button;
    }));

    if (!selected) {
      profileNode.innerHTML = '<p>No regional memory has formed yet.</p>';
      return;
    }

    const transitions = selected.typeSequence.map(label).join(' → ');
    const speciesText = selected.dominantSpecies
      ? `${selected.dominantSpecies.name} (${selected.dominantSpecies.population})`
      : 'none observed';
    const latestEvents = selected.events.slice(0, 5);
    profileNode.innerHTML = `
      <header><div><p class="planet-eyebrow">${escapeHtml(selected.geography)}</p><h3>${escapeHtml(selected.name)}</h3></div><span>${escapeHtml(selected.status)}</span></header>
      <dl class="planet-atlas__facts">
        <div><dt>Now</dt><dd>${escapeHtml(label(selected.type))}</dd></div>
        <div><dt>Peak</dt><dd>${escapeHtml(percent(selected.peakScore))}</dd></div>
        <div><dt>Observed</dt><dd>${selected.observations} scans</dd></div>
        <div><dt>Travel</dt><dd>${selected.travelledKm.toLocaleString()} km</dd></div>
        <div><dt>Dominant life</dt><dd>${escapeHtml(speciesText)}</dd></div>
        <div><dt>Biome</dt><dd>${escapeHtml(readableBiome(selected.biome))}</dd></div>
      </dl>
      <p class="planet-atlas__succession"><b>Succession</b> ${escapeHtml(transitions)}</p>
      <ol class="planet-atlas__timeline">${latestEvents.map(event => `<li><b>${escapeHtml(event.kind)}</b><span>${escapeHtml(event.text)}</span></li>`).join('')}</ol>
      <button type="button" data-atlas-focus>Go to ${escapeHtml(selected.name)}</button>`;
    profileNode.querySelector('[data-atlas-focus]')?.addEventListener('click', () => focusRegion(selected, runtime, world));
  }

  return { render };
}

function installAtlasOverlay(atlas, runtime, world) {
  const host = document.getElementById('world');
  const canvas = document.getElementById('lofiLivingCanvas');
  if (!host || !canvas) return { render() {}, destroy() {} };

  injectStyles();
  const layer = document.createElement('div');
  layer.className = 'planet-atlas-overlay';
  layer.setAttribute('aria-hidden', 'true');
  host.append(layer);

  function render() {
    const camera = runtime.getCamera?.();
    if (!camera || finite(camera.zoom) < 0.68) {
      layer.replaceChildren();
      return;
    }

    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const entries = atlas.getEntries().filter(entry => entry.status !== 'merged');
    const selectedId = atlas.getSelected()?.id;
    const nodes = [];

    for (const entry of entries) {
      const point = project(entry.x / world.width, entry.y / world.height, rect.width, rect.height, camera);
      if (!point.visible) continue;
      const marker = document.createElement('div');
      marker.className = `planet-atlas-marker is-${entry.status}${entry.id === selectedId ? ' is-selected' : ''}`;
      marker.style.left = `${point.x}px`;
      marker.style.top = `${point.y}px`;
      marker.style.opacity = String(clamp(0.28 + point.depth * 0.72, 0.18, 1));
      marker.innerHTML = `<i></i><span>${escapeHtml(entry.name)}</span>`;
      nodes.push(marker);
    }
    layer.replaceChildren(...nodes);
  }

  function destroy() { layer.remove(); }
  return { render, destroy };
}

function focusRegion(region, runtime, world) {
  const current = runtime.getCamera?.() || {};
  runtime.setCamera?.({
    ...current,
    centerX: finite(region.x) / world.width,
    centerY: finite(region.y) / world.height,
    zoom: Math.max(2.6, finite(current.zoom) || 1),
  });
  runtime.updateInterface?.(true);
}

function project(worldX, worldY, width, height, camera) {
  const radius = Math.min(width, height) * 0.43 * finite(camera.zoom || 1);
  const cx = width * 0.5;
  const cy = height * 0.5;
  const lon = (worldX - 0.5) * Math.PI * 2;
  const lat = (0.5 - worldY) * Math.PI;
  const lon0 = (finite(camera.centerX) - 0.5) * Math.PI * 2;
  const lat0 = (0.5 - finite(camera.centerY)) * Math.PI;
  const delta = lon - lon0;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLat0 = Math.sin(lat0);
  const cosLat0 = Math.cos(lat0);
  const x = cosLat * Math.sin(delta);
  const y = sinLat * cosLat0 - cosLat * Math.cos(delta) * sinLat0;
  const z = sinLat * sinLat0 + cosLat * Math.cos(delta) * cosLat0;
  return { x: cx + x * radius, y: cy - y * radius, depth: z, visible: z > 0 };
}

function geographicLabel(region, world) {
  const longitude = ((finite(region.x) / world.width) * 360) - 180;
  const latitude = 90 - (finite(region.y) / world.height) * 180;
  const latBand = Math.abs(latitude) < 12 ? 'equatorial' : Math.abs(latitude) < 35 ? 'subtropical' : Math.abs(latitude) < 62 ? 'temperate' : 'polar';
  const hemisphere = latitude >= 0 ? 'north' : 'south';
  const eastWest = longitude >= 0 ? 'east' : 'west';
  return `${hemisphere} ${latBand} · ${Math.abs(latitude).toFixed(1)}° ${latitude >= 0 ? 'N' : 'S'}, ${Math.abs(longitude).toFixed(1)}° ${eastWest === 'east' ? 'E' : 'W'}`;
}

function modelDistance(a, b, world) {
  const width = finite(world.width) || 1200;
  const dxRaw = Math.abs(finite(a.x) - finite(b.x));
  const dx = Math.min(dxRaw, Math.max(0, width - dxRaw));
  return Math.hypot(dx, finite(a.y) - finite(b.y));
}

function kilometresPerModelUnit(world) {
  return finite(world.geography?.kilometresPerModelUnit) || 100;
}

function injectStyles() {
  if (document.getElementById('eidolonEcologicalAtlasStyles')) return;
  const style = document.createElement('style');
  style.id = 'eidolonEcologicalAtlasStyles';
  style.textContent = `
    .planet-ecological-atlas .planet-atlas__body{display:grid;gap:8px;margin-top:9px}.planet-atlas__regions{display:flex;gap:5px;overflow-x:auto;padding-bottom:2px}.planet-atlas__region{flex:0 0 auto;max-width:150px;padding:6px 8px;border:1px solid rgb(139 184 168/.2);border-radius:8px;background:rgb(3 8 6/.28);color:inherit;text-align:left;cursor:pointer}.planet-atlas__region b,.planet-atlas__region span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.planet-atlas__region b{font:700 9px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.planet-atlas__region span{margin-top:2px;color:#aebbb1;font:8px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.planet-atlas__region.is-selected{border-color:rgb(244 240 189/.7);background:rgb(244 240 189/.08)}.planet-atlas__region.is-dormant{opacity:.58}.planet-atlas__region.is-merged{opacity:.34}.planet-atlas__profile{padding:9px;border:1px solid rgb(139 184 168/.16);border-radius:9px;background:rgb(0 0 0/.18)}.planet-atlas__profile header{display:flex;justify-content:space-between;gap:8px}.planet-atlas__profile h3{margin:1px 0 0;font:650 15px/1.1 Georgia,'Times New Roman',serif}.planet-atlas__profile header>span{color:#d8b56d;font:700 8px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-transform:uppercase}.planet-atlas__facts{display:grid;grid-template-columns:1fr 1fr;gap:5px 9px;margin:9px 0}.planet-atlas__facts div{min-width:0}.planet-atlas__facts dt{color:#829188;font:700 7px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-transform:uppercase}.planet-atlas__facts dd{margin:2px 0 0;color:#cbd8cf;font:9px/1.25 system-ui,sans-serif}.planet-atlas__succession{margin:7px 0;color:#b8c5bc;font:9px/1.35 system-ui,sans-serif}.planet-atlas__timeline{display:grid;gap:5px;margin:8px 0;padding:0;list-style:none}.planet-atlas__timeline li{display:grid;grid-template-columns:58px 1fr;gap:6px}.planet-atlas__timeline b{color:#d8b56d;font:700 7px/1.25 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-transform:uppercase}.planet-atlas__timeline span{color:#aebbb1;font:9px/1.3 system-ui,sans-serif}.planet-atlas__profile>button{width:100%;min-height:30px;border:1px solid rgb(139 184 168/.35);border-radius:8px;background:rgb(139 184 168/.1);color:#e8eddf;cursor:pointer;font:700 9px/1.1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.planet-atlas-overlay{position:absolute;inset:0;z-index:7;pointer-events:none;overflow:hidden}.planet-atlas-marker{position:absolute;transform:translate(-50%,-50%);display:flex;align-items:center;gap:4px;max-width:130px}.planet-atlas-marker i{width:6px;height:6px;flex:0 0 6px;border:1px solid rgb(244 240 189/.9);border-radius:50%;box-shadow:0 0 0 2px rgb(3 8 6/.45)}.planet-atlas-marker span{padding:2px 4px;border-radius:4px;background:rgb(3 8 6/.68);color:#dbe5dd;font:700 7px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.planet-atlas-marker.is-dormant span{color:#8f9b93}.planet-atlas-marker.is-selected i{background:#f4f0bd;box-shadow:0 0 0 3px rgb(244 240 189/.16)}
  `;
  document.head.append(style);
}

function readSelected(storageKey) {
  try { return localStorage.getItem(storageKey) || null; }
  catch { return null; }
}

function statusRank(status) {
  return status === 'active' ? 0 : status === 'dormant' ? 1 : 2;
}

function label(type) { return TYPE_LABEL[type] || String(type || 'ecological region'); }
function readableBiome(value) { return String(value || 'wildland').replace(/[-_]/g, ' '); }
function percent(value) { return `${Math.round(clamp(finite(value), 0, 1) * 100)}%`; }
function round(value) { return Math.round(finite(value) * 1000) / 1000; }
function finite(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

startWhenReady();
