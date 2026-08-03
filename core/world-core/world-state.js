import { createDeterministicRng } from './rng.js';
import { createHistoryStore } from './history.js';

export function createWorldState(options = {}) {
  const seed = options.seed ?? 'reality-sandbox';
  const rng = createDeterministicRng(seed, options.snapshot?.rngState);
  const history = createHistoryStore(options.snapshot?.history);
  const entities = new Map();
  const modules = new Map();
  let nextEntityId = options.snapshot?.nextEntityId || 1;
  let timeYears = options.snapshot?.timeYears || 0;
  let tick = options.snapshot?.tick || 0;

  if (Array.isArray(options.snapshot?.entities)) {
    for (const entity of options.snapshot.entities) entities.set(entity.id, clone(entity));
  }

  function createEntity(kind, components = {}, preferredId = null) {
    const id = preferredId || `${kind}-${nextEntityId++}`;
    if (entities.has(id)) throw new Error(`Duplicate entity id: ${id}`);
    const entity = { id, kind, components: clone(components), createdAt: timeYears, alive: true };
    entities.set(id, entity);
    history.record({
      type: 'entity-created',
      time: timeYears,
      title: `${kind} created`,
      entities: [id],
      data: { kind },
    });
    return entity;
  }

  function updateEntity(id, patch) {
    const entity = entities.get(id);
    if (!entity) throw new Error(`Unknown entity: ${id}`);
    if (patch.components) entity.components = { ...entity.components, ...clone(patch.components) };
    for (const [key, value] of Object.entries(patch)) {
      if (key !== 'components' && key !== 'id') entity[key] = clone(value);
    }
    return entity;
  }

  function registerModule(module) {
    if (!module?.id || typeof module.step !== 'function') throw new Error('Modules require id and step().');
    if (modules.has(module.id)) throw new Error(`Duplicate module: ${module.id}`);
    modules.set(module.id, module);
    module.initialize?.(api);
    return module;
  }

  function step(years = 1) {
    const dt = Math.max(0, Number(years) || 0);
    for (const module of modules.values()) module.step(dt, api);
    timeYears += dt;
    tick++;
    return { timeYears, tick };
  }

  function save() {
    return {
      version: 1,
      seed,
      timeYears,
      tick,
      rngState: rng.getState(),
      nextEntityId,
      entities: [...entities.values()].map(clone),
      history: history.save(),
      modules: Object.fromEntries([...modules].map(([id, module]) => [id, module.save?.() ?? null])),
    };
  }

  function restoreModules(snapshot) {
    for (const [id, state] of Object.entries(snapshot?.modules || {})) modules.get(id)?.load?.(state, api);
  }

  const api = {
    seed,
    rng,
    history,
    createEntity,
    updateEntity,
    getEntity: id => entities.get(id) || null,
    getEntities: kind => [...entities.values()].filter(entity => !kind || entity.kind === kind),
    registerModule,
    step,
    save,
    restoreModules,
    getTimeYears: () => timeYears,
    getTick: () => tick,
  };

  return api;
}

function clone(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
