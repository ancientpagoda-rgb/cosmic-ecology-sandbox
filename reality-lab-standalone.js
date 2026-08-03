(() => {
  const app = document.getElementById('app');
  const status = document.getElementById('status');
  const yearEl = document.getElementById('year');
  const speedInput = document.getElementById('timeSpeed');
  const speedLabel = document.getElementById('speedLabel');

  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas unavailable');
    app.appendChild(canvas);

    const COUNT = 30000;
    const points = new Float32Array(COUNT * 3);
    const elevation = new Float32Array(COUNT);
    const moisture = new Float32Array(COUNT);
    const temperature = new Float32Array(COUNT);
    const forest = new Float32Array(COUNT);
    const river = new Float32Array(COUNT);
    const city = new Float32Array(COUNT);
    const cloud = new Float32Array(COUNT);
    const golden = Math.PI * (3 - Math.sqrt(5));

    status.textContent = 'Generating planet…';
    for (let i = 0; i < COUNT; i++) {
      const y = 1 - (i / (COUNT - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const t = golden * i;
      const x = Math.cos(t) * r;
      const z = Math.sin(t) * r;
      points[i * 3] = x;
      points[i * 3 + 1] = y;
      points[i * 3 + 2] = z;

      const continents = 0.5 + Math.sin(x * 5.1 + z * 2.2) * 0.17 + Math.sin(y * 7.3 - x * 3.4) * 0.13;
      const mountains = Math.pow(Math.abs(Math.sin(x * 14 + y * 9 - z * 11)), 2.2) * 0.2;
      const e = clamp(continents + mountains, 0, 1);
      elevation[i] = e;
      temperature[i] = clamp(0.9 - Math.abs(y) * 0.8 - Math.max(0, e - 0.62) * 0.72, 0, 1);
      moisture[i] = clamp(0.48 + Math.sin(z * 6.2 - x * 2.6) * 0.24 + Math.sin(y * 10.7 + z * 4.1) * 0.16, 0, 1);
      forest[i] = clamp(moisture[i] * temperature[i] * 1.5 - 0.2, 0, 1);
      river[i] = clamp((1 - Math.abs(Math.sin(x * 22 + y * 13 - z * 17))) * moisture[i] * Math.max(0, e - 0.43) * 3.1, 0, 1);
      city[i] = e > 0.48 && e < 0.66 && river[i] > 0.76 && moisture[i] > 0.52 && hash(i) > 0.996 ? 0.25 : 0;
      cloud[i] = Math.sin(x * 13 + y * 7 - z * 9) + Math.sin(x * 5 - y * 11 + z * 4) > 0.72 ? 1 : 0;
    }

    let yaw = 0.45;
    let pitch = -0.1;
    let zoom = 0.56;
    let years = 0;
    let last = performance.now();
    let pointer = null;
    let lastX = 0;
    let lastY = 0;
    let cloudSpin = 0;
    const touches = new Map();
    let pinchStart = 0;
    let zoomStart = zoom;
    let image = null;
    let depth = null;

    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 1.15);
      const w = Math.max(1, Math.floor(innerWidth * dpr));
      const h = Math.max(1, Math.floor(innerHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        image = ctx.createImageData(w, h);
        depth = new Float32Array(w * h);
      }
    }
    addEventListener('resize', resize);
    resize();

    canvas.addEventListener('pointerdown', e => {
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (touches.size === 1) {
        pointer = e.pointerId;
        lastX = e.clientX;
        lastY = e.clientY;
      } else {
        pointer = null;
        pinchStart = distance();
        zoomStart = zoom;
      }
      canvas.setPointerCapture?.(e.pointerId);
    });

    canvas.addEventListener('pointermove', e => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (touches.size >= 2) {
        zoom = clamp(zoomStart + (distance() - pinchStart) / 250, 0, 1);
        return;
      }
      if (e.pointerId !== pointer) return;
      yaw += (e.clientX - lastX) * 0.009;
      pitch = clamp(pitch + (e.clientY - lastY) * 0.009, -1.35, 1.35);
      lastX = e.clientX;
      lastY = e.clientY;
    });

    const release = e => {
      touches.delete(e.pointerId);
      if (!touches.size) pointer = null;
      if (touches.size < 2) pinchStart = 0;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      zoom = clamp(zoom - e.deltaY * 0.0012, 0, 1);
    }, { passive: false });

    speedInput.addEventListener('input', updateSpeed);
    updateSpeed();
    status.remove();
    requestAnimationFrame(frame);

    function frame(now) {
      requestAnimationFrame(frame);
      const dt = Math.min(0.08, (now - last) / 1000);
      last = now;
      if (pointer === null && touches.size < 2) yaw += dt * 0.03;
      cloudSpin += dt * 0.018;
      const rate = timeRate(Number(speedInput.value));
      years += rate * dt;
      evolve(rate * dt);
      draw(now);
      yearEl.textContent = formatYears(years);
    }

    function evolve(stepYears) {
      const k = clamp(stepYears / 170000, 0, 0.014);
      const epoch = Math.floor(years / 10000);
      for (let i = 0; i < COUNT; i += 3) {
        const targetForest = clamp(moisture[i] * temperature[i] * 1.55 - 0.16, 0, 1);
        forest[i] += (targetForest - forest[i]) * k;
        const habitability = river[i] * 0.7 + moisture[i] * 0.35 + temperature[i] * 0.2 - Math.max(0, elevation[i] - 0.7);
        if (city[i] > 0) city[i] = clamp(city[i] + (habitability - city[i]) * k * 0.3, 0, 1);
        else if (habitability > 0.82 && hash(i + epoch * 131) > 0.9995) city[i] = 0.09;
      }
    }

    function draw(now) {
      const w = canvas.width;
      const h = canvas.height;
      const data = image.data;
      data.fill(0);
      depth.fill(-Infinity);
      const scale = Math.min(w, h) * (0.27 + zoom * 0.62);
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch);
      const pointRadius = zoom > 0.78 ? 1 : 0;

      for (let i = 0; i < COUNT; i++) {
        const x0 = points[i * 3], y0 = points[i * 3 + 1], z0 = points[i * 3 + 2];
        let x = x0 * cy - z0 * sy;
        let z = x0 * sy + z0 * cy;
        let y = y0 * cx - z * sx;
        z = y0 * sx + z * cx;
        const radius = 1 + Math.max(0, elevation[i] - 0.47) * 0.075;
        x *= radius;
        y *= radius;
        z *= radius;
        if (z <= 0) continue;

        const px = Math.round(w / 2 + x * scale);
        const py = Math.round(h / 2 - y * scale);
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        const c = color(i);
        const light = clamp(0.28 - x * 0.16 + y * 0.1 + z * 0.88, 0.16, 1.22);
        writePixel(px, py, z, c, light, w, h, data, depth);
        if (pointRadius) {
          writePixel(px + 1, py, z - 0.0001, c, light * 0.86, w, h, data, depth);
          writePixel(px, py + 1, z - 0.0001, c, light * 0.86, w, h, data, depth);
        }
      }

      ctx.putImageData(image, 0, 0);

      const planetRadius = scale * 1.015;
      const gradient = ctx.createRadialGradient(w / 2 - planetRadius * 0.32, h / 2 - planetRadius * 0.28, planetRadius * 0.3, w / 2, h / 2, planetRadius * 1.08);
      gradient.addColorStop(0.78, 'rgba(30,95,150,0)');
      gradient.addColorStop(0.96, 'rgba(40,125,205,0.05)');
      gradient.addColorStop(1, 'rgba(80,175,255,0.28)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, planetRadius * 1.07, 0, Math.PI * 2);
      ctx.fill();

      const ccy = Math.cos(yaw + cloudSpin), csy = Math.sin(yaw + cloudSpin);
      ctx.globalAlpha = 0.14 + Math.sin(now * 0.0002) * 0.035;
      ctx.fillStyle = '#e8f7ff';
      for (let i = 0; i < COUNT; i += 2) {
        if (!cloud[i]) continue;
        const x0 = points[i * 3], y0 = points[i * 3 + 1], z0 = points[i * 3 + 2];
        let x = x0 * ccy - z0 * csy;
        let z = x0 * csy + z0 * ccy;
        const y = y0 * cx - z * sx;
        z = y0 * sx + z * cx;
        if (z <= 0) continue;
        const px = w / 2 + x * scale * 1.035;
        const py = h / 2 - y * scale * 1.035;
        ctx.fillRect(px, py, zoom > 0.7 ? 1.5 : 1, zoom > 0.7 ? 1.5 : 1);
      }
      ctx.globalAlpha = 1;
    }

    function writePixel(px, py, z, c, light, w, h, data, depthBuffer) {
      if (px < 0 || py < 0 || px >= w || py >= h) return;
      const di = py * w + px;
      if (z <= depthBuffer[di]) return;
      depthBuffer[di] = z;
      const p = di * 4;
      data[p] = Math.min(255, c[0] * light);
      data[p + 1] = Math.min(255, c[1] * light);
      data[p + 2] = Math.min(255, c[2] * light);
      data[p + 3] = 255;
    }

    function color(i) {
      if (elevation[i] < 0.47) {
        const depthShade = clamp((0.47 - elevation[i]) * 2.5, 0, 1);
        return [8, 52 + depthShade * 14, 92 + depthShade * 34];
      }
      if (temperature[i] < 0.14 || elevation[i] > 0.84) return [220, 232, 240];
      if (river[i] > 0.68) return [22, 132, 196];
      if (city[i] > 0.08) return [245, 158 + city[i] * 35, 48];
      if (moisture[i] < 0.22) return [165, 126, 58];
      const f = forest[i];
      return [42 + (1 - f) * 42, 82 + f * 90, 38 + f * 30];
    }

    function distance() {
      const a = [...touches.values()];
      return a.length < 2 ? 0 : Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]);
    }

    function updateSpeed() {
      const r = timeRate(Number(speedInput.value));
      speedLabel.value = r ? `${compact(r)} yr/s` : 'paused';
    }
  } catch (error) {
    status.textContent = `Unable to start: ${error.message}`;
    status.classList.add('error');
  }

  function timeRate(v) { return v < 0.05 ? 0 : Math.pow(10, v); }
  function compact(v) { return v < 1000 ? Math.round(v).toLocaleString() : v < 1e6 ? `${(v / 1000).toFixed(v < 10000 ? 1 : 0)}k` : `${(v / 1e6).toFixed(1)}M`; }
  function formatYears(v) { return v < 1000 ? `${Math.floor(v).toLocaleString()} years` : v < 1e6 ? `${(v / 1000).toFixed(1)} thousand years` : `${(v / 1e6).toFixed(2)} million years`; }
  function hash(v) { let h = Math.imul(v ^ 0x9e3779b9, 2654435761); h ^= h >>> 16; return (h >>> 0) / 4294967295; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
})();
