// Minimal ECS-lite: entities are IDs; components are maps from id -> data.

let nextId = 1;

export function createEcs() {
  const entities = new Set();
  const components = {
    position: new Map(), // { x, y }
    velocity: new Map(), // { vx, vy }
    agent: new Map(),    // { colorHue, energy, dna, ... }
    predator: new Map(), // { colorHue, energy, age, dna, rest }
    apex: new Map(),     // { colorHue, energy, age, rest, dna }
    plant: new Map(),    // reserved for individually embodied vegetation entities
    burst: new Map(),    // transient burst particles { vx, vy, life, hue }
    resource: new Map(), // { kind, amount, regenTimer, age, cycles, seedTimer }
    forceField: new Map(), // { strength, radius }
  };

  function createEntity() {
    const id = nextId++;
    entities.add(id);
    return id;
  }

  function destroyEntity(id) {
    entities.delete(id);
    for (const comp of Object.values(components)) {
      comp.delete(id);
    }
  }

  function* view(...keys) {
    for (const id of entities) {
      let ok = true;
      for (const k of keys) {
        if (!components[k].has(id)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      yield { id, ...Object.fromEntries(keys.map((k) => [k, components[k].get(id)])) };
    }
  }

  return {
    entities,
    components,
    createEntity,
    destroyEntity,
    view,
  };
}
