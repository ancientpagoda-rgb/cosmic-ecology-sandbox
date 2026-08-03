export function createRapierAdapter() {
  let RAPIER = null;
  let physicsWorld = null;
  let ready = false;
  const bodies = new Map();

  return {
    id: 'physics.rapier',
    name: 'Rapier Physics',
    version: '0.19.3',
    execution: 'wasm',
    source: '@dimforge/rapier3d-compat',
    license: 'Apache-2.0',
    provides: ['physics.rigid-body', 'physics.collisions'],

    async initialize({ provideCapability }) {
      RAPIER = await import('@dimforge/rapier3d-compat');
      await RAPIER.init();
      physicsWorld = new RAPIER.World({ x: 0, y: 0, z: 0 });
      ready = true;
      provideCapability('physics.rigid-body', this);
      provideCapability('physics.collisions', this);
    },

    step(dt) {
      if (!ready) return;
      physicsWorld.timestep = Math.min(1 / 30, Math.max(1 / 240, dt));
      physicsWorld.step();
    },

    createBody(id, options = {}) {
      if (!ready) throw new Error('Rapier is not initialized.');
      const position = options.position || { x: 0, y: 0, z: 0 };
      const bodyDesc = options.fixed
        ? RAPIER.RigidBodyDesc.fixed()
        : RAPIER.RigidBodyDesc.dynamic();
      bodyDesc.setTranslation(position.x, position.y, position.z);
      if (options.linearDamping != null) bodyDesc.setLinearDamping(options.linearDamping);
      const body = physicsWorld.createRigidBody(bodyDesc);
      const radius = options.radius || 0.02;
      const collider = physicsWorld.createCollider(
        RAPIER.ColliderDesc.ball(radius)
          .setRestitution(options.restitution ?? 0.15)
          .setFriction(options.friction ?? 0.7),
        body,
      );
      bodies.set(id, { body, collider });
      return body;
    },

    removeBody(id) {
      const entry = bodies.get(id);
      if (!entry || !physicsWorld) return;
      physicsWorld.removeRigidBody(entry.body);
      bodies.delete(id);
    },

    getTransform(id) {
      const entry = bodies.get(id);
      if (!entry) return null;
      return { position: entry.body.translation(), rotation: entry.body.rotation() };
    },

    applyForce(id, force) {
      const entry = bodies.get(id);
      entry?.body.addForce(force, true);
    },

    getWorld() { return physicsWorld; },
    isReady() { return ready; },
  };
}
