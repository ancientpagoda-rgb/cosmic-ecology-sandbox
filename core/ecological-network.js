const STORAGE_PREFIX = 'eidolon-ecological-network-v1';
const POLL_MS = 850;
const MAX_LINK_DISTANCE = 340;
const MIN_LINK_STRENGTH = 0.34;
const LINK_CHANGE_THRESHOLD = 0.12;
const DORMANT_AFTER_SCANS = 2;
const MAX_EVENTS_PER_LINK = 14;

const KIND_LABEL = Object.freeze({
  migration: 'migration corridor',
  lineage: 'lineage expansion',
  climate: 'moving climate front',
  predator: 'predator route',
  resource: 'resource corridor',
});

function startWhenReady() {
  const start = async () => {
    try {
      if (window.realitySandboxReady) await window.realitySandboxReady;
      const atlas = await waitForAtlas();
      const planet = window.realitySandboxPlanet;
      const runtime = window.realitySandboxUnified;
      if (!atlas || !planet?.world || !planet?.biosphere || !runtime) return;

      const network = createEcologicalNetwork({
        atlas,
        world: planet.world,
        biosphere: planet.biosphere,
        seed: window.realitySandboxSeed?.seed || planet.world.seed || 'eidolon',
      });
      planet.ecologicalNetwork = network;
      window.realitySandboxEcologicalNetwork = network;

      network.refresh({ initial: true });
      const ui = installNetworkUi(network, atlas, runtime, planet.world);
      const overlay = installNetworkOverlay(network, atlas, runtime, planet.world);
      ui.render();
      overlay.render();

      let lastAtlasSignature = atlas.signature?.() || '';
      const interval = window.setInterval(() => {
        if (document.hidden) return;
        const nextSignature = atlas.signature?.() || '';
        if (nextSignature !== lastAtlasSignature) {
          lastAtlasSignature = nextSignature;
          network.refresh();
          ui.render();
        }
        overlay.render();
      }, POLL_MS);

      window.addEventListener('pagehide', () => {
        window.clearInterval(interval);
        overlay.destroy();
      }, { once: true });

      window.dispatchEvent(new CustomEvent('eidolon-ecological-network-ready', {
        detail: { links: network.getLinks().length },
      }));
    } catch (error) {
      console.warn('[ecological-network] disabled:', error);
    }
  };

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}

async function waitForAtlas() {
  if (window.realitySandboxEcologicalAtlas) return window.realitySandboxEcologicalAtlas;
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      window.removeEventListener('eidolon-ecological-atlas-ready', onReady);
      clearTimeout(timeout);
      resolve(value || null);
    };
    const onReady = () => finish(window.realitySandboxEcologicalAtlas);
    window.addEventListener('eidolon-ecological-atlas-ready', onReady, { once: true });
    const timeout = window.setTimeout(() => finish(window.realitySandboxEcologicalAtlas), 8000);
  });
}

export function createEcologicalNetwork({ atlas, world, biosphere, seed = 'eidolon' }) {
  const storageKey = `${STORAGE_PREFIX}:${seed}`;
  const state = readState(storageKey);
  let scanNumber = finite(state.scanNumber);
  let eventCounter = finite(state.eventCounter);

  function refresh({ initial = false } = {}) {
    scanNumber += 1;
    const entries = atlas.getEntries?.().filter(entry => entry.status === 'active' && !entry.mergedInto) || [];
    const candidates = [];

    for (let left = 0; left < entries.length; left += 1) {
      for (let right = left + 1; right < entries.length; right += 1) {
        const a = entries[left];
        const b = entries[right];
        const separation = distance(a, b, world.width);
        if (separation > MAX_LINK_DISTANCE) continue;
        const inferred = inferLink(a, b, separation, biosphere);
        if (inferred.strength >= MIN_LINK_STRENGTH) candidates.push(inferred);
      }
    }

    const matched = new Set();
    for (const candidate of candidates) {
      const id = linkId(seed, candidate.a.id, candidate.b.id);
      let link = state.links.find(item => item.id === id);
      if (!link) {
        link = {
          id,
          aId: candidate.a.id,
          bId: candidate.b.id,
          sourceId: candidate.source.id,
          targetId: candidate.target.id,
          kind: candidate.kind,
          status: 'active',
          firstSeenTick: world.tick,
          lastSeenTick: world.tick,
          observations: 1,
          missedScans: 0,
          strength: round(candidate.strength),
          peakStrength: round(candidate.strength),
          evidence: clone(candidate.evidence),
          events: [],
        };
        state.links.unshift(link);
        addEvent(link, 'birth', `${name(candidate.source)} and ${name(candidate.target)} became linked by a ${label(candidate.kind)}.`, candidate);
      } else {
        const previousKind = link.kind;
        const previousStrength = finite(link.strength);
        const wasDormant = link.status === 'dormant';
        link.status = 'active';
        link.lastSeenTick = world.tick;
        link.observations = finite(link.observations) + 1;
        link.missedScans = 0;
        link.sourceId = candidate.source.id;
        link.targetId = candidate.target.id;
        link.kind = candidate.kind;
        link.strength = round(candidate.strength);
        link.peakStrength = Math.max(finite(link.peakStrength), link.strength);
        link.evidence = clone(candidate.evidence);

        if (wasDormant) addEvent(link, 'return', `${label(candidate.kind)} activity returned between ${name(candidate.source)} and ${name(candidate.target)}.`, candidate);
        if (previousKind !== candidate.kind) addEvent(link, 'transition', `The connection reorganized from ${label(previousKind)} to ${label(candidate.kind)}.`, candidate);
        const delta = link.strength - previousStrength;
        if (Math.abs(delta) >= LINK_CHANGE_THRESHOLD) {
          addEvent(link, delta > 0 ? 'strengthen' : 'weaken', `The ${label(link.kind)} ${delta > 0 ? 'strengthened' : 'weakened'} to ${percent(link.strength)}.`, candidate);
        }
      }
      matched.add(link.id);
    }

    for (const link of state.links) {
      if (matched.has(link.id) || link.status === 'dormant') continue;
      link.missedScans = finite(link.missedScans) + 1;
      if (link.missedScans >= DORMANT_AFTER_SCANS) {
        link.status = 'dormant';
        link.lastSeenTick = world.tick;
        if (!initial) addEvent(link, 'collapse', `The ${label(link.kind)} fell below the network evidence threshold.`, null);
      }
    }

    state.scanNumber = scanNumber;
    state.eventCounter = eventCounter;
    persist(storageKey, state);
    return getLinks();
  }

  function getLinks({ includeDormant = false } = {}) {
    return state.links
      .filter(link => includeDormant || link.status === 'active')
      .sort((a, b) => statusRank(a.status) - statusRank(b.status) || finite(b.strength) - finite(a.strength))
      .map(clone);
  }

  function getLink(id) {
    const link = state.links.find(item => item.id === id);
    return link ? clone(link) : null;
  }

  function getSnapshot() {
    return {
      version: 1,
      scanNumber,
      maxLinkDistance: MAX_LINK_DISTANCE,
      links: getLinks({ includeDormant: true }),
    };
  }

  function signature() {
    return state.links.map(link => [link.id, link.status, link.kind, link.strength, link.events?.[0]?.id || ''].join(':')).join('|');
  }

  function addEvent(link, kind, text, candidate) {
    eventCounter += 1;
    link.events ??= [];
    link.events.unshift({
      id: `${link.id}:${world.tick}:${eventCounter}`,
      tick: world.tick,
      kind,
      text,
      evidence: candidate ? clone(candidate.evidence) : null,
    });
    link.events.length = Math.min(link.events.length, MAX_EVENTS_PER_LINK);
  }

  return { refresh, getLinks, getLink, getSnapshot, signature };
}

function inferLink(a, b, separation, biosphere) {
  const distanceFit = clamp01(1 - separation / MAX_LINK_DISTANCE);
  const aSpecies = speciesMap(a.currentSpecies);
  const bSpecies = speciesMap(b.currentSpecies);
  const shared = [...aSpecies.keys()].filter(id => bSpecies.has(id));
  const sharedFit = clamp01(shared.length / Math.max(1, Math.min(aSpecies.size, bSpecies.size)));
  const sharedPredators = shared.filter(id => ['predator', 'apex'].includes(aSpecies.get(id)?.guild || bSpecies.get(id)?.guild));
  const predatorFit = clamp01(sharedPredators.length / Math.max(1, shared.length || 1));
  const aColonizing = recentEvent(a, ['colonization', 'speciation']);
  const bColonizing = recentEvent(b, ['colonization', 'speciation']);
  const colonizationFit = aColonizing || bColonizing ? 1 : 0;
  const ancestry = ancestryRelation(aSpecies, bSpecies, biosphere.getAncestry?.() || []);
  const lineageFit = ancestry ? 1 : 0;
  const sameFront = a.type === b.type && ['drought', 'flood'].includes(a.type) ? 1 : 0;
  const frontFit = sameFront * clamp01((finite(a.currentScore) + finite(b.currentScore)) * 0.5);
  const resourcePair = ['bloom', 'diversity'].includes(a.type) && ['bloom', 'diversity'].includes(b.type) ? 1 : 0;
  const predationSignal = clamp01((typeSignal(a, 'predation') + typeSignal(b, 'predation')) * 0.5);

  const scores = {
    lineage: lineageFit * 0.56 + sharedFit * 0.18 + colonizationFit * 0.10 + distanceFit * 0.16,
    migration: sharedFit * 0.48 + colonizationFit * 0.22 + distanceFit * 0.22 + resourcePair * 0.08,
    climate: frontFit * 0.64 + distanceFit * 0.26 + sharedFit * 0.10,
    predator: predatorFit * 0.48 + predationSignal * 0.26 + sharedFit * 0.10 + distanceFit * 0.16,
    resource: resourcePair * 0.38 + sharedFit * 0.30 + distanceFit * 0.22 + colonizationFit * 0.10,
  };

  const [kind, strength] = Object.entries(scores).sort((left, right) => right[1] - left[1])[0];
  const direction = inferDirection(kind, a, b, { aColonizing, bColonizing, ancestry });
  return {
    a,
    b,
    source: direction.source,
    target: direction.target,
    kind,
    strength: clamp01(strength),
    evidence: {
      separation: round(separation),
      separationKm: Math.round(separation * kilometresPerModelUnit()),
      sharedSpecies: shared.map(id => aSpecies.get(id)?.name || bSpecies.get(id)?.name || id),
      sharedPredators: sharedPredators.map(id => aSpecies.get(id)?.name || bSpecies.get(id)?.name || id),
      colonizationSignal: Boolean(colonizationFit),
      ancestry: ancestry ? { parentId: ancestry.parentId, childId: ancestry.childId } : null,
      frontType: sameFront ? a.type : null,
      sourceScore: round(finite(direction.source.currentScore)),
      targetScore: round(finite(direction.target.currentScore)),
    },
  };
}

function inferDirection(kind, a, b, context) {
  if (kind === 'lineage' && context.ancestry) {
    const parentInA = (a.currentSpecies || []).some(species => species.id === context.ancestry.parentId);
    return parentInA ? { source: a, target: b } : { source: b, target: a };
  }
  if (kind === 'migration') {
    if (context.aColonizing && !context.bColonizing) return { source: b, target: a };
    if (context.bColonizing && !context.aColonizing) return { source: a, target: b };
  }
  if (kind === 'predator') {
    const aPressure = typeSignal(a, 'predation');
    const bPressure = typeSignal(b, 'predation');
    return aPressure >= bPressure ? { source: a, target: b } : { source: b, target: a };
  }
  return finite(a.currentScore) >= finite(b.currentScore) ? { source: a, target: b } : { source: b, target: a };
}

function ancestryRelation(aSpecies, bSpecies, ancestry) {
  for (const branch of ancestry) {
    const aParent = aSpecies.has(branch.parentId);
    const aChild = aSpecies.has(branch.childId);
    const bParent = bSpecies.has(branch.parentId);
    const bChild = bSpecies.has(branch.childId);
    if ((aParent && bChild) || (bParent && aChild)) return branch;
  }
  return null;
}

function speciesMap(species = []) {
  return new Map((species || []).filter(item => item?.id && finite(item.population) > 0).map(item => [item.id, item]));
}

function recentEvent(entry, kinds) {
  return (entry.events || []).slice(0, 4).some(event => kinds.includes(event.kind));
}

function typeSignal(entry, type) {
  return entry.type === type ? clamp01(finite(entry.currentScore)) : 0;
}

function installNetworkUi(network, atlas, runtime, world) {
  const pulse = document.querySelector('.planet-pulse');
  const actions = pulse?.querySelector('.planet-pulse__actions');
  if (!pulse || !actions) return { render() {} };

  injectStyles();
  let details = pulse.querySelector('[data-ecological-network]');
  if (!details) {
    details = document.createElement('details');
    details.className = 'planet-pulse__memory planet-ecological-network';
    details.dataset.ecologicalNetwork = '';
    details.innerHTML = '<summary>Ecological network</summary><ol data-network-list></ol>';
    pulse.insertBefore(details, actions);
  }
  const list = details.querySelector('[data-network-list]');

  function render() {
    const entries = new Map(atlas.getEntries().map(entry => [entry.id, entry]));
    const links = network.getLinks();
    list.replaceChildren(...links.map(link => {
      const source = entries.get(link.sourceId);
      const target = entries.get(link.targetId);
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `planet-network__link is-${link.kind}`;
      button.innerHTML = `<b>${escapeHtml(name(source))} → ${escapeHtml(name(target))}</b><span>${escapeHtml(label(link.kind))} · ${percent(link.strength)}</span><small>${escapeHtml(evidenceSummary(link))}</small>`;
      button.addEventListener('click', () => focusConnection(source, target, runtime, world));
      item.append(button);
      return item;
    }));
    if (!links.length) {
      const empty = document.createElement('li');
      empty.className = 'planet-network__empty';
      empty.textContent = 'No cross-region pathway is strong enough to distinguish yet.';
      list.append(empty);
    }
  }

  return { render };
}

function installNetworkOverlay(network, atlas, runtime, world) {
  const host = document.getElementById('world');
  const canvas = document.getElementById('lofiLivingCanvas');
  if (!host || !canvas) return { render() {}, destroy() {} };

  injectStyles();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('planet-network-overlay');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<defs><marker id="eidolonNetworkArrow" markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="currentColor"/></marker></defs>';
  host.append(svg);

  function render() {
    const camera = runtime.getCamera?.();
    const rect = canvas.getBoundingClientRect();
    if (!camera || !rect.width || !rect.height || finite(camera.zoom) < 0.68) {
      clearPaths(svg);
      return;
    }
    svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    const entries = new Map(atlas.getEntries().map(entry => [entry.id, entry]));
    const nodes = [];

    for (const link of network.getLinks()) {
      const source = entries.get(link.sourceId);
      const target = entries.get(link.targetId);
      if (!source || !target) continue;
      const from = project(source.x / world.width, source.y / world.height, rect.width, rect.height, camera);
      const to = project(target.x / world.width, target.y / world.height, rect.width, rect.height, camera);
      if (!from.visible || !to.visible) continue;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const bend = Math.max(8, Math.hypot(to.x - from.x, to.y - from.y) * 0.12);
      const midX = (from.x + to.x) * 0.5;
      const midY = (from.y + to.y) * 0.5 - bend;
      path.setAttribute('d', `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} Q ${midX.toFixed(1)} ${midY.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`);
      path.setAttribute('class', `planet-network-path is-${link.kind}`);
      path.setAttribute('opacity', String(clamp01(0.24 + finite(link.strength) * 0.72) * Math.min(from.depth, to.depth)));
      path.setAttribute('marker-end', 'url(#eidolonNetworkArrow)');
      nodes.push(path);
    }
    replacePaths(svg, nodes);
  }

  function destroy() { svg.remove(); }
  return { render, destroy };
}

function clearPaths(svg) {
  for (const path of [...svg.querySelectorAll('.planet-network-path')]) path.remove();
}

function replacePaths(svg, nodes) {
  clearPaths(svg);
  svg.append(...nodes);
}

function focusConnection(source, target, runtime, world) {
  if (!source || !target) return;
  const current = runtime.getCamera?.() || {};
  const center = sphericalMidpoint(source, target, world.width);
  runtime.setCamera?.({
    ...current,
    centerX: center.x / world.width,
    centerY: center.y / world.height,
    zoom: Math.max(1.8, finite(current.zoom) || 1),
  });
  runtime.updateInterface?.(true);
}

function sphericalMidpoint(a, b, width) {
  let bx = finite(b.x);
  const ax = finite(a.x);
  if (bx - ax > width / 2) bx -= width;
  if (bx - ax < -width / 2) bx += width;
  return { x: ((ax + bx) * 0.5 % width + width) % width, y: (finite(a.y) + finite(b.y)) * 0.5 };
}

function evidenceSummary(link) {
  const evidence = link.evidence || {};
  const parts = [];
  if (evidence.sharedSpecies?.length) parts.push(`${evidence.sharedSpecies.length} shared species`);
  if (evidence.sharedPredators?.length) parts.push(`${evidence.sharedPredators.length} shared predator lineage${evidence.sharedPredators.length === 1 ? '' : 's'}`);
  if (evidence.ancestry) parts.push('parent/child lineage evidence');
  if (evidence.frontType) parts.push(`neighboring ${evidence.frontType} signals`);
  if (evidence.colonizationSignal) parts.push('recent colonization/speciation');
  parts.push(`${Math.round(finite(evidence.separationKm)).toLocaleString()} km apart`);
  return parts.join(' · ');
}

function injectStyles() {
  if (document.getElementById('eidolonEcologicalNetworkStyles')) return;
  const style = document.createElement('style');
  style.id = 'eidolonEcologicalNetworkStyles';
  style.textContent = `
    .planet-ecological-network ol { display:grid; gap:6px; margin:9px 0 0; padding:0; list-style:none; max-height:220px; overflow:auto; }
    .planet-network__link { width:100%; padding:7px 8px; border:1px solid rgb(139 184 168 / .18); border-radius:8px; background:rgb(3 8 6 / .3); color:inherit; text-align:left; cursor:pointer; }
    .planet-network__link:hover { background:rgb(139 184 168 / .1); }
    .planet-network__link b,.planet-network__link span,.planet-network__link small { display:block; }
    .planet-network__link b { color:#e7eee7; font:700 10px/1.25 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
    .planet-network__link span { margin-top:2px; color:#d8b56d; font:700 8px/1.2 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; text-transform:uppercase; letter-spacing:.05em; }
    .planet-network__link small,.planet-network__empty { margin-top:4px; color:#aebbb1; font:10px/1.3 system-ui,sans-serif; }
    .planet-network-overlay { position:absolute; inset:0; z-index:5; width:100%; height:100%; pointer-events:none; overflow:visible; }
    .planet-network-path { fill:none; stroke-width:1.45; vector-effect:non-scaling-stroke; color:#b8cbbf; stroke:currentColor; }
    .planet-network-path.is-climate { color:#7fb8d7; stroke-dasharray:5 4; }
    .planet-network-path.is-migration { color:#d5c37d; }
    .planet-network-path.is-lineage { color:#b99ae0; }
    .planet-network-path.is-predator { color:#df806b; }
    .planet-network-path.is-resource { color:#8fcf83; stroke-dasharray:2 3; }
  `;
  document.head.append(style);
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

function linkId(seed, aId, bId) {
  const pair = [aId, bId].sort().join('|');
  const text = `${seed}|${pair}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `link-${(hash >>> 0).toString(36)}`;
}

function readState(storageKey) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (!saved || !Array.isArray(saved.links)) return { links: [], scanNumber: 0, eventCounter: 0 };
    return saved;
  } catch {
    return { links: [], scanNumber: 0, eventCounter: 0 };
  }
}

function persist(storageKey, state) {
  try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* network memory is optional */ }
}

function distance(a, b, width) {
  const dx = Math.min(Math.abs(finite(a.x) - finite(b.x)), width - Math.abs(finite(a.x) - finite(b.x)));
  return Math.hypot(dx, finite(a.y) - finite(b.y));
}

function kilometresPerModelUnit() {
  return finite(globalThis.window?.realitySandboxPlanet?.world?.geography?.kilometresPerModelUnit || 100);
}

function name(entry) { return entry?.name || 'unnamed region'; }
function label(kind) { return KIND_LABEL[kind] || String(kind || 'ecological pathway'); }
function statusRank(status) { return status === 'active' ? 0 : 1; }
function percent(value) { return `${Math.round(clamp01(finite(value)) * 100)}%`; }
function round(value) { return Math.round(finite(value) * 1000) / 1000; }
function clamp01(value) { return Math.max(0, Math.min(1, finite(value))); }
function finite(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

if (typeof window !== 'undefined') startWhenReady();