const MAX_EVENTS = 1000;
const MAX_LIMIT = 200;
const EVENTS_KEY = 'events';
const EIDOLON_PREFIX = 'eidolon-atlas:';
const EIDOLON_MAX_EVENTS = 300;

function corsHeaders(origin = '*') {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,x-write-token',
    'access-control-max-age': '86400',
  };
}

function json(payload, status = 200, origin = '*') {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders(origin),
    },
  });
}

async function readEvents(env) {
  const text = await env.computree_events.get(EVENTS_KEY);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeEvents(env, events) {
  await env.computree_events.put(EVENTS_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
}

async function readEidolonEvents(env, seed) {
  const text = await env.computree_events.get(`${EIDOLON_PREFIX}${seed}`);
  if (!text) return [];
  try { const parsed = JSON.parse(text); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}

async function writeEidolonEvents(env, seed, events) {
  await env.computree_events.put(`${EIDOLON_PREFIX}${seed}`, JSON.stringify(events.slice(-EIDOLON_MAX_EVENTS)));
}

function sanitizeEidolonSighting(body) {
  const seed = String(body.seed || '').slice(0, 96);
  const regionId = String(body.regionId || '').toUpperCase();
  const lineageId = String(body.lineageId || '').toLowerCase();
  const name = String(body.name || '').replace(/[^\w\s'-]/g, '').trim().slice(0, 32);
  const guild = String(body.guild || 'grazer').toLowerCase();
  const tick = Math.max(0, Math.min(1e9, Math.floor(Number(body.tick) || 0)));
  if (!/^[\w-]{3,96}$/.test(seed)) throw new Error('invalid seed');
  if (!/^[A-H](?:0[1-9]|1[0-2])$/.test(regionId)) throw new Error('invalid region');
  if (!/^lin-[a-z0-9]{8}$/.test(lineageId)) throw new Error('invalid lineage');
  if (!name) throw new Error('invalid lineage name');
  if (!['grazer', 'predator', 'apex'].includes(guild)) throw new Error('invalid guild');
  return { id: `${tick}:${regionId}:${lineageId}`, kind: 'lineage-release', seed, regionId, lineageId, name, guild, tick, created_at: new Date().toISOString() };
}

function sanitizeEvent(body) {
  const kind = String(body.kind || 'worldseed').slice(0, 64);
  const tree_hash = String(body.tree_hash || '').slice(0, 128);
  const payload = body.payload || {};

  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('payload must be an object');
  }

  const raw = JSON.stringify(payload);
  if (raw.length > 200000) throw new Error('payload too large');

  return {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    kind,
    tree_hash,
    payload,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = env.CORS_ORIGIN || '*';

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return json({
        ok: true,
        service: 'computree-worker',
        endpoints: {
          health: '/health',
          events: '/events?limit=50',
          publish: 'POST /events with x-write-token',
        },
      }, 200, origin);
    }

    if (request.method === 'GET' && url.pathname === '/eidolon/health') {
      return json({ ok: true, service: 'eidolon-atlas-relay', authority: 'curator-token', endpoints: { sightings: '/eidolon/sightings?seed=...&limit=48', publish: 'POST /eidolon/sightings with x-write-token' } }, 200, origin);
    }

    if (request.method === 'GET' && url.pathname === '/eidolon/sightings') {
      const seed = String(url.searchParams.get('seed') || '').slice(0, 96);
      if (!/^[\w-]{3,96}$/.test(seed)) return json({ error: 'invalid seed' }, 400, origin);
      const limit = Math.min(Math.max(1, Number(url.searchParams.get('limit') || 48)), 100);
      const events = await readEidolonEvents(env, seed);
      return json({ format: 'eidolon-atlas-1', seed, events: events.slice(-limit).reverse() }, 200, origin);
    }

    if (request.method === 'POST' && url.pathname === '/eidolon/sightings') {
      if (!env.WRITE_TOKEN || request.headers.get('x-write-token') !== env.WRITE_TOKEN) return json({ error: 'curator token required' }, 401, origin);
      try {
        const sighting = sanitizeEidolonSighting(await request.json());
        const events = await readEidolonEvents(env, sighting.seed);
        const next = [...events.filter(event => event.id !== sighting.id), sighting];
        await writeEidolonEvents(env, sighting.seed, next);
        return json(sighting, 201, origin);
      } catch (error) {
        return json({ error: error.message || 'bad request' }, 400, origin);
      }
    }

    if (request.method === 'GET' && url.pathname === '/events') {
      const limit = Math.min(Number(url.searchParams.get('limit') || 50), MAX_LIMIT);
      const events = await readEvents(env);
      return json(events.slice(-limit), 200, origin);
    }

    if (request.method === 'POST' && url.pathname === '/events') {
      if (env.WRITE_TOKEN) {
        const provided = request.headers.get('x-write-token') || '';
        if (provided !== env.WRITE_TOKEN) return json({ error: 'bad write token' }, 401, origin);
      }

      try {
        const event = sanitizeEvent(await request.json());
        const events = await readEvents(env);
        events.push(event);
        await writeEvents(env, events);
        return json(event, 201, origin);
      } catch (error) {
        return json({ error: error.message || 'bad request' }, 400, origin);
      }
    }

    return json({ error: 'not found' }, 404, origin);
  },
};
