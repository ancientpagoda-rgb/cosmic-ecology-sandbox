import { biomeColor } from './planet.js';

const TAU = Math.PI * 2;
const GLOBE_RADIUS_FACTOR = 0.43;
const MAX_LONG_EDGE = 1600;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const wrap = (v, max) => ((v % max) + max) % max;

function exposeDiagnostics() {
  if (window.__presentationRecoveryDiagnosticsInstalled) return;
  const previous = window.realitySandboxPresentationDiagnostics;
  window.realitySandboxPresentationDiagnostics = () => ({
    ...(typeof previous === 'function' ? previous() : {}),
    presentationRecovery: document.documentElement.dataset.presentationRecovery || 'booting',
    surfaceLayers: document.documentElement.dataset.surfaceLayers || 'not-installed',
    surfaceLayerLod: Number(document.documentElement.dataset.surfaceLayerLod || 0),
    surfaceLayerCells: Number(document.documentElement.dataset.surfaceLayerCells || 0),
    surfaceLayerResolution: document.documentElement.dataset.surfaceLayerResolution || 'unknown',
    surfaceDetailCanvasPresent: Boolean(document.getElementById('surfaceDetailCanvas')),
    weatherPresentation: document.documentElement.dataset.weatherPresentation || 'not-installed',
    weatherCanvasPresent: Boolean(document.getElementById('weatherPresentationCanvas')),
  });
  window.__presentationRecoveryDiagnosticsInstalled = true;
}

exposeDiagnostics();

document.documentElement.dataset.presentationRecovery = 'waiting-runtime';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForRuntime() {
  for (let i = 0; i < 160; i++) {
    const ready = window.realitySandboxReady;
    if (ready && typeof ready.then === 'function') {
      try { await ready; } catch (error) {
        document.documentElement.dataset.presentationRecovery = 'runtime-rejected';
        document.documentElement.dataset.presentationRecoveryError = String(error?.message || error || 'runtime rejected');
        return null;
      }
    }

    const runtime = window.realitySandboxUnified;
    const planet = window.realitySandboxPlanet;
    const canvas = document.getElementById('lofiLivingCanvas');
    if (runtime?.render && runtime?.getCamera && planet?.world && planet?.living?.sampleDynamicPlanet && planet?.waterCycle?.sample && canvas) {
      return { runtime, planet, sourceCanvas: canvas };
    }
    await sleep(50);
  }
  document.documentElement.dataset.presentationRecovery = 'runtime-timeout';
  return null;
}

function screenToWorld(px, py, camera, width, height) {
  const radius = Math.min(width, height) * GLOBE_RADIUS_FACTOR * camera.zoom;
  const sx = (px - width * 0.5) / radius;
  const sy = -(py - height * 0.5) / radius;
  const rho2 = sx * sx + sy * sy;
  if (rho2 > 1) return null;
  const z = Math.sqrt(Math.max(0, 1 - rho2));
  const lon0 = (camera.centerX - 0.5) * TAU;
  const lat0 = (0.5 - camera.centerY) * Math.PI;
  const sinLat0 = Math.sin(lat0);
  const cosLat0 = Math.cos(lat0);
  const latitude = Math.asin(clamp(sy * cosLat0 + z * sinLat0, -1, 1));
  const longitude = lon0 + Math.atan2(sx, z * cosLat0 - sy * sinLat0);
  return {
    x: wrap(longitude / TAU + 0.5, 1),
    y: clamp(0.5 - latitude / Math.PI, 0, 1),
    depth: z,
  };
}

function lodForZoom(zoom) {
  if (zoom < 1.25) return 0;
  if (zoom < 2.0) return 1;
  if (zoom < 3.4) return 2;
  if (zoom < 5.6) return 3;
  return 4;
}

function textureNoise(x, y, seed, lod) {
  const a = Math.sin((x * (34 + lod * 21) + y * (19 + lod * 11) + seed * 0.000011) * TAU);
  const b = Math.cos((x * (91 + lod * 31) - y * (57 + lod * 17) + seed * 0.000019) * TAU);
  const c = Math.sin((x * (181 + lod * 43) + y * (131 + lod * 29) - seed * 0.000007) * TAU);
  return a * 0.48 + b * 0.32 + c * 0.20;
}

function mix(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t);
}

function composeColor(terrain, neighbor, water, biomass, x, y, seed, lod) {
  let color = biomeColor(terrain);
  const noise = textureNoise(x, y, seed, lod);
  const relief = clamp(((terrain.elevation ?? 0.5) - (neighbor?.elevation ?? terrain.elevation ?? 0.5)) * 12, -0.20, 0.20);
  const grain = terrain.land ? 0.06 + lod * 0.018 : 0.035 + lod * 0.009;
  color = color.map(v => clamp(v * (1 + relief + noise * grain), 0, 255));

  if (!terrain.land) {
    if (neighbor?.land) color = mix(color, [44, 166, 190], 0.46);
    return color;
  }

  if (neighbor && !neighbor.land) color = mix(color, [229, 205, 151], 0.48);

  const lake = clamp(water?.lake || 0, 0, 1);
  const river = clamp(water?.river || 0, 0, 1);
  const snow = clamp((water?.snowpack || 0) * 0.8, 0, 1);
  const flood = clamp(water?.flood || 0, 0, 1);
  if (lake > 0.12) color = mix(color, [37, 119, 165], clamp((lake - 0.08) * 1.45, 0, 0.86));
  if (river > (lod >= 3 ? 0.08 : 0.14)) color = mix(color, [40, 128, 174], clamp((river - 0.05) * 1.75, 0, 0.72));
  if (flood > 0.16) color = mix(color, [70, 139, 153], flood * 0.20);
  if (snow > 0.08) color = mix(color, [235, 244, 246], snow * 0.50);

  if (biomass > 0.015 && ['grassland', 'forest', 'rainforest', 'steppe'].includes(terrain.biome)) {
    const canopy = terrain.biome === 'rainforest' ? [19, 92, 48] : terrain.biome === 'forest' ? [35, 105, 56] : [91, 139, 67];
    color = mix(color, canopy, clamp(biomass * (0.12 + lod * 0.045) + Math.max(0, noise) * 0.04, 0, 0.32));
  }

  if (lod >= 2 && (terrain.plateBoundary || 0) > 0.43) {
    color = mix(color, [116, 104, 91], clamp(((terrain.plateBoundary || 0) - 0.40) * 0.26, 0, 0.18));
  }
  if (lod >= 3 && (terrain.volcanism || 0) > 0.45) {
    color = mix(color, [105, 68, 55], clamp(((terrain.volcanism || 0) - 0.42) * 0.20, 0, 0.13));
  }
  return color;
}

function installSurfaceRecovery(runtime, planet, sourceCanvas) {
  if (document.getElementById('surfaceDetailCanvas')) {
    document.documentElement.dataset.presentationRecovery = 'native-surface-present';
    return;
  }

  const host = sourceCanvas.parentElement;
  if (!host) throw new Error('surface canvas host missing');

  const canvas = document.createElement('canvas');
  canvas.id = 'surfaceDetailCanvas';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%', zIndex: '1',
    pointerEvents: 'none', imageRendering: 'auto', display: 'none',
  });
  host.insertBefore(canvas, sourceCanvas.nextSibling);
  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
  if (!ctx) throw new Error('surface 2d context unavailable');

  const { world, living, waterCycle } = planet;
  const seed = window.realitySandboxSeed?.numericSeed || 734221;
  let lastKey = '';
  let lastDraw = 0;
  let lastCells = 0;

  function syncSize() {
    const sw = Math.max(1, sourceCanvas.width || sourceCanvas.clientWidth || 1);
    const sh = Math.max(1, sourceCanvas.height || sourceCanvas.clientHeight || 1);
    const scale = Math.min(1, MAX_LONG_EDGE / Math.max(sw, sh));
    const width = Math.max(1, Math.round(sw * scale));
    const height = Math.max(1, Math.round(sh * scale));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    return { width, height };
  }

  function draw(force = false) {
    const camera = runtime.getCamera();
    const lod = lodForZoom(camera.zoom);
    const { width, height } = syncSize();
    const key = `${camera.centerX.toFixed(5)}:${camera.centerY.toFixed(5)}:${camera.zoom.toFixed(4)}:${width}:${height}:${lod}`;
    const now = performance.now();

    if (sourceCanvas.dataset.dragging === 'true') {
      canvas.style.display = 'none';
      return;
    }

    if (lod === 0) {
      canvas.style.display = 'none';
      ctx.clearRect(0, 0, width, height);
      document.documentElement.dataset.surfaceLayers = 'overview';
      document.documentElement.dataset.surfaceLayerLod = '0';
      document.documentElement.dataset.surfaceLayerCells = '0';
      document.documentElement.dataset.surfaceLayerResolution = `${width}x${height}`;
      lastKey = key;
      return;
    }

    if (!force && key === lastKey && now - lastDraw < 180) return;
    lastKey = key;
    lastDraw = now;
    canvas.style.display = 'block';
    ctx.clearRect(0, 0, width, height);

    const radius = Math.min(width, height) * GLOBE_RADIUS_FACTOR * camera.zoom;
    const cell = Math.max(2, Math.round([9, 7, 5, 4][lod - 1] * Math.max(0.78, Math.max(width, height) / 1200)));
    const worldOffset = world.width / Math.max(180, radius * 1.9);
    const biomassSampler = window.realitySandboxVegetationPresentation?.sampleBiomass;
    const alpha = [0.82, 0.86, 0.90, 0.93][lod - 1];
    let cells = 0;

    for (let py = 0; py < height; py += cell) {
      for (let px = 0; px < width; px += cell) {
        const point = screenToWorld(px + cell * 0.5, py + cell * 0.5, camera, width, height);
        if (!point) continue;
        const wx = point.x * world.width;
        const wy = point.y * world.height;
        const terrain = living.sampleDynamicPlanet(wx, wy);
        if (!terrain) continue;
        const neighbor = living.sampleDynamicPlanet(wrap(wx + worldOffset, world.width), clamp(wy - worldOffset * 0.58, 0, world.height));
        const water = waterCycle.sample(wx, wy);
        const biomass = typeof biomassSampler === 'function' ? biomassSampler(wx, wy) : 0;
        const color = composeColor(terrain, neighbor, water, biomass, point.x, point.y, seed, lod);
        const edge = clamp(point.depth * 3.0, 0.26, 1);
        ctx.fillStyle = `rgba(${Math.round(color[0])},${Math.round(color[1])},${Math.round(color[2])},${alpha * edge})`;
        ctx.fillRect(px, py, cell + 1, cell + 1);
        cells++;
      }
    }

    lastCells = cells;
    document.documentElement.dataset.surfaceLayers = 'active';
    document.documentElement.dataset.surfaceLayerLod = String(lod);
    document.documentElement.dataset.surfaceLayerCells = String(lastCells);
    document.documentElement.dataset.surfaceLayerResolution = `${width}x${height}`;
    document.documentElement.dataset.presentationRecovery = 'surface-recovered';
  }

  const originalRender = runtime.render.bind(runtime);
  runtime.render = frame => {
    const result = originalRender(frame);
    draw(false);
    return result;
  };

  window.addEventListener('resize', () => draw(true), { passive: true });
  new ResizeObserver(() => draw(true)).observe(sourceCanvas);
  draw(true);
}

async function boot() {
  try {
    const state = await waitForRuntime();
    if (!state) return;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    exposeDiagnostics();

    if (!document.getElementById('surfaceDetailCanvas')) {
      installSurfaceRecovery(state.runtime, state.planet, state.sourceCanvas);
    } else {
      document.documentElement.dataset.presentationRecovery = 'native-presentation-active';
    }

    exposeDiagnostics();
  } catch (error) {
    document.documentElement.dataset.presentationRecovery = 'error';
    document.documentElement.dataset.presentationRecoveryError = String(error?.stack || error?.message || error);
    console.error('[presentation-recovery]', error);
  }
}

boot();
