import { biomeColor } from './planet.js';

const TAU = Math.PI * 2;
const GLOBE_RADIUS_FACTOR = 0.43;
const MAX_DETAIL_LONG_EDGE = 1440;
const REFRESH_MS = 220;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrap = (value, max) => ((value % max) + max) % max;
const mix = (a, b, t) => a.map((value, index) => value + (b[index] - value) * t);

function rgb(color, alpha = 1) {
  return `rgba(${Math.round(clamp(color[0], 0, 255))},${Math.round(clamp(color[1], 0, 255))},${Math.round(clamp(color[2], 0, 255))},${clamp(alpha, 0, 1)})`;
}

function shade(color, factor) {
  return color.map(value => clamp(value * factor, 0, 255));
}

function detailLevel(zoom) {
  if (zoom < 1.35) return 0;
  if (zoom < 2.25) return 1;
  if (zoom < 4.25) return 2;
  if (zoom < 7.25) return 3;
  return 4;
}

function surfaceNoise(nx, ny, seed, level) {
  const s = (seed % 100000) * 0.0000137;
  const f1 = 34 + level * 17;
  const f2 = 71 + level * 31;
  const f3 = 143 + level * 61;
  const a = Math.sin((nx * f1 + ny * (f1 * 0.61) + s) * TAU);
  const b = Math.cos((nx * (f2 * 0.47) - ny * f2 + s * 1.7) * TAU);
  const c = Math.sin((nx * f3 + ny * (f3 * 0.37) - s * 2.3) * TAU);
  return a * 0.48 + b * 0.32 + c * 0.20;
}

function screenToWorld(px, py, camera, width, height) {
  const radius = Math.min(width, height) * GLOBE_RADIUS_FACTOR * camera.zoom;
  const cx = width * 0.5;
  const cy = height * 0.5;
  const sx = (px - cx) / radius;
  const sy = -(py - cy) / radius;
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
    x: ((longitude / TAU + 0.5) % 1 + 1) % 1,
    y: clamp(0.5 - latitude / Math.PI, 0, 1),
    depth: z,
  };
}

function composeSurfaceColor(terrain, neighbor, water, biomass, nx, ny, seed, level) {
  let color = biomeColor(terrain);
  const noise = surfaceNoise(nx, ny, seed, level);
  const elevation = terrain.elevation ?? 0.5;
  const neighborElevation = neighbor?.elevation ?? elevation;
  const relief = clamp((elevation - neighborElevation) * 10, -0.16, 0.16);
  const textureStrength = terrain.land ? 0.045 + level * 0.012 : 0.025 + level * 0.006;
  color = shade(color, 1 + relief + noise * textureStrength);

  if (!terrain.land) {
    const oceanDetail = clamp((elevation - 0.28) * 0.45 + noise * 0.035, -0.08, 0.10);
    color = shade(color, 1 + oceanDetail);
    if (neighbor?.land) color = mix(color, [52, 164, 184], 0.38);
    return color;
  }

  if (neighbor && !neighbor.land) {
    color = mix(color, [222, 197, 139], 0.42);
  }

  const lake = clamp(water?.lake || 0, 0, 1);
  const river = clamp(water?.river || 0, 0, 1);
  const surface = clamp((water?.surface || 0) * 0.5, 0, 1);
  const flood = clamp(water?.flood || 0, 0, 1);
  const snowpack = clamp((water?.snowpack || 0) * 0.7, 0, 1);

  if (lake > 0.16) color = mix(color, [42, 126, 164], clamp((lake - 0.10) * 1.25, 0, 0.82));
  if (river > (level >= 3 ? 0.10 : level >= 2 ? 0.16 : 0.24)) {
    const riverStrength = clamp((river - 0.08) * (level >= 3 ? 1.7 : 1.15) + surface * 0.16, 0, 0.76);
    color = mix(color, [44, 131, 172], riverStrength);
  }
  if (flood > 0.2) color = mix(color, [70, 139, 153], flood * 0.18);
  if (snowpack > 0.08) color = mix(color, [232, 241, 244], snowpack * 0.44);

  const lushBiome = ['grassland', 'forest', 'rainforest', 'steppe'].includes(terrain.biome);
  if (lushBiome && biomass > 0.02) {
    const canopy = terrain.biome === 'rainforest' ? [25, 101, 55] : terrain.biome === 'forest' ? [42, 112, 63] : [93, 139, 68];
    const vegetationMix = clamp(biomass * (0.08 + level * 0.035) + Math.max(0, noise) * 0.025, 0, 0.24);
    color = mix(color, canopy, vegetationMix);
  }

  const plateBoundary = clamp(terrain.plateBoundary || 0, 0, 1);
  const volcanism = clamp(terrain.volcanism || 0, 0, 1);
  if (level >= 2 && plateBoundary > 0.46) {
    const rock = terrain.biome === 'snow-mountain' ? [206, 212, 214] : [116, 105, 92];
    color = mix(color, rock, clamp((plateBoundary - 0.42) * 0.20 + Math.max(0, noise) * 0.025, 0, 0.15));
  }
  if (level >= 3 && volcanism > 0.50) {
    color = mix(color, [104, 72, 61], clamp((volcanism - 0.48) * 0.12, 0, 0.08));
  }

  return color;
}

async function installSurfaceLayerPresentation() {
  try {
    await window.realitySandboxReady;
  } catch {
    document.documentElement.dataset.surfaceLayers = 'blocked';
    return;
  }

  const runtime = window.realitySandboxUnified;
  const planet = window.realitySandboxPlanet;
  const world = planet?.world;
  const living = planet?.living;
  const waterCycle = planet?.waterCycle;
  const sourceCanvas = document.getElementById('lofiLivingCanvas');
  const host = sourceCanvas?.parentElement;
  if (!runtime?.render || !runtime?.getCamera || !world || !living?.sampleDynamicPlanet || !waterCycle?.sample || !sourceCanvas || !host) {
    document.documentElement.dataset.surfaceLayers = 'missing-prerequisite';
    return;
  }
  if (runtime.__surfaceLayerPresentationInstalled) return;

  const canvas = document.createElement('canvas');
  canvas.id = 'surfaceDetailCanvas';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    zIndex: '1',
    pointerEvents: 'none',
    imageRendering: 'auto',
  });
  host.insertBefore(canvas, sourceCanvas.nextSibling);
  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
  if (!ctx) {
    canvas.remove();
    document.documentElement.dataset.surfaceLayers = 'no-2d-context';
    return;
  }

  const seed = window.realitySandboxSeed?.numericSeed || 734221;
  let lastDraw = -Infinity;
  let lastCameraKey = '';
  let lastCells = 0;
  let lastLevel = 0;

  function syncCanvas() {
    const sourceWidth = Math.max(1, sourceCanvas.width || sourceCanvas.clientWidth || 1);
    const sourceHeight = Math.max(1, sourceCanvas.height || sourceCanvas.clientHeight || 1);
    const scale = Math.min(1, MAX_DETAIL_LONG_EDGE / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    return { width, height };
  }

  function cameraKey(camera, level, width, height) {
    return [camera.centerX.toFixed(5), camera.centerY.toFixed(5), camera.zoom.toFixed(4), level, width, height].join(':');
  }

  function drawSurfaceLayers(timestamp = performance.now(), force = false) {
    const camera = runtime.getCamera();
    const level = detailLevel(camera.zoom);
    lastLevel = level;
    const { width, height } = syncCanvas();
    const key = cameraKey(camera, level, width, height);
    const cameraChanged = key !== lastCameraKey;

    if (sourceCanvas.dataset.dragging === 'true') {
      canvas.style.display = 'none';
      return 0;
    }

    if (level === 0) {
      canvas.style.display = 'none';
      ctx.clearRect(0, 0, width, height);
      lastCameraKey = key;
      lastCells = 0;
      document.documentElement.dataset.surfaceLayers = 'overview';
      document.documentElement.dataset.surfaceLayerLod = '0';
      return 0;
    }

    if (!force && !cameraChanged && timestamp - lastDraw < REFRESH_MS) return lastCells;
    lastDraw = timestamp;
    lastCameraKey = key;
    canvas.style.display = 'block';
    ctx.clearRect(0, 0, width, height);

    const radius = Math.min(width, height) * GLOBE_RADIUS_FACTOR * camera.zoom;
    const cx = width * 0.5;
    const cy = height * 0.5;
    const cell = Math.max(3, Math.round([10, 8, 6, 5][level - 1] * Math.max(0.85, Math.max(width, height) / 1100)));
    const worldOffset = world.width / Math.max(160, radius * 1.8);
    const biomassSampler = window.realitySandboxVegetationPresentation?.sampleBiomass;
    const opacity = [0.78, 0.82, 0.86, 0.90][level - 1];
    let cells = 0;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.clip();

    for (let py = 0; py < height; py += cell) {
      for (let px = 0; px < width; px += cell) {
        const point = screenToWorld(px + cell * 0.5, py + cell * 0.5, camera, width, height);
        if (!point) continue;

        const worldX = point.x * world.width;
        const worldY = point.y * world.height;
        const terrain = living.sampleDynamicPlanet(worldX, worldY);
        if (!terrain) continue;
        const neighbor = living.sampleDynamicPlanet(wrap(worldX + worldOffset, world.width), clamp(worldY - worldOffset * 0.62, 0, world.height));
        const water = waterCycle.sample(worldX, worldY);
        const biomass = typeof biomassSampler === 'function' ? biomassSampler(worldX, worldY) : 0;
        const color = composeSurfaceColor(terrain, neighbor, water, biomass, point.x, point.y, seed, level);
        const edgeFade = clamp(point.depth * 2.8, 0.26, 1);

        ctx.fillStyle = rgb(color, opacity * edgeFade);
        ctx.fillRect(px, py, cell + 1, cell + 1);
        cells += 1;
      }
    }
    ctx.restore();

    lastCells = cells;
    document.documentElement.dataset.surfaceLayers = 'active';
    document.documentElement.dataset.surfaceLayerLod = String(level);
    document.documentElement.dataset.surfaceLayerCells = String(cells);
    document.documentElement.dataset.surfaceLayerResolution = `${width}x${height}`;
    return cells;
  }

  const originalRender = runtime.render.bind(runtime);
  runtime.render = frame => {
    const result = originalRender(frame);
    drawSurfaceLayers(frame?.timestamp ?? performance.now());
    return result;
  };

  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => drawSurfaceLayers(performance.now(), true)) : null;
  observer?.observe(sourceCanvas);
  window.addEventListener('resize', () => drawSurfaceLayers(performance.now(), true), { passive: true });

  const previousDiagnostics = window.realitySandboxPresentationDiagnostics;
  window.realitySandboxPresentationDiagnostics = () => ({
    ...(typeof previousDiagnostics === 'function' ? previousDiagnostics() : {}),
    surfaceLayers: document.documentElement.dataset.surfaceLayers || 'unknown',
    surfaceLayerLod: Number(document.documentElement.dataset.surfaceLayerLod || 0),
    surfaceLayerCells: Number(document.documentElement.dataset.surfaceLayerCells || 0),
    surfaceLayerResolution: document.documentElement.dataset.surfaceLayerResolution || 'unknown',
    surfaceDetailCanvasPresent: Boolean(document.getElementById('surfaceDetailCanvas')),
  });

  runtime.__surfaceLayerPresentationInstalled = true;
  drawSurfaceLayers(performance.now(), true);
}

document.addEventListener('DOMContentLoaded', installSurfaceLayerPresentation, { once: true });
