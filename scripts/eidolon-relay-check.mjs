import worker from '../computree-worker/src/index.js';

const values = new Map();
const env = {
  WRITE_TOKEN: 'atlas-test-token',
  computree_events: {
    get: async key => values.get(key) || null,
    put: async (key, value) => values.set(key, value),
  },
};

const base = 'https://relay.test';
const payload = { seed: 'eidolon-living-planet-734221', regionId: 'C07', lineageId: 'lin-00abc123', name: 'Glass Minnow', guild: 'grazer', tick: 42 };
const denied = await worker.fetch(new Request(`${base}/eidolon/sightings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }), env);
if (denied.status !== 401) throw new Error('Relay accepted an untrusted browser write.');
const posted = await worker.fetch(new Request(`${base}/eidolon/sightings`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-write-token': 'atlas-test-token' }, body: JSON.stringify(payload) }), env);
if (posted.status !== 201) throw new Error(`Relay did not accept a curator sighting: ${await posted.text()}`);
const listed = await worker.fetch(new Request(`${base}/eidolon/sightings?seed=${payload.seed}&limit=4`), env);
const result = await listed.json();
if (listed.status !== 200 || result.format !== 'eidolon-atlas-1' || result.events?.[0]?.regionId !== 'C07') throw new Error('Relay did not return a public, seed-scoped Atlas feed.');
console.log(`Eidolon relay contract passed: ${result.events.length} public sighting.`);
