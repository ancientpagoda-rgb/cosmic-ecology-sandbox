const CLOUD_STEP_MS = 2400;
const MOBILE_QUERY = '(max-width: 720px), (pointer: coarse)';
const TAU = Math.PI * 2;
let attempts = 0;

function bootLilacClouds() {
  if (window.realitySandboxLilacClouds?.ready) return;

  const unified = window.realitySandboxUnified;
  const hifi = window.realitySandboxHifi;
  const canvas = document.getElementById('lofiLivingCanvas');
  if (!unified || !hifi?.ready || !canvas) {
    if (attempts++ < 240) setTimeout(bootLilacClouds, 50);
    return;
  }

  const context = canvas.getContext('2d');
  const mobile = matchMedia(MOBILE_QUERY).matches;
  let lastSignature = '';

  const originalUnifiedRender = unified.render.bind(unified);
  unified.render = frame => {
    originalUnifiedRender(frame);
    drawWhenFresh(frame?.timestamp ?? performance.now());
  };

  const originalHifiRender = hifi.render.bind(hifi);
  hifi.render = () => {
    originalHifiRender();
    drawClouds(performance.now());
  };

  const originalSnapshot = unified.getSnapshot.bind(unified);
  unified.getSnapshot = () => {
    const snapshot = originalSnapshot();
    snapshot.presentation = {
      ...snapshot.presentation,
      cloudPalette: 'pale-lilac-clouds-purple-rain-radar',
      cloudStyle: 'swirls-with-rain-intensity',
      rainRadar: true,
    };
    return snapshot;
  };

  window.realitySandboxLilacClouds = {
    ready: true,
    rainRadar: true,
    render: () => {
      originalHifiRender();
      drawClouds(performance.now());
    },
  };

  originalHifiRender();
  drawWhenFresh(performance.now());

  function drawWhenFresh(timestamp) {
    const camera = unified.getCamera();
    const phase = Math.floor(timestamp / CLOUD_STEP_MS);
    const signature = [phase, camera.zoom.toFixed(4), camera.centerX.toFixed(5), camera.centerY.toFixed(5)].join(':');
    if (signature === lastSignature) return;
    lastSignature = signature;
    drawClouds(timestamp);
  }

  function drawClouds(timestamp) {
    const camera = unified.getCamera();
    const width = canvas.width;
    const height = canvas.height;
    const cx = width * 0.5;
    const cy = height * 0.5;
    const baseRadius = Math.min(width, height) * (mobile ? 0.43 : 0.44);
    const radius = baseRadius * camera.zoom;
    const phase = timestamp / 18000;

    context.save();
    context.beginPath();
    context.arc(cx, cy, radius, 0, TAU);
    context.clip();
    context.globalCompositeOperation = 'screen';

    const swirls = mobile ? 5 : 7;
    for (let index = 0; index < swirls; index++) drawSwirl(index, phase, camera, cx, cy, radius);

    context.restore();
  }

  function drawSwirl(index, phase, camera, cx, cy, radius) {
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

    const outerWidth = Math.max(8, radius * (0.035 + hash(seed, 43) * 0.02));

    // Dry cloud: pale, pretty lilac instead of solid purple.
    strokeRibbon(points, outerWidth, 'rgba(235, 216, 255, 0.18)', radius * 0.012, 'rgba(220, 190, 255, 0.42)');
    strokeRibbon(points, outerWidth * 0.58, 'rgba(213, 185, 245, 0.26)', radius * 0.006, 'rgba(214, 183, 255, 0.3)');

    // Rain radar: purple appears only in active rain cells.
    strokeRainSegments(points, intensities, outerWidth, 0.48, 'rgba(163, 104, 232, 0.5)', 'rgba(181, 118, 244, 0.74)');
    strokeRainSegments(points, intensities, outerWidth * 0.7, 0.67, 'rgba(103, 49, 190, 0.72)', 'rgba(146, 75, 230, 0.9)');
    strokeRainSegments(points, intensities, outerWidth * 0.34, 0.82, 'rgba(255, 112, 213, 0.92)', 'rgba(255, 105, 221, 1)');

    const puffEvery = mobile ? 5 : 4;
    for (let pointIndex = 3; pointIndex < points.length - 2; pointIndex += puffEvery) {
      const point = points[pointIndex];
      const intensity = intensities[pointIndex];
      const puff = outerWidth * (0.42 + hash(seed, pointIndex + 67) * 0.34);
      context.save();

      if (intensity < 0.48) {
        context.shadowColor = 'rgba(221, 194, 255, 0.3)';
        context.shadowBlur = puff * 0.35;
        context.fillStyle = 'rgba(234, 218, 255, 0.18)';
      } else if (intensity < 0.78) {
        context.shadowColor = 'rgba(155, 82, 229, 0.75)';
        context.shadowBlur = puff * 0.75;
        context.fillStyle = 'rgba(138, 73, 214, 0.48)';
      } else {
        context.shadowColor = 'rgba(255, 103, 216, 0.95)';
        context.shadowBlur = puff;
        context.fillStyle = 'rgba(255, 116, 218, 0.5)';
      }

      context.beginPath();
      context.arc(point.x, point.y, puff, 0, TAU);
      context.fill();
      context.restore();
    }
  }

  function strokeRainSegments(points, intensities, width, threshold, color, glow) {
    let segment = [];
    const flush = () => {
      if (segment.length > 1) strokeRibbon(segment, width, color, width * 0.45, glow);
      segment = [];
    };

    for (let index = 0; index < points.length; index++) {
      if (intensities[index] >= threshold) segment.push(points[index]);
      else flush();
    }
    flush();
  }

  function strokeRibbon(points, width, color, blur, shadowColor) {
    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = width;
    context.strokeStyle = color;
    context.shadowBlur = blur;
    context.shadowColor = shadowColor;
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length - 1; index++) {
      const point = points[index];
      const next = points[index + 1];
      context.quadraticCurveTo(point.x, point.y, (point.x + next.x) * 0.5, (point.y + next.y) * 0.5);
    }
    const last = points[points.length - 1];
    context.lineTo(last.x, last.y);
    context.stroke();
    context.restore();
  }
}

function hash(a, b) {
  let value = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ 0x9e3779b9;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootLilacClouds, { once: true });
else bootLilacClouds();
