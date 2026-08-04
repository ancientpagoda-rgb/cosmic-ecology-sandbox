export async function createLocalCreaturePhysics(options = {}) {
  const mobile = Boolean(options.mobile);
  let RAPIER;
  try {
    RAPIER = await import('@dimforge/rapier3d-compat');
    await RAPIER.init();
  } catch (error) {
    console.warn('Rapier creature physics unavailable; using terrain-lock fallback.', error);
    return createFallbackPhysics();
  }

  const physicsWorld = new RAPIER.World({ x: 0, y: -3.8, z: 0 });
  const bodies = new Map();
  const ground = [];
  const gridRadius = mobile ? 3 : 4;
  const tileSize = mobile ? 0.52 : 0.46;
  const halfThickness = 0.035;
  let terrainRevision = '';

  for (let z = -gridRadius; z <= gridRadius; z++) {
    for (let x = -gridRadius; x <= gridRadius; x++) {
      const collider = physicsWorld.createCollider(
        RAPIER.ColliderDesc.cuboid(tileSize * 0.52, halfThickness, tileSize * 0.52)
          .setFriction(1.05)
          .setRestitution(0.02),
      );
      ground.push({ x, z, collider, floorY: 0 });
    }
  }

  function updateTerrain(navigation, terrainState, sampleSurface) {
    if (!navigation || !terrainState || typeof sampleSurface !== 'function') return;
    const level = terrainState.level || 7;
    const age = terrainState.geologicalAgeMyr || 0;
    const revision = `${level}:${Math.round(navigation.u * 900)}:${Math.round(navigation.v * 900)}:${Math.round(age * 2)}`;
    if (revision === terrainRevision) return;
    terrainRevision = revision;

    const worldUnitsPerTurn = 0.9 * (2 ** level);
    for (const tile of ground) {
      const localX = tile.x * tileSize;
      const localZ = tile.z * tileSize;
      const u = wrap(navigation.u + localX / worldUnitsPerTurn, 1);
      const v = clamp(navigation.v + localZ / worldUnitsPerTurn, 0.01, 0.99);
      const sample = sampleSurface(u, v);
      tile.floorY = sample.floorY;
      tile.collider.setTranslation({
        x: localX,
        y: sample.floorY - halfThickness,
        z: localZ,
      });
    }
  }

  function addCreature(id, bodyInfo, localPosition) {
    if (bodies.has(id)) return bodies.get(id);
    const radius = clamp(bodyInfo.radius || 0.025, 0.012, 0.09);
    const halfHeight = clamp((bodyInfo.height || 0.08) * 0.28, radius * 0.7, 0.14);
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(localPosition.x, localPosition.y + halfHeight + radius, localPosition.z)
      .setLinearDamping(4.2)
      .setAngularDamping(8)
      .setCcdEnabled(true)
      .lockRotations();
    const body = physicsWorld.createRigidBody(desc);
    const collider = physicsWorld.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, radius)
        .setFriction(0.94)
        .setRestitution(0.03)
        .setDensity(0.8),
      body,
    );
    const entry = { body, collider, radius, halfHeight, lastFloorY: localPosition.y };
    bodies.set(id, entry);
    return entry;
  }

  function removeCreature(id) {
    const entry = bodies.get(id);
    if (!entry) return;
    physicsWorld.removeRigidBody(entry.body);
    bodies.delete(id);
  }

  function step(dt, targets = new Map()) {
    physicsWorld.timestep = clamp(dt, 1 / 240, 1 / 30);
    for (const [id, target] of targets.entries()) {
      const entry = bodies.get(id);
      if (!entry) continue;
      const body = entry.body;
      const current = body.translation();
      entry.lastFloorY = target.floorY;
      const dx = target.x - current.x;
      const dz = target.z - current.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 0.82 || current.y < target.floorY - 0.6 || current.y > target.floorY + 1.4) {
        body.setTranslation({
          x: target.x,
          y: target.floorY + entry.halfHeight + entry.radius + 0.015,
          z: target.z,
        }, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        continue;
      }
      const desiredSpeed = clamp(target.speed || 0, 0, 2.2);
      const inverse = distance > 0.0001 ? 1 / distance : 0;
      const velocity = body.linvel();
      body.setLinvel({
        x: dx * inverse * desiredSpeed,
        y: velocity.y,
        z: dz * inverse * desiredSpeed,
      }, true);
    }

    physicsWorld.step();
    const transforms = new Map();
    for (const [id, entry] of bodies.entries()) {
      const position = entry.body.translation();
      const floor = entry.lastFloorY;
      if (position.y < floor - 0.35) {
        entry.body.setTranslation({
          x: position.x,
          y: floor + entry.halfHeight + entry.radius,
          z: position.z,
        }, true);
      }
      transforms.set(id, {
        x: position.x,
        y: Math.max(floor, position.y - entry.halfHeight - entry.radius),
        z: position.z,
      });
    }
    return transforms;
  }

  function clear() {
    for (const id of [...bodies.keys()]) removeCreature(id);
    physicsWorld.free?.();
  }

  return {
    ready: true,
    updateTerrain,
    addCreature,
    removeCreature,
    step,
    clear,
    getBodyCount: () => bodies.size,
  };
}

function createFallbackPhysics() {
  const bodies = new Set();
  return {
    ready: false,
    updateTerrain() {},
    addCreature(id) { bodies.add(id); },
    removeCreature(id) { bodies.delete(id); },
    step(_dt, targets = new Map()) {
      return new Map([...targets].map(([id, target]) => [id, {
        x: target.x,
        y: target.floorY,
        z: target.z,
      }]));
    },
    clear() { bodies.clear(); },
    getBodyCount: () => bodies.size,
  };
}

const wrap = (value, max) => ((value % max) + max) % max;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
