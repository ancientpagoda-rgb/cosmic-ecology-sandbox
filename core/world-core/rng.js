export function createDeterministicRng(seed = 1, state = null) {
  let value = Number.isFinite(state) ? state >>> 0 : hashSeed(seed);

  function next() {
    value += 0x6D2B79F5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  }

  return {
    next,
    int(max) { return Math.floor(next() * Math.max(1, max)); },
    range(min, max) { return min + (max - min) * next(); },
    chance(probability) { return next() < probability; },
    pick(items) { return items[Math.min(items.length - 1, Math.floor(next() * items.length))]; },
    getState: () => value >>> 0,
    setState(nextState) { value = nextState >>> 0; },
  };
}

export function hashSeed(seed) {
  const text = String(seed);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
