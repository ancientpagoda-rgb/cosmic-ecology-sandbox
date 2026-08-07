const CACHE_WIDTH = 64;
const CACHE_HEIGHT = 32;
const CHUNK_SIZE = 128;
const REFRESH_AFTER_MS = 5000;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function wrap(value, maximum) {
  return ((value % maximum) + maximum) % maximum;
}

function scheduleIdle(callback) {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(callback, { timeout: 120 });
  } else {
    setTimeout(() => callback({ timeRemaining: () => 8 }), 0);
  }
}

async function installInteractionCache() {
  try {
    await window.realitySandboxReady;
  } catch {
    return;
  }

  const runtime = window.realitySandboxUnified;
  const planet = window.realitySandboxPlanet;
  const living = planet?.living;
  const waterCycle = planet?.waterCycle;
  const world = planet?.world;
  if (!runtime?.render || !living?.sampleDynamicPlanet || !waterCycle?.sample || !world) return;
  if (runtime.__interactionCacheInstalled) return;

  const originalTerrain = living.sampleDynamicPlanet.bind(living);
  const originalWater = waterCycle.sample.bind(waterCycle);
  const originalRender = runtime.render.bind(runtime);

  let terrainCache = new Array(CACHE_WIDTH * CACHE_HEIGHT);
  let waterCache = new Array(CACHE_WIDTH * CACHE_HEIGHT);
  let cacheReady = false;
  let building = false;
  let buildToken = 0;
  let refreshTimer = 0;

  function indexForWorld(x, y) {
    const column = Math.floor(wrap(x, world.width) / world.width * CACHE_WIDTH) % CACHE_WIDTH;
    const row = clamp(Math.floor(clamp(y, 0, world.height - Number.EPSILON) / world.height * CACHE_HEIGHT), 0, CACHE_HEIGHT - 1);
    return row * CACHE_WIDTH + column;
  }

  function cachedTerrain(x, y) {
    return terrainCache[indexForWorld(x, y)] || originalTerrain(x, y);
  }

  function cachedWater(x, y) {
    return waterCache[indexForWorld(x, y)] || originalWater(x, y);
  }

  function rebuildCache() {
    if (building) return;
    building = true;
    cacheReady = false;
    const token = ++buildToken;
    const nextTerrain = new Array(CACHE_WIDTH * CACHE_HEIGHT);
    const nextWater = new Array(CACHE_WIDTH * CACHE_HEIGHT);
    let cursor = 0;

    function buildChunk(deadline) {
      if (token !== buildToken) return;
      let built = 0;
      while (cursor < nextTerrain.length && built < CHUNK_SIZE && (deadline.timeRemaining() > 1 || built < 24)) {
        const row = Math.floor(cursor / CACHE_WIDTH);
        const column = cursor - row * CACHE_WIDTH;
        const x = (column + 0.5) / CACHE_WIDTH * world.width;
        const y = (row + 0.5) / CACHE_HEIGHT * world.height;
        nextTerrain[cursor] = originalTerrain(x, y);
        nextWater[cursor] = originalWater(x, y);
        cursor += 1;
        built += 1;
      }

      if (cursor < nextTerrain.length) {
        scheduleIdle(buildChunk);
        return;
      }

      terrainCache = nextTerrain;
      waterCache = nextWater;
      cacheReady = true;
      building = false;
      document.documentElement.dataset.interactionCache = 'ready';
      window.dispatchEvent(new CustomEvent('reality-interaction-cache-ready'));
    }

    scheduleIdle(buildChunk);
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(rebuildCache, REFRESH_AFTER_MS);
  }

  window.realitySandboxInteractionCache = {
    width: CACHE_WIDTH,
    height: CACHE_HEIGHT,
    isReady: () => cacheReady,
    sampleTerrain: cachedTerrain,
    sampleWater: cachedWater,
  };

  runtime.render = frame => {
    const interacting = document.getElementById('lofiLivingCanvas')?.dataset.dragging === 'true';
    if (!interacting || !cacheReady) {
      return originalRender(frame);
    }

    living.sampleDynamicPlanet = cachedTerrain;
    waterCycle.sample = cachedWater;
    try {
      return originalRender(frame);
    } finally {
      living.sampleDynamicPlanet = originalTerrain;
      waterCycle.sample = originalWater;
    }
  };

  const canvas = document.getElementById('lofiLivingCanvas');
  canvas?.addEventListener('pointerup', scheduleRefresh, { passive: true });
  canvas?.addEventListener('pointercancel', scheduleRefresh, { passive: true });

  runtime.__interactionCacheInstalled = true;
  rebuildCache();
}

document.addEventListener('DOMContentLoaded', installInteractionCache, { once: true });
