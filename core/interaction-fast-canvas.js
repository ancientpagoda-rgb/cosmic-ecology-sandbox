import { biomeColor } from './planet.js';

const TAU = Math.PI * 2;
const DESKTOP_TILE = 8;
const TOUCH_TILE = 10;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function wrap01(value) {
  return value - Math.floor(value);
}

function mixRgb(a, b, t) {
  const amount = clamp(t, 0, 1);
  return a.map((value, index) => Math.round(value + (b[index] - value) * amount));
}

function quickSurfaceColor(terrain, water) {
  let rgb = biomeColor(terrain);
  if (!terrain.land) return rgb;
  if ((water?.lake || 0) > 0.15) rgb = mixRgb(rgb, [34, 112, 164], clamp(water.lake, 0, 0.9));
  else if ((water?.river || 0) > 0.12) rgb = mixRgb(rgb, [43, 133, 178], 0.42);
  return rgb;
}

async function installFastInteractionCanvas() {
  try {
    await window.realitySandboxReady;
  } catch {
    return;
  }

  // Install after the other interaction wrappers so this becomes the outermost
  // render gate and can completely bypass Pixi during a gesture.
  await Promise.resolve();

  const runtime = window.realitySandboxUnified;
  const world = window.realitySandboxPlanet?.world;
  const sourceCanvas = document.getElementById('lofiLivingCanvas');
  if (!runtime?.render || !runtime?.getCamera || !world || !sourceCanvas) return;
  if (runtime.__fastInteractionCanvasInstalled) return;

  const originalRender = runtime.render.bind(runtime);
  const fastCanvas = document.createElement('canvas');
  const ctx = fastCanvas.getContext('2d', { alpha: false, desynchronized: true });
  if (!ctx) return;

  fastCanvas.id = 'lofiInteractionCanvas';
  fastCanvas.setAttribute('aria-hidden', 'true');
  Object.assign(fastCanvas.style, {
    position: 'absolute',
    zIndex: '2',
    display: 'none',
    pointerEvents: 'none',
    imageRendering: 'pixelated',
    background: '#030806',
  });
  sourceCanvas.parentElement?.insertBefore(fastCanvas, sourceCanvas.nextSibling);

  const coarsePointer = matchMedia('(pointer: coarse)').matches;
  const tile = coarsePointer ? TOUCH_TILE : DESKTOP_TILE;
  let active = false;
  let resumeSimulation = false;

  function syncCanvasGeometry() {
    if (fastCanvas.width !== sourceCanvas.width) fastCanvas.width = sourceCanvas.width;
    if (fastCanvas.height !== sourceCanvas.height) fastCanvas.height = sourceCanvas.height;
    for (const property of ['inset', 'left', 'top', 'right', 'bottom', 'width', 'height', 'transform', 'transformOrigin']) {
      fastCanvas.style[property] = sourceCanvas.style[property] || '';
    }
  }

  function drawFastGlobe() {
    const cache = window.realitySandboxInteractionCache;
    if (!cache?.isReady?.()) return false;

    syncCanvasGeometry();
    const width = fastCanvas.width;
    const height = fastCanvas.height;
    if (!width || !height) return false;

    const camera = runtime.getCamera();
    const baseRadius = Math.min(width, height) * (coarsePointer ? 0.42 : 0.43);
    const radius = baseRadius * camera.zoom;
    const cx = width * 0.5;
    const cy = height * 0.5;
    const lon0 = (camera.centerX - 0.5) * TAU;
    const lat0 = (0.5 - camera.centerY) * Math.PI;
    const sinLat0 = Math.sin(lat0);
    const cosLat0 = Math.cos(lat0);

    ctx.fillStyle = '#030806';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(139,184,168,0.20)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 2, 0, TAU);
    ctx.fill();

    const left = Math.max(0, Math.floor((cx - radius) / tile) * tile);
    const right = Math.min(width, Math.ceil((cx + radius) / tile) * tile);
    const top = Math.max(0, Math.floor((cy - radius) / tile) * tile);
    const bottom = Math.min(height, Math.ceil((cy + radius) / tile) * tile);

    for (let py = top; py < bottom; py += tile) {
      for (let px = left; px < right; px += tile) {
        const sx = (px + tile * 0.5 - cx) / radius;
        const sy = -(py + tile * 0.5 - cy) / radius;
        const rho2 = sx * sx + sy * sy;
        if (rho2 > 1) continue;

        const z = Math.sqrt(Math.max(0, 1 - rho2));
        const latitude = Math.asin(clamp(sy * cosLat0 + z * sinLat0, -1, 1));
        const longitude = lon0 + Math.atan2(sx, z * cosLat0 - sy * sinLat0);
        const u = wrap01(longitude / TAU + 0.5);
        const v = clamp(0.5 - latitude / Math.PI, 0, 1);
        const worldX = u * world.width;
        const worldY = v * world.height;
        const terrain = cache.sampleTerrain(worldX, worldY);
        const water = cache.sampleWater(worldX, worldY);
        if (!terrain) continue;

        const rgb = quickSurfaceColor(terrain, water);
        const light = clamp(0.3 + 0.78 * (sx * -0.35 + sy * 0.42 + z * 0.82), 0.18, 1.06);
        const red = clamp(Math.round(rgb[0] * light), 0, 255);
        const green = clamp(Math.round(rgb[1] * light), 0, 255);
        const blue = clamp(Math.round(rgb[2] * light), 0, 255);
        ctx.fillStyle = `rgb(${red} ${green} ${blue})`;
        ctx.fillRect(px, py, tile, tile);
      }
    }

    ctx.strokeStyle = 'rgba(139,184,168,0.78)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.stroke();
    return true;
  }

  runtime.render = frame => {
    const dragging = sourceCanvas.dataset.dragging === 'true';
    const cacheReady = window.realitySandboxInteractionCache?.isReady?.() === true;

    if (dragging && cacheReady) {
      if (!active) {
        active = true;
        const debug = window.realitySandboxDebug;
        if (debug?.isPaused && !debug.isPaused()) {
          debug.pause();
          resumeSimulation = true;
        } else {
          resumeSimulation = false;
        }
        fastCanvas.style.display = 'block';
      }
      drawFastGlobe();
      return;
    }

    if (active) {
      active = false;
      fastCanvas.style.display = 'none';
      if (resumeSimulation) window.realitySandboxDebug?.resume?.();
      resumeSimulation = false;
      return originalRender({ ...frame, timestamp: (frame?.timestamp ?? performance.now()) + 1000 });
    }

    return originalRender(frame);
  };

  runtime.__fastInteractionCanvasInstalled = true;
}

document.addEventListener('DOMContentLoaded', installFastInteractionCanvas, { once: true });
