const MAX_EVENTS = 1000;
const MAX_LIMIT = 200;
const EVENTS_KEY = 'events';

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

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, service: 'computree-worker' }, 200, origin);
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
