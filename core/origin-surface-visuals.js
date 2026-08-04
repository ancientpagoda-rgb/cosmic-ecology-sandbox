export function createOriginSurfaceVisuals(originSystem, groundLevel, options = {}) {
  const mobile = options.mobile ?? matchMedia('(max-width: 720px), (pointer: coarse)').matches;
  const canvas = document.createElement('canvas');
  canvas.className = 'origin-surface-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;inset:0;z-index:7;width:100%;height:100%;pointer-events:none;opacity:0;transition:opacity .35s ease;';
  document.body.append(canvas);

  const context = canvas.getContext('2d', { alpha: true, desynchronized: true });
  let width = 1;
  let height = 1;
  let pixelRatio = 1;
  let lastDraw = -Infinity;
  let destroyed = false;

  function resize() {
    const nextWidth = Math.max(1, window.innerWidth);
    const nextHeight = Math.max(1, window.innerHeight);
    const nextRatio = Math.min(devicePixelRatio || 1, mobile ? 1 : 1.35);
    if (nextWidth === width && nextHeight === height && nextRatio === pixelRatio) return;
    width = nextWidth;
    height = nextHeight;
    pixelRatio = nextRatio;
    canvas.width = Math.floor(width * pixelRatio);
    canvas.height = Math.floor(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  function render(frame = {}) {
    if (destroyed) return;
    const timestamp = frame.timestamp ?? performance.now();
    const originState = originSystem.getState();
    const groundState = groundLevel.getState();
    const active = Boolean(originState.surfaceReady && groundState.active);
    canvas.style.opacity = active ? '1' : '0';

    if (!active) {
      context.clearRect(0, 0, width, height);
      return;
    }

    const interval = mobile ? 50 : 32;
    if (timestamp - lastDraw < interval) return;
    lastDraw = timestamp;
    resize();
    context.clearRect(0, 0, width, height);

    const navigation = groundState.navigation;
    const heading = navigation.heading || 0;
    const latitude = (0.5 - navigation.v) * Math.PI;
    const longitudeScale = Math.max(0.22, Math.cos(latitude));
    const forwardU = Math.sin(heading);
    const forwardV = -Math.cos(heading);
    const rightU = Math.cos(heading);
    const rightV = Math.sin(heading);
    const horizon = height * (0.43 + (navigation.pitch || 0) * 0.2);
    const rows = mobile ? 9 : 13;
    const columns = mobile ? 8 : 12;
    const time = timestamp * 0.001;

    context.save();
    context.beginPath();
    context.rect(0, Math.max(0, horizon - 8), width, height - horizon + 8);
    context.clip();

    for (let row = 0; row < rows; row++) {
      const depthT = row / Math.max(1, rows - 1);
      const depth = lerp(3.25, 0.2, depthT);
      const inverseDepth = 1 / depth;
      const verticalT = (inverseDepth - 1 / 3.25) / (1 / 0.2 - 1 / 3.25);
      const screenY = horizon + verticalT * (height - horizon) * 0.94;
      const spread = 0.55 + depth * 0.42;

      for (let column = 0; column < columns; column++) {
        const lateral = (column / Math.max(1, columns - 1) - 0.5) * spread * 2;
        const geographicScale = 0.0065;
        const u = wrap(
          navigation.u + (forwardU * depth + rightU * lateral) * geographicScale / longitudeScale,
          1,
        );
        const v = clamp(
          navigation.v + (forwardV * depth + rightV * lateral) * geographicScale,
          0.01,
          0.99,
        );
        const signal = originSystem.getSurfaceSignal(u, v);
        const strength = visualStrength(signal);
        if (strength < 0.018) continue;

        const noise = hashNoise(row, column, Math.floor(u * 997), Math.floor(v * 991));
        const screenX = width * 0.5 + lateral * inverseDepth * width * 0.25 + (noise - 0.5) * 18;
        const size = clamp((8 + strength * 48) * inverseDepth, 2, mobile ? 38 : 58);
        const wobble = Math.sin(time * 0.45 + noise * 12) * size * 0.04;
        drawColony(screenX, screenY + wobble, size, signal, noise);
      }
    }

    context.restore();
  }

  function drawColony(x, y, size, signal, noise) {
    const style = colonyStyle(signal);
    const alpha = clamp(style.alpha * (0.7 + noise * 0.45), 0.04, 0.82);

    context.save();
    context.translate(x, y);
    context.rotate((noise - 0.5) * 0.45);
    context.globalCompositeOperation = signal.photosynthesis > 0.01 ? 'screen' : 'source-over';
    context.fillStyle = `rgba(${style.color[0]},${style.color[1]},${style.color[2]},${alpha})`;
    context.beginPath();
    context.ellipse(0, 0, size * (0.72 + noise * 0.5), size * 0.22, 0, 0, Math.PI * 2);
    context.fill();

    if (signal.protocells > 0.004 || signal.microbes > 0.015) {
      context.strokeStyle = `rgba(${style.highlight[0]},${style.highlight[1]},${style.highlight[2]},${alpha * 0.65})`;
      context.lineWidth = Math.max(0.5, size * 0.035);
      context.beginPath();
      const points = 3 + Math.floor(noise * 4);
      for (let index = 0; index <= points; index++) {
        const px = (index / points - 0.5) * size * 1.1;
        const py = Math.sin(index * 2.4 + noise * 8) * size * 0.08;
        if (!index) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      context.stroke();
    }

    if (signal.plants > 0.018) {
      context.globalCompositeOperation = 'source-over';
      const blades = 2 + Math.floor(signal.plants * 6 + noise * 3);
      context.strokeStyle = `rgba(62,153,78,${clamp(0.35 + signal.plants * 0.55, 0, 0.88)})`;
      context.lineWidth = Math.max(0.7, size * 0.045);
      for (let index = 0; index < blades; index++) {
        const offset = (index / Math.max(1, blades - 1) - 0.5) * size * 0.9;
        const bladeHeight = size * (0.42 + hashNoise(index, blades, Math.floor(noise * 1000), 17) * 0.8);
        context.beginPath();
        context.moveTo(offset, 0);
        context.quadraticCurveTo(offset + (noise - 0.5) * size * 0.24, -bladeHeight * 0.58, offset + (noise - 0.5) * size * 0.16, -bladeHeight);
        context.stroke();
      }
    }

    context.restore();
  }

  function colonyStyle(signal) {
    if (signal.plants > 0.018) {
      return { color: [35, 105, 54], highlight: [122, 190, 91], alpha: 0.3 + signal.plants * 0.42 };
    }
    if (signal.photosynthesis > 0.01) {
      return { color: [35, 142, 112], highlight: [110, 225, 168], alpha: 0.2 + signal.photosynthesis * 1.5 };
    }
    if (signal.microbes > 0.015) {
      return { color: [37, 119, 139], highlight: [116, 220, 223], alpha: 0.17 + signal.microbes * 0.9 };
    }
    if (signal.protocells > 0.004) {
      return { color: [119, 87, 145], highlight: [210, 162, 235], alpha: 0.12 + signal.protocells * 2.2 };
    }
    return { color: [151, 105, 50], highlight: [237, 182, 94], alpha: 0.08 + signal.organics * 0.48 };
  }

  function visualStrength(signal) {
    return Math.max(
      signal.organics * 0.18,
      signal.protocells * 0.85,
      signal.microbes,
      signal.photosynthesis * 1.4,
      signal.plants * 1.6,
    );
  }

  const api = {
    id: 'origin.surface-visuals',
    name: 'Emergent Surface Colonization',
    version: '1.0.0',
    execution: 'browser-canvas',
    source: 'Reality Sandbox spatial origin field visualization',
    license: 'Project license',
    provides: ['origin.surface-visuals'],
    requires: ['origin.abiogenesis', 'exploration.ground-level'],
    after: ['terrain.ground-level'],
    initialize({ provideCapability }) {
      provideCapability('origin.surface-visuals', api);
    },
    render,
    destroy() {
      destroyed = true;
      canvas.remove();
    },
  };

  return api;
}

function hashNoise(a, b, c, d) {
  let value = Math.imul(a + 1, 374761393) ^ Math.imul(b + 3, 668265263) ^ Math.imul(c + 5, 1274126177) ^ Math.imul(d + 7, 2246822519);
  value = Math.imul(value ^ value >>> 13, 1274126177);
  return ((value ^ value >>> 16) >>> 0) / 4294967295;
}

const lerp = (a, b, t) => a + (b - a) * t;
const wrap = (value, max) => ((value % max) + max) % max;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
