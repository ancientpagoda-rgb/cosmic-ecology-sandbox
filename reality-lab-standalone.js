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

    const COUNT = 24000;
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
      const e = clamp(0.5 + Math.sin(x * 5.1 + z * 2.2) * 0.17 + Math.sin(y * 7.3 - x * 3.4) * 0.13 + Math.abs(Math.sin(x * 14 + y * 9 - z * 11)) * 0.18, 0, 1);
      elevation[i] = e;
      temperature[i] = clamp(0.9 - Math.abs(y) * 0.8 - Math.max(0, e - 0.62) * 0.7, 0, 1);
      moisture[i] = clamp(0.48 + Math.sin(z * 6.2 - x * 2.6) * 0.24 + Math.sin(y * 10.7 + z * 4.1) * 0.16, 0, 1);
      forest[i] = clamp(moisture[i] * temperature[i] * 1.5 - 0.2, 0, 1);
      river[i] = clamp((1 - Math.abs(Math.sin(x * 22 + y * 13 - z * 17))) * moisture[i] * Math.max(0, e - 0.44) * 2.8, 0, 1);
      city[i] = e > 0.48 && e < 0.66 && river[i] > 0.76 && moisture[i] > 0.52 && hash(i) > 0.996 ? 0.25 : 0;
      cloud[i] = Math.sin(x * 13 + y * 7 - z * 9) + Math.sin(x * 5 - y * 11 + z * 4) > 0.8 ? 1 : 0;
    }

    let yaw = 0.45, pitch = -0.1, zoom = 0.56, years = 0, last = performance.now();
    let pointer = null, lastX = 0, lastY = 0;
    const touches = new Map();
    let pinchStart = 0, zoomStart = zoom;

    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 1.15);
      const w = Math.max(1, Math.floor(innerWidth * dpr));
      const h = Math.max(1, Math.floor(innerHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }
    addEventListener('resize', resize);
    resize();

    canvas.addEventListener('pointerdown', e => {
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (touches.size === 1) { pointer = e.pointerId; lastX = e.clientX; lastY = e.clientY; }
      else { pointer = null; pinchStart = distance(); zoomStart = zoom; }
      canvas.setPointerCapture?.(e.pointerId);
    });
    canvas.addEventListener('pointermove', e => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (touches.size >= 2) { zoom = clamp(zoomStart + (distance() - pinchStart) / 260, 0, 1); return; }
      if (e.pointerId !== pointer) return;
      yaw += (e.clientX - lastX) * 0.009;
      pitch = clamp(pitch + (e.clientY - lastY) * 0.009, -1.35, 1.35);
      lastX = e.clientX; lastY = e.clientY;
    });
    const release = e => { touches.delete(e.pointerId); if (!touches.size) pointer = null; if (touches.size < 2) pinchStart = 0; };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('wheel', e => { e.preventDefault(); zoom = clamp(zoom - e.deltaY * 0.0012, 0, 1); }, { passive: false });

    speedInput.addEventListener('input', updateSpeed);
    updateSpeed();
    status.remove();
    requestAnimationFrame(frame);

    function frame(now) {
      requestAnimationFrame(frame);
      const dt = Math.min(0.08, (now - last) / 1000);
      last = now;
      if (pointer === null && touches.size < 2) yaw += dt * 0.03;
      const rate = timeRate(Number(speedInput.value));
      years += rate * dt;
      evolve(rate * dt);
      draw(now);
      yearEl.textContent = formatYears(years);
    }

    function evolve(stepYears) {
      const k = clamp(stepYears / 200000, 0, 0.01);
      for (let i = 0; i < COUNT; i += 5) {
        const target = clamp(moisture[i] * temperature[i] * 1.5 - 0.18, 0, 1);
        forest[i] += (target - forest[i]) * k;
        if (city[i] > 0) city[i] = clamp(city[i] + (river[i] + moisture[i] - city[i]) * k * 0.2, 0, 1);
      }
    }

    function draw(now) {
      const w = canvas.width, h = canvas.height;
      ctx.fillStyle = '#02060b'; ctx.fillRect(0, 0, w, h);
      const image = ctx.createImageData(w, h);
      const data = image.data;
      const depth = new Float32Array(w * h); depth.fill(-Infinity);
      const scale = Math.min(w, h) * (0.28 + zoom * 0.58);
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch);
      for (let i = 0; i < COUNT; i++) {
        const x0 = points[i * 3], y0 = points[i * 3 + 1], z0 = points[i * 3 + 2];
        let x = x0 * cy - z0 * sy, z = x0 * sy + z0 * cy;
        let y = y0 * cx - z * sx; z = y0 * sx + z * cx;
        const radius = 1 + Math.max(0, elevation[i] - 0.47) * 0.07;
        x *= radius; y *= radius; z *= radius;
        if (z <= 0) continue;
        const px = Math.round(w / 2 + x * scale), py = Math.round(h / 2 - y * scale);
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        const di = py * w + px;
        if (z <= depth[di]) continue;
        depth[di] = z;
        const c = color(i);
        const light = clamp(0.3 - x * 0.14 + y * 0.1 + z * 0.85, 0.18, 1.2);
        const p = di * 4;
        data[p] = Math.min(255, c[0] * light);
        data[p + 1] = Math.min(255, c[1] * light);
        data[p + 2] = Math.min(255, c[2] * light);
        data[p + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
      ctx.globalAlpha = 0.18 + Math.sin(now * 0.0002) * 0.05;
      ctx.fillStyle = '#dff4ff';
      for (let i = 0; i < COUNT; i += 3) {
        if (!cloud[i]) continue;
        const x0 = points[i * 3], y0 = points[i * 3 + 1], z0 = points[i * 3 + 2];
        let x = x0 * cy - z0 * sy, z = x0 * sy + z0 * cy;
        let y = y0 * cx - z * sx; z = y0 * sx + z * cx;
        if (z <= 0) continue;
        const px = w / 2 + x * scale * 1.035, py = h / 2 - y * scale * 1.035;
        ctx.fillRect(px, py, 1, 1);
      }
      ctx.globalAlpha = 1;
    }

    function color(i) {
      if (elevation[i] < 0.47) return [10, 58, 104];
      if (temperature[i] < 0.14 || elevation[i] > 0.84) return [220, 232, 240];
      if (river[i] > 0.74) return [25, 130, 190];
      if (city[i] > 0.08) return [245, 160, 52];
      if (moisture[i] < 0.22) return [165, 126, 58];
      const f = forest[i];
      return [45 + (1 - f) * 42, 85 + f * 82, 40 + f * 28];
    }

    function distance() { const a = [...touches.values()]; return a.length < 2 ? 0 : Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]); }
    function updateSpeed() { const r = timeRate(Number(speedInput.value)); speedLabel.value = r ? `${compact(r)} yr/s` : 'paused'; }
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
