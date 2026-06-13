// Shared forest layer for Computree.
// Uses a tiny backend at /events when configured. Falls back to localStorage.

const sharedPanel = document.getElementById('sharedPanel');
const sharedSettingsBtn = document.getElementById('sharedSettings');
const publishSeedBtn = document.getElementById('publishSeed');
const loadSharedBtn = document.getElementById('loadShared');
const autoSyncBtn = document.getElementById('autoSync');
const backendUrlEl = document.getElementById('supabaseUrl');
const writeTokenEl = document.getElementById('supabaseKey');
let autoSync = false;

backendUrlEl.placeholder = 'Backend URL, e.g. https://computree-backend.ancientpagoda.workers.dev';
writeTokenEl.placeholder = 'Write token from backend .env';

function sharedMsg(text) {
  artifact.innerHTML = `<b>Shared Forest</b><br><pre style="white-space:pre-wrap">${escapeHtml(text)}</pre>`;
}

function getLocalEvents() {
  try { return JSON.parse(localStorage.getItem('computree-events') || '[]'); }
  catch (e) { return []; }
}

function setLocalEvents(events) {
  localStorage.setItem('computree-events', JSON.stringify(events.slice(-200)));
}

function loadSharedSettings() {
  let s = { url: '', token: '' };
  try { s = { ...s, ...JSON.parse(localStorage.getItem('computree-shared') || '{}') }; } catch (e) {}
  backendUrlEl.value = s.url || '';
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
    body: JSON.stringify(event)
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function loadRemoteEvents() {
  saveSharedSettings();
  const cfg = JSON.parse(localStorage.getItem('computree-shared') || '{}');
  if (!cfg.url) return getLocalEvents().slice(-50);
  const res = await fetch(`${cfg.url}/events?limit=50`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function decodeSeed(seed) {
  return JSON.parse(decodeURIComponent(escape(atob(seed))));
}

function plantSeedString(seed) {
  const s = decodeSeed(seed);
  const t = new Tree(rnd(innerWidth - 120, 60), rnd(innerHeight - 160, 120), s);
  t.mutate();
  forest.push(t);
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
        branches: tree.branches,
        leaves: tree.leaves,
        roots: tree.roots,
        flowers: tree.flowers.length,
        artifacts: tree.artifacts?.slice(-2) || []
      }
    }
  };
  await saveRemoteEvent(event);
  sharedMsg(`Published ${kind}.\nTree: ${tree.id}\nFlowers: ${tree.flowers.length}\nCE: ${tree.energy.toFixed(1)}`);
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
      const t = plantSeedString(seed);
      t.id = key;
      seen.add(key);
      planted++;
    } catch (e) {}
  }
  sharedMsg(`Loaded shared forest.\nNew trees planted: ${planted}\nEvents checked: ${rows.length}`);
}

sharedSettingsBtn.onclick = () => sharedPanel.classList.toggle('hidden');
[backendUrlEl, writeTokenEl].forEach(el => el.onchange = saveSharedSettings);
publishSeedBtn.onclick = async () => { try { await publishCurrentSeed(); } catch (e) { sharedMsg(e.message); } };
loadSharedBtn.onclick = async () => { try { await loadSharedForest(); } catch (e) { sharedMsg(e.message); } };
autoSyncBtn.onclick = () => {
  autoSync = !autoSync;
  autoSyncBtn.textContent = autoSync ? 'autosync on' : 'autosync off';
  sharedMsg(autoSync ? 'Autosync enabled. Publishes every ~60s.' : 'Autosync disabled.');
};

loadSharedSettings();

setInterval(async () => {
  if (!autoSync) return;
  try { if (turn % 3600 < 60) await publishCurrentSeed('autosync-worldseed'); }
  catch (e) { sharedMsg(`Autosync error:\n${e.message}`); }
}, 5000);

const originalAiClick = document.getElementById('ai').onclick;
document.getElementById('ai').onclick = async () => {
  await originalAiClick();
  try { await publishLatestArtifact(); } catch (e) {}
};
