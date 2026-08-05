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
    const timestamp = frame?.timestamp ?? performance.now();
    drawWhenFresh(timestamp);
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
      cloudPalette: 'lilac-purple-with-pink-edges',
      cloudStyle: 'decorative-swirls',
    };
    return snapshot;
  };

  window.realitySandboxLilacClouds = {
    ready: true,
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
    const signature = [
      phase,
      camera.zoom.toFixed(4),
      camera.centerX.toFixed(5),
      camera.centerY.toFixed(5),
    ].join(':');

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
    for (let index = 0; index < swirls; index++) {
      drawSwirl(index, phase, camera, cx, cy, radius);
    }

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
    }

    const outerWidth = Math.max(8, radius * (0.035 + hash(seed, 43) * 0.02));
    strokeRibbon(points, outerWidth, 'rgba(255, 117, 220, 0.34)', radius * 0.026, 'rgba(255, 114, 224, 0.9)');
    strokeRibbon(points, outerWidth * 0.68, 'rgba(181, 116, 255, 0.58)', radius * 0.012, 'rgba(211, 148, 255, 0.72)');
    strokeRibbon(points, outerWidth * 0.24, 'rgba(238, 209, 255, 0.52)', 0, 'transparent');

    const puffEvery = mobile ? 5 : 4;
    for (let pointIndex = 3; pointIndex < points.length - 2; pointIndex += puffEvery) {
      const point = points[pointIndex];
      const puff = outerWidth * (0.42 + hash(seed, pointIndex + 67) * 0.34);
      context.save();
      context.shadowColor = 'rgba(255, 118, 223, 0.72)';
      context.shadowBlur = puff * 0.9;
      context.fillStyle = 'rgba(255, 143, 226, 0.28)';
      context.beginPath();
      context.arc(point.x, point.y, puff, 0, TAU);
      context.fill();
      context.shadowBlur = puff * 0.35;
      context.fillStyle = 'rgba(177, 112, 244, 0.48)';
      context.beginPath();
      context.arc(point.x, point.y, puff * 0.72, 0, TAU);
      context.fill();
      context.fillStyle = 'rgba(229, 198, 255, 0.32)';
      context.beginPath();
      context.arc(point.x - puff * 0.16, point.y - puff * 0.14, puff * 0.34, 0, TAU);
      context.fill();
      context.restore();
    }
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
      context.quadraticCurveTo(
        point.x,
        point.y,
        (point.x + next.x) * 0.5,
        (point.y + next.y) * 0.5,
      );
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

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootLilacClouds, { once: true });
} else {
  bootLilacClouds();
}
