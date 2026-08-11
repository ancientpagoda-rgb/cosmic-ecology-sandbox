const EPSILON = 1e-12;

export const REALITY_TRANSACTION_TYPES = Object.freeze({
  GRAZE: 'GRAZE',
  PREDATE: 'PREDATE',
  DIE: 'DIE',
  REPRODUCE: 'REPRODUCE',
  DECOMPOSE: 'DECOMPOSE',
  UPTAKE: 'UPTAKE',
  PRECIPITATE: 'PRECIPITATE',
  FLOW: 'FLOW',
  ERODE: 'ERODE',
  DEPOSIT: 'DEPOSIT',
  EVAPORATE: 'EVAPORATE',
});

// Backward-compatible name for the ecology ledgers while the transaction bus
// expands to non-ecological cross-scale contracts.
export const ECOLOGICAL_TRANSACTION_TYPES = REALITY_TRANSACTION_TYPES;

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

export function installEcologicalTransactions({ world, historyLimit = 256 } = {}) {
  if (!world?.ecs?.components || typeof world.step !== 'function' || typeof world.ecs.destroyEntity !== 'function') {
    throw new Error('Reality transactions require the authoritative Eidolon world.');
  }

  const handlers = new Map();
  const beforeStepHooks = [];
  const afterStepHooks = [];
  const recent = [];
  const counts = Object.fromEntries(Object.values(REALITY_TRANSACTION_TYPES).map(type => [type, 0]));
  const guildMaps = {
    grazer: world.ecs.components.agent,
    predator: world.ecs.components.predator,
    apex: world.ecs.components.apex,
  };
  const originalStep = world.step;
  const originalDestroyEntity = world.ecs.destroyEntity;
  const originalSetMethods = new Map();
  let activeBatch = null;
  let sequence = 0;
  let destroyed = false;
  let suppressCapture = 0;

  function positionOf(id) {
    const pos = world.ecs.components.position?.get?.(id);
    return pos ? { x: finite(pos.x), y: finite(pos.y) } : { x: 0, y: 0 };
  }

  function handlerList(type) {
    return (handlers.get(type) || []).slice().sort((a, b) => b.priority - a.priority || a.order - b.order);
  }

  function appendRecord(event) {
    const record = {
      sequence: ++sequence,
      tick: world.tick,
      type: event.type,
      payload: { ...event.payload },
      result: { ...event.result },
    };
    recent.push(record);
    if (recent.length > historyLimit) recent.splice(0, recent.length - historyLimit);
    counts[event.type] = (counts[event.type] || 0) + 1;
    if (activeBatch) activeBatch.records.push(record);
    return record;
  }

  function transact(type, payload = {}, initialResult = {}) {
    if (!Object.values(REALITY_TRANSACTION_TYPES).includes(type)) throw new Error(`Unknown reality transaction type: ${type}`);
    const event = { type, payload: { ...payload }, result: { ...initialResult }, tick: world.tick };
    suppressCapture += 1;
    try {
      for (const registration of handlerList(type)) registration.handler(event);
    } finally {
      suppressCapture -= 1;
    }
    appendRecord(event);
    return event;
  }

  function register(type, handler, priority = 0) {
    if (!Object.values(REALITY_TRANSACTION_TYPES).includes(type)) throw new Error(`Unknown reality transaction type: ${type}`);
    if (typeof handler !== 'function') throw new Error('Reality transaction handler must be a function.');
    const list = handlers.get(type) || [];
    const registration = { handler, priority, order: sequence++ };
    list.push(registration);
    handlers.set(type, list);
    return () => {
      const current = handlers.get(type) || [];
      const index = current.indexOf(registration);
      if (index >= 0) current.splice(index, 1);
    };
  }

  function addStepHook(collection, handler, priority = 0) {
    const registration = { handler, priority, order: sequence++ };
    collection.push(registration);
    return () => {
      const index = collection.indexOf(registration);
      if (index >= 0) collection.splice(index, 1);
    };
  }

  function runHooks(collection, dt) {
    const sorted = collection.slice().sort((a, b) => b.priority - a.priority || a.order - b.order);
    for (const hook of sorted) hook.handler({ world, dt, transactions: api });
  }

  function pendingRemoval(guild) {
    if (!activeBatch) return null;
    for (let index = activeBatch.removals.length - 1; index >= 0; index -= 1) {
      const removal = activeBatch.removals[index];
      if (!removal.consumed && removal.guild === guild) return removal;
    }
    return null;
  }

  function pendingBirth(guild, parentId) {
    if (!activeBatch) return null;
    for (let index = activeBatch.births.length - 1; index >= 0; index -= 1) {
      const birth = activeBatch.births[index];
      if (!birth.consumed && birth.guild === guild && birth.id !== parentId) return birth;
    }
    return null;
  }

  function wrapOrganism(id, guild, entity) {
    if (!entity || typeof entity !== 'object' || entity.__ecologicalTransactionProxy) return entity;
    const proxy = new Proxy(entity, {
      get(target, property, receiver) {
        if (property === '__ecologicalTransactionProxy') return true;
        return Reflect.get(target, property, receiver);
      },
      set(target, property, value, receiver) {
        if (property !== 'energy' || suppressCapture > 0 || !activeBatch) return Reflect.set(target, property, value, receiver);
        const before = Math.max(0, finite(target.energy));
        let after = Math.max(0, finite(value));
        const delta = after - before;
        const position = positionOf(id);

        if (delta > EPSILON && guild === 'grazer') {
          const event = transact(REALITY_TRANSACTION_TYPES.GRAZE, {
            consumerId: id,
            guild,
            x: position.x,
            y: position.y,
            requestedGain: delta,
          }, { allowedGain: delta });
          after = before + Math.max(0, finite(event.result.allowedGain, delta));
        } else if (delta > EPSILON && (guild === 'predator' || guild === 'apex')) {
          const preyGuild = guild === 'predator' ? 'grazer' : 'predator';
          const prey = pendingRemoval(preyGuild);
          if (prey) {
            prey.consumed = true;
            const event = transact(REALITY_TRANSACTION_TYPES.PREDATE, {
              consumerId: id,
              consumerGuild: guild,
              preyId: prey.id,
              preyGuild,
              x: prey.x,
              y: prey.y,
              preyEnergy: prey.energy,
              requestedGain: delta,
            }, { allowedGain: delta });
            after = before + Math.max(0, finite(event.result.allowedGain, delta));
          }
        } else if (delta < -EPSILON) {
          const birth = pendingBirth(guild, id);
          if (birth) {
            birth.consumed = true;
            const child = guildMaps[guild]?.get?.(birth.id);
            const parentLoss = before - after;
            const event = transact(REALITY_TRANSACTION_TYPES.REPRODUCE, {
              parentId: id,
              childId: birth.id,
              guild,
              x: position.x,
              y: position.y,
              parentEnergyBefore: before,
              parentEnergyAfter: after,
              parentEnergyTransferred: parentLoss,
              childEnergy: Math.max(0, finite(child?.energy)),
            }, { childEnergy: Math.max(0, finite(child?.energy)) });
            if (child && Number.isFinite(event.result.childEnergy)) {
              suppressCapture += 1;
              try { child.energy = Math.max(0, event.result.childEnergy); } finally { suppressCapture -= 1; }
            }
          }
        }

        const changed = Reflect.set(target, property, after, receiver);
        activeBatch.energyMutations.push({ id, guild, before, after, x: position.x, y: position.y });
        return changed;
      },
    });
    return proxy;
  }

  function installGuildMapCapture(guild, map) {
    if (!map?.set) return;
    for (const [id, entity] of [...map.entries()]) Map.prototype.set.call(map, id, wrapOrganism(id, guild, entity));
    const originalSet = map.set.bind(map);
    originalSetMethods.set(map, originalSet);
    map.set = function capturedSet(id, entity) {
      const existed = map.has(id);
      const wrapped = wrapOrganism(id, guild, entity);
      const result = originalSet(id, wrapped);
      if (!existed && activeBatch && suppressCapture === 0) {
        const pos = positionOf(id);
        activeBatch.births.push({ id, guild, x: pos.x, y: pos.y, initialEnergy: Math.max(0, finite(wrapped?.energy)), consumed: false });
      }
      return result;
    };
  }

  for (const [guild, map] of Object.entries(guildMaps)) installGuildMapCapture(guild, map);

  const capturedDestroyEntity = function capturedDestroyEntity(id) {
    if (activeBatch && suppressCapture === 0) {
      for (const [guild, map] of Object.entries(guildMaps)) {
        if (!map?.has?.(id)) continue;
        const entity = map.get(id);
        const pos = positionOf(id);
        activeBatch.removals.push({ id, guild, x: pos.x, y: pos.y, energy: Math.max(0, finite(entity?.energy)), consumed: false });
        break;
      }
    }
    return originalDestroyEntity.call(world.ecs, id);
  };
  world.ecs.destroyEntity = capturedDestroyEntity;

  function flushDeaths() {
    if (!activeBatch) return;
    for (const removal of activeBatch.removals) {
      if (removal.consumed) continue;
      transact(REALITY_TRANSACTION_TYPES.DIE, {
        entityId: removal.id,
        guild: removal.guild,
        x: removal.x,
        y: removal.y,
        storedEnergy: removal.energy,
      }, {});
      removal.consumed = true;
    }
  }

  function wrappedStep(dt) {
    if (destroyed || activeBatch) return originalStep.call(world, dt);
    activeBatch = {
      tickBefore: world.tick,
      births: [],
      removals: [],
      energyMutations: [],
      records: [],
    };
    try {
      runHooks(beforeStepHooks, dt);
      const result = originalStep.call(world, dt);
      flushDeaths();
      runHooks(afterStepHooks, dt);
      return result;
    } finally {
      activeBatch = null;
    }
  }

  world.step = wrappedStep;

  function snapshot() {
    return {
      version: 2,
      eventDriven: true,
      scanFreePopulationAccounting: true,
      domains: ['ecology', 'hydrology'],
      types: { ...REALITY_TRANSACTION_TYPES },
      counts: { ...counts },
      recent: recent.slice(-64).map(record => ({ ...record, payload: { ...record.payload }, result: { ...record.result } })),
      handlers: Object.fromEntries([...handlers.entries()].map(([type, list]) => [type, list.length])),
      hooks: { beforeStep: beforeStepHooks.length, afterStep: afterStepHooks.length },
    };
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (world.step === wrappedStep) world.step = originalStep;
    if (world.ecs.destroyEntity === capturedDestroyEntity) world.ecs.destroyEntity = originalDestroyEntity;
    for (const [map, originalSet] of originalSetMethods.entries()) map.set = originalSet;
    handlers.clear();
    beforeStepHooks.length = 0;
    afterStepHooks.length = 0;
    if (world.ecologicalTransactions === api) world.ecologicalTransactions = null;
    if (world.realityTransactions === api) world.realityTransactions = null;
  }

  const api = {
    version: 2,
    eventDriven: true,
    types: REALITY_TRANSACTION_TYPES,
    transact,
    register,
    beforeStep: (handler, priority = 0) => addStepHook(beforeStepHooks, handler, priority),
    afterStep: (handler, priority = 0) => addStepHook(afterStepHooks, handler, priority),
    snapshot,
    destroy,
  };

  world.ecologicalTransactions = api;
  world.realityTransactions = api;
  return api;
}

export const installRealityTransactions = installEcologicalTransactions;
