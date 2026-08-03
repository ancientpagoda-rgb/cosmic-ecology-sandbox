export function createReboundAdapter(options = {}) {
  const endpoint = options.endpoint || null;
  const bodies = [];
  let mode = endpoint ? 'remote-rebound' : 'local-fallback';
  let time = 0;
  let requestInFlight = false;

  function addBody(body) {
    bodies.push({
      id: body.id || `body-${bodies.length + 1}`,
      mass: body.mass ?? 0,
      position: { ...(body.position || { x: 0, y: 0, z: 0 }) },
      velocity: { ...(body.velocity || { x: 0, y: 0, z: 0 }) },
      radius: body.radius ?? 0,
    });
  }

  function seedDefaultSystem() {
    if (bodies.length) return;
    addBody({ id: 'star', mass: 1, radius: 0.1 });
    addBody({
      id: 'planet',
      mass: 3e-6,
      radius: 0.02,
      position: { x: 1, y: 0, z: 0 },
      velocity: { x: 0, y: 1, z: 0 },
    });
  }

  async function remoteStep(dt) {
    if (!endpoint || requestInFlight) return;
    requestInFlight = true;
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dt, time, bodies }),
      });
      if (!response.ok) throw new Error(`REBOUND worker returned ${response.status}`);
      const result = await response.json();
      if (Array.isArray(result.bodies)) {
        bodies.length = 0;
        result.bodies.forEach(addBody);
      }
      time = Number.isFinite(result.time) ? result.time : time + dt;
      mode = 'remote-rebound';
    } catch {
      mode = 'local-fallback';
      localLeapfrog(dt);
    } finally {
      requestInFlight = false;
    }
  }

  function localLeapfrog(dt) {
    const G = 1;
    const accelerations = bodies.map(() => ({ x: 0, y: 0, z: 0 }));
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i];
        const b = bodies[j];
        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const dz = b.position.z - a.position.z;
        const r2 = dx * dx + dy * dy + dz * dz + 1e-8;
        const invR3 = 1 / (Math.sqrt(r2) * r2);
        const fa = G * b.mass * invR3;
        const fb = G * a.mass * invR3;
        accelerations[i].x += dx * fa;
        accelerations[i].y += dy * fa;
        accelerations[i].z += dz * fa;
        accelerations[j].x -= dx * fb;
        accelerations[j].y -= dy * fb;
        accelerations[j].z -= dz * fb;
      }
    }
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i];
      const acc = accelerations[i];
      body.velocity.x += acc.x * dt;
      body.velocity.y += acc.y * dt;
      body.velocity.z += acc.z * dt;
      body.position.x += body.velocity.x * dt;
      body.position.y += body.velocity.y * dt;
      body.position.z += body.velocity.z * dt;
    }
    time += dt;
  }

  return {
    id: 'orbit.rebound',
    name: 'REBOUND Orbital Adapter',
    version: '1.0.0',
    execution: endpoint ? 'server' : 'browser-fallback',
    source: 'REBOUND-compatible worker protocol; local leapfrog fallback',
    license: 'REBOUND GPL-3.0 when remote worker is used; adapter under project license',
    provides: ['orbits', 'n-body'],

    initialize({ provideCapability }) {
      seedDefaultSystem();
      provideCapability('orbits', this);
      provideCapability('n-body', this);
    },

    step(dt) {
      if (endpoint) void remoteStep(dt);
      else localLeapfrog(dt);
    },

    addBody,
    clear() { bodies.length = 0; },
    getBodies() { return bodies.map(body => structuredClone(body)); },
    getTime() { return time; },
    getMode() { return mode; },
    save() { return { time, bodies, mode }; },
    load(state) {
      if (!state) return;
      time = state.time || 0;
      bodies.length = 0;
      for (const body of state.bodies || []) addBody(body);
    },
  };
}
