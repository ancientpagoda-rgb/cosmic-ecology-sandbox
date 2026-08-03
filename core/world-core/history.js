export function createHistoryStore(snapshot = null) {
  const events = new Map();
  const entityEvents = new Map();
  let nextId = snapshot?.nextId || 1;

  if (Array.isArray(snapshot?.events)) {
    for (const event of snapshot.events) insertEvent(event);
  }

  function record(input) {
    const event = {
      id: input.id || `event-${nextId++}`,
      type: input.type || 'unknown',
      time: Number(input.time) || 0,
      title: input.title || input.type || 'Event',
      description: input.description || '',
      entities: [...new Set(input.entities || [])],
      causes: [...new Set(input.causes || [])],
      location: input.location ? { ...input.location } : null,
      data: input.data ? structuredCloneSafe(input.data) : null,
    };
    for (const causeId of event.causes) {
      if (!events.has(causeId)) throw new Error(`Unknown cause: ${causeId}`);
      if (causeId === event.id) throw new Error('An event cannot cause itself.');
    }
    insertEvent(event);
    return event;
  }

  function insertEvent(event) {
    events.set(event.id, event);
    for (const entityId of event.entities || []) {
      if (!entityEvents.has(entityId)) entityEvents.set(entityId, []);
      entityEvents.get(entityId).push(event.id);
    }
  }

  function explain(eventId, depth = 6) {
    const root = events.get(eventId);
    if (!root) return null;
    const seen = new Set();
    function visit(event, remaining) {
      if (!event || remaining < 0 || seen.has(event.id)) return null;
      seen.add(event.id);
      return {
        ...event,
        causes: (event.causes || [])
          .map(id => visit(events.get(id), remaining - 1))
          .filter(Boolean),
      };
    }
    return visit(root, depth);
  }

  function timeline(options = {}) {
    const from = options.from ?? -Infinity;
    const to = options.to ?? Infinity;
    const entityId = options.entityId;
    const type = options.type;
    const source = entityId
      ? (entityEvents.get(entityId) || []).map(id => events.get(id))
      : [...events.values()];
    return source
      .filter(event => event.time >= from && event.time <= to)
      .filter(event => !type || event.type === type)
      .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  }

  function save() {
    return {
      nextId,
      events: timeline().map(event => structuredCloneSafe(event)),
    };
  }

  return {
    record,
    get: id => events.get(id) || null,
    explain,
    timeline,
    save,
    get size() { return events.size; },
  };
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
