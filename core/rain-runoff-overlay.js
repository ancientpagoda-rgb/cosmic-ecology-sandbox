const WEATHER_STEP_MS = 900;
const TAU = Math.PI * 2;
let attempts = 0;

function bootRainRunoff() {
  if (window.realitySandboxRainRunoff?.ready) return;

  const unified = window.realitySandboxUnified;
  const hifi = window.realitySandboxHifi;
  const weather = window.realitySandboxEarthWeather;
  const canvas = document.getElementById('lofiLivingCanvas');
  if (!unified || !hifi?.ready || !weather?.ready || typeof hifi.projectGeo !== 'function' || !canvas) {
    if (attempts++ < 240) setTimeout(bootRainRunoff, 50);
    return;
  }

  const context = canvas.getContext('2d');
  let lastSignature = '';
  let activeRainCells = 0;
  let landRainCells = 0;

  const originalUnifiedRender = unified.render.bind(unified);
  unified.render = frame => {
    originalUnifiedRender(frame);
    drawWhenFresh(frame?.timestamp ?? performance.now());
  };

  const originalHifiRender = hifi.render.bind(hifi);
  hifi.render = () => {
    originalHifiRender();
    drawWeather(performance.now());
  };

  const originalSnapshot = unified.getSnapshot.bind(unified);
  unified.getSnapshot = () => {
    const snapshot = originalSnapshot();
    snapshot.presentation = {
      ...snapshot.presentation,
      visibleRain: true,
      wetGround: true,
      runoffVisuals: true,
      precipitationCoordinateSystem: 'georeferenced latitude-longitude',
      precipitationDataMode: 'simulated-not-live',
    };
    return snapshot;
  };

  window.realitySandboxRainRunoff = {
    ready: true,
    georeferenced: true,
    simulated: true,
    render: () => {
      originalHifiRender();
      drawWeather(performance.now());
    },
    getState: () => ({
      ready: true,
      activeRainCells,
      landRainCells,
      visibleRain: true,
      wetGround: true,
      runoffVisuals: true,
      georeferenced: true,
      simulated: true,
    }),
  };

  originalHifiRender();
  drawWhenFresh(performance.now());

  function drawWhenFresh(timestamp) {
    const camera = unified.getCamera();
    const step = Math.floor(timestamp / WEATHER_STEP_MS);
    const signature = [step, camera.zoom.toFixed(4), camera.centerX.toFixed(5), camera.centerY.toFixed(5)].join(':');
    if (signature === lastSignature) return;
    lastSignature = signature;
    drawWeather(timestamp);
  }

  function drawWeather(timestamp) {
    const geometry = hifi.getViewGeometry();
    const samples = weather.getPrecipitationSamples(timestamp);
    activeRainCells = 0;
    landRainCells = 0;

    context.save();
    context.beginPath();
    context.arc(geometry.cx, geometry.cy, geometry.radius, 0, TAU);
    context.clip();

    for (const sample of samples) {
      const projected = hifi.projectGeo(sample.latitude, sample.longitude);
      if (!projected.visible || sample.intensity < 0.48) continue;
      activeRainCells += 1;

      const surface = hifi.surfaceSample(sample.latitude, sample.longitude);
      if (surface.land) {
        landRainCells += 1;
        drawWetGround(projected, sample, geometry.radius);
        if (sample.intensity > 0.68) drawRunoff(projected, sample, geometry, timestamp);
      }
      drawRain(projected, sample, geometry.radius, timestamp);
    }

    context.restore();
  }

  function drawWetGround(projected, sample, radius) {
    const footprint = radius * (0.014 + sample.intensity * 0.022) * (0.45 + projected.depth * 0.55);
    const wetness = 0.06 + sample.intensity * 0.16;

    context.save();
    context.globalCompositeOperation = 'multiply';
    context.shadowColor = `rgba(35, 28, 70, ${wetness * 0.7})`;
    context.shadowBlur = footprint * 0.9;
    context.fillStyle = `rgba(24, 31, 62, ${wetness})`;
    context.beginPath();
    context.ellipse(projected.x, projected.y, footprint * 1.45, footprint * 0.58, 0.1, 0, TAU);
    context.fill();
    context.restore();
  }

  function drawRunoff(projected, sample, geometry, timestamp) {
    const seed = hashString(sample.systemId) + Math.round(sample.latitude * 17) + Math.round(sample.longitude * 13);
    const pulse = 0.72 + 0.28 * Math.sin(timestamp / 2600 + seed);
    const length = geometry.radius * (0.035 + sample.intensity * 0.045);
    const slopeX = (projected.x - geometry.cx) * 0.06;
    const endX = projected.x + slopeX + (hash(seed, 211) - 0.5) * length * 0.55;
    const endY = projected.y + length;
    const controlX = projected.x + (endX - projected.x) * 0.52 + (hash(seed, 233) - 0.5) * length * 0.36;
    const controlY = projected.y + length * 0.48;

    context.save();
    context.globalCompositeOperation = 'screen';
    context.lineCap = 'round';
    context.strokeStyle = `rgba(93, 143, 237, ${0.1 + sample.intensity * 0.18})`;
    context.shadowColor = 'rgba(133, 118, 245, 0.45)';
    context.shadowBlur = Math.max(1, geometry.radius * 0.004);
    context.lineWidth = Math.max(0.8, geometry.radius * 0.0018 * sample.intensity * pulse);
    context.beginPath();
    context.moveTo(projected.x, projected.y);
    context.quadraticCurveTo(controlX, controlY, endX, endY);
    context.stroke();

    const poolRadius = geometry.radius * (0.004 + sample.intensity * 0.004) * pulse;
    context.fillStyle = `rgba(93, 128, 229, ${0.07 + sample.intensity * 0.12})`;
    context.beginPath();
    context.ellipse(endX, endY, poolRadius * 1.8, poolRadius * 0.58, 0, 0, TAU);
    context.fill();
    context.restore();
  }

  function drawRain(projected, sample, radius, timestamp) {
    const footprint = radius * (0.012 + sample.intensity * 0.018) * (0.45 + projected.depth * 0.55);
    const dropCount = 2 + Math.floor(sample.intensity * 5);
    const seed = hashString(sample.systemId) + Math.round(sample.latitude * 31) + Math.round(sample.longitude * 19);

    context.save();
    context.globalCompositeOperation = 'screen';
    context.lineCap = 'round';

    for (let drop = 0; drop < dropCount; drop++) {
      const fall = fract(timestamp / (580 + drop * 53) + hash(seed + drop, 307));
      const jitterX = (hash(seed + drop * 17, 331) - 0.5) * footprint * 2.4;
      const startX = projected.x + jitterX - fall * footprint * 0.35;
      const startY = projected.y + footprint * 0.25 + fall * footprint * 3.1;
      const length = footprint * (0.55 + sample.intensity * 0.75);

      context.strokeStyle = sample.intensity > 0.82
        ? `rgba(255, 160, 232, ${0.28 + sample.intensity * 0.3})`
        : `rgba(174, 183, 255, ${0.17 + sample.intensity * 0.26})`;
      context.shadowColor = sample.intensity > 0.82
        ? 'rgba(255, 111, 218, 0.72)'
        : 'rgba(128, 120, 242, 0.5)';
      context.shadowBlur = Math.max(1, radius * 0.0035);
      context.lineWidth = Math.max(0.7, radius * 0.0017 * sample.intensity);
      context.beginPath();
      context.moveTo(startX, startY);
      context.lineTo(startX - length * 0.22, startY + length);
      context.stroke();
    }

    context.restore();
  }
}

function hashString(value) {
  let hashValue = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hashValue ^= value.charCodeAt(index);
    hashValue = Math.imul(hashValue, 16777619);
  }
  return (hashValue >>> 0) % 100000;
}

function hash(a, b) {
  let value = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ 0x9e3779b9;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function fract(value) {
  return value - Math.floor(value);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootRainRunoff, { once: true });
else bootRainRunoff();
