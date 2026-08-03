const TAU = Math.PI * 2;

export function createScaleRuntime(options = {}) {
  const entities = new Map();
  const listeners = new Set();
  const state = {
    camera: {
      distance: options.distance ?? 3,
      altitude: 2,
      longitude: 0,
      latitude: 0,
      systemRotationX: 0,
      systemRotationY: 0,
    },
    lod: createLodWeights(options.distance ?? 3),
    lighting: {
      sunDirection: { x: 1, y: 0, z: 1 },
      exposure: 1.05,
      atmosphere: 0,
    },
    activeTier: 'planet',
    origin: { x: 0, y: 0, z: 0 },
  };

  function updateCamera(cameraState = {}) {
    const distance = Number.isFinite(cameraState.distance) ? cameraState.distance : state.camera.distance;
    state.camera = {
      distance,
      altitude: Math.max(0, distance - 1),
      longitude: wrap(-(cameraState.rotationY ?? 0), TAU),
      latitude: clamp(-(cameraState.rotationX ?? 0), -Math.PI / 2, Math.PI / 2),
      systemRotationX: cameraState.systemRotationX ?? 0,
      systemRotationY: cameraState.systemRotationY ?? 0,
    };
    state.lod = createLodWeights(distance);
    state.activeTier = chooseTier(state.lod);
    state.lighting.atmosphere = state.lod.region * 0.35 + state.lod.surface * 0.85;
    emit();
    return state;
  }

  function setSunDirection(direction) {
    if (!direction) return;
    state.lighting.sunDirection = normalize(direction);
    emit();
  }

  function registerEntity(entity) {
    if (!entity?.id) throw new Error('Persistent entities require an id.');
    entities.set(entity.id, {
      scale: 'planet',
      position: { x: 0, y: 0, z: 0 },
      ...entity,
    });
    return entities.get(entity.id);
  }

  function getEntity(id) {
    return entities.get(id) || null;
  }

  function aggregateEntity(id, representation) {
    const entity = entities.get(id);
    if (!entity) return null;
    entity.representations ||= {};
    entity.representations[representation.scale] = representation;
    return entity;
  }

  function geospatialAddress(level, longitude, latitude) {
    const xNorm = wrap(longitude + Math.PI, TAU) / TAU;
    const yNorm = clamp(0.5 - latitude / Math.PI, 0, 1);
    const tiles = 2 ** level;
    return {
      planet: options.planetId || 'gaia',
      face: 'equirect',
      level,
      x: Math.min(tiles - 1, Math.floor(xNorm * tiles)),
      y: Math.min(tiles - 1, Math.floor(yNorm * tiles)),
      key: `${options.planetId || 'gaia'}/equirect/${level}/${Math.min(tiles - 1, Math.floor(xNorm * tiles))}/${Math.min(tiles - 1, Math.floor(yNorm * tiles))}`,
    };
  }

  function simulationBudget() {
    const tier = state.activeTier;
    if (tier === 'galaxy') return { galaxy: 'statistical', system: 'paused', planet: 'aggregate', region: 'paused', surface: 'paused' };
    if (tier === 'system') return { galaxy: 'statistical', system: 'orbital', planet: 'aggregate', region: 'paused', surface: 'paused' };
    if (tier === 'planet') return { galaxy: 'statistical', system: 'orbital', planet: 'full', region: 'aggregate', surface: 'paused' };
    if (tier === 'region') return { galaxy: 'statistical', system: 'orbital', planet: 'full', region: 'full', surface: 'aggregate' };
    return { galaxy: 'statistical', system: 'orbital', planet: 'full', region: 'full', surface: 'full' };
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(state);
    return () => listeners.delete(listener);
  }

  function emit() {
    for (const listener of listeners) listener(state);
  }

  return {
    updateCamera,
    setSunDirection,
    registerEntity,
    getEntity,
    aggregateEntity,
    geospatialAddress,
    simulationBudget,
    subscribe,
    getState: () => state,
    getLod: () => state.lod,
    getCamera: () => state.camera,
  };
}

export function createLodWeights(distance) {
  const surface = 1 - smoothstep(1.28, 1.62, distance);
  const regionIn = smoothstep(1.28, 1.58, distance);
  const regionOut = 1 - smoothstep(2.2, 3.2, distance);
  const region = regionIn * regionOut;
  const planetIn = smoothstep(1.8, 2.7, distance);
  const planetOut = 1 - smoothstep(7.5, 12, distance);
  const planet = planetIn * planetOut;
  const systemIn = smoothstep(5.5, 9.5, distance);
  const systemOut = 1 - smoothstep(34, 49, distance);
  const system = systemIn * systemOut;
  const galaxy = smoothstep(31, 50, distance);
  const total = surface + region + planet + system + galaxy || 1;
  return {
    surface: surface / total,
    region: region / total,
    planet: planet / total,
    system: system / total,
    galaxy: galaxy / total,
  };
}

function chooseTier(lod) {
  return Object.entries(lod).sort((a, b) => b[1] - a[1])[0][0];
}
function normalize(vector) {
  const length = Math.hypot(vector.x || 0, vector.y || 0, vector.z || 0) || 1;
  return { x: (vector.x || 0) / length, y: (vector.y || 0) / length, z: (vector.z || 0) / length };
}
function smoothstep(a, b, value) {
  const x = clamp((value - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
}
function wrap(value, max) {
  return ((value % max) + max) % max;
}
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
