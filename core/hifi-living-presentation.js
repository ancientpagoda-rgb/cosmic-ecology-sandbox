const MOBILE_BUFFER = { width: 768, height: 432 };
const DESKTOP_BUFFER = { width: 1280, height: 720 };
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const SEED = 20260812;

let bootAttempts = 0;

function boot() {
  if (window.realitySandboxHifi?.ready) return;

  const unified = window.realitySandboxUnified;
  const backing = document.getElementById('lofiLivingCanvas');
  if (!unified || !backing) {
    if (bootAttempts++ < 240) setTimeout(boot, 50);
    return;
  }

  const mobile = matchMedia('(max-width: 720px), (pointer: coarse)').matches;
  const buffer = mobile ? MOBILE_BUFFER : DESKTOP_BUFFER;
  const canvas = document.createElement('canvas');
  canvas.id = 'lofiLivingCanvas';
  canvas.className = 'hifi-living-canvas';
  canvas.width = buffer.width;
  canvas.height = buffer.height;
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', 'High-fidelity spherical living world. Scroll or pinch to zoom and drag to rotate.');

  backing.id = 'lofiLivingCanvasBacking';
  backing.tabIndex = -1;
  backing.setAttribute('aria-hidden', 'true');
  backing.after(canvas);

  const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const surfaceCanvas = document.createElement('canvas');
  surfaceCanvas.width = buffer.width;
  surfaceCanvas.height = buffer.height;
  const surfaceContext = surfaceCanvas.getContext('2d', { alpha: true });

  context.imageSmoothingEnabled = true;
  surfaceContext.imageSmoothingEnabled = true;
  document.body.dataset.presentationFidelity = 'high';

  const stars = createStars(buffer.width, buffer.height, mobile ? 160 : 300);
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  let lastSignature = '';
  let lastCloudPhase = -1;
  let lastRenderMs = 0;
  let rendering = false;
  let queued = false;

  installInteractions();

  const originalRender = unified.render.bind(unified);
  unified.render = frame => {
    originalRender(frame);
    const timestamp = frame?.timestamp ?? performance.now();
    renderIfNeeded(timestamp);
  };

  const originalSnapshot = unified.getSnapshot.bind(unified);
  unified.getSnapshot = () => {
    const snapshot = originalSnapshot();
    snapshot.presentation = {
      ...snapshot.presentation,
      fidelity: 'high',
      displayMode: 'hifi-procedural-sphere',
      outputWidth: buffer.width,
      outputHeight: buffer.height,
      backingRenderer: 'pixi-webgl',
      visibleRenderer: 'canvas2d-hifi',
    };
    return snapshot;
  };

  window.realitySandboxHifi = {
    ready: true,
    canvas,
    buffer: { ...buffer },
    render: () => renderIfNeeded(performance.now(), true),
    getState: () => ({
      ready: true,
      mobile,
      width: buffer.width,
      height: buffer.height,
      lastRenderMs,
      camera: unified.getCamera(),
    }),
  };

  renderIfNeeded(performance.now(), true);

  function renderIfNeeded(timestamp, force = false) {
    const camera = unified.getCamera();
    const cloudPhase = Math.floor(timestamp / 2400);
    const signature = [
      camera.zoom.toFixed(4),
      camera.centerX.toFixed(5),
      camera.centerY.toFixed(5),
    ].join(':');

    if (!force && signature === lastSignature && cloudPhase === lastCloudPhase) return;
    if (rendering) {
      queued = true;
      return;
    }

    rendering = true;
    const started = performance.now();
    drawPlanet(camera, cloudPhase);
    lastRenderMs = performance.now() - started;
    lastSignature = signature;
    lastCloudPhase = cloudPhase;
    rendering = false;

    if (queued) {
      queued = false;
      requestAnimationFrame(() => renderIfNeeded(performance.now(), true));
    }
  }

  function drawPlanet(camera, cloudPhase) {
    const width = buffer.width;
    const height = buffer.height;
    const cx = width * 0.5;
    const cy = height * 0.5;
    const baseRadius = Math.min(width, height) * (mobile ? 0.43 : 0.44);
    const radius = baseRadius * camera.zoom;

    drawSpace(context, width, height, stars);

    context.save();
    context.shadowColor = 'rgba(46, 127, 174, 0.52)';
    context.shadowBlur = Math.max(18, baseRadius * 0.13);
    context.beginPath();
    context.arc(cx, cy, Math.min(radius, baseRadius * 1.04), 0, Math.PI * 2);
    context.strokeStyle = 'rgba(94, 180, 221, 0.38)';
    context.lineWidth = Math.max(3, baseRadius * 0.018);
    context.stroke();
    context.restore();

    const image = surfaceContext.createImageData(width, height);
    const data = image.data;
    const left = Math.max(0, Math.floor(cx - radius - 2));
    const right = Math.min(width - 1, Math.ceil(cx + radius + 2));
    const top = Math.max(0, Math.floor(cy - radius - 2));
    const bottom = Math.min(height - 1, Math.ceil(cy + radius + 2));
    const lon0 = (camera.centerX - 0.5) * Math.PI * 2;
    const lat0 = (0.5 - camera.centerY) * Math.PI;
    const sinLat0 = Math.sin(lat0);
    const cosLat0 = Math.cos(lat0);
    const light = normalize3(-0.42, 0.46, 0.78);
    const cloudShift = cloudPhase * 0.018;

    for (let py = top; py <= bottom; py++) {
      const sy = -(py + 0.5 - cy) / radius;
      for (let px = left; px <= right; px++) {
        const sx = (px + 0.5 - cx) / radius;
        const rho2 = sx * sx + sy * sy;
        if (rho2 > 1) continue;

        const viewZ = Math.sqrt(Math.max(0, 1 - rho2));
        const latitude = Math.asin(clamp(sy * cosLat0 + viewZ * sinLat0, -1, 1));
        const longitude = lon0 + Math.atan2(sx, viewZ * cosLat0 - sy * sinLat0);
        const cosLat = Math.cos(latitude);
        const gx = cosLat * Math.cos(longitude);
        const gy = Math.sin(latitude);
        const gz = cosLat * Math.sin(longitude);

        const macro = layeredWave(gx, gy, gz, 1.8);
        const regional = layeredWave(gx + 0.17, gy - 0.09, gz + 0.13, 4.7);
        const fine = layeredWave(gx - 0.21, gy + 0.11, gz - 0.07, 13.4);
        const grain = hash3(
          Math.floor((gx + 1) * 640),
          Math.floor((gy + 1) * 640),
          Math.floor((gz + 1) * 640),
          SEED,
        ) * 2 - 1;
        const ridge = 1 - Math.abs(Math.sin((gx * 7.8 + gy * 5.4 - gz * 6.2) * Math.PI));
        const elevation = macro * 0.58 + regional * 0.28 + fine * 0.1 + grain * 0.04 + ridge * 0.08 - 0.08;
        const land = elevation > 0.03;
        const latitudeCold = Math.pow(Math.abs(gy), 1.28);
        const temperature = clamp(1 - latitudeCold * 0.96 - Math.max(0, elevation) * 0.42, 0, 1);
        const moisture = clamp(0.52 + layeredWave(gx - 0.31, gy + 0.22, gz + 0.19, 7.3) * 0.42 - ridge * 0.08, 0, 1);

        let color = land
          ? landColor(elevation, temperature, moisture, ridge)
          : oceanColor(elevation);

        const lightAmount = clamp(sx * light.x + sy * light.y + viewZ * light.z, -1, 1);
        const daylight = 0.2 + Math.max(0, lightAmount) * 0.86;
        const twilight = smoothstep(-0.18, 0.08, lightAmount);
        color = multiplyColor(color, daylight * (0.64 + twilight * 0.36));

        if (!land) {
          const glint = Math.pow(Math.max(0, lightAmount), 30) * Math.pow(viewZ, 5);
          color = addColor(color, 105 * glint, 132 * glint, 150 * glint);
        } else if (lightAmount < -0.08) {
          const settlement = hash3(
            Math.floor((longitude + Math.PI) * 170),
            Math.floor((latitude + Math.PI * 0.5) * 170),
            7,
            SEED + 91,
          );
          if (settlement > 0.994 && temperature > 0.18 && elevation < 0.55) {
            const glow = clamp((-lightAmount - 0.08) * 3.5, 0, 1);
            color = addColor(color, 175 * glow, 112 * glow, 42 * glow);
          }
        }

        const cloud = cloudField(gx, gy, gz, cloudShift);
        if (cloud > 0.61) {
          const density = smoothstep(0.61, 0.91, cloud) * (0.3 + viewZ * 0.7);
          const cloudLight = 0.46 + Math.max(0, lightAmount) * 0.68;
          color = mixColor(color, [225 * cloudLight, 235 * cloudLight, 239 * cloudLight], density * 0.72);
        }

        const rim = Math.pow(1 - viewZ, 2.35);
        color = addColor(color, 42 * rim, 104 * rim, 145 * rim);
        const index = (py * width + px) * 4;
        data[index] = clampByte(color[0]);
        data[index + 1] = clampByte(color[1]);
        data[index + 2] = clampByte(color[2]);
        data[index + 3] = clampByte(230 + viewZ * 25);
      }
    }

    surfaceContext.clearRect(0, 0, width, height);
    surfaceContext.putImageData(image, 0, 0);
    context.drawImage(surfaceCanvas, 0, 0);

    context.save();
    const edgeWidth = Math.max(1.5, baseRadius * 0.012);
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.strokeStyle = 'rgba(138, 211, 239, 0.72)';
    context.lineWidth = edgeWidth;
    context.stroke();
    context.beginPath();
    context.arc(cx - radius * 0.13, cy - radius * 0.18, radius * 0.72, Math.PI * 1.03, Math.PI * 1.62);
    context.strokeStyle = 'rgba(255,255,255,0.16)';
    context.lineWidth = Math.max(1, edgeWidth * 0.66);
    context.stroke();
    context.restore();
  }

  function installInteractions() {
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      canvas.focus({ preventScroll: true });
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      const camera = unified.getCamera();
      unified.setCamera({ ...camera, zoom: clamp(camera.zoom * Math.exp(-delta * 0.0015), MIN_ZOOM, MAX_ZOOM) });
      renderIfNeeded(performance.now(), true);
    }, { passive: false });

    canvas.addEventListener('pointerdown', event => {
      event.preventDefault();
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture?.(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size >= 2) beginPinch();
      else {
        const camera = unified.getCamera();
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, camera };
      }
      canvas.dataset.dragging = 'true';
    });

    canvas.addEventListener('pointermove', event => {
      if (!pointers.has(event.pointerId)) return;
      event.preventDefault();
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pointers.size >= 2) {
        if (!pinch) beginPinch();
        const pair = [...pointers.values()].slice(0, 2);
        const distance = Math.max(1, Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y));
        unified.setCamera({ ...pinch.camera, zoom: clamp(pinch.camera.zoom * distance / pinch.distance, MIN_ZOOM, MAX_ZOOM) });
        renderIfNeeded(performance.now(), true);
        return;
      }

      if (!drag || drag.id !== event.pointerId) return;
      const rect = canvas.getBoundingClientRect();
      const dx = (event.clientX - drag.x) / Math.max(1, rect.width);
      const dy = (event.clientY - drag.y) / Math.max(1, rect.height);
      unified.setCamera({
        zoom: drag.camera.zoom,
        centerX: wrap01(drag.camera.centerX - dx / Math.max(1, drag.camera.zoom)),
        centerY: clamp(drag.camera.centerY + dy / Math.max(1, drag.camera.zoom), 0.01, 0.99),
      });
      renderIfNeeded(performance.now(), true);
    });

    const endPointer = event => {
      pointers.delete(event.pointerId);
      try { canvas.releasePointerCapture?.(event.pointerId); } catch {}
      pinch = null;
      drag = null;
      if (pointers.size === 1) {
        const [id, point] = [...pointers.entries()][0];
        drag = { id, x: point.x, y: point.y, camera: unified.getCamera() };
      }
      canvas.dataset.dragging = pointers.size ? 'true' : 'false';
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);

    canvas.addEventListener('dblclick', event => {
      event.preventDefault();
      unified.resetCamera();
      renderIfNeeded(performance.now(), true);
    });

    canvas.addEventListener('keydown', event => {
      const camera = unified.getCamera();
      if (event.key === '0' || event.key === 'Home') {
        event.preventDefault();
        unified.resetCamera();
      } else if (event.key === '+' || event.key === '=' || event.key === 'PageUp') {
        event.preventDefault();
        unified.setCamera({ ...camera, zoom: clamp(camera.zoom * 1.35, MIN_ZOOM, MAX_ZOOM) });
      } else if (event.key === '-' || event.key === '_' || event.key === 'PageDown') {
        event.preventDefault();
        unified.setCamera({ ...camera, zoom: clamp(camera.zoom / 1.35, MIN_ZOOM, MAX_ZOOM) });
      } else return;
      renderIfNeeded(performance.now(), true);
    });
  }

  function beginPinch() {
    const pair = [...pointers.values()].slice(0, 2);
    if (pair.length < 2) return;
    pinch = {
      distance: Math.max(1, Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y)),
      camera: unified.getCamera(),
    };
    drag = null;
  }
}

function drawSpace(context, width, height, stars) {
  const gradient = context.createRadialGradient(width * 0.5, height * 0.48, 0, width * 0.5, height * 0.5, Math.max(width, height) * 0.72);
  gradient.addColorStop(0, '#07131d');
  gradient.addColorStop(0.58, '#030a11');
  gradient.addColorStop(1, '#010308');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  for (const star of stars) {
    context.globalAlpha = star.alpha;
    context.fillStyle = star.warm ? '#f6dfbd' : '#d8ecff';
    context.fillRect(star.x, star.y, star.size, star.size);
  }
  context.globalAlpha = 1;
}

function createStars(width, height, count) {
  const stars = [];
  for (let index = 0; index < count; index++) {
    const x = hash3(index, 11, 23, SEED + 17) * width;
    const y = hash3(index, 29, 47, SEED + 31) * height;
    stars.push({
      x: Math.floor(x),
      y: Math.floor(y),
      size: hash3(index, 53, 71, SEED + 43) > 0.94 ? 2 : 1,
      alpha: 0.25 + hash3(index, 79, 97, SEED + 59) * 0.62,
      warm: hash3(index, 101, 113, SEED + 73) > 0.78,
    });
  }
  return stars;
}

function layeredWave(x, y, z, frequency) {
  const a = Math.sin((x * 1.13 + y * 0.77 - z * 0.41) * frequency * Math.PI);
  const b = Math.cos((x * -0.63 + y * 1.31 + z * 0.92) * frequency * Math.PI * 0.73);
  const c = Math.sin((x * 0.48 - y * 0.56 + z * 1.42) * frequency * Math.PI * 1.37);
  const d = Math.cos((x + y + z) * frequency * Math.PI * 0.39);
  return (a * 0.34 + b * 0.29 + c * 0.23 + d * 0.14);
}

function cloudField(x, y, z, shift) {
  const broad = layeredWave(x + shift, y - shift * 0.18, z + shift * 0.46, 6.8);
  const wisps = layeredWave(x - shift * 0.37, y + shift * 0.11, z + shift, 17.2);
  return clamp(0.52 + broad * 0.31 + wisps * 0.18, 0, 1);
}

function oceanColor(elevation) {
  const shallow = smoothstep(-0.32, 0.04, elevation);
  return mixColor([5, 24, 54], [21, 102, 130], shallow);
}

function landColor(elevation, temperature, moisture, ridge) {
  if (temperature < 0.12) return mixColor([205, 219, 225], [246, 250, 250], 0.62 + ridge * 0.25);
  if (elevation > 0.72) return mixColor([104, 100, 92], [224, 224, 219], smoothstep(0.72, 1.05, elevation));
  if (elevation > 0.53) return mixColor([79, 84, 74], [140, 126, 103], ridge * 0.65);
  if (moisture < 0.22 && temperature > 0.46) return mixColor([154, 112, 59], [213, 174, 100], temperature * 0.7);
  if (moisture > 0.68 && temperature > 0.38) return mixColor([20, 83, 54], [49, 126, 70], temperature * 0.5);
  if (moisture > 0.48) return mixColor([39, 91, 57], [84, 134, 72], temperature * 0.42);
  return mixColor([94, 112, 63], [143, 139, 76], 1 - moisture);
}

function mixColor(a, b, t) {
  const amount = clamp(t, 0, 1);
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ];
}

function multiplyColor(color, amount) {
  return [color[0] * amount, color[1] * amount, color[2] * amount];
}

function addColor(color, red, green, blue) {
  return [color[0] + red, color[1] + green, color[2] + blue];
}

function hash3(x, y, z, seed) {
  let value = seed ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function normalize3(x, y, z) {
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / Math.max(0.000001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function wrap01(value) {
  return value - Math.floor(value);
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
