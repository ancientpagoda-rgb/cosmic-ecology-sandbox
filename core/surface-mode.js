import { biomeColor } from './planet.js';

const TAU = Math.PI * 2;
const SEA_LEVEL = 0.53;
const Z_SCALE = 62;
const EYE_HEIGHT = 3.6;
const MAX_ALTITUDE = 52;
const FOV = Math.PI * 0.72;
const MAX_VIEW_DISTANCE = 190;
const TARGET_RENDER_INTERVAL = 1000 / 20;
const MAX_RENDER_LONG_EDGE = 960;
const DISTANT_CACHE_START = 26;
const GLOBE_RADIUS_FACTOR = 0.43;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrap = (value, max) => ((value % max) + max) % max;
const lerp = (a, b, t) => a + (b - a) * t;
const mixColor = (a, b, t) => a.map((value, index) => lerp(value, b[index], t));

function hash2(x, y, seed = 0) {
  let h = (Math.imul(Math.floor(x), 374761393) ^ Math.imul(Math.floor(y), 668265263) ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function shortestWrappedDelta(value, origin, size) {
  let delta = value - origin;
  if (delta > size * 0.5) delta -= size;
  else if (delta < -size * 0.5) delta += size;
  return delta;
}

async function waitForRuntime() {
  for (let attempt = 0; attempt < 200; attempt++) {
    const ready = window.realitySandboxReady;
    if (ready && typeof ready.then === 'function') {
      try { await ready; } catch { return null; }
    }
    const runtime = window.realitySandboxUnified;
    const planet = window.realitySandboxPlanet;
    const sourceCanvas = document.getElementById('lofiLivingCanvas');
    if (runtime?.getCamera && planet?.world && planet?.living?.sampleDynamicPlanet && planet?.waterCycle?.sample && sourceCanvas) {
      return { runtime, planet, sourceCanvas };
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return null;
}

function installSurfaceMode({ runtime, planet, sourceCanvas }) {
  if (window.realitySandboxSurfaceMode) return;

  const host = document.getElementById('world') || sourceCanvas.parentElement;
  if (!host) return;

  const { world, living, waterCycle } = planet;
  const seed = window.realitySandboxSeed?.numericSeed || 734221;
  const keys = new Set();
  const player = {
    x: world.width * 0.5,
    y: world.height * 0.5,
    yaw: 0,
    pitch: 0,
    altitude: EYE_HEIGHT,
  };

  let active = false;
  let lastFrameTime = performance.now();
  let lastTerrainRender = -Infinity;
  let surfaceFrame = 0;
  let visibleCreatures = 0;
  let dragLook = false;
  let dragX = 0;
  let dragY = 0;
  let shellDisplay = '';

  const layer = document.createElement('div');
  layer.id = 'surfaceModeLayer';
  Object.assign(layer.style, {
    position: 'absolute',
    inset: '0',
    zIndex: '40',
    opacity: '0',
    pointerEvents: 'none',
    transition: 'opacity 420ms ease',
    background: '#06100d',
  });

  const canvas = document.createElement('canvas');
  canvas.id = 'surfaceModeCanvas';
  canvas.setAttribute('aria-label', 'First-person surface view of Nysa');
  canvas.tabIndex = 0;
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    display: 'block',
    imageRendering: 'auto',
    cursor: 'crosshair',
    touchAction: 'none',
  });
  let ctx = null;
  let gpuSurface = null;
  let gpuStarting = false;
  let gpuBackend = 'starting';

  const hud = document.createElement('div');
  hud.id = 'surfaceModeHud';
  Object.assign(hud.style, {
    position: 'absolute',
    inset: '0',
    zIndex: '2',
    pointerEvents: 'none',
    color: '#eef8f1',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    textShadow: '0 1px 4px rgba(0,0,0,.9)',
  });

  const info = document.createElement('div');
  Object.assign(info.style, {
    position: 'absolute',
    top: 'max(14px, env(safe-area-inset-top))',
    left: 'max(14px, env(safe-area-inset-left))',
    padding: '9px 11px',
    border: '1px solid rgba(190,230,205,.22)',
    borderRadius: '10px',
    background: 'rgba(4,12,10,.56)',
    backdropFilter: 'blur(6px)',
    fontSize: '11px',
    lineHeight: '1.45',
  });

  const exitButton = document.createElement('button');
  exitButton.type = 'button';
  exitButton.textContent = 'Exit Surface';
  Object.assign(exitButton.style, {
    position: 'absolute',
    top: 'max(14px, env(safe-area-inset-top))',
    right: 'max(14px, env(safe-area-inset-right))',
    minHeight: '36px',
    padding: '7px 12px',
    border: '1px solid rgba(190,230,205,.34)',
    borderRadius: '10px',
    background: 'rgba(4,12,10,.72)',
    color: '#eef8f1',
    pointerEvents: 'auto',
    cursor: 'pointer',
  });

  const help = document.createElement('div');
  help.textContent = 'WASD move · mouse look · Shift sprint · Space/Ctrl altitude · Esc exit';
  Object.assign(help.style, {
    position: 'absolute',
    left: '50%',
    bottom: 'max(16px, env(safe-area-inset-bottom))',
    transform: 'translateX(-50%)',
    maxWidth: 'calc(100vw - 30px)',
    padding: '7px 10px',
    borderRadius: '9px',
    background: 'rgba(4,12,10,.54)',
    fontSize: '10px',
    whiteSpace: 'nowrap',
  });

  const crosshair = document.createElement('div');
  crosshair.textContent = '+';
  Object.assign(crosshair.style, {
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    fontSize: '19px',
    fontWeight: '300',
    opacity: '.72',
  });

  const enterButton = document.createElement('button');
  enterButton.type = 'button';
  enterButton.id = 'enterSurfaceMode';
  enterButton.textContent = 'Enter Surface';
  Object.assign(enterButton.style, {
    position: 'absolute',
    zIndex: '24',
    left: '50%',
    bottom: 'max(18px, env(safe-area-inset-bottom))',
    transform: 'translateX(-50%)',
    minHeight: '38px',
    padding: '8px 14px',
    border: '1px solid rgba(190,230,205,.38)',
    borderRadius: '11px',
    background: 'rgba(6,18,15,.78)',
    color: '#eef8f1',
    boxShadow: '0 8px 30px rgba(0,0,0,.32)',
    backdropFilter: 'blur(8px)',
    cursor: 'pointer',
    font: '600 12px/1.1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  });

  hud.append(info, exitButton, help, crosshair);
  layer.append(canvas, hud);
  host.append(layer, enterButton);

  function collectCreatures() {
    const { position, agent, predator, apex } = world.ecs.components;
    const entries = [];
    const groups = [
      { collection: agent, color: '#d8c890', size: 0.72 },
      { collection: predator, color: '#d29173', size: 0.92 },
      { collection: apex, color: '#c06960', size: 1.18 },
    ];
    for (const group of groups) {
      for (const [id] of group.collection.entries()) {
        const pos = position.get(id);
        if (pos) entries.push({ id, x: pos.x, y: pos.y, color: group.color, size: group.size });
      }
    }
    return entries;
  }

  function startGpuRenderer() {
    if (gpuStarting || gpuSurface) return;
    gpuStarting = true;
    import('./surface-mode-gpu.js').then(({ createGpuSurfaceRenderer }) => createGpuSurfaceRenderer({
      canvas,
      world,
      terrainAt,
      waterAt,
      colorAt: localSurfaceColor,
      biomassAt: window.realitySandboxVegetationPresentation?.sampleBiomass,
      getCreatures: collectCreatures,
      seed,
      seaLevel: SEA_LEVEL,
      zScale: Z_SCALE,
    })).then(renderer => {
      gpuSurface = renderer;
      gpuBackend = 'webgl2';
      syncCanvas();
      if (active) renderSurface(true);
    }).catch(error => {
      // Pixi already proves WebGL is normally present, but retain the former
      // Canvas2D renderer for unusually constrained devices.
      console.warn('[Surface Mode] GPU renderer unavailable; using CPU fallback.', error);
      ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
      gpuBackend = ctx ? 'canvas2d-fallback' : 'unavailable';
      if (active) renderSurface(true);
    });
  }

  function syncCanvas() {
    const rect = layer.getBoundingClientRect();
    const cssWidth = Math.max(1, rect.width || innerWidth || 1);
    const cssHeight = Math.max(1, rect.height || innerHeight || 1);
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (gpuSurface) {
      gpuSurface.resize(cssWidth, cssHeight, dpr);
      document.documentElement.dataset.surfaceModeResolution = `${canvas.width}x${canvas.height}`;
      return;
    }
    let width = Math.round(cssWidth * dpr);
    let height = Math.round(cssHeight * dpr);
    const scale = Math.min(1, MAX_RENDER_LONG_EDGE / Math.max(width, height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    document.documentElement.dataset.surfaceModeResolution = `${width}x${height}`;
  }

  function terrainAt(x, y) {
    return living.sampleDynamicPlanet(wrap(x, world.width), clamp(y, 0, world.height));
  }

  function waterAt(x, y) {
    return waterCycle.sample(wrap(x, world.width), clamp(y, 0, world.height));
  }

  function distantTerrainAt(x, y) {
    const cache = window.realitySandboxInteractionCache;
    if (cache?.isReady?.()) return cache.sampleTerrain(x, y);
    return terrainAt(x, y);
  }

  function distantWaterAt(x, y) {
    const cache = window.realitySandboxInteractionCache;
    if (cache?.isReady?.()) return cache.sampleWater(x, y);
    return waterAt(x, y);
  }

  function groundZAt(x, y) {
    const terrain = terrainAt(x, y);
    if (!terrain) return SEA_LEVEL * Z_SCALE;
    return (terrain.land ? terrain.elevation : SEA_LEVEL) * Z_SCALE;
  }

  function localSurfaceColor(terrain, water, distance, lateralNoise = 0) {
    let color = biomeColor(terrain);
    if (!terrain.land) {
      const wave = 0.92 + lateralNoise * 0.08;
      color = [18 * wave, 105 * wave, 151 * wave];
    } else {
      const lake = clamp(water?.lake || 0, 0, 1);
      const river = clamp(water?.river || 0, 0, 1);
      const snow = clamp((water?.snowpack || 0) * 0.75, 0, 1);
      if (lake > 0.2) color = mixColor(color, [34, 119, 164], clamp(lake * 0.75, 0, 0.72));
      if (river > 0.16) color = mixColor(color, [41, 129, 174], clamp(river * 0.42, 0, 0.48));
      if (snow > 0.06) color = mixColor(color, [235, 244, 247], clamp(snow * 0.54, 0, 0.54));
      const reliefShade = 0.9 + clamp((terrain.elevation - SEA_LEVEL) * 0.42, 0, 0.18) + lateralNoise * 0.045;
      color = color.map(value => clamp(value * reliefShade, 0, 255));
    }
    const fog = clamp((distance - 42) / (MAX_VIEW_DISTANCE - 42), 0, 0.78);
    return mixColor(color, [118, 151, 145], fog);
  }

  function projectPoint(wx, wy, z, eyeZ, width, height, horizon, focal) {
    const dx = shortestWrappedDelta(wx, player.x, world.width);
    const dy = wy - player.y;
    const forward = dx * Math.cos(player.yaw) + dy * Math.sin(player.yaw);
    if (forward <= 0.5) return null;
    const side = -dx * Math.sin(player.yaw) + dy * Math.cos(player.yaw);
    const sx = width * 0.5 + (side / forward) * focal;
    const sy = horizon - ((z - eyeZ) / forward) * focal;
    if (sx < -80 || sx > width + 80) return null;
    return { x: sx, y: sy, depth: forward, scale: focal / forward };
  }

  function drawSky(width, height, horizon, localWater) {
    const cloud = clamp(localWater?.cloud || 0, 0, 1);
    const rain = clamp((localWater?.rain || 0) * 8, 0, 1);
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    const upper = mixColor([28, 72, 98], [70, 82, 86], cloud * 0.72);
    const lower = mixColor([125, 177, 183], [116, 125, 124], cloud * 0.66);
    gradient.addColorStop(0, `rgb(${upper.map(Math.round).join(',')})`);
    gradient.addColorStop(clamp(horizon / height, 0.15, 0.8), `rgb(${lower.map(Math.round).join(',')})`);
    gradient.addColorStop(1, '#23372f');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    if (cloud > 0.12) {
      ctx.save();
      ctx.globalAlpha = 0.12 + cloud * 0.18;
      ctx.fillStyle = '#dce6e2';
      const bandY = horizon * 0.42;
      for (let index = 0; index < 8; index++) {
        const x = ((index * 0.173 + surfaceFrame * 0.00007) % 1) * width;
        const y = bandY + Math.sin(index * 2.1) * height * 0.055;
        ctx.beginPath();
        ctx.ellipse(x, y, width * 0.12, height * 0.035, 0, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    if (rain > 0.08) {
      ctx.save();
      ctx.strokeStyle = `rgba(210,232,239,${0.12 + rain * 0.32})`;
      ctx.lineWidth = Math.max(1, width / 1100);
      const streaks = Math.round(40 + rain * 140);
      for (let index = 0; index < streaks; index++) {
        const r1 = hash2(index, surfaceFrame >> 2, seed);
        const r2 = hash2(index + 77, surfaceFrame >> 3, seed);
        const x = r1 * width;
        const y = r2 * height;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - width * 0.006, y + height * 0.045);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawTerrain(width, height, horizon, eyeZ) {
    const focal = width / (2 * Math.tan(FOV * 0.5));
    const stride = width >= 760 ? 4 : 3;
    const skyFog = [118, 151, 145];

    for (let sx = 0; sx < width; sx += stride) {
      const rayOffset = ((sx + stride * 0.5) / width - 0.5) * FOV;
      const angle = player.yaw + rayOffset;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      let coveredY = height;
      let distance = 1.8;

      while (distance < MAX_VIEW_DISTANCE && coveredY > 0) {
        const wx = wrap(player.x + cos * distance, world.width);
        const wy = clamp(player.y + sin * distance, 0, world.height);
        const useDistantCache = distance >= DISTANT_CACHE_START;
        const terrain = useDistantCache ? distantTerrainAt(wx, wy) : terrainAt(wx, wy);
        if (!terrain) break;
        const water = useDistantCache ? distantWaterAt(wx, wy) : waterAt(wx, wy);
        const surfaceZ = (terrain.land ? terrain.elevation : SEA_LEVEL) * Z_SCALE;
        const projectedY = horizon - ((surfaceZ - eyeZ) / distance) * focal;

        if (projectedY < coveredY) {
          const noise = Math.sin((wx * 0.41 + wy * 0.23) + distance * 0.13) * 0.5;
          let color = localSurfaceColor(terrain, water, distance, noise);
          const fog = clamp((distance - 90) / 140, 0, 0.35);
          color = mixColor(color, skyFog, fog);
          ctx.fillStyle = `rgb(${color.map(value => Math.round(clamp(value, 0, 255))).join(',')})`;
          const top = Math.max(-2, Math.floor(projectedY));
          ctx.fillRect(sx, top, stride + 1, Math.ceil(coveredY - top) + 1);
          coveredY = top;
        }

        distance += 1.15 + distance * 0.042;
      }
    }

    return focal;
  }

  function drawVegetation(width, height, horizon, eyeZ, focal) {
    const biomassSampler = window.realitySandboxVegetationPresentation?.sampleBiomass;
    const grid = 12;
    const range = 8;
    const sprites = [];
    const originX = Math.floor(player.x / grid);
    const originY = Math.floor(player.y / grid);

    for (let gy = originY - range; gy <= originY + range; gy++) {
      for (let gx = originX - range; gx <= originX + range; gx++) {
        const jitterX = (hash2(gx, gy, seed) - 0.5) * grid * 0.72;
        const jitterY = (hash2(gx + 47, gy - 19, seed) - 0.5) * grid * 0.72;
        const wx = wrap((gx + 0.5) * grid + jitterX, world.width);
        const wy = clamp((gy + 0.5) * grid + jitterY, 0, world.height);
        const terrain = terrainAt(wx, wy);
        if (!terrain?.land || !['forest', 'rainforest', 'grassland', 'steppe'].includes(terrain.biome)) continue;
        const biomass = typeof biomassSampler === 'function' ? biomassSampler(wx, wy) : (terrain.biome === 'rainforest' ? 0.9 : terrain.biome === 'forest' ? 0.72 : 0.34);
        const chance = terrain.biome === 'rainforest' ? 0.92 : terrain.biome === 'forest' ? 0.78 : 0.32;
        if (biomass < 0.02 || hash2(gx - 31, gy + 81, seed) > chance) continue;
        const baseZ = terrain.elevation * Z_SCALE;
        const heightWorld = (terrain.biome === 'rainforest' ? 2.8 : terrain.biome === 'forest' ? 2.2 : 0.8) * (0.75 + hash2(gx + 9, gy + 7, seed) * 0.7);
        const base = projectPoint(wx, wy, baseZ, eyeZ, width, height, horizon, focal);
        const top = projectPoint(wx, wy, baseZ + heightWorld, eyeZ, width, height, horizon, focal);
        if (!base || !top || base.depth > 125) continue;
        sprites.push({ base, top, biome: terrain.biome, biomass, heightWorld });
      }
    }

    sprites.sort((a, b) => b.base.depth - a.base.depth);
    for (const sprite of sprites) {
      const h = Math.max(2, sprite.base.y - sprite.top.y);
      if (sprite.biome === 'forest' || sprite.biome === 'rainforest') {
        ctx.strokeStyle = 'rgba(57,47,34,.92)';
        ctx.lineWidth = clamp(h * 0.09, 1, 5);
        ctx.beginPath();
        ctx.moveTo(sprite.base.x, sprite.base.y);
        ctx.lineTo(sprite.top.x, sprite.top.y + h * 0.28);
        ctx.stroke();
        ctx.fillStyle = sprite.biome === 'rainforest' ? 'rgba(25,92,48,.96)' : 'rgba(45,107,58,.96)';
        ctx.beginPath();
        ctx.ellipse(sprite.top.x, sprite.top.y + h * 0.22, h * 0.34, h * 0.43, 0, 0, TAU);
        ctx.fill();
      } else if (h > 2.5) {
        ctx.strokeStyle = 'rgba(114,151,72,.82)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sprite.base.x, sprite.base.y);
        ctx.lineTo(sprite.top.x, sprite.top.y);
        ctx.stroke();
      }
    }
  }

  function drawCreatures(width, height, horizon, eyeZ, focal) {
    const { position, agent, predator, apex } = world.ecs.components;
    visibleCreatures = 0;

    const groups = [
      { collection: agent, fill: '#d8c890', size: 0.72 },
      { collection: predator, fill: '#d29173', size: 0.92 },
      { collection: apex, fill: '#c06960', size: 1.18 },
    ];

    const sprites = [];
    for (const group of groups) {
      for (const [id] of group.collection.entries()) {
        const pos = position.get(id);
        if (!pos) continue;
        const dx = shortestWrappedDelta(pos.x, player.x, world.width);
        const dy = pos.y - player.y;
        if (dx * dx + dy * dy > 150 * 150) continue;
        const terrain = terrainAt(pos.x, pos.y);
        if (!terrain?.land) continue;
        const groundZ = terrain.elevation * Z_SCALE;
        const base = projectPoint(pos.x, pos.y, groundZ, eyeZ, width, height, horizon, focal);
        const top = projectPoint(pos.x, pos.y, groundZ + group.size, eyeZ, width, height, horizon, focal);
        if (!base || !top) continue;
        sprites.push({ base, top, fill: group.fill, size: group.size });
      }
    }

    sprites.sort((a, b) => b.base.depth - a.base.depth);
    for (const sprite of sprites) {
      const h = clamp(sprite.base.y - sprite.top.y, 2.5, height * 0.24);
      const w = h * 0.95;
      ctx.fillStyle = sprite.fill;
      ctx.strokeStyle = 'rgba(24,27,24,.9)';
      ctx.lineWidth = clamp(h * 0.055, 0.8, 3);
      ctx.beginPath();
      ctx.ellipse(sprite.base.x, sprite.base.y - h * 0.5, w * 0.46, h * 0.32, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sprite.base.x + w * 0.38, sprite.base.y - h * 0.64, Math.max(1.5, h * 0.18), 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sprite.base.x - w * 0.24, sprite.base.y - h * 0.28);
      ctx.lineTo(sprite.base.x - w * 0.20, sprite.base.y);
      ctx.moveTo(sprite.base.x + w * 0.14, sprite.base.y - h * 0.28);
      ctx.lineTo(sprite.base.x + w * 0.18, sprite.base.y);
      ctx.stroke();
      visibleCreatures++;
    }
    document.documentElement.dataset.surfaceModeVisibleCreatures = String(visibleCreatures);
  }

  function updateHud(terrain, localWater) {
    const latitude = (0.5 - player.y / world.height) * 180;
    const longitude = (player.x / world.width - 0.5) * 360;
    const altitude = Math.max(0, player.altitude - EYE_HEIGHT);
    info.innerHTML = `<b>SURFACE MODE · NYSA</b><br>${terrain?.biome || 'unknown'} · ${latitude.toFixed(2)}° ${latitude >= 0 ? 'N' : 'S'} · ${Math.abs(longitude).toFixed(2)}° ${longitude >= 0 ? 'E' : 'W'}<br>altitude +${altitude.toFixed(1)} · rain ${(localWater?.rain || 0).toFixed(2)} · nearby life ${visibleCreatures}`;
    document.documentElement.dataset.surfaceModeBiome = terrain?.biome || 'unknown';
    document.documentElement.dataset.surfaceModeCoordinates = `${player.x.toFixed(2)},${player.y.toFixed(2)}`;
  }

  function renderSurface(force = false) {
    if (!active) return;
    const now = performance.now();
    if (!force && !gpuSurface && now - lastTerrainRender < TARGET_RENDER_INTERVAL) return;
    lastTerrainRender = now;
    surfaceFrame++;
    const startedAt = performance.now();
    syncCanvas();
    const width = canvas.width;
    const height = canvas.height;
    const terrain = terrainAt(player.x, player.y);
    const localWater = waterAt(player.x, player.y);
    if (gpuSurface) {
      const render = gpuSurface.render(player, localWater || {});
      visibleCreatures = render.visibleCreatures;
      gpuBackend = render.backend;
      updateHud(terrain, localWater);
      document.documentElement.dataset.surfaceModeRenderMs = (performance.now() - startedAt).toFixed(1);
      document.documentElement.dataset.surfaceModeRenderer = gpuBackend;
      return;
    }
    if (!ctx) {
      // Do not create a 2D context while WebGPURenderer is negotiating a GPU context.
      return;
    }
    const groundZ = groundZAt(player.x, player.y);
    const eyeZ = groundZ + player.altitude;
    const horizon = height * clamp(0.49 + player.pitch * 0.46, 0.18, 0.80);

    drawSky(width, height, horizon, localWater);
    const focal = drawTerrain(width, height, horizon, eyeZ);
    drawVegetation(width, height, horizon, eyeZ, focal);
    drawCreatures(width, height, horizon, eyeZ, focal);
    updateHud(terrain, localWater);
    document.documentElement.dataset.surfaceModeRenderMs = (performance.now() - startedAt).toFixed(1);
    document.documentElement.dataset.surfaceModeRenderer = gpuBackend;
  }

  function updateMovement(dt) {
    if (!active) return;
    const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const speed = sprint ? 38 : 13;
    let forward = 0;
    let strafe = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) forward += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) forward -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) strafe += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) strafe -= 1;
    const magnitude = Math.hypot(forward, strafe) || 1;
    forward /= magnitude;
    strafe /= magnitude;

    const fx = Math.cos(player.yaw);
    const fy = Math.sin(player.yaw);
    const rx = -fy;
    const ry = fx;
    player.x = wrap(player.x + (fx * forward + rx * strafe) * speed * dt, world.width);
    player.y = clamp(player.y + (fy * forward + ry * strafe) * speed * dt, 0.05, world.height - 0.05);

    if (keys.has('Space')) player.altitude = clamp(player.altitude + dt * 11, EYE_HEIGHT, MAX_ALTITUDE);
    if (keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC')) {
      player.altitude = clamp(player.altitude - dt * 11, EYE_HEIGHT, MAX_ALTITUDE);
    }
  }

  function loop(now) {
    requestAnimationFrame(loop);
    const dt = clamp((now - lastFrameTime) / 1000, 0, 0.05);
    lastFrameTime = now;
    if (!active) return;
    updateMovement(dt);
    renderSurface(false);
  }
  requestAnimationFrame(loop);

  function enterAt(x, y) {
    player.x = wrap(x, world.width);
    player.y = clamp(y, 0.05, world.height - 0.05);
    player.altitude = EYE_HEIGHT;
    player.pitch = 0;
    active = true;
    keys.clear();
    runtime.setPresentationSuspended?.(true);
    document.documentElement.dataset.surfaceMode = 'active';
    layer.style.pointerEvents = 'auto';
    layer.style.opacity = '1';
    enterButton.style.display = 'none';
    const shell = document.querySelector('.planet-shell');
    if (shell) {
      shellDisplay = shell.style.display;
      shell.style.display = 'none';
    }
    renderSurface(true);
    canvas.focus({ preventScroll: true });
    canvas.requestPointerLock?.().catch?.(() => {});
  }

  function exitSurface() {
    if (!active) return;
    active = false;
    keys.clear();
    runtime.setPresentationSuspended?.(false);
    document.documentElement.dataset.surfaceMode = 'inactive';
    if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    layer.style.opacity = '0';
    layer.style.pointerEvents = 'none';
    enterButton.style.display = '';
    const shell = document.querySelector('.planet-shell');
    if (shell) shell.style.display = shellDisplay;
  }

  function enterFromCameraCenter() {
    const camera = runtime.getCamera();
    enterAt(camera.centerX * world.width, camera.centerY * world.height);
  }

  function globePointFromClient(clientX, clientY) {
    const rect = sourceCanvas.getBoundingClientRect();
    const camera = runtime.getCamera();
    const width = rect.width;
    const height = rect.height;
    const radius = Math.min(width, height) * GLOBE_RADIUS_FACTOR * camera.zoom;
    const sx = (clientX - rect.left - width * 0.5) / radius;
    const sy = -(clientY - rect.top - height * 0.5) / radius;
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
      x: wrap(longitude / TAU + 0.5, 1) * world.width,
      y: clamp(0.5 - latitude / Math.PI, 0, 1) * world.height,
    };
  }

  enterButton.addEventListener('click', enterFromCameraCenter);
  exitButton.addEventListener('click', exitSurface);

  sourceCanvas.addEventListener('dblclick', event => {
    if (active) return;
    const point = globePointFromClient(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    enterAt(point.x, point.y);
  });

  window.addEventListener('keydown', event => {
    if (!active) return;
    if (event.code === 'Escape') {
      event.preventDefault();
      exitSurface();
      return;
    }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ControlLeft', 'ControlRight', 'KeyC', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
      event.preventDefault();
      keys.add(event.code);
    }
  }, { passive: false });

  window.addEventListener('keyup', event => keys.delete(event.code));
  window.addEventListener('blur', () => keys.clear());

  document.addEventListener('mousemove', event => {
    if (!active) return;
    if (document.pointerLockElement === canvas) {
      player.yaw = (player.yaw + event.movementX * 0.00225) % TAU;
      player.pitch = clamp(player.pitch + event.movementY * 0.0019, -0.58, 0.58);
      return;
    }
    if (!dragLook) return;
    const dx = event.clientX - dragX;
    const dy = event.clientY - dragY;
    dragX = event.clientX;
    dragY = event.clientY;
    player.yaw = (player.yaw + dx * 0.004) % TAU;
    player.pitch = clamp(player.pitch + dy * 0.0032, -0.58, 0.58);
  });

  canvas.addEventListener('pointerdown', event => {
    if (!active) return;
    canvas.focus({ preventScroll: true });
    if (event.pointerType === 'mouse') {
      dragLook = true;
      dragX = event.clientX;
      dragY = event.clientY;
      canvas.requestPointerLock?.().catch?.(() => {});
    }
  });
  window.addEventListener('pointerup', () => { dragLook = false; });
  window.addEventListener('resize', () => { syncCanvas(); renderSurface(true); }, { passive: true });

  const previousDiagnostics = window.realitySandboxPresentationDiagnostics;
  window.realitySandboxPresentationDiagnostics = () => ({
    ...(typeof previousDiagnostics === 'function' ? previousDiagnostics() : {}),
    surfaceModeReady: true,
    surfaceMode: active ? 'active' : 'inactive',
    surfaceModeCanvasPresent: Boolean(document.getElementById('surfaceModeCanvas')),
    surfaceModeResolution: document.documentElement.dataset.surfaceModeResolution || 'unknown',
    surfaceModeBiome: document.documentElement.dataset.surfaceModeBiome || 'unknown',
    surfaceModeCoordinates: document.documentElement.dataset.surfaceModeCoordinates || 'unknown',
    surfaceModeVisibleCreatures: Number(document.documentElement.dataset.surfaceModeVisibleCreatures || 0),
    surfaceModeRenderMs: Number(document.documentElement.dataset.surfaceModeRenderMs || 0),
    surfaceModeRenderer: document.documentElement.dataset.surfaceModeRenderer || gpuBackend,
  });

  window.realitySandboxSurfaceMode = {
    enter: enterFromCameraCenter,
    enterAt,
    exit: exitSurface,
    isActive: () => active,
    getPlayer: () => ({ ...player }),
  };
  document.documentElement.dataset.surfaceMode = 'inactive';
  document.documentElement.dataset.surfaceModeReady = 'true';
  syncCanvas();
  startGpuRenderer();
}

async function boot() {
  const state = await waitForRuntime();
  if (!state) {
    document.documentElement.dataset.surfaceModeReady = 'false';
    return;
  }
  installSurfaceMode(state);
}

boot();
