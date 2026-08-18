const SURFACE_SAMPLE_GRID = 20;
const MAX_SAMPLE_CACHE_ENTRIES = 10000;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrap = (value, max) => ((value % max) + max) % max;

async function waitForRuntime() {
  for (let attempt = 0; attempt < 300; attempt++) {
    const ready = window.realitySandboxReady;
    if (ready && typeof ready.then === 'function') {
      try { await ready; } catch { return null; }
    }
    const runtime = window.realitySandboxUnified;
    const planet = window.realitySandboxPlanet;
    const mode = window.realitySandboxSurfaceMode;
    if (runtime?.render && planet?.world && planet?.living?.sampleDynamicPlanet && planet?.waterCycle?.sample && mode?.isActive) {
      return { runtime, planet, mode };
    }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  return null;
}

function installCpuRelief({ runtime, planet, mode }) {
  if (window.realitySandboxSurfaceCpuRelief?.installed) return;

  const { world } = planet;
  const stats = {
    rootRenderCalls: 0,
    rootRendersSkipped: 0,
    terrainHotHits: 0,
    terrainHotMisses: 0,
    waterHotHits: 0,
    waterHotMisses: 0,
    terrainGridHits: 0,
    terrainGridMisses: 0,
    waterGridHits: 0,
    waterGridMisses: 0,
    cacheResets: 0,
  };

  const surfaceActive = () => Boolean(mode.isActive?.() && document.documentElement.dataset.surfaceMode === 'active');

  const nativeRootRender = runtime.render.bind(runtime);
  runtime.render = function surfaceAwareRootRender(frame) {
    stats.rootRenderCalls++;
    if (surfaceActive()) {
      stats.rootRendersSkipped++;
      return;
    }
    syncCacheSession(false);
    return nativeRootRender(frame);
  };

  const nativeTerrainSample = planet.living.sampleDynamicPlanet.bind(planet.living);
  const nativeWaterSample = planet.waterCycle.sample.bind(planet.waterCycle);
  const terrainGrid = new Map();
  const waterGrid = new Map();
  let cacheSessionActive = false;

  function clearCaches() {
    terrainGrid.clear();
    waterGrid.clear();
    stats.cacheResets++;
  }

  function syncCacheSession(active = surfaceActive()) {
    if (active && !cacheSessionActive) {
      clearCaches();
      cacheSessionActive = true;
    } else if (!active && cacheSessionActive) {
      clearCaches();
      cacheSessionActive = false;
    }
    return active;
  }

  function remember(cache, key, value) {
    cache.set(key, value);
    if (cache.size <= MAX_SAMPLE_CACHE_ENTRIES) return value;
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
    return value;
  }

  function nodeKey(x, y) {
    return `${x.toFixed(3)}:${y.toFixed(3)}`;
  }

  function sampleNode(cache, nativeSample, x, y, hitField, missField) {
    const sx = wrap(x, world.width);
    const sy = clamp(y, 0, world.height);
    const key = nodeKey(sx, sy);
    if (cache.has(key)) {
      stats[hitField]++;
      return cache.get(key);
    }
    stats[missField]++;
    return remember(cache, key, nativeSample(sx, sy));
  }

  function bilerp(a, b, c, d, tx, ty) {
    const nearest = ty < 0.5 ? (tx < 0.5 ? a : b) : (tx < 0.5 ? c : d);
    if (!nearest || typeof nearest !== 'object') return nearest;
    const result = { ...nearest };
    const keys = new Set([
      ...Object.keys(a || {}),
      ...Object.keys(b || {}),
      ...Object.keys(c || {}),
      ...Object.keys(d || {}),
    ]);

    for (const key of keys) {
      const av = a?.[key];
      const bv = b?.[key];
      const cv = c?.[key];
      const dv = d?.[key];
      if (![av, bv, cv, dv].every(Number.isFinite)) continue;
      const top = av + (bv - av) * tx;
      const bottom = cv + (dv - cv) * tx;
      result[key] = top + (bottom - top) * ty;
    }
    return result;
  }

  function sampleInterpolated(cache, nativeSample, x, y, hitField, missField) {
    const sx = wrap(x, world.width);
    const sy = clamp(y, 0, world.height);
    const x0 = Math.floor(sx / SURFACE_SAMPLE_GRID) * SURFACE_SAMPLE_GRID;
    const y0 = Math.floor(sy / SURFACE_SAMPLE_GRID) * SURFACE_SAMPLE_GRID;
    const x1 = x0 + SURFACE_SAMPLE_GRID;
    const y1 = Math.min(world.height, y0 + SURFACE_SAMPLE_GRID);
    const tx = clamp((sx - x0) / SURFACE_SAMPLE_GRID, 0, 1);
    const ySpan = Math.max(1e-6, y1 - y0);
    const ty = clamp((sy - y0) / ySpan, 0, 1);

    const a = sampleNode(cache, nativeSample, x0, y0, hitField, missField);
    const b = sampleNode(cache, nativeSample, x1, y0, hitField, missField);
    const c = sampleNode(cache, nativeSample, x0, y1, hitField, missField);
    const d = sampleNode(cache, nativeSample, x1, y1, hitField, missField);
    return bilerp(a, b, c, d, tx, ty);
  }

  function cacheableSurfaceRead(rest) {
    return rest.length === 0 || (rest.length === 1 && rest[0] === 'vegetation-v38');
  }

  planet.living.sampleDynamicPlanet = function surfaceCachedTerrainSample(x, y, ...rest) {
    if (!cacheableSurfaceRead(rest) || !Number.isFinite(x) || !Number.isFinite(y) || !syncCacheSession()) {
      stats.terrainHotMisses++;
      return nativeTerrainSample(x, y, ...rest);
    }
    stats.terrainHotHits++;
    return sampleInterpolated(terrainGrid, nativeTerrainSample, x, y, 'terrainGridHits', 'terrainGridMisses');
  };

  planet.waterCycle.sample = function surfaceCachedWaterSample(x, y, ...rest) {
    if (!cacheableSurfaceRead(rest) || !Number.isFinite(x) || !Number.isFinite(y) || !syncCacheSession()) {
      stats.waterHotMisses++;
      return nativeWaterSample(x, y, ...rest);
    }
    stats.waterHotHits++;
    return sampleInterpolated(waterGrid, nativeWaterSample, x, y, 'waterGridHits', 'waterGridMisses');
  };

  const api = {
    installed: true,
    clearCaches,
    getStats: () => ({
      ...stats,
      surfaceActive: surfaceActive(),
      hiddenRootPresentationSuspended: surfaceActive(),
      sampleGrid: SURFACE_SAMPLE_GRID,
      maxSampleCacheEntries: MAX_SAMPLE_CACHE_ENTRIES,
      terrainCacheSize: terrainGrid.size,
      waterCacheSize: waterGrid.size,
      bilinearSurfaceSampling: true,
      vegetationSamplingCached: true,
    }),
  };

  window.realitySandboxSurfaceCpuRelief = api;
  document.documentElement.dataset.surfaceCpuRelief = 'root-render-suspended-bilinear-grid-cache';

  const previousDiagnostics = window.realitySandboxPresentationDiagnostics;
  window.realitySandboxPresentationDiagnostics = () => ({
    ...(typeof previousDiagnostics === 'function' ? previousDiagnostics() : {}),
    surfaceCpuRelief: api.getStats(),
  });
}

async function boot() {
  const state = await waitForRuntime();
  if (!state) {
    document.documentElement.dataset.surfaceCpuRelief = 'unavailable';
    return;
  }
  installCpuRelief(state);
}

boot();
