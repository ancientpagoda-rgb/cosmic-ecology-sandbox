const TAU = Math.PI * 2;
const MAX_WEATHER = 13;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

async function installPresentationLayerFix() {
  try {
    await window.realitySandboxReady;
  } catch {
    return;
  }

  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const runtime = window.realitySandboxUnified;
  const planet = window.realitySandboxPlanet;
  const world = planet?.world;
  const dynamics = planet?.dynamics;
  const sourceCanvas = document.getElementById('lofiLivingCanvas');
  const host = sourceCanvas?.parentElement;
  if (!runtime?.render || !runtime?.getCamera || !world || !dynamics || !sourceCanvas || !host) return;
  if (runtime.__presentationLayerFixInstalled) return;

  const weatherCanvas = document.createElement('canvas');
  weatherCanvas.id = 'weatherPresentationCanvas';
  weatherCanvas.setAttribute('aria-hidden', 'true');
  Object.assign(weatherCanvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    zIndex: '2',
    pointerEvents: 'none',
    imageRendering: 'pixelated',
  });
  host.insertBefore(weatherCanvas, sourceCanvas.nextSibling);
  const ctx = weatherCanvas.getContext('2d', { alpha: true });

  function syncLayers() {
    const width = Math.max(1, sourceCanvas.width);
    const height = Math.max(1, sourceCanvas.height);
    if (weatherCanvas.width !== width) weatherCanvas.width = width;
    if (weatherCanvas.height !== height) weatherCanvas.height = height;

    const morphology = document.getElementById('morphologyOverlay');
    if (morphology) {
      morphology.style.position = 'absolute';
      morphology.style.inset = '0';
      morphology.style.left = '0';
      morphology.style.top = '0';
      morphology.style.right = '0';
      morphology.style.bottom = '0';
      morphology.style.width = '100%';
      morphology.style.height = '100%';
      morphology.style.zIndex = '3';
      morphology.style.pointerEvents = 'none';
      morphology.style.overflow = 'hidden';
      morphology.setAttribute('width', String(width));
      morphology.setAttribute('height', String(height));
      morphology.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }
  }

  function project(worldX, worldY, camera, width, height) {
    const mobile = matchMedia('(max-width: 720px), (pointer: coarse)').matches;
    const radius = Math.min(width, height) * (mobile ? 0.42 : 0.43) * camera.zoom;
    const cx = width * 0.5;
    const cy = height * 0.5;
    const lon = (worldX / world.width - 0.5) * TAU;
    const lat = (0.5 - worldY / world.height) * Math.PI;
    const lon0 = (camera.centerX - 0.5) * TAU;
    const lat0 = (0.5 - camera.centerY) * Math.PI;
    const delta = lon - lon0;
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const sinLat0 = Math.sin(lat0);
    const cosLat0 = Math.cos(lat0);
    const x = cosLat * Math.sin(delta);
    const y = sinLat * cosLat0 - cosLat * Math.cos(delta) * sinLat0;
    const z = sinLat * sinLat0 + cosLat * Math.cos(delta) * cosLat0;
    return { x: cx + x * radius, y: cy - y * radius, depth: z, visible: z > 0, radius };
  }

  function drawWeather() {
    if (!ctx) return;
    syncLayers();
    const width = weatherCanvas.width;
    const height = weatherCanvas.height;
    ctx.clearRect(0, 0, width, height);

    if (sourceCanvas.dataset.dragging === 'true') {
      weatherCanvas.style.display = 'none';
      return;
    }
    weatherCanvas.style.display = 'block';

    const camera = runtime.getCamera();
    const cells = dynamics.getWeather?.() || [];
    let drawn = 0;

    for (const cell of cells) {
      if (drawn >= MAX_WEATHER) break;
      const point = project(cell.x, cell.y, camera, width, height);
      if (!point.visible) continue;

      const strength = clamp(cell.strength ?? 0.5, 0, 1);
      const cloudRadius = Math.max(3, Math.round((cell.radius || 10) / world.width * point.radius * 2.8));
      const alpha = clamp((0.42 + strength * 0.42) * point.depth, 0.18, 0.86);
      const x = Math.round(point.x);
      const y = Math.round(point.y);

      ctx.globalAlpha = alpha;
      ctx.fillStyle = cell.type === 'storm' ? '#89949b' : '#d8e2dd';
      ctx.fillRect(x - cloudRadius, y - 2, cloudRadius * 2, 4);
      ctx.fillRect(x - Math.max(2, cloudRadius - 3), y - 5, Math.max(4, cloudRadius * 2 - 6), 3);
      ctx.fillRect(x - Math.max(1, cloudRadius - 5), y + 2, Math.max(2, cloudRadius * 2 - 10), 2);

      if (cell.type === 'rain' || cell.type === 'storm') {
        ctx.globalAlpha = clamp(alpha * 0.9, 0.2, 0.8);
        ctx.fillStyle = '#78b9d5';
        for (let offset = -cloudRadius + 2; offset <= cloudRadius - 2; offset += 5) {
          ctx.fillRect(x + offset, y + 5 + (Math.abs(offset) % 2), 1, 4);
        }
      }

      if (cell.type === 'storm' && strength > 0.62) {
        ctx.globalAlpha = clamp(alpha * 0.9, 0.25, 0.9);
        ctx.fillStyle = '#f4f0bd';
        ctx.fillRect(x, y + 5, 1, 3);
        ctx.fillRect(x - 1, y + 8, 1, 2);
      }

      drawn += 1;
    }

    ctx.globalAlpha = 1;
    document.documentElement.dataset.visibleWeatherCells = String(drawn);
  }

  const originalRender = runtime.render.bind(runtime);
  runtime.render = frame => {
    const result = originalRender(frame);
    syncLayers();
    drawWeather();
    return result;
  };

  const observer = new ResizeObserver(syncLayers);
  observer.observe(sourceCanvas);
  syncLayers();
  drawWeather();

  runtime.__presentationLayerFixInstalled = true;
  document.documentElement.dataset.presentationLayerFix = 'active';
}

document.addEventListener('DOMContentLoaded', installPresentationLayerFix, { once: true });
