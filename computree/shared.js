// Shared forest shell for Computree.
// This version adds local import/export and a backend adapter placeholder.
// To make it truly shared, connect saveRemoteEvent/loadRemoteEvents to Supabase, Firebase, or your Oracle backend.

const sharedPanel = document.getElementById('sharedPanel');
const sharedSettingsBtn = document.getElementById('sharedSettings');
const publishSeedBtn = document.getElementById('publishSeed');
const loadSharedBtn = document.getElementById('loadShared');
const autoSyncBtn = document.getElementById('autoSync');
const supabaseUrlEl = document.getElementById('supabaseUrl');
const supabaseKeyEl = document.getElementById('supabaseKey');
let autoSync = false;

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

async function saveRemoteEvent(event) {
  // Backend adapter goes here.
  // Expected event shape: { created_at, kind, tree_hash, payload }
  const events = getLocalEvents();
  events.push(event);
  setLocalEvents(events);
  return event;
}

async function loadRemoteEvents() {
  // Backend adapter goes here.
  return getLocalEvents().slice(-50);
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
    created_at: new Date().toISOString(),
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
publishSeedBtn.onclick = async () => { try { await publishCurrentSeed(); } catch (e) { sharedMsg(e.message); } };
loadSharedBtn.onclick = async () => { try { await loadSharedForest(); } catch (e) { sharedMsg(e.message); } };
autoSyncBtn.onclick = () => {
  autoSync = !autoSync;
  autoSyncBtn.textContent = autoSync ? 'autosync on' : 'autosync off';
  sharedMsg(autoSync ? 'Autosync enabled for local events. Backend adapter pending.' : 'Autosync disabled.');
};

setInterval(async () => {
  if (!autoSync) return;
  try { if (turn % 3600 < 60) await publishCurrentSeed('autosync-worldseed'); }
  catch (e) { sharedMsg(`Autosync error:\n${e.message}`); }
}, 5000);
