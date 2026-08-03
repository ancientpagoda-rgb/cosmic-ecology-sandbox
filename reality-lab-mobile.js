import * as THREE from 'three';

const app = document.getElementById('app');
const status = document.getElementById('status');
const yearEl = document.getElementById('year');
const speedInput = document.getElementById('timeSpeed');
const speedLabel = document.getElementById('speedLabel');

window.addEventListener('error', event => showError(event.error?.message || event.message));
window.addEventListener('unhandledrejection', event => showError(event.reason?.message || String(event.reason)));

start().catch(error => showError(error.message));

async function start() {
  status.textContent = 'Starting renderer…';
  await breathe();

  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.15));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x02060b, 1);
  app.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.01, 100);
  camera.position.set(0, 0.15, 3.25);
  const world = new THREE.Group();
  scene.add(world);

  status.textContent = 'Generating terrain…';
  await breathe();
  const grid = createGrid(112, 56);
  computeFlow(grid);
  seedLife(grid);

  status.textContent = 'Building planet points…';
  await breathe();
  const surface = createSurface(grid, 42000);
  world.add(surface.points);

  status.textContent = 'Forming clouds…';
  await breathe();
  const clouds = createClouds(6500);
  world.add(clouds.points);
  world.add(createAtmosphere());

  let years = 0;
  let targetDistance = 3.25;
  let distance = 3.25;
  let yaw = 0.4;
  let pitch = -0.1;
  let last = performance.now();
  let accumulator = 0;
  let dragging = false;
  let activePointer = null;
  let lastX = 0;
  let lastY = 0;
  const pointers = new Map();
  let pinchStart = 0;
  let pinchCameraStart = targetDistance;

  renderer.domElement.addEventListener('pointerdown', event => {
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    renderer.domElement.setPointerCapture?.(event.pointerId);
    if (pointers.size === 1) {
      dragging = true;
      activePointer = event.pointerId;
      lastX = event.clientX;
      lastY = event.clientY;
    } else {
      dragging = false;
      activePointer = null;
      pinchStart = pinchDistance(pointers);
      pinchCameraStart = targetDistance;
    }
  });

  renderer.domElement.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    if (pointers.size >= 2) {
      const current = pinchDistance(pointers);
      targetDistance = clamp(pinchCameraStart * pinchStart / Math.max(1, current), 1.03, 8);
      return;
    }
    if (!dragging || event.pointerId !== activePointer) return;
    yaw += (event.clientX - lastX) * 0.006;
    pitch = clamp(pitch + (event.clientY - lastY) * 0.006, -1.42, 1.42);
    lastX = event.clientX;
    lastY = event.clientY;
  });

  const release = event => {
    pointers.delete(event.pointerId);
    if (!pointers.size) { dragging = false; activePointer = null; }
    if (pointers.size < 2) pinchStart = 0;
  };
  renderer.domElement.addEventListener('pointerup', release);
  renderer.domElement.addEventListener('pointercancel', release);
  renderer.domElement.addEventListener('lostpointercapture', release);
  renderer.domElement.addEventListener('wheel', event => {
    event.preventDefault();
    targetDistance = clamp(targetDistance * Math.exp(event.deltaY * 0.001), 1.03, 8);
  }, { passive: false });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  speedInput.addEventListener('input', updateSpeedLabel);
  updateSpeedLabel();
  status.remove();

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.08, (now - last) / 1000);
    last = now;
    if (!dragging && pointers.size < 2) yaw += dt * 0.03;
    distance += (targetDistance - distance) * Math.min(1, dt * 8);
    const cp = Math.cos(pitch);
    camera.position.set(Math.sin(yaw) * cp * distance, Math.sin(pitch) * distance, Math.cos(yaw) * cp * distance);
    camera.lookAt(0, 0, 0);

    const rate = timeRate(Number(speedInput.value));
    years += rate * dt;
    accumulator += rate * dt;
    if (accumulator >= 1000) {
      evolve(grid, Math.min(accumulator, 10000));
      updateColors(surface, grid);
      accumulator = 0;
    }

    clouds.points.rotation.y += dt * 0.017;
    clouds.material.opacity = 0.3 + Math.sin(now * 0.0002) * 0.07;
    yearEl.textContent = formatYears(years);
    renderer.render(scene, camera);
  }

  requestAnimationFrame(frame);
  window.realitySandbox = { grid, surface, clouds };
}

function createGrid(width, height) {
  const count = width * height;
  const cells = new Array(count);
  const flow = new Float32Array(count);
  const forest = new Float32Array(count);
  const city = new Float32Array(count);
  const downstream = new Int32Array(count);
  for (let y = 0; y < height; y++) {
    const lat = Math.PI / 2 - ((y + 0.5) / height) * Math.PI;
    for (let x = 0; x < width; x++) {
      const lon = ((x + 0.5) / width) * Math.PI * 2 - Math.PI;
      const c = Math.cos(lat);
      const px = c * Math.cos(lon), py = Math.sin(lat), pz = c * Math.sin(lon);
      const elevation = clamp(0.48 + Math.sin(px * 5.1 + pz * 2.2) * 0.17 + Math.sin(py * 7.3 - px * 3.4) * 0.13 + Math.abs(Math.sin(px * 14 + py * 9 - pz * 11)) * 0.18, 0, 1);
      const temperature = clamp(0.9 - Math.abs(py) * 0.8 - Math.max(0, elevation - 0.62) * 0.7, 0, 1);
      const moisture = clamp(0.48 + Math.sin(pz * 6.2 - px * 2.6) * 0.24 + Math.sin(py * 10.7 + pz * 4.1) * 0.16, 0, 1);
      cells[y * width + x] = { x, y, lat, lon, elevation, temperature, moisture };
    }
  }
  return { width, height, count, cells, flow, forest, city, downstream, sea: 0.47 };
}

function computeFlow(grid) {
  const order = Array.from({ length: grid.count }, (_, i) => i).sort((a, b) => grid.cells[b].elevation - grid.cells[a].elevation);
  grid.flow.fill(1);
  for (const i of order) {
    const c = grid.cells[i];
    if (c.elevation < grid.sea) { grid.downstream[i] = -1; continue; }
    let best = -1, bestElevation = c.elevation;
    for (const n of neighbors(grid, c.x, c.y)) {
      if (grid.cells[n].elevation < bestElevation) { best = n; bestElevation = grid.cells[n].elevation; }
    }
    grid.downstream[i] = best;
    if (best >= 0) grid.flow[best] += grid.flow[i];
  }
  let max = 1;
  for (const value of grid.flow) max = Math.max(max, value);
  for (let i = 0; i < grid.count; i++) grid.flow[i] = Math.log1p(grid.flow[i]) / Math.log1p(max);
}

function seedLife(grid) {
  for (let i = 0; i < grid.count; i++) {
    const c = grid.cells[i];
    if (c.elevation < grid.sea) continue;
    grid.forest[i] = clamp(c.moisture * c.temperature * 1.5 - 0.2, 0, 1);
    const coast = neighbors(grid, c.x, c.y).some(n => grid.cells[n].elevation < grid.sea);
    const score = grid.flow[i] * 1.2 + (coast ? 0.6 : 0) + c.moisture * 0.3;
    if (score > 1.05 && hash01(i * 31) > 0.994) grid.city[i] = 0.15;
  }
}

function evolve(grid, years) {
  const nextForest = new Float32Array(grid.forest);
  const nextCity = new Float32Array(grid.city);
  const fr = clamp(years / 30000, 0, 0.2);
  const cr = clamp(years / 15000, 0, 0.3);
  for (let i = 0; i < grid.count; i++) {
    const c = grid.cells[i];
    if (c.elevation < grid.sea) continue;
    const ns = neighbors(grid, c.x, c.y);
    const nearbyForest = ns.reduce((s, n) => s + grid.forest[n], 0) / ns.length;
    const carrying = clamp(c.moisture * c.temperature * 1.5 - 0.12, 0, 1);
    nextForest[i] = clamp(grid.forest[i] + (carrying - grid.forest[i]) * fr + nearbyForest * fr * 0.08, 0, 1);
    const coast = ns.some(n => grid.cells[n].elevation < grid.sea);
    const nearbyCity = ns.reduce((s, n) => s + grid.city[n], 0) / ns.length;
    const suitability = clamp(grid.flow[i] * 1.15 + (coast ? 0.52 : 0) + c.moisture * 0.25 + nearbyCity * 0.55, 0, 1.6);
    if (grid.city[i] > 0 || nearbyCity > 0.03) nextCity[i] = clamp(grid.city[i] + (suitability * 0.45 - grid.city[i]) * cr, 0, 1);
  }
  grid.forest.set(nextForest);
  grid.city.set(nextCity);
}

function createSurface(grid, count) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const map = new Uint32Array(count);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const x = Math.cos(theta) * r, z = Math.sin(theta) * r;
    const gi = gridIndex(grid, Math.asin(y), Math.atan2(z, x));
    map[i] = gi;
    const radius = 1 + Math.max(0, grid.cells[gi].elevation - grid.sea) * 0.07;
    positions[i * 3] = x * radius; positions[i * 3 + 1] = y * radius; positions[i * 3 + 2] = z * radius;
    setColor(colors, i, worldColor(grid, gi));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ size: 0.009, vertexColors: true, sizeAttenuation: true, depthWrite: true });
  return { points: new THREE.Points(geometry, material), geometry, colors, map };
}

function updateColors(surface, grid) {
  for (let i = 0; i < surface.map.length; i++) setColor(surface.colors, i, worldColor(grid, surface.map[i]));
  surface.geometry.attributes.color.needsUpdate = true;
}

function worldColor(grid, i) {
  const c = grid.cells[i];
  if (c.elevation < grid.sea) return [0.03, 0.2, 0.36];
  if (c.temperature < 0.14 || c.elevation > 0.84) return [0.85, 0.9, 0.94];
  if (grid.flow[i] > 0.46) return [0.08, 0.48, 0.72];
  if (grid.city[i] > 0.08) return [0.95, 0.62, 0.2];
  if (c.moisture < 0.22) return [0.65, 0.5, 0.23];
  const f = grid.forest[i];
  return [0.18 + (1 - f) * 0.18, 0.34 + f * 0.32, 0.16 + f * 0.12];
}

function createClouds(count) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const x = Math.cos(theta) * r, z = Math.sin(theta) * r;
    const visible = Math.sin(x * 13 + y * 7 - z * 9) + Math.sin(x * 5 - y * 11 + z * 4) > 0.8 ? 1 : 0;
    positions[i * 3] = x * 1.035; positions[i * 3 + 1] = y * 1.035; positions[i * 3 + 2] = z * 1.035;
    colors[i * 3] = visible; colors[i * 3 + 1] = visible; colors[i * 3 + 2] = visible;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ size: 0.012, vertexColors: true, transparent: true, opacity: 0.34, depthWrite: false, blending: THREE.AdditiveBlending });
  return { points: new THREE.Points(geometry, material), material };
}

function createAtmosphere() {
  return new THREE.Mesh(new THREE.SphereGeometry(1.055, 32, 16), new THREE.MeshBasicMaterial({ color: 0x317fc7, transparent: true, opacity: 0.055, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }));
}

function neighbors(grid, x, y) {
  const result = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = (x + dx + grid.width) % grid.width;
    const ny = y + dy;
    if (ny >= 0 && ny < grid.height) result.push(ny * grid.width + nx);
  }
  return result;
}

function gridIndex(grid, lat, lon) {
  const x = Math.floor(((lon + Math.PI) / (Math.PI * 2)) * grid.width + grid.width) % grid.width;
  const y = clamp(Math.floor(((Math.PI / 2 - lat) / Math.PI) * grid.height), 0, grid.height - 1);
  return y * grid.width + x;
}

function setColor(array, i, color) { array[i * 3] = color[0]; array[i * 3 + 1] = color[1]; array[i * 3 + 2] = color[2]; }
function pinchDistance(pointers) { const values = [...pointers.values()]; return values.length < 2 ? 0 : Math.hypot(values[0][0] - values[1][0], values[0][1] - values[1][1]); }
function timeRate(value) { return value < 0.05 ? 0 : Math.pow(10, value); }
function updateSpeedLabel() { const rate = timeRate(Number(speedInput.value)); speedLabel.value = rate ? `${formatCompact(rate)} yr/s` : 'paused'; }
function formatCompact(value) { return value < 1000 ? Math.round(value).toLocaleString() : value < 1e6 ? `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}k` : `${(value / 1e6).toFixed(1)}M`; }
function formatYears(value) { return value < 1000 ? `${Math.floor(value).toLocaleString()} years` : value < 1e6 ? `${(value / 1000).toFixed(1)} thousand years` : `${(value / 1e6).toFixed(2)} million years`; }
function hash01(value) { let h = Math.imul(value ^ 0x9e3779b9, 2654435761); h ^= h >>> 16; return (h >>> 0) / 4294967295; }
function breathe() { return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0))); }
function showError(message) { status.textContent = `Unable to start: ${message}`; status.classList.add('error'); }
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
