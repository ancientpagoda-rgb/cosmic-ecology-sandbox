const TAU = Math.PI * 2;
const MAX_WEATHER = 13;
const ANIMAL_SCALE_BOOST = 1.65;
const GLOBE_RADIUS_FACTOR = 0.43;

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

  let webglLost = false;
  let lastRenderError = '';

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
  const ctx = weatherCanvas.getContext('2d', { alpha: true, desynchronized: true });

  function syncLayers() {
    const width = Math.max(1, sourceCanvas.width);
    const height = Math.max(1, sourceCanvas.height);
    if (weatherCanvas.width !== width) weatherCanvas.width = width;
    if (weatherCanvas.height !== height) weatherCanvas.height = height;

    const morphology = document.getElementById('morphologyOverlay');
    if (morphology) {
      Object.assign(morphology.style, {
        position: 'absolute',
        inset: '0',
        left: '0',
        top: '0',
        right: '0',
        bottom: '0',
        width: '100%',
        height: '100%',
        zIndex: '3',
        pointerEvents: 'none',
        overflow: 'hidden',
      });
      morphology.setAttribute('width', String(width));
      morphology.setAttribute('height', String(height));
      morphology.setAttribute('viewBox', `0 0 ${width} ${height}`);
      morphology.setAttribute('preserveAspectRatio', 'none');
    }
  }

  function project(worldX, worldY, camera, width, height) {
    const radius = Math.min(width, height) * GLOBE_RADIUS_FACTOR * camera.zoom;
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

  function boostAnimalMorphology() {
    const morphology = document.getElementById('morphologyOverlay');
    if (!morphology || morphology.style.display === 'none') {
      document.documentElement.dataset.visibleAnimalMorphology = '0';
      return 0;
    }

    let visible = 0;
    for (const group of morphology.children) {
      if (!(group instanceof SVGGElement)) continue;
      if (group.style.display === 'none' || group.querySelector('ellipse')) continue;
      const transform = group.getAttribute('transform') || '';
      if (!transform) continue;
      const boosted = transform.replace(/scale\(([-+\d.eE]+)\)/, (_, value) => {
        const scale = Number(value);
        return `scale(${Number.isFinite(scale) ? (scale * ANIMAL_SCALE_BOOST).toFixed(2) : value})`;
      });
      group.setAttribute('transform', boosted);
      group.style.display = '';
      visible += 1;
    }
    document.documentElement.dataset.visibleAnimalMorphology = String(visible);
    return visible;
  }

  function drawWeather() {
    if (!ctx) return 0;
    syncLayers();
    const width = weatherCanvas.width;
    const height = weatherCanvas.height;
    ctx.clearRect(0, 0, width, height);

    if (sourceCanvas.dataset.dragging === 'true') {
      weatherCanvas.style.display = 'none';
      return 0;
    }
    weatherCanvas.style.display = 'block';

    const camera = runtime.getCamera();
    const cells = dynamics.getWeather?.() || [];
    document.documentElement.dataset.totalWeatherCells = String(cells.length);
    let drawn = 0;

    for (const cell of cells) {
      if (drawn >= MAX_WEATHER) break;
      const point = project(cell.x, cell.y, camera, width, height);
      if (!point.visible) continue;

      const strength = clamp(cell.strength ?? 0.5, 0, 1);
      const cloudRadius = Math.max(4, Math.round((cell.radius || 10) / world.width * point.radius * 3.25));
      const alpha = clamp((0.52 + strength * 0.38) * point.depth, 0.24, 0.92);
      const x = Math.round(point.x);
      const y = Math.round(point.y);

      ctx.globalAlpha = alpha;
      ctx.fillStyle = cell.type === 'storm' ? '#8d999f' : '#e1e9e5';
      ctx.fillRect(x - cloudRadius, y - 2, cloudRadius * 2, 5);
      ctx.fillRect(x - Math.max(2, cloudRadius - 3), y - 6, Math.max(4, cloudRadius * 2 - 6), 4);
      ctx.fillRect(x - Math.max(1, cloudRadius - 5), y + 3, Math.max(2, cloudRadius * 2 - 10), 2);

      if (cell.type === 'rain' || cell.type === 'storm' || cell.type === 'snow') {
        ctx.globalAlpha = clamp(alpha * 0.92, 0.25, 0.88);
        ctx.fillStyle = cell.type === 'snow' ? '#dce9ee' : '#78b9d5';
        for (let offset = -cloudRadius + 2; offset <= cloudRadius - 2; offset += 4) {
          ctx.fillRect(x + offset, y + 6 + (Math.abs(offset) % 2), 1, cell.type === 'snow' ? 2 : 5);
        }
      }

      if (cell.type === 'storm' && strength > 0.62) {
        ctx.globalAlpha = clamp(alpha * 0.95, 0.3, 0.95);
        ctx.fillStyle = '#f4f0bd';
        ctx.fillRect(x, y + 6, 1, 3);
        ctx.fillRect(x - 1, y + 9, 1, 2);
      }

      drawn += 1;
    }

    ctx.globalAlpha = 1;
    document.documentElement.dataset.visibleWeatherCells = String(drawn);
    return drawn;
  }

  function markContextLost(reason = 'event') {
    webglLost = true;
    document.documentElement.dataset.webglContext = 'lost';
    document.documentElement.dataset.webglContextReason = reason;
    syncLayers();
    drawWeather();
  }

  sourceCanvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    markContextLost('webglcontextlost');
  }, false);

  sourceCanvas.addEventListener('webglcontextrestored', () => {
    webglLost = false;
    lastRenderError = '';
    document.documentElement.dataset.webglContext = 'restored';
    document.documentElement.dataset.webglContextReason = '';
    try {
      runtime.render({ timestamp: performance.now() + 1000 });
    } catch (error) {
      lastRenderError = String(error?.message || error);
    }
  }, false);

  sourceCanvas.addEventListener('webglcontextcreationerror', event => {
    markContextLost(event?.statusMessage || 'webglcontextcreationerror');
  }, false);

  const originalRender = runtime.render.bind(runtime);
  runtime.render = frame => {
    let result;
    let rendered = false;
    if (!webglLost) {
      try {
        result = originalRender(frame);
        rendered = true;
        lastRenderError = '';
      } catch (error) {
        const message = String(error?.message || error);
        lastRenderError = message;
        if (/webgl|context|gpu/i.test(message)) markContextLost('render-error');
        else throw error;
      }
    }

    syncLayers();
    if (rendered) boostAnimalMorphology();
    drawWeather();
    return result;
  };

  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(syncLayers) : null;
  observer?.observe(sourceCanvas);
  window.addEventListener('resize', syncLayers, { passive: true });

  syncLayers();
  boostAnimalMorphology();
  drawWeather();

  runtime.__presentationLayerFixInstalled = true;
  document.documentElement.dataset.presentationLayerFix = 'active';
  document.documentElement.dataset.webglContext = 'ok';

  window.realitySandboxPresentationDiagnostics = () => ({
    webglContext: document.documentElement.dataset.webglContext || 'unknown',
    webglReason: document.documentElement.dataset.webglContextReason || '',
    lastRenderError,
    totalWeatherCells: Number(document.documentElement.dataset.totalWeatherCells || 0),
    visibleWeatherCells: Number(document.documentElement.dataset.visibleWeatherCells || 0),
    visibleAnimalMorphology: Number(document.documentElement.dataset.visibleAnimalMorphology || 0),
    morphologyPresent: Boolean(document.getElementById('morphologyOverlay')),
    weatherCanvasPresent: Boolean(document.getElementById('weatherPresentationCanvas')),
  });
}

document.addEventListener('DOMContentLoaded', installPresentationLayerFix, { once: true });
