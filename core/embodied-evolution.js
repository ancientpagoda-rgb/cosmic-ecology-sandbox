const YUKA_SOURCES = [
  'https://cdn.jsdelivr.net/npm/yuka@0.7.8/build/yuka.module.js',
  'https://unpkg.com/yuka@0.7.8/build/yuka.module.js',
];
const SCALE = 0.04;
const GEO_SCALE = 0.0065;
const ROLES = ['agent', 'predator', 'apex'];
const BASE_SPEED = { agent: 34, predator: 48, apex: 31 };
const LABEL = { agent: 'grazer', predator: 'predator', apex: 'apex' };

export function createEmbodiedEvolution(world, originSystem, groundLevel, options = {}) {
  const mobile = options.mobile ?? matchMedia('(max-width: 720px), (pointer: coarse)').matches;
  const rng = mulberry32(options.seed ?? 0x51A9E5);
  const records = new Map();
  const lineages = new Set();
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: true, desynchronized: true });
  const hud = document.createElement('section');
  let YUKA;
  let manager;
  let width = 1;
  let height = 1;
  let ratio = 1;
  let elapsed = 0;
  let lastDraw = -Infinity;
  let lastHud = -Infinity;
  let populationEstablished = false;
  let births = 0;
  let deaths = 0;
  let maxGeneration = 0;
  let destroyed = false;
  let savedGenomes = [];

  canvas.className = 'embodied-evolution-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;inset:0;z-index:8;width:100%;height:100%;pointer-events:none;opacity:0;transition:opacity .3s ease';
  document.body.append(canvas);

  hud.className = 'embodied-evolution-hud';
  hud.hidden = true;
  hud.setAttribute('aria-live', 'polite');
  hud.style.cssText = 'position:fixed;right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));z-index:15;max-width:min(340px,calc(100vw - 24px));padding:10px 12px;border:1px solid rgba(147,217,190,.22);border-radius:12px;background:rgba(2,10,12,.7);backdrop-filter:blur(10px);color:#d8fff2;font:600 11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em;pointer-events:none';
  hud.innerHTML = '<strong style="display:block;margin-bottom:4px;color:#8ff0c7">EMBODIED EVOLUTION · YUKA</strong><span data-summary>Waiting for motile life…</span>';
  document.body.append(hud);
  const summary = hud.querySelector('[data-summary]');

  async function initialize({ provideCapability }) {
    YUKA = await loadYuka();
    manager = new YUKA.EntityManager();
    sync(true);
    provideCapability('evolution.embodied', api);
    provideCapability('ai.yuka', manager);
  }

  function step(dt) {
    if (destroyed || !manager) return;
    elapsed += Math.max(0, dt);
    sync(false);
    for (const record of records.values()) {
      record.clock -= dt;
      if (record.clock <= 0) {
        decide(record);
        record.clock = clamp(0.72 - record.genome.sense * 0.18 + rng() * 0.14, 0.2, 0.72);
      }
      const activity = clamp(record.vehicle.getSpeed() / Math.max(0.001, record.vehicle.maxSpeed), 0, 1);
      record.gait += dt * (3.4 + activity * 8) * record.genome.legs;
    }
    manager.update(dt);
    writeBack();
  }

  function sync(initial) {
    const live = new Set();
    const suppressBirths = initial || !populationEstablished;
    for (const role of ROLES) {
      for (const [id, component] of world.ecs.components[role].entries()) {
        const position = world.ecs.components.position.get(id);
        if (!position) continue;
        live.add(id);
        if (!records.has(id)) addCreature(id, role, component, position, suppressBirths);
      }
    }
    for (const [id, record] of records.entries()) {
      if (live.has(id)) continue;
      manager.remove(record.vehicle);
      records.delete(id);
      deaths++;
    }
    if (live.size) populationEstablished = true;
  }

  function addCreature(id, role, component, position, suppressBirth) {
    const parent = nearest(role, position, 95);
    const restored = takeSavedGenome(role, position);
    const genome = normalizeGenome(restored || component.embodiment || mutate(parent?.genome, component.dna, role, rng), role);
    if (parent && genome.generation <= parent.genome.generation) genome.generation = parent.genome.generation + 1;
    if (!genome.lineage) genome.lineage = parent && genomeDistance(parent.genome, genome) < 0.22
      ? parent.genome.lineage
      : `${role[0].toUpperCase()}${hashGenome(genome).toString(36).slice(0, 4)}`;
    component.embodiment = genome;
    component.generation = Math.max(component.generation || 0, genome.generation);

    const vehicle = new YUKA.Vehicle();
    vehicle.position.set(position.x * SCALE, 0, position.y * SCALE);
    const velocity = world.ecs.components.velocity.get(id);
    if (velocity) vehicle.velocity.set(velocity.vx * SCALE, 0, velocity.vy * SCALE);
    vehicle.maxSpeed = BASE_SPEED[role] * genome.speed * SCALE;
    vehicle.maxForce = 6 * genome.stamina;
    vehicle.updateNeighborhood = true;
    vehicle.neighborhoodRadius = 4 + genome.sense * 1.5;

    const wander = new YUKA.WanderBehavior();
    wander.weight = role === 'agent' ? 0.42 : 0.25;
    const seek = new YUKA.SeekBehavior(new YUKA.Vector3().copy(vehicle.position));
    seek.weight = role === 'agent' ? 0.85 : 0.35;
    const separation = new YUKA.SeparationBehavior();
    separation.weight = 0.65 + (1 - genome.social) * 0.8;
    const alignment = new YUKA.AlignmentBehavior();
    alignment.weight = role === 'agent' ? genome.social * 0.48 : 0.05;
    const cohesion = new YUKA.CohesionBehavior();
    cohesion.weight = role === 'agent' ? genome.social * 0.36 : 0.04;
    const evade = new YUKA.EvadeBehavior();
    evade.active = false;
    evade.weight = 1.5 + genome.caution;
    const pursuit = new YUKA.PursuitBehavior();
    pursuit.active = false;
    pursuit.weight = role === 'apex' ? 1.65 : 1.35;
    for (const behavior of [wander, seek, separation, alignment, cohesion, evade, pursuit]) vehicle.steering.add(behavior);
    manager.add(vehicle);

    records.set(id, {
      id, role, component, genome, vehicle,
      behavior: { seek, evade, pursuit },
      clock: rng() * 0.4,
      gait: rng() * Math.PI * 2,
      mode: 'wander',
    });
    lineages.add(genome.lineage);
    maxGeneration = Math.max(maxGeneration, genome.generation);
    if (!suppressBirth) births++;
  }

  function decide(record) {
    const { role, genome, vehicle, behavior } = record;
    behavior.evade.active = false;
    behavior.pursuit.active = false;
    behavior.seek.active = true;

    if (role === 'agent') {
      const threat = nearestOther(record, ['predator', 'apex'], 135 * genome.sense);
      if (threat) {
        behavior.evade.pursuer = threat.vehicle;
        behavior.evade.active = true;
        behavior.seek.active = false;
        record.mode = 'flee';
        return;
      }
      const food = nearestResource(record, 180 * genome.sense);
      if (food) {
        setTarget(behavior.seek.target, vehicle.position, food);
        behavior.seek.weight = 0.8 + genome.metabolism * 0.35;
        record.mode = 'forage';
        return;
      }
      const herd = herdCenter(record, 130 * genome.sense);
      if (herd) {
        setTarget(behavior.seek.target, vehicle.position, herd);
        behavior.seek.weight = 0.2 + genome.social * 0.5;
        record.mode = 'herd';
        return;
      }
    } else {
      const prey = nearestOther(record, role === 'apex' ? ['predator', 'agent'] : ['agent'], 190 * genome.sense);
      if (prey) {
        behavior.pursuit.evader = prey.vehicle;
        behavior.pursuit.active = true;
        behavior.seek.active = false;
        record.mode = 'hunt';
        return;
      }
    }

    const angle = rng() * Math.PI * 2;
    behavior.seek.target.set(vehicle.position.x + Math.cos(angle) * 3, 0, vehicle.position.z + Math.sin(angle) * 3);
    behavior.seek.weight = 0.12;
    record.mode = 'wander';
  }

  function writeBack() {
    const maxX = world.width * SCALE;
    const maxZ = world.height * SCALE;
    for (const record of records.values()) {
      const { id, vehicle } = record;
      vehicle.position.x = wrap(vehicle.position.x, maxX);
      vehicle.position.z = wrap(vehicle.position.z, maxZ);
      vehicle.position.y = 0;
      const position = world.ecs.components.position.get(id);
      const velocity = world.ecs.components.velocity.get(id);
      if (position) {
        position.x = vehicle.position.x / SCALE;
        position.y = vehicle.position.z / SCALE;
      }
      if (velocity) {
        velocity.vx = vehicle.velocity.x / SCALE;
        velocity.vy = vehicle.velocity.z / SCALE;
      }
    }
  }

  function render(frame = {}) {
    if (destroyed) return;
    const timestamp = frame.timestamp ?? performance.now();
    const ground = groundLevel.getState();
    const active = Boolean(ground.active && originSystem.getState().animalsReady && records.size);
    canvas.style.opacity = active ? '1' : '0';
    hud.hidden = !active;
    if (!active) {
      context.clearRect(0, 0, width, height);
      return;
    }
    if (timestamp - lastDraw >= (mobile ? 50 : 30)) {
      lastDraw = timestamp;
      resize();
      draw(ground.navigation);
    }
    if (timestamp - lastHud >= 350) {
      lastHud = timestamp;
      const counts = countRoles();
      summary.textContent = `${counts.agent} grazers · ${counts.predator} predators · ${counts.apex} apex · ${lineages.size} lineages · gen ${maxGeneration} · ${births} births · ${deaths} deaths`;
    }
  }

  function resize() {
    const nextWidth = Math.max(1, innerWidth);
    const nextHeight = Math.max(1, innerHeight);
    const nextRatio = Math.min(devicePixelRatio || 1, mobile ? 1 : 1.35);
    if (nextWidth === width && nextHeight === height && nextRatio === ratio) return;
    width = nextWidth;
    height = nextHeight;
    ratio = nextRatio;
    canvas.width = Math.floor(width * ratio);
    canvas.height = Math.floor(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function draw(navigation) {
    context.clearRect(0, 0, width, height);
    const visible = [];
    for (const record of records.values()) {
      const projected = project(record, navigation, width, height);
      if (projected) visible.push(projected);
    }
    visible.sort((a, b) => b.depth - a.depth);
    const cap = mobile ? 28 : 72;
    for (const item of visible.slice(-cap)) drawCreature(item, context);
  }

  function project(record, navigation, screenWidth, screenHeight) {
    const position = world.ecs.components.position.get(record.id);
    if (!position) return null;
    const u = wrap(position.x / world.width, 1);
    const v = clamp(position.y / world.height, 0.01, 0.99);
    const latitude = (0.5 - navigation.v) * Math.PI;
    const longitudeScale = Math.max(0.22, Math.cos(latitude));
    const du = turnDelta(u, navigation.u) * longitudeScale / GEO_SCALE;
    const dv = (v - navigation.v) / GEO_SCALE;
    const heading = navigation.heading || 0;
    const forward = du * Math.sin(heading) + dv * -Math.cos(heading);
    const lateral = du * Math.cos(heading) + dv * Math.sin(heading);
    if (forward < 0.16 || forward > 3.6 || Math.abs(lateral) > 0.72 + forward * 0.55) return null;
    const inverse = 1 / forward;
    const horizon = screenHeight * (0.43 + (navigation.pitch || 0) * 0.2);
    const vertical = (inverse - 1 / 3.6) / (1 / 0.16 - 1 / 3.6);
    const base = record.role === 'apex' ? 38 : record.role === 'predator' ? 28 : 22;
    return {
      record,
      depth: forward,
      x: screenWidth * 0.5 + lateral * inverse * screenWidth * 0.25,
      y: horizon + vertical * (screenHeight - horizon) * 0.94,
      size: clamp(base * record.genome.size * inverse, 5, mobile ? 90 : 135),
    };
  }

  function nearest(role, position, radius) {
    let best = null;
    let distance = radius * radius;
    for (const candidate of records.values()) {
      if (candidate.role !== role) continue;
      const point = world.ecs.components.position.get(candidate.id);
      const next = torusDistance(position, point, world.width, world.height);
      if (next < distance) {
        distance = next;
        best = candidate;
      }
    }
    return best;
  }

  function nearestOther(record, roles, radius) {
    const origin = world.ecs.components.position.get(record.id);
    let best = null;
    let distance = radius * radius;
    for (const candidate of records.values()) {
      if (candidate.id === record.id || !roles.includes(candidate.role)) continue;
      const next = torusDistance(origin, world.ecs.components.position.get(candidate.id), world.width, world.height);
      if (next < distance) {
        distance = next;
        best = candidate;
      }
    }
    return best;
  }

  function nearestResource(record, radius) {
    const origin = world.ecs.components.position.get(record.id);
    let best = null;
    let distance = radius * radius;
    for (const [id, resource] of world.ecs.components.resource.entries()) {
      if ((resource.amount ?? 0) <= 0) continue;
      const point = world.ecs.components.position.get(id);
      const next = torusDistance(origin, point, world.width, world.height);
      if (next < distance) {
        distance = next;
        best = point;
      }
    }
    return best;
  }

  function herdCenter(record, radius) {
    const origin = world.ecs.components.position.get(record.id);
    let x = 0;
    let y = 0;
    let count = 0;
    for (const candidate of records.values()) {
      if (candidate.id === record.id || candidate.role !== record.role) continue;
      const point = world.ecs.components.position.get(candidate.id);
      if (torusDistance(origin, point, world.width, world.height) > radius * radius) continue;
      x += nearestCoordinate(point.x, origin.x, world.width);
      y += nearestCoordinate(point.y, origin.y, world.height);
      count++;
    }
    return count ? { x: wrap(x / count, world.width), y: wrap(y / count, world.height) } : null;
  }

  function setTarget(target, vehicle, point) {
    const maxX = world.width * SCALE;
    const maxZ = world.height * SCALE;
    target.set(
      nearestCoordinate(point.x * SCALE, vehicle.x, maxX),
      0,
      nearestCoordinate(point.y * SCALE, vehicle.z, maxZ),
    );
  }

  function takeSavedGenome(role, position) {
    let bestIndex = -1;
    let bestDistance = Infinity;
    for (let index = 0; index < savedGenomes.length; index++) {
      const item = savedGenomes[index];
      if (item.role !== role) continue;
      const next = torusDistance(position, item, world.width, world.height);
      if (next < bestDistance) {
        bestDistance = next;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) return null;
    return savedGenomes.splice(bestIndex, 1)[0].genome;
  }

  function save() {
    return {
      elapsed, births, deaths, maxGeneration,
      creatures: [...records.values()].map(record => {
        const point = world.ecs.components.position.get(record.id);
        return { role: record.role, x: point?.x || 0, y: point?.y || 0, genome: record.genome };
      }),
    };
  }

  function load(state) {
    if (!state) return;
    elapsed = Math.max(0, state.elapsed || 0);
    births = Math.max(0, state.births || 0);
    deaths = Math.max(0, state.deaths || 0);
    maxGeneration = Math.max(0, state.maxGeneration || 0);
    savedGenomes = Array.isArray(state.creatures) ? state.creatures.slice(0, 90) : [];
  }

  function getState() {
    return { counts: countRoles(), lineages: lineages.size, births, deaths, maxGeneration, creatures: records.size };
  }

  function countRoles() {
    const counts = { agent: 0, predator: 0, apex: 0 };
    for (const record of records.values()) counts[record.role]++;
    return counts;
  }

  function destroy() {
    destroyed = true;
    if (manager) for (const record of records.values()) manager.remove(record.vehicle);
    records.clear();
    canvas.remove();
    hud.remove();
  }

  const api = {
    id: 'evolution.embodied-yuka',
    name: 'Embodied Evolution and Creature AI',
    version: '1.0.0',
    execution: 'browser-yuka-canvas',
    source: 'Yuka 0.7.8 steering plus Reality Sandbox heritable morphology',
    license: 'MIT (Yuka) and project license',
    provides: ['evolution.embodied', 'ai.yuka'],
    requires: ['origin.abiogenesis', 'exploration.ground-level'],
    after: ['terrain.ground-level', 'origin.surface-visuals'],
    initialize, step, render, save, load, getState, destroy,
  };
  return api;
}

function drawCreature({ record, x, y, size }, context) {
  const g = record.genome;
  const speed = clamp(record.vehicle.getSpeed() / Math.max(0.001, record.vehicle.maxSpeed), 0, 1);
  const gait = Math.sin(record.gait) * speed;
  const length = size * (0.95 + g.length * 0.5);
  const bodyHeight = size * (0.38 + g.depth * 0.2);
  const leg = size * (0.42 + g.legs * 0.38);
  const hue = wrap(g.hue + (record.role === 'predator' ? -20 : record.role === 'apex' ? 35 : 0), 360);
  context.save();
  context.translate(x, y);
  context.fillStyle = 'rgba(0,0,0,.24)';
  context.beginPath();
  context.ellipse(0, size * 0.08, length * 0.62, size * 0.13, 0, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = `hsla(${hue},55%,62%,.95)`;
  context.lineWidth = Math.max(1.2, size * 0.075);
  context.lineCap = 'round';
  for (const side of [-1, 1]) {
    context.beginPath();
    context.moveTo(side * length * 0.28, -bodyHeight * 0.05);
    context.lineTo(side * length * 0.28 + gait * leg * 0.25, leg * 0.58);
    context.lineTo(side * length * 0.28 - gait * leg * 0.34, leg);
    context.stroke();
  }
  context.fillStyle = `hsl(${hue} 55% ${record.role === 'apex' ? 43 : 53}%)`;
  context.beginPath();
  context.ellipse(0, -bodyHeight * 0.42, length * 0.5, bodyHeight * 0.62, g.tilt * 0.18, 0, Math.PI * 2);
  context.fill();
  const headX = length * 0.46;
  const headY = -bodyHeight * (0.55 + g.neck * 0.3);
  context.beginPath();
  context.ellipse(headX, headY, size * (0.18 + g.head * 0.12), size * (0.15 + g.head * 0.1), -0.1, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = `hsla(${hue},65%,72%,.85)`;
  context.lineWidth = Math.max(0.8, size * 0.035);
  context.beginPath();
  context.moveTo(-length * 0.48, -bodyHeight * 0.42);
  context.quadraticCurveTo(-length * 0.7, -bodyHeight * 1.1, -length * (0.72 + g.tail * 0.28), -bodyHeight * 0.3);
  context.stroke();
  if (record.role !== 'agent' || g.display > 0.56) {
    context.beginPath();
    context.moveTo(headX - size * 0.06, headY - size * 0.12);
    context.lineTo(headX - size * (0.04 + g.display * 0.16), headY - size * (0.28 + g.display * 0.16));
    context.moveTo(headX + size * 0.07, headY - size * 0.12);
    context.lineTo(headX + size * (0.12 + g.display * 0.14), headY - size * (0.27 + g.display * 0.15));
    context.stroke();
  }
  if (size > 25) {
    context.fillStyle = 'rgba(225,255,245,.78)';
    context.font = `${Math.max(9, size * 0.105)}px ui-monospace,monospace`;
    context.textAlign = 'center';
    context.fillText(`${LABEL[record.role]} · ${g.lineage}`, 0, -bodyHeight * 1.55);
  }
  context.restore();
}

async function loadYuka() {
  let error;
  for (const source of YUKA_SOURCES) {
    try {
      return await import(/* @vite-ignore */ source);
    } catch (next) {
      error = next;
    }
  }
  throw new Error(`Unable to load Yuka 0.7.8: ${error?.message || 'network unavailable'}`);
}

function mutate(parent, dna = {}, role, rng) {
  const base = parent || {
    speed: dna.speed ?? 1, sense: dna.sense ?? 1, metabolism: dna.metabolism ?? 1,
    stamina: 0.8 + rng() * 0.4, social: role === 'agent' ? 0.58 + rng() * 0.32 : 0.12 + rng() * 0.35,
    caution: role === 'agent' ? 0.55 + rng() * 0.35 : 0.18 + rng() * 0.3,
    size: role === 'apex' ? 1.35 : role === 'predator' ? 1.08 : 0.85 + rng() * 0.28,
    length: 0.55 + rng() * 0.45, depth: 0.4 + rng() * 0.5, legs: 0.55 + rng() * 0.48,
    neck: 0.35 + rng() * 0.55, head: 0.4 + rng() * 0.55, tail: 0.35 + rng() * 0.65,
    tilt: (rng() - 0.5) * 0.8, display: rng(),
    hue: role === 'agent' ? 150 + rng() * 90 : role === 'predator' ? 5 + rng() * 55 : 205 + rng() * 75,
    generation: 0, lineage: '',
  };
  const generation = (parent?.generation || 0) + (parent ? 1 : 0);
  const amount = parent ? 0.055 + Math.min(0.045, generation * 0.002) : 0;
  const next = { ...base, generation };
  for (const key of ['speed', 'sense', 'metabolism', 'stamina', 'social', 'caution', 'size', 'length', 'depth', 'legs', 'neck', 'head', 'tail', 'tilt', 'display']) {
    next[key] = (base[key] ?? 0.5) + (rng() - 0.5) * amount * 2;
  }
  next.hue = (base.hue ?? 180) + (rng() - 0.5) * amount * 120;
  return next;
}

function normalizeGenome(g = {}, role) {
  return {
    speed: clamp(g.speed ?? 1, 0.45, 1.8), sense: clamp(g.sense ?? 1, 0.4, 2),
    metabolism: clamp(g.metabolism ?? 1, 0.45, 1.8), stamina: clamp(g.stamina ?? 1, 0.45, 1.7),
    social: clamp(g.social ?? (role === 'agent' ? 0.7 : 0.25), 0, 1), caution: clamp(g.caution ?? 0.5, 0, 1),
    size: clamp(g.size ?? 1, 0.55, 1.75), length: clamp(g.length ?? 0.7, 0.2, 1.3),
    depth: clamp(g.depth ?? 0.65, 0.2, 1.3), legs: clamp(g.legs ?? 0.75, 0.25, 1.5),
    neck: clamp(g.neck ?? 0.55, 0.1, 1.4), head: clamp(g.head ?? 0.6, 0.2, 1.35),
    tail: clamp(g.tail ?? 0.6, 0.05, 1.5), tilt: clamp(g.tilt ?? 0, -1, 1),
    display: clamp(g.display ?? 0.5, 0, 1), hue: wrap(g.hue ?? 180, 360),
    generation: Math.max(0, Math.floor(g.generation || 0)), lineage: String(g.lineage || ''),
  };
}

function genomeDistance(a, b) {
  const keys = ['speed', 'sense', 'metabolism', 'stamina', 'social', 'caution', 'size', 'length', 'depth', 'legs', 'neck', 'head', 'tail', 'display'];
  return keys.reduce((sum, key) => sum + Math.abs((a[key] || 0) - (b[key] || 0)), 0) / keys.length;
}

function hashGenome(g) {
  const text = [g.hue, g.size, g.legs, g.sense, g.social, g.generation].map(value => Math.round((value || 0) * 100)).join(':');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function torusDistance(a, b, width, height) {
  if (!a || !b) return Infinity;
  const dx = shortest((b.x || 0) - (a.x || 0), width);
  const dy = shortest((b.y || 0) - (a.y || 0), height);
  return dx * dx + dy * dy;
}
function nearestCoordinate(value, reference, period) { return reference + shortest(value - reference, period); }
function shortest(delta, period) {
  if (delta > period * 0.5) return delta - period;
  if (delta < -period * 0.5) return delta + period;
  return delta;
}
function turnDelta(value, reference) {
  let delta = value - reference;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  return delta;
}
function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const wrap = (value, max) => ((value % max) + max) % max;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
