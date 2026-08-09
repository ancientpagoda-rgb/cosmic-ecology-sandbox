const MAX_ENTRIES = 36;

export function createEcologyJournal(world) {
  const entries = [];

  function record(title, description, kind = 'observation') {
    if (!title || !description) return null;
    const previous = entries[0];
    if (previous?.title === title && world.tick - previous.tick < 18) return previous;

    const entry = {
      id: `${world.seed || 'nysa'}-${world.tick}-${entries.length}`,
      tick: world.tick,
      title,
      description,
      kind,
    };
    entries.unshift(entry);
    if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
    globalThis.window?.dispatchEvent?.(new CustomEvent('ecology-journal-event', { detail: entry }));
    return entry;
  }

  return {
    record,
    getEntries: (limit = MAX_ENTRIES) => entries.slice(0, Math.max(0, limit)),
  };
}
