function normalizeTypes(types) {
  const values = Array.isArray(types)
    ? types
    : types && typeof types === 'object'
      ? Object.values(types)
      : [];
  const unique = [...new Set(values.map(value => String(value)).filter(Boolean))];
  if (!unique.length) throw new Error('transaction journal requires at least one allowed type');
  return Object.freeze(unique);
}

export function createTransactionJournal({
  types,
  historyLimit = 256,
  getTick = () => 0,
} = {}) {
  const allowedTypes = normalizeTypes(types);
  const allowed = new Set(allowedTypes);
  if (!(Number.isInteger(historyLimit) && historyLimit >= 0)) throw new Error('historyLimit must be a non-negative integer');
  if (typeof getTick !== 'function') throw new Error('getTick must be a function');

  const handlers = new Map();
  const beforeStepHooks = [];
  const afterStepHooks = [];
  const recent = [];
  const counts = Object.fromEntries(allowedTypes.map(type => [type, 0]));
  let recordSequence = 0;
  let registrationOrder = 0;
  let destroyed = false;

  function assertActive() {
    if (destroyed) throw new Error('transaction journal has been destroyed');
  }

  function assertType(type) {
    if (!allowed.has(type)) throw new Error(`Unknown transaction type: ${type}`);
  }

  function sorted(collection) {
    return collection.slice().sort((a, b) => b.priority - a.priority || a.order - b.order);
  }

  function appendRecord(event) {
    const record = {
      sequence: ++recordSequence,
      tick: event.tick,
      type: event.type,
      payload: { ...event.payload },
      result: { ...event.result },
    };
    if (historyLimit > 0) {
      recent.push(record);
      if (recent.length > historyLimit) recent.splice(0, recent.length - historyLimit);
    }
    counts[event.type] += 1;
    return record;
  }

  function transact(type, payload = {}, initialResult = {}) {
    assertActive();
    assertType(type);
    const event = {
      type,
      payload: { ...payload },
      result: { ...initialResult },
      tick: getTick(),
    };
    for (const registration of sorted(handlers.get(type) || [])) registration.handler(event);
    appendRecord(event);
    return event;
  }

  function register(type, handler, priority = 0) {
    assertActive();
    assertType(type);
    if (typeof handler !== 'function') throw new Error('transaction handler must be a function');
    const list = handlers.get(type) || [];
    const registration = { handler, priority: Number(priority) || 0, order: registrationOrder++ };
    list.push(registration);
    handlers.set(type, list);
    return () => {
      const current = handlers.get(type) || [];
      const index = current.indexOf(registration);
      if (index >= 0) current.splice(index, 1);
    };
  }

  function addHook(collection, handler, priority = 0) {
    assertActive();
    if (typeof handler !== 'function') throw new Error('transaction step hook must be a function');
    const registration = { handler, priority: Number(priority) || 0, order: registrationOrder++ };
    collection.push(registration);
    return () => {
      const index = collection.indexOf(registration);
      if (index >= 0) collection.splice(index, 1);
    };
  }

  function runHooks(collection, context = {}) {
    assertActive();
    for (const hook of sorted(collection)) hook.handler(context);
  }

  function snapshot() {
    return {
      version: 1,
      types: [...allowedTypes],
      counts: { ...counts },
      recent: recent.map(record => ({
        ...record,
        payload: { ...record.payload },
        result: { ...record.result },
      })),
      handlers: Object.fromEntries(allowedTypes.map(type => [type, (handlers.get(type) || []).length])),
      hooks: {
        beforeStep: beforeStepHooks.length,
        afterStep: afterStepHooks.length,
      },
      recordSequence,
    };
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    handlers.clear();
    beforeStepHooks.length = 0;
    afterStepHooks.length = 0;
    recent.length = 0;
  }

  return {
    version: 1,
    transact,
    register,
    beforeStep: (handler, priority = 0) => addHook(beforeStepHooks, handler, priority),
    afterStep: (handler, priority = 0) => addHook(afterStepHooks, handler, priority),
    runBeforeStep: context => runHooks(beforeStepHooks, context),
    runAfterStep: context => runHooks(afterStepHooks, context),
    snapshot,
    destroy,
  };
}
