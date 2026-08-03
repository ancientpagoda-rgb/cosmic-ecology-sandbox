import * as THREE from 'three';

const app = document.getElementById('app');
const status = document.getElementById('status');
const yearEl = document.getElementById('year');
const speedInput = document.getElementById('timeSpeed');
const speedLabel = document.getElementById('speedLabel');

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x02060b, 1);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.001, 1000);
camera.position.set(0, 0.22, 3.4);

const world = new THREE.Group();
scene.add(world);

const GRID_W = 192;
const GRID_H = 96;
const CELL_COUNT = GRID_W * GRID_H;
const SEA = 0.47;
const cells = createWorldGrid();
const downstream = new Int32Array(CELL_COUNT);
const flow = new Float32Array(CELL_COUNT);
const forest = new Float32Array(CELL_COUNT);
const city = new Float32Array(CELL_COUNT);
computeDrainage();
seedEcologyAndCities();

const surfaceCount = /iPhone|iPad|iPod/i.test(navigator.userAgent) ? 90000 : 180000;
const surface = createSurfacePoints(surfaceCount);
world.add(surface.points);
const clouds = createCloudPoints(/iPhone|iPad|iPod/i.test(navigator.userAgent) ? 18000 : 42000);
world.add(clouds.points);
const atmosphere = createAtmosphere();
world.add(atmosphere);

let worldYears = 0;
let targetDistance = 3.4;
let cameraDistance = 3.4;
let yaw = 0.45;
let pitch = -0.12;
let dragging = false;
let pointerId = null;
let lastX = 0;
let lastY = 0;
let lastFrame = performance.now();
let fieldAccumulator = 0;
const pointers = new Map();
let pinchDistance = 0;
let pinchStartDistance = targetDistance;

renderer.domElement.addEventListener('pointerdown', event => {
  pointers.set(event.pointerId, [event.clientX, event.clientY]);
  renderer.domElement.setPointerCapture?.(event.pointerId);
  if (pointers.size === 1) {
    dragging = true;
    pointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
  } else if (pointers.size === 2) {
    dragging = false;
    pointerId = null;
    pinchDistance = getPinchDistance();
    pinchStartDistance = targetDistance;
  }
});

renderer.domElement.addEventListener('pointermove', event => {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, [event.clientX, event.clientY]);
  if (pointers.size >= 2) {
    const next = getPinchDistance();
    if (pinchDistance > 0) targetDistance = clamp(pinchStartDistance * pinchDistance / Math.max(1, next), 1.025, 9);
    return;
  }
  if (!dragging || event.pointerId !== pointerId) return;
  yaw += (event.clientX - lastX) * 0.006;
  pitch = clamp(pitch + (event.clientY - lastY) * 0.006, -1.45, 1.45);
  lastX = event.clientX;
  lastY = event.clientY;
});

function releasePointer(event) {
  pointers.delete(event.pointerId);
  if (!pointers.size) {
    dragging = false;
    pointerId = null;
  }
  if (pointers.size < 2) pinchDistance = 0;
}
renderer.domElement.addEventListener('pointerup', releasePointer);
renderer.domElement.addEventListener('pointercancel', releasePointer);
renderer.domElement.addEventListener('lostpointercapture', releasePointer);
renderer.domElement.addEventListener('wheel', event => {
  event.preventDefault();
  targetDistance = clamp(targetDistance * Math.exp(event.deltaY * 0.001), 1.025, 9);
}, { passive: false });

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

speedInput.addEventListener('input', updateSpeedLabel);
updateSpeedLabel();
status.remove();
requestAnimationFrame(frame);

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.08, (now - lastFrame) / 1000);
  lastFrame = now;

  if (!dragging && pointers.size < 2) yaw += dt * 0.035;
  cameraDistance += (targetDistance - cameraDistance) * Math.min(1, dt * 8);
  const cp = Math.cos(pitch);
  camera.position.set(Math.sin(yaw) * cp * cameraDistance, Math.sin(pitch) * cameraDistance, Math.cos(yaw) * cp * cameraDistance);
  camera.lookAt(0, 0, 0);

  const yearsPerSecond = timeRate(Number(speedInput.value));
  worldYears += yearsPerSecond * dt;
  fieldAccumulator += yearsPerSecond * dt;
  while (fieldAccumulator >= 250) {
    simulateWorld(Math.min(fieldAccumulator, 5000));
    fieldAccumulator -= Math.min(fieldAccumulator, 5000);
  }

  clouds.points.rotation.y += dt * 0.018;
  clouds.points.rotation.x = Math.sin(now * 0.00005) * 0.03;
  updateCloudOpacity(now, clouds);

  yearEl.textContent = formatYears(worldYears);
  renderer.render(scene, camera);
}

function createWorldGrid() {
  const data = new Array(CELL_COUNT);
  for (let y = 0; y < GRID_H; y++) {
    const lat = Math.PI / 2 - ((y + 0.5) / GRID_H) * Math.PI;
    for (let x = 0; x < GRID_W; x++) {
      const lon = ((x + 0.5) / GRID_W) * Math.PI * 2 - Math.PI;
      const p = spherePoint(lat, lon);
      const continental = fbm(p.x * 1.7, p.y * 1.7, p.z * 1.7, 11);
      const ridge = 1 - Math.abs(fbm(p.x * 5.4 + 2, p.y * 5.4 - 3, p.z * 5.4 + 7, 29) * 2 - 1);
      const elevation = clamp(continental * 0.73 + ridge * 0.24, 0, 1);
      const temperature = clamp(0.93 - Math.abs(Math.sin(lat)) * 0.82 - Math.max(0, elevation - 0.62) * 0.75, 0, 1);
      const moisture = clamp(0.24 + fbm(p.x * 3.1 - 4, p.y * 3.1 + 9, p.z * 3.1 - 2, 43) * 0.84, 0, 1);
      data[index(x, y)] = { x, y, lat, lon, p, elevation, temperature, moisture };
    }
  }
  return data;
}

function computeDrainage() {
  const order = Array.from({ length: CELL_COUNT }, (_, i) => i).sort((a, b) => cells[b].elevation - cells[a].elevation);
  flow.fill(1);
  for (const i of order) {
    const c = cells[i];
    if (c.elevation < SEA) { downstream[i] = -1; continue; }
    let best = -1;
    let bestElevation = c.elevation;
    for (const n of neighbors(c.x, c.y)) {
      if (cells[n].elevation < bestElevation) { best = n; bestElevation = cells[n].elevation; }
    }
    downstream[i] = best;
    if (best >= 0) flow[best] += flow[i];
  }
  let maxFlow = 1;
  for (const value of flow) maxFlow = Math.max(maxFlow, value);
  for (let i = 0; i < flow.length; i++) flow[i] = Math.log1p(flow[i]) / Math.log1p(maxFlow);
}

function seedEcologyAndCities() {
  for (let i = 0; i < CELL_COUNT; i++) {
    const c = cells[i];
    if (c.elevation < SEA) continue;
    forest[i] = clamp(c.moisture * c.temperature * 1.45 - 0.22, 0, 1);
    const coast = neighbors(c.x, c.y).some(n => cells[n].elevation < SEA) ? 1 : 0;
    const suitability = flow[i] * 1.2 + coast * 0.65 + c.moisture * 0.35 + c.temperature * 0.2 - Math.max(0, c.elevation - 0.72) * 2;
    if (suitability > 1.05 && hash01(i * 97 + 5) > 0.992) city[i] = 0.15 + suitability * 0.08;
  }
}

function simulateWorld(years) {
  const forestNext = new Float32Array(forest);
  const cityNext = new Float32Array(city);
  const forestRate = clamp(years / 25000, 0, 0.25);
  const cityRate = clamp(years / 12000, 0, 0.35);

  for (let i = 0; i < CELL_COUNT; i++) {
    const c = cells[i];
    if (c.elevation < SEA) continue;
    const ns = neighbors(c.x, c.y);
    const nearbyForest = ns.reduce((sum, n) => sum + forest[n], 0) / ns.length;
    const carrying = clamp(c.moisture * c.temperature * 1.55 - 0.15, 0, 1);
    forestNext[i] = clamp(forest[i] + (carrying - forest[i]) * forestRate + nearbyForest * forestRate * 0.12, 0, 1);

    const coast = ns.some(n => cells[n].elevation < SEA) ? 1 : 0;
    const nearbyCity = ns.reduce((sum, n) => sum + city[n], 0) / ns.length;
    const suitability = clamp(flow[i] * 1.2 + coast * 0.55 + c.moisture * 0.25 + nearbyCity * 0.6 - Math.max(0, c.elevation - 0.7), 0, 1.8);
    if (city[i] > 0 || nearbyCity > 0.03) cityNext[i] = clamp(city[i] + (suitability * 0.48 - city[i]) * cityRate + nearbyCity * cityRate * 0.18, 0, 1);
    else if (suitability > 1.0 && hash01(i + Math.floor(worldYears / 5000)) > 0.9994) cityNext[i] = 0.08;
  }

  forest.set(forestNext);
  city.set(cityNext);
  updateSurfaceColors(surface);
}

function createSurfacePoints(count) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const gridIndex = new Uint32Array(count);
  const golden = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const x = Math.cos(theta) * ring;
    const z = Math.sin(theta) * ring;
    const lat = Math.asin(y);
    const lon = Math.atan2(z, x);
    const gi = gridFor(lat, lon);
    gridIndex[i] = gi;
    const c = cells[gi];
    const radius = 1 + Math.max(0, c.elevation - SEA) * 0.075;
    positions[i * 3] = x * radius;
    positions[i * 3 + 1] = y * radius;
    positions[i * 3 + 2] = z * radius;
    setPointColor(colors, i, worldColor(gi));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ size: 0.0065, vertexColors: true, sizeAttenuation: true, transparent: false, depthWrite: true });
  const points = new THREE.Points(geometry, material);
  return { points, geometry, colors, gridIndex };
}

function updateSurfaceColors(surfaceData) {
  for (let i = 0; i < surfaceData.gridIndex.length; i++) setPointColor(surfaceData.colors, i, worldColor(surfaceData.gridIndex[i]));
  surfaceData.geometry.attributes.color.needsUpdate = true;
}

function worldColor(i) {
  const c = cells[i];
  if (c.elevation < SEA) {
    const depth = clamp((SEA - c.elevation) / SEA, 0, 1);
    return [0.03 + depth * 0.01, 0.18 + depth * 0.07, 0.31 + depth * 0.1];
  }
  if (c.temperature < 0.13 || c.elevation > 0.86) return [0.82, 0.88, 0.92];
  if (flow[i] > 0.46) return [0.08, 0.43, 0.66];
  if (city[i] > 0.08) {
    const glow = clamp(city[i], 0, 1);
    return [0.72 + glow * 0.28, 0.47 + glow * 0.31, 0.18 + glow * 0.18];
  }
  if (c.moisture < 0.22) return [0.63, 0.49, 0.22];
  const f = forest[i];
  return [0.18 + (1 - f) * 0.18, 0.34 + f * 0.32, 0.16 + f * 0.12];
}

function createCloudPoints(count) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const alpha = new Float32Array(count);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    const density = fbm(x * 5 + 5, y * 5 - 3, z * 5 + 8, 67);
    const visible = density > 0.57 ? 1 : 0;
    positions[i * 3] = x * 1.035;
    positions[i * 3 + 1] = y * 1.035;
    positions[i * 3 + 2] = z * 1.035;
    colors[i * 3] = visible;
    colors[i * 3 + 1] = visible;
    colors[i * 3 + 2] = visible;
    alpha[i] = visible;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ size: 0.009, vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(geometry, material);
  return { points, geometry, material, alpha };
}

function updateCloudOpacity(now, cloudData) {
  cloudData.material.opacity = 0.34 + Math.sin(now * 0.00017) * 0.08;
}

function createAtmosphere() {
  const geometry = new THREE.SphereGeometry(1.055, 64, 32);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexShader: `varying vec3 vNormal;void main(){vNormal=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: `varying vec3 vNormal;void main(){float intensity=pow(0.72-dot(vNormal,vec3(0.0,0.0,1.0)),3.0);gl_FragColor=vec4(0.12,0.45,0.95,1.0)*intensity;}`,
  });
  return new THREE.Mesh(geometry, material);
}

function neighbors(x, y) {
  const result = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (dx === 0 && dy === 0) continue;
    const nx = (x + dx + GRID_W) % GRID_W;
    const ny = y + dy;
    if (ny >= 0 && ny < GRID_H) result.push(index(nx, ny));
  }
  return result;
}

function gridFor(lat, lon) {
  const x = Math.floor(((lon + Math.PI) / (Math.PI * 2)) * GRID_W + GRID_W) % GRID_W;
  const y = clamp(Math.floor(((Math.PI / 2 - lat) / Math.PI) * GRID_H), 0, GRID_H - 1);
  return index(x, y);
}

function spherePoint(lat, lon) {
  const c = Math.cos(lat);
  return { x: c * Math.cos(lon), y: Math.sin(lat), z: c * Math.sin(lon) };
}

function fbm(x, y, z, seed) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let octave = 0; octave < 5; octave++) {
    value += smoothNoise(x * frequency, y * frequency, z * frequency, seed + octave * 31) * amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value;
}

function smoothNoise(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const tx = fade(x - xi), ty = fade(y - yi), tz = fade(z - zi);
  const c000 = hash3(xi, yi, zi, seed), c100 = hash3(xi + 1, yi, zi, seed);
  const c010 = hash3(xi, yi + 1, zi, seed), c110 = hash3(xi + 1, yi + 1, zi, seed);
  const c001 = hash3(xi, yi, zi + 1, seed), c101 = hash3(xi + 1, yi, zi + 1, seed);
  const c011 = hash3(xi, yi + 1, zi + 1, seed), c111 = hash3(xi + 1, yi + 1, zi + 1, seed);
  const x00 = lerp(c000, c100, tx), x10 = lerp(c010, c110, tx), x01 = lerp(c001, c101, tx), x11 = lerp(c011, c111, tx);
  return lerp(lerp(x00, x10, ty), lerp(x01, x11, ty), tz);
}

function hash3(x, y, z, seed) {
  let h = Math.imul(x ^ seed, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function hash01(value) {
  let h = Math.imul(value ^ 0x9e3779b9, 2654435761);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function setPointColor(array, i, color) {
  array[i * 3] = color[0];
  array[i * 3 + 1] = color[1];
  array[i * 3 + 2] = color[2];
}

function getPinchDistance() {
  const values = [...pointers.values()];
  return values.length < 2 ? 0 : Math.hypot(values[0][0] - values[1][0], values[0][1] - values[1][1]);
}

function timeRate(value) {
  if (value < 0.05) return 0;
  return Math.pow(10, value);
}

function updateSpeedLabel() {
  const rate = timeRate(Number(speedInput.value));
  speedLabel.value = rate === 0 ? 'paused' : `${formatCompact(rate)} yr/s`;
}

function formatYears(value) {
  if (value < 1000) return `${Math.floor(value).toLocaleString()} years`;
  if (value < 1e6) return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} thousand years`;
  if (value < 1e9) return `${(value / 1e6).toFixed(value < 1e7 ? 2 : 1)} million years`;
  return `${(value / 1e9).toFixed(2)} billion years`;
}

function formatCompact(value) {
  if (value < 1000) return Math.round(value).toLocaleString();
  if (value < 1e6) return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}k`;
  return `${(value / 1e6).toFixed(value < 1e7 ? 1 : 0)}M`;
}

function index(x, y) { return y * GRID_W + x; }
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const fade = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

window.realitySandbox = { cells, flow, forest, city, surface, clouds };
