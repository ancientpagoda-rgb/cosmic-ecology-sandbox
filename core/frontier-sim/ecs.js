let nextEntityId = 1;

export function createFrontierEcs() {
  const entities = new Set();
  const components = {
    position: new Map(),
    velocity: new Map(),
    settlement: new Map(),
    faction: new Map(),
    route: new Map(),
    mobileUnit: new Map(),
    cargo: new Map(),
    site: new Map(),
    memory: new Map(),
  };

  function createEntity() {
    const id = nextEntityId++;
    entities.add(id);
    return id;
  }

  function destroyEntity(id) {
    entities.delete(id);
    for (const store of Object.values(components)) {
      store.delete(id);
    }
  }

  function* view(...keys) {
    for (const id of entities) {
      let hasAll = true;
      for (const key of keys) {
        if (!components[key].has(id)) {
          hasAll = false;
          break;
        }
      }
      if (!hasAll) continue;
      yield { id, ...Object.fromEntries(keys.map(key => [key, components[key].get(id)])) };
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
