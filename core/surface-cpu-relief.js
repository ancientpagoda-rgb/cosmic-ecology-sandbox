const TERRAIN_HOT_TTL_MS = 420;
const WATER_HOT_TTL_MS = 260;

async function waitForRuntime() {
  for (let attempt = 0; attempt < 300; attempt++) {
    const ready = window.realitySandboxReady;
    if (ready && typeof ready.then === 'function') {
      try { await ready; } catch { return null; }
    }
    const runtime = window.realitySandboxUnified;
    const planet = window.realitySandboxPlanet;
    const mode = window.realitySandboxSurfaceMode;
    if (runtime?.render && planet?.living?.sampleDynamicPlanet && planet?.waterCycle?.sample && mode?.isActive) {
      return { runtime, planet, mode };
    }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  return null;
}

function installCpuRelief({ runtime, planet, mode }) {
  if (window.realitySandboxSurfaceCpuRelief?.installed) return;

  const stats = {
    rootRenderCalls: 0,
    rootRendersSkipped: 0,
    terrainHotHits: 0,
    terrainHotMisses: 0,
    waterHotHits: 0,
    waterHotMisses: 0,
  };

  const surfaceActive = () => Boolean(mode.isActive?.() && document.documentElement.dataset.surfaceMode === 'active');

  // The root Pixi planet is hidden by Surface Mode, but moduleHost still calls
  // its render() every animation frame. Stop that expensive procedural globe
  // redraw while the dedicated Three.js surface renderer owns the screen.
  const nativeRootRender = runtime.render.bind(runtime);
  runtime.render = function surfaceAwareRootRender(frame) {
    stats.rootRenderCalls++;
    if (surfaceActive()) {
      stats.rootRendersSkipped++;
      return;
    }
    return nativeRootRender(frame);
  };

  // Camera rotation does not change the player's world coordinate. Avoid
  // repeatedly re-running the procedural terrain/water samplers for the exact
  // same point just to maintain eye height, HUD, and local weather state.
  const nativeTerrainSample = planet.living.sampleDynamicPlanet.bind(planet.living);
  const nativeWaterSample = planet.waterCycle.sample.bind(planet.waterCycle);
  let terrainHot = null;
  let waterHot = null;

  planet.living.sampleDynamicPlanet = function surfaceHotTerrainSample(x, y, ...rest) {
    if (rest.length || !surfaceActive() || !Number.isFinite(x) || !Number.isFinite(y)) {
      return nativeTerrainSample(x, y, ...rest);
    }
    const now = performance.now();
    if (terrainHot && terrainHot.x === x && terrainHot.y === y && now - terrainHot.at <= TERRAIN_HOT_TTL_MS) {
      stats.terrainHotHits++;
      return terrainHot.value;
    }
    stats.terrainHotMisses++;
    const value = nativeTerrainSample(x, y);
    terrainHot = { x, y, at: now, value };
    return value;
  };

  planet.waterCycle.sample = function surfaceHotWaterSample(x, y, ...rest) {
    if (rest.length || !surfaceActive() || !Number.isFinite(x) || !Number.isFinite(y)) {
      return nativeWaterSample(x, y, ...rest);
    }
    const now = performance.now();
    if (waterHot && waterHot.x === x && waterHot.y === y && now - waterHot.at <= WATER_HOT_TTL_MS) {
      stats.waterHotHits++;
      return waterHot.value;
    }
    stats.waterHotMisses++;
    const value = nativeWaterSample(x, y);
    waterHot = { x, y, at: now, value };
    return value;
  };

  const api = {
    installed: true,
    getStats: () => ({
      ...stats,
      surfaceActive: surfaceActive(),
      hiddenRootPresentationSuspended: surfaceActive(),
      terrainHotTtlMs: TERRAIN_HOT_TTL_MS,
      waterHotTtlMs: WATER_HOT_TTL_MS,
    }),
  };

  window.realitySandboxSurfaceCpuRelief = api;
  document.documentElement.dataset.surfaceCpuRelief = 'root-render-suspended-hot-samples';

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

