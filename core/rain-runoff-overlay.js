const WEATHER_STEP_MS = 900;
const MOBILE_QUERY = '(max-width: 720px), (pointer: coarse)';
const TAU = Math.PI * 2;
let attempts = 0;

function bootRainRunoff() {
  if (window.realitySandboxRainRunoff?.ready) return;

  const unified = window.realitySandboxUnified;
  const hifi = window.realitySandboxHifi;
  const clouds = window.realitySandboxLilacClouds;
  const canvas = document.getElementById('lofiLivingCanvas');
  if (!unified || !hifi?.ready || !clouds?.ready || !canvas) {
    if (attempts++ < 240) setTimeout(bootRainRunoff, 50);
    return;
  }

  const context = canvas.getContext('2d');
  const mobile = matchMedia(MOBILE_QUERY).matches;
  let lastSignature = '';
  let activeRainCells = 0;

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
    };
    return snapshot;
  };

  window.realitySandboxRainRunoff = {
    ready: true,
    render: () => {
      originalHifiRender();
      drawWeather(performance.now());
    },
    getState: () => ({
      ready: true,
      activeRainCells,
      visibleRain: true,
      wetGround: true,
      runoffVisuals: true,
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
    const camera = unified.getCamera();
    const width = canvas.width;
    const height = canvas.height;
    const cx = width * 0.5;
    const cy = height * 0.5;
    const baseRadius = Math.min(width, height) * (mobile ? 0.43 : 0.44);
    const radius = baseRadius * camera.zoom;
    const phase = timestamp / 18000;
    activeRainCells = 0;

    context.save();
    context.beginPath();
    context.arc(cx, cy, radius, 0, TAU);
    context.clip();

    const swirls = mobile ? 5 : 7;
    for (let index = 0; index < swirls; index++) {
      drawStorm(index, phase, camera, cx, cy, radius);
    }

    context.restore();
  }

  function drawStorm(index, phase, camera, cx, cy, radius) {
    const seed = 9137 + index * 173;
    const longitudeShift = camera.centerX * TAU;
    const latitudeShift = (camera.centerY - 0.5) * Math.PI;
    const orbit = hash(seed, 11) * TAU + longitudeShift * 0.7 + phase * (0.34 + index * 0.025);
    const radial = 0.16 + hash(seed, 19) * 0.58;
    const centerX = cx + Math.cos(orbit) * radius * radial;
    const centerY = cy + Math.sin(orbit * 0.84 + latitudeShift) * radius * radial * 0.62;
    const spiralRadius = radius * (0.12 + hash(seed, 29) * 0.17);
    const turns = 1.18 + hash(seed, 37) * 0.92;
    const clockwise = index % 2 === 0 ? 1 : -1;
    const points = [];
    const intensities = [];
    const samples = 48;

    for (let sample = 0; sample <= samples; sample++) {
      const t = sample / samples;
      const angle = orbit + clockwise * t * turns * TAU;
      const expansion = 0.2 + t * 0.9;
      const wobble = Math.sin(t * TAU * 3 + seed * 0.01) * spiralRadius * 0.08;
      points.push({
        x: centerX + Math.cos(angle) * (spiralRadius * expansion + wobble),
        y: centerY + Math.sin(angle) * (spiralRadius * expansion * 0.58 + wobble * 0.35),
      });

      const broadCell = 0.5 + 0.5 * Math.sin(t * TAU * (1.6 + hash(seed, 73)) + phase * 1.8 + seed * 0.004);
      const embeddedCell = 0.5 + 0.5 * Math.sin(t * TAU * (4.4 + hash(seed, 89) * 2.2) - phase * 2.4 + seed * 0.009);
      const noise = hash(seed + Math.floor(t * 13), 101 + index);
      intensities.push(clamp(broadCell * 0.52 + embeddedCell * 0.3 + noise * 0.18, 0, 1));
    }

    const cloudWidth = Math.max(8, radius * (0.035 + hash(seed, 43) * 0.02));
    drawWetGround(points, intensities, cloudWidth, radius);
    drawRunoff(points, intensities, cloudWidth, radius, cx, cy, phase, seed);
    drawRain(points, intensities, cloudWidth, radius, phase, seed);
  }

  function drawWetGround(points, intensities, cloudWidth, radius) {
    context.save();
    context.globalCompositeOperation = 'multiply';

    for (let index = 0; index < points.length; index += 4) {
      const intensity = intensities[index];
      if (intensity < 0.48) continue;
      activeRainCells += 1;

      const point = points[index];
      const spread = cloudWidth * (1.3 + intensity * 1.8);
      const wetness = 0.08 + intensity * 0.2;
      context.shadowColor = `rgba(50, 24, 92, ${wetness * 0.7})`;
      context.shadowBlur = radius * 0.018;
      context.fillStyle = `rgba(28, 18, 64, ${wetness})`;
      context.beginPath();
      context.ellipse(point.x, point.y + cloudWidth * (1.3 + intensity), spread, spread * 0.42, 0, 0, TAU);
      context.fill();
    }

    context.restore();
  }

  function drawRunoff(points, intensities, cloudWidth, radius, cx, cy, phase, seed) {
    context.save();
    context.globalCompositeOperation = 'screen';
    context.lineCap = 'round';

    for (let index = 2; index < points.length; index += 8) {
      const intensity = intensities[index];
      if (intensity < 0.68) continue;

      const point = points[index];
      const flowPulse = 0.72 + 0.28 * Math.sin(phase * 3.1 + seed * 0.013 + index);
      const endX = cx + (point.x - cx) * 0.58 + (hash(seed, index + 211) - 0.5) * radius * 0.08;
      const endY = clamp(point.y + radius * (0.11 + intensity * 0.12), cy - radius * 0.92, cy + radius * 0.9);
      const controlX = point.x + (endX - point.x) * 0.45 + (hash(seed, index + 233) - 0.5) * radius * 0.06;
      const controlY = point.y + (endY - point.y) * 0.48;

      context.strokeStyle = `rgba(92, 139, 237, ${0.12 + intensity * 0.2})`;
      context.shadowColor = 'rgba(138, 118, 255, 0.55)';
      context.shadowBlur = cloudWidth * 0.35;
      context.lineWidth = Math.max(1, cloudWidth * 0.1 * intensity * flowPulse);
      context.beginPath();
      context.moveTo(point.x, point.y + cloudWidth * 1.2);
      context.quadraticCurveTo(controlX, controlY, endX, endY);
      context.stroke();

      const poolRadius = cloudWidth * (0.25 + intensity * 0.35) * flowPulse;
      context.fillStyle = `rgba(102, 112, 232, ${0.08 + intensity * 0.16})`;
      context.beginPath();
      context.ellipse(endX, endY, poolRadius * 1.8, poolRadius * 0.58, 0, 0, TAU);
      context.fill();
      context.strokeStyle = `rgba(230, 180, 255, ${0.12 + intensity * 0.18})`;
      context.lineWidth = Math.max(0.75, cloudWidth * 0.045);
      context.stroke();
    }

    context.restore();
  }

  function drawRain(points, intensities, cloudWidth, radius, phase, seed) {
    context.save();
    context.globalCompositeOperation = 'screen';
    context.lineCap = 'round';

    for (let index = 0; index < points.length; index += 3) {
      const intensity = intensities[index];
      if (intensity < 0.48) continue;

      const point = points[index];
      const drops = 2 + Math.floor(intensity * 4);
      for (let drop = 0; drop < drops; drop++) {
        const jitter = (hash(seed + index * 17, drop + 307) - 0.5) * cloudWidth * 1.9;
        const fall = fract(phase * (5.5 + intensity * 3) + hash(seed + drop * 31, index + 331));
        const travel = cloudWidth * (1.4 + intensity * 2.6);
        const startX = point.x + jitter - fall * cloudWidth * 0.28;
        const startY = point.y + cloudWidth * 0.7 + fall * travel;
        const length = cloudWidth * (0.42 + intensity * 0.62);

        context.strokeStyle = intensity > 0.82
          ? `rgba(255, 156, 232, ${0.28 + intensity * 0.34})`
          : `rgba(174, 170, 255, ${0.18 + intensity * 0.3})`;
        context.shadowColor = intensity > 0.82
          ? 'rgba(255, 111, 218, 0.75)'
          : 'rgba(132, 111, 241, 0.55)';
        context.shadowBlur = radius * 0.004;
        context.lineWidth = Math.max(0.85, radius * 0.0022 * intensity);
        context.beginPath();
        context.moveTo(startX, startY);
        context.lineTo(startX - length * 0.22, startY + length);
        context.stroke();
      }
    }

    context.restore();
  }
}

function hash(a, b) {
  let value = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ 0x9e3779b9;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function fract(value) {
  return value - Math.floor(value);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootRainRunoff, { once: true });
else bootRainRunoff();
