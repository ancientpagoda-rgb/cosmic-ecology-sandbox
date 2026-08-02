// Convert the simulation's rectangular coordinates into a spherical topology.
// X is longitude: it wraps continuously around the globe.
// Y is latitude: crossing a pole reflects latitude and rotates longitude 180°.

export function createSphericalStepper(world) {
  const previousY = new Map();

  return function stepSphere(dt) {
    const { position, velocity } = world.ecs.components;
    const width = world.width;
    const height = world.height;

    previousY.clear();
    for (const [id, pos] of position.entries()) previousY.set(id, pos.y);

    // The existing world step still performs ordinary edge wrapping. We then
    // reinterpret vertical wraps as pole crossings on a sphere.
    world.step(dt);

    for (const [id, pos] of position.entries()) {
      const before = previousY.get(id);
      if (before == null) continue;

      const vel = velocity.get(id);
      const crossedNorth = before < height * 0.25 && pos.y > height * 0.75;
      const crossedSouth = before > height * 0.75 && pos.y < height * 0.25;

      if (crossedNorth) {
        pos.y = height - pos.y;
        pos.x = (pos.x + width * 0.5) % width;
        if (vel) vel.vy = Math.abs(vel.vy);
      } else if (crossedSouth) {
        pos.y = height - pos.y;
        pos.x = (pos.x + width * 0.5) % width;
        if (vel) vel.vy = -Math.abs(vel.vy);
      }

      // Longitude remains continuous around the globe.
      pos.x = ((pos.x % width) + width) % width;
      pos.y = Math.max(0, Math.min(height, pos.y));
    }
  };
}
