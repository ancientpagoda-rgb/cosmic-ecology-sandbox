const TAU = Math.PI * 2;
const MAX_WEATHER = 64;
const REFERENCE_RENDER_LONG_EDGE = 840;
const REFERENCE_ANIMAL_SCALE_BOOST = 4.7;
const GLOBE_RADIUS_FACTOR = 0.43;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

async function installPresentationLayerFix() {
  try {
    await window.realitySandboxReady;
  } catch (error) {
    document.documentElement.dataset.presentationLayerFix = 'blocked';
    document.documentElement.dataset.presentationLayerError = String(error?.message || error || 'runtime readiness failed');
    return;
  }

  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  try {
    const runtime = window.realitySandboxUnified;
    const planet = window.realitySandboxPlanet;
    const world = planet?.world;
    const dynamics = planet?.dynamics;
    const sourceCanvas = document.getElementById('lofiLivingCanvas');
    const host = sourceCanvas?.parentElement;
    if (!runtime?.render || !runtime?.getCamera || !world || !dynamics || !sourceCanvas || !host) {
      document.documentElement.dataset.presentationLayerFix = 'missing-prerequisite';
      return;
    }
    if (runtime.__presentationLayerFixInstalled) return;

    let webglLost = false;
    let lastRenderError = '';
    const nativeGetWeather = typeof dynamics.getWeather === 'function' ? dynamics.getWeather.bind(dynamics) : () => [];

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
      imageRendering: 'auto',
    });
    host.insertBefore(weatherCanvas, sourceCanvas.nextSibling);
    const ctx = weatherCanvas.getContext('2d', { alpha: true, desynchronized: true });

    function resolutionScale() {
      return Math.max(sourceCanvas.width, sourceCanvas.height) / REFERENCE_RENDER_LONG_EDGE;
    }

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

      const animalScaleBoost = REFERENCE_ANIMAL_SCALE_BOOST * resolutionScale();
      document.documentElement.dataset.animalScaleBoost = animalScaleBoost.toFixed(2);

      let visible = 0;
      for (const group of morphology.children) {
        if (String(group.tagName).toLowerCase() !== 'g') continue;
        if (group.style.display === 'none' || group.querySelector('ellipse')) continue;
        const transform = group.getAttribute('transform') || '';
        if (!transform) continue;
        const boosted = transform.replace(/scale\(([-+\d.eE]+)\)/, (_, value) => {
          const scale = Number(value);
          return `scale(${Number.isFinite(scale) ? (scale * animalScaleBoost).toFixed(2) : value})`;
        });
        group.setAttribute('transform', boosted);
        group.setAttribute('opacity', String(Math.max(0.9, Number(group.getAttribute('opacity')) || 0)));
        group.style.display = '';
        group.style.filter = 'drop-shadow(0 0 1px rgba(245,255,250,0.95))';

        const body = group.querySelector('path');
        if (body) {
          body.setAttribute('stroke', '#101713');
          body.setAttribute('stroke-width', '0.26');
          body.setAttribute('paint-order', 'stroke fill');
        }
        visible += 1;
      }
      document.documentElement.dataset.visibleAnimalMorphology = String(visible);
      return visible;
    }

    function radarColor(cell, strength) {
      if (cell.type === 'snow') return strength > 0.72 ? '#d8efff' : '#8fc9ff';
      if (cell.type === 'storm') {
        if (strength > 0.82) return '#ff355d';
        if (strength > 0.62) return '#ff8a34';
        return '#ffd34d';
      }
      if (cell.type === 'rain') {
        if (strength > 0.78) return '#ffb632';
        if (strength > 0.52) return '#d7e83f';
        return '#59d87a';
      }
      return '#72cfe8';
    }

    function drawRadarBlob(x, y, radius, color, strength, depth) {
      const edgeAlpha = clamp((0.15 + strength * 0.20) * depth, 0.06, 0.34);
      const coreAlpha = clamp((0.23 + strength * 0.34) * depth, 0.10, 0.58);
      const gradient = ctx.createRadialGradient(x, y, radius * 0.08, x, y, radius);
      gradient.addColorStop(0, colorWithAlpha(color, coreAlpha));
      gradient.addColorStop(0.52, colorWithAlpha(color, coreAlpha * 0.74));
      gradient.addColorStop(0.82, colorWithAlpha(color, edgeAlpha));
      gradient.addColorStop(1, colorWithAlpha(color, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(x, y, radius * 1.35, radius * 0.82, 0, 0, TAU);
      ctx.fill();
    }

    function colorWithAlpha(hex, alpha) {
      const value = Number.parseInt(hex.slice(1), 16);
      const r = (value >> 16) & 255;
      const g = (value >> 8) & 255;
      const b = value & 255;
      return `rgba(${r},${g},${b},${clamp(alpha, 0, 1)})`;
    }

    function drawWeather() {
      if (!ctx) return 0;
      syncLayers();
      const width = weatherCanvas.width;
      const height = weatherCanvas.height;
      const detailScale = resolutionScale();
      ctx.clearRect(0, 0, width, height);

      if (sourceCanvas.dataset.dragging === 'true') {
        weatherCanvas.style.display = 'none';
        return 0;
      }
      weatherCanvas.style.display = 'block';

      const camera = runtime.getCamera();
      const cells = nativeGetWeather() || [];
      document.documentElement.dataset.totalWeatherCells = String(cells.length);
      let drawn = 0;

      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      for (const cell of cells) {
        if (drawn >= MAX_WEATHER) break;
        const point = project(cell.x, cell.y, camera, width, height);
        if (!point.visible) continue;

        const strength = clamp(cell.strength ?? 0.5, 0, 1);
        const radarRadius = Math.max(
          Math.round(7 * detailScale),
          Math.round((cell.radius || 10) / world.width * point.radius * 3.5),
        );
        const color = radarColor(cell, strength);
        drawRadarBlob(point.x, point.y, radarRadius, color, strength, point.depth);

        if ((cell.type === 'storm' || cell.type === 'rain') && strength > 0.58) {
          const innerRadius = radarRadius * (0.30 + strength * 0.18);
          drawRadarBlob(
            point.x + radarRadius * 0.10,
            point.y - radarRadius * 0.06,
            innerRadius,
            cell.type === 'storm' ? (strength > 0.82 ? '#ff2d55' : '#ff9f32') : '#e9e83d',
            strength,
            point.depth,
          );
        }
        drawn += 1;
      }
      ctx.restore();

      document.documentElement.dataset.visibleWeatherCells = String(drawn);
      document.documentElement.dataset.weatherPresentation = 'radar';
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
          const currentGetWeather = dynamics.getWeather;
          dynamics.getWeather = () => [];
          try {
            result = originalRender(frame);
            rendered = true;
          } finally {
            dynamics.getWeather = currentGetWeather;
          }
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
    document.documentElement.dataset.presentationLayerError = '';
    document.documentElement.dataset.webglContext = 'ok';
    document.documentElement.dataset.weatherPresentation = 'radar';

    const previousDiagnostics = window.realitySandboxPresentationDiagnostics;
    window.realitySandboxPresentationDiagnostics = () => ({
      ...(typeof previousDiagnostics === 'function' ? previousDiagnostics() : {}),
      webglContext: document.documentElement.dataset.webglContext || 'unknown',
      webglReason: document.documentElement.dataset.webglContextReason || '',
      lastRenderError,
      totalWeatherCells: Number(document.documentElement.dataset.totalWeatherCells || 0),
      visibleWeatherCells: Number(document.documentElement.dataset.visibleWeatherCells || 0),
      visibleAnimalMorphology: Number(document.documentElement.dataset.visibleAnimalMorphology || 0),
      morphologyPresent: Boolean(document.getElementById('morphologyOverlay')),
      weatherCanvasPresent: Boolean(document.getElementById('weatherPresentationCanvas')),
      weatherPresentation: document.documentElement.dataset.weatherPresentation || 'unknown',
      renderResolution: `${sourceCanvas.width}x${sourceCanvas.height}`,
      renderQuality: document.documentElement.dataset.renderQuality || 'unknown',
      animalScaleBoost: Number(document.documentElement.dataset.animalScaleBoost || 0),
    });
  } catch (error) {
    document.documentElement.dataset.presentationLayerFix = 'error';
    document.documentElement.dataset.presentationLayerError = String(error?.stack || error?.message || error);
    throw error;
  }
}

document.addEventListener('DOMContentLoaded', installPresentationLayerFix, { once: true });
