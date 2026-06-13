// Shared forest layer for Computree.
// Uses a tiny backend at /events when configured. Falls back to localStorage.

const sharedPanel = document.getElementById('sharedPanel');
const sharedSettingsBtn = document.getElementById('sharedSettings');
const publishSeedBtn = document.getElementById('publishSeed');
const loadSharedBtn = document.getElementById('loadShared');
const plantSelectedBtn = document.getElementById('plantSelected');
const autoSyncBtn = document.getElementById('autoSync');
const inspectTreeBtn = document.getElementById('inspectTree');
const sharedStatusEl = document.getElementById('sharedStatus');
const eventFeedEl = document.getElementById('eventFeed');
const worldseedViewEl = document.getElementById('worldseedView');
const missionEl = document.getElementById('mission');
const backendUrlEl = document.getElementById('supabaseUrl');
const writeTokenEl = document.getElementById('supabaseKey');
const DEFAULT_BACKEND_URL = 'https://computree-backend.ancientpagoda.workers.dev';
let autoSync = false;
let selectedTree = forest[0];
let sharedRows = [];
let selectedEvent = null;

backendUrlEl.placeholder = 'Backend URL, e.g. https://computree-backend.ancientpagoda.workers.dev';
writeTokenEl.placeholder = 'Write token from backend .env';

function sharedMsg(text) {
  artifact.innerHTML = `<b>Shared Forest</b><br><pre style="white-space:pre-wrap">${escapeHtml(text)}</pre>`;
}

function setSharedStatus(text, tone = 'warn') {
  sharedStatusEl.textContent = `shared: ${text}`;
  sharedStatusEl.className = `pill status ${tone}`;
}

function setMission(step) {
  const copy = {
    load: 'Load shared roots, then graft a seed.',
    inspect: 'Choose a Worldseed from the shared organism feed.',
    plant: 'Plant the selected seed into this body.',
    publish: 'Publish the new Worldseed when it flowers.',
    grow: 'Keep it alive. Feed computation, grow flowers, prune waste.'
  };
  missionEl.textContent = copy[step] || copy.grow;
  loadSharedBtn.classList.toggle('next', step === 'load');
  plantSelectedBtn.classList.toggle('next', step === 'plant');
  publishSeedBtn.classList.toggle('next', step === 'publish');
}

function formatAgo(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return 'unknown time';
  if (ms < 60000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`;
  return `${Math.round(ms / 3600000)}h ago`;
}

function renderEventFeed(rows = []) {
  sharedRows = rows;
  if (!rows.length) {
    eventFeedEl.innerHTML = '<div class="event">No shared seeds yet. Publish one.</div>';
    return;
  }
  eventFeedEl.innerHTML = rows.slice(-12).reverse().map(row => {
    const tree = row.payload?.tree || {};
    const label = row.kind || 'event';
    const flowers = tree.flowers ?? row.payload?.flowers ?? '-';
    const energy = Number.isFinite(tree.energy) ? `${tree.energy.toFixed(1)} CE` : 'unknown CE';
    const selected = selectedEvent?.id === row.id ? ' selected' : '';
    return `<div class="event${selected}" data-event-id="${escapeHtml(row.id)}"><b>${escapeHtml(label)}</b> ${escapeHtml(formatAgo(row.created_at))}<br><span>${escapeHtml(row.tree_hash || 'unknown tree')}</span><br><span>flowers: ${escapeHtml(flowers)} · ${escapeHtml(energy)}</span></div>`;
  }).join('');
}

function inspectEvent(row) {
  selectedEvent = row;
  if (row.payload?.seed) seedbox.value = row.payload.seed;
  renderEventFeed(sharedRows);
  const summary = {
    id: row.id,
    kind: row.kind,
    tree_hash: row.tree_hash,
    created_at: row.created_at,
    payload: {
      turn: row.payload?.turn,
      tree: row.payload?.tree,
      hasSeed: Boolean(row.payload?.seed),
    },
  };
  worldseedViewEl.innerHTML = `<span class="pill tree-chip">${escapeHtml(row.kind || 'event')}</span><pre style="white-space:pre-wrap">${escapeHtml(JSON.stringify(summary, null, 2))}</pre>`;
  setMission(row.payload?.seed ? 'plant' : 'inspect');
}

function treeSnapshot(tree) {
  const flower = tree.flowers.at(-1);
  const memory = tree.memory.at(-1);
  return {
    id: tree.id,
    turn,
    energy: +tree.energy.toFixed(2),
    anatomy: {
      roots: tree.roots,
      branches: tree.branches,
      leaves: tree.leaves,
      flowers: tree.flowers.length,
      memories: tree.memory.length,
    },
    state: tree.state,
    season: currentSeason().name,
    resources: Object.fromEntries(Object.entries(tree.resources).map(([k, v]) => [k, +v.toFixed(2)])),
    metabolism: Object.fromEntries(Object.entries(tree.metabolism).map(([k, v]) => [k, +v.toFixed(3)])),
    lastFailure: tree.lastFailure || null,
    genome: Object.fromEntries(Object.entries(tree.g).map(([k, v]) => [k, +v.toFixed(3)])),
    latestFlower: flower || null,
    latestMemory: memory || null,
    artifacts: tree.artifacts?.slice(-2) || [],
  };
}

function inspectTree(tree = selectedTree || forest[0]) {
  selectedTree = tree || forest[0];
  const snapshot = treeSnapshot(selectedTree);
  worldseedViewEl.innerHTML = `<span class="pill tree-chip">${escapeHtml(snapshot.id)}</span><pre style="white-space:pre-wrap">${escapeHtml(JSON.stringify(snapshot, null, 2))}</pre>`;
}

function getLocalEvents() {
  try { return JSON.parse(localStorage.getItem('computree-events') || '[]'); }
  catch (e) { return []; }
}

function setLocalEvents(events) {
  localStorage.setItem('computree-events', JSON.stringify(events.slice(-200)));
}

function loadSharedSettings() {
  let s = { url: DEFAULT_BACKEND_URL, token: '' };
  try { s = { ...s, ...JSON.parse(localStorage.getItem('computree-shared') || '{}') }; } catch (e) {}
  backendUrlEl.value = s.url || DEFAULT_BACKEND_URL;
  writeTokenEl.value = s.token || '';
}

function saveSharedSettings() {
  localStorage.setItem('computree-shared', JSON.stringify({
    url: backendUrlEl.value.trim().replace(/\/$/, ''),
    token: writeTokenEl.value.trim()
  }));
}

async function saveRemoteEvent(event) {
  saveSharedSettings();
  const cfg = JSON.parse(localStorage.getItem('computree-shared') || '{}');
  const body = JSON.stringify(event);
  if (!cfg.url) {
    const events = getLocalEvents();
    events.push(event);
    setLocalEvents(events);
    return event;
  }

  const res = await fetch(`${cfg.url}/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-write-token': cfg.token || ''
    },
    body
  });
  const text = await res.text();
  if (window.recordRealBandwidth) window.recordRealBandwidth(body.length + text.length);
  if (!res.ok) throw new Error(text);
  const saved = JSON.parse(text);
  setSharedStatus('connected', 'ok');
  return saved;
}

async function loadRemoteEvents() {
  saveSharedSettings();
  const cfg = JSON.parse(localStorage.getItem('computree-shared') || '{}');
  if (!cfg.url) return getLocalEvents().slice(-50);
  const res = await fetch(`${cfg.url}/events?limit=50`);
  const text = await res.text();
  if (window.recordRealBandwidth) window.recordRealBandwidth(text.length);
  if (!res.ok) throw new Error(text);
  const rows = JSON.parse(text);
  setSharedStatus('connected', 'ok');
  renderEventFeed(rows);
  return rows;
}

function decodeSeed(seed) {
  return JSON.parse(decodeURIComponent(escape(atob(seed))));
}

function plantSeedString(seed, parentId = null) {
  const s = decodeSeed(seed);
  const visibleParent = parentId && forest.some(tree => tree.id === parentId) ? parentId : forest[0]?.id;
  s.parentId = visibleParent || s.parentId || null;
  const t = new Tree(rnd(innerWidth - 120, 60), rnd(innerHeight - 160, 120), s);
  t.mutate();
  forest.push(t);
  pulses.push({ x: t.x, y: t.y, t: turn, label: 'shared' });
  return t;
}

async function publishCurrentSeed(kind = 'worldseed') {
  const tree = forest[0];
  const seed = tree.seed();
  const event = {
    kind,
    tree_hash: tree.id,
    payload: {
      seed,
      turn,
      tree: {
        name: tree.name,
        energy: tree.energy,
        state: tree.state,
        season: currentSeason().name,
        resources: tree.resources,
        metabolism: tree.metabolism,
        branches: tree.branches,
        leaves: tree.leaves,
        roots: tree.roots,
        flowers: tree.flowers.length,
        artifacts: tree.artifacts?.slice(-2) || []
      }
    }
  };
  await saveRemoteEvent(event);
  if (window.computreePublishPulse) window.computreePublishPulse();
  pulses.push({ x: tree.x, y: tree.y, t: turn, label: 'published' });
  renderEventFeed(await loadRemoteEvents());
  sharedMsg(`Published ${kind}.\nTree: ${tree.id}\nFlowers: ${tree.flowers.length}\nCE: ${tree.energy.toFixed(1)}`);
  inspectTree(tree);
  setMission('grow');
}

async function publishLatestArtifact() {
  const tree = forest[0];
  const item = tree.artifacts?.at(-1);
  if (!item) return;
  await saveRemoteEvent({ kind: 'ai-flower', tree_hash: tree.id, payload: item });
}

async function loadSharedForest() {
  const rows = await loadRemoteEvents();
  let planted = 0;
  const seen = new Set(forest.map(t => t.id));
  for (const row of rows) {
    const seed = row.payload?.seed;
    if (!seed) continue;
    try {
      const decoded = decodeSeed(seed);
      const key = decoded.hash || row.tree_hash || hash(seed);
      if (seen.has(key)) continue;
      const t = plantSeedString(seed, decoded.parentId || row.tree_hash);
      t.id = key;
      seen.add(key);
      planted++;
    } catch (e) {}
  }
  renderEventFeed(rows);
  sharedMsg(`Loaded shared forest.\nNew trees planted: ${planted}\nEvents checked: ${rows.length}`);
  inspectTree(forest[0]);
  setMission(rows.some(row => row.payload?.seed) ? 'inspect' : 'publish');
}

sharedSettingsBtn.onclick = () => sharedPanel.classList.toggle('hidden');
[backendUrlEl, writeTokenEl].forEach(el => el.onchange = async () => {
  saveSharedSettings();
  try { renderEventFeed(await loadRemoteEvents()); } catch (e) { setSharedStatus('sync failed', 'bad'); sharedMsg(e.message); }
});
publishSeedBtn.onclick = async () => { try { await publishCurrentSeed(); } catch (e) { setSharedStatus('publish failed', 'bad'); sharedMsg(e.message); } };
loadSharedBtn.onclick = async () => { try { await loadSharedForest(); } catch (e) { setSharedStatus('load failed', 'bad'); sharedMsg(e.message); } };
plantSelectedBtn.onclick = () => {
  try {
    const seed = selectedEvent?.payload?.seed || seedbox.value.trim();
    if (!seed) throw new Error('select an event with a seed first');
    const t = plantSeedString(seed, selectedEvent?.tree_hash || null);
    inspectTree(t);
    sharedMsg(`Planted selected event.\nTree: ${t.id}`);
    setMission('publish');
  } catch (e) {
    sharedMsg(`Plant selected failed:\n${e.message}`);
  }
};
inspectTreeBtn.onclick = () => inspectTree(selectedTree || forest[0]);
autoSyncBtn.onclick = () => {
  autoSync = !autoSync;
  autoSyncBtn.textContent = autoSync ? 'autosync on' : 'autosync off';
  sharedMsg(autoSync ? 'Autosync enabled. Publishes every ~60s.' : 'Autosync disabled.');
};

loadSharedSettings();
loadRemoteEvents().then(rows => {
  renderEventFeed(rows);
  setSharedStatus(rows.length ? 'connected' : 'connected, empty', 'ok');
}).catch(e => {
  setSharedStatus('offline', 'bad');
  renderEventFeed(getLocalEvents());
  sharedMsg(`Shared backend unavailable:\n${e.message}`);
});
inspectTree(forest[0]);
setMission('load');

canvas.addEventListener('click', event => {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  let best = forest[0];
  let bestDistance = Infinity;
  for (const tree of forest) {
    const distance = Math.hypot(tree.x - x, tree.y - y);
    if (distance < bestDistance) {
      best = tree;
      bestDistance = distance;
    }
  }
  if (best && bestDistance < 90) inspectTree(best);
});

eventFeedEl.addEventListener('click', event => {
  const card = event.target.closest('[data-event-id]');
  if (!card) return;
  const row = sharedRows.find(item => item.id === card.dataset.eventId);
  if (row) inspectEvent(row);
});

setInterval(async () => {
  if (!autoSync) return;
  try { if (turn % 3600 < 60) await publishCurrentSeed('autosync-worldseed'); }
  catch (e) { setSharedStatus('autosync failed', 'bad'); sharedMsg(`Autosync error:\n${e.message}`); }
}, 5000);

const originalAiClick = document.getElementById('ai').onclick;
document.getElementById('ai').onclick = async () => {
  await originalAiClick();
  try { await publishLatestArtifact(); } catch (e) {}
};
