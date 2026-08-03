const canvas = document.getElementById('planet');
const ctx = canvas.getContext('2d', { alpha: false });
const ui = Object.fromEntries(['zoom','relief','speed','lod','faces','age','rivers','cities','forest','snow','desert','hexes','nodes'].map(id => [id, document.getElementById(id)]));

const pointSets = new Map([
  [0, createPointPlanet(32000)],
  [1, createPointPlanet(82000)],
  [2, createPointPlanet(170000)],
]);

let rx = -0.18;
let ry = 0.5;
let pointer = null;
let lastX = 0;
let lastY = 0;
let last = performance.now();
let worldAge = 0;
let accumulator = 0;

canvas.addEventListener('pointerdown', event => {
  pointer = event.pointerId;
  lastX = event.clientX;
  lastY = event.clientY;
  canvas.setPointerCapture?.(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (event.pointerId !== pointer) return;
  ry += (event.clientX - lastX) * 0.009;
  rx += (event.clientY - lastY) * 0.009;
  rx = Math.max(-1.35, Math.min(1.35, rx));
  lastX = event.clientX;
  lastY = event.clientY;
});
canvas.addEventListener('pointerup', event => { if (event.pointerId === pointer) pointer = null; });
canvas.addEventListener('pointercancel', () => { pointer = null; });

function createPointPlanet(count) {
  const points = new Float32Array(count * 3);
  const elevation = new Float32Array(count);
  const moisture = new Float32Array(count);
  const temperature = new Float32Array(count);
  const vegetation = new Float32Array(count);
  const river = new Float32Array(count);
  const city = new Uint8Array(count);
  const golden = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;
    points[i * 3] = x;
    points[i * 3 + 1] = y;
    points[i * 3 + 2] = z;

    const continents = fbm(x * 2.2, y * 2.2, z * 2.2, 7);
    const ridges = Math.abs(fbm(x * 6 + 4, y * 6 - 3, z * 6 + 2, 19) - 0.5);
    elevation[i] = clamp(continents * 0.78 + ridges * 0.42, 0, 1);
    temperature[i] = clamp(0.82 - Math.abs(y) * 0.72 - Math.max(0, elevation[i] - 0.58) * 0.72, 0, 1);
    moisture[i] = clamp(fbm(x * 4 - 8, y * 4 + 5, z * 4 + 3, 31) * 0.92, 0, 1);
    vegetation[i] = clamp(moisture[i] * temperature[i] * 1.55 - 0.14, 0, 1);
    river[i] = riverField(x, y, z, elevation[i], moisture[i]);
    city[i] = elevation[i] > 0.48 && elevation[i] < 0.66 && moisture[i] > 0.55 && river[i] > 0.58 && hash01(i, 91) > 0.995 ? 1 : 0;
  }

  return { count, points, elevation, moisture, temperature, vegetation, river, city };
}

function chooseLod() {
  const zoom = Number(ui.zoom.value);
  return zoom > 0.68 ? 2 : zoom > 0.28 ? 1 : 0;
}

function rotate(x0, y0, z0, radius) {
  const cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx);
  let x = x0 * cy - z0 * sy;
  let z = x0 * sy + z0 * cy;
  let y = y0;
  const y2 = y * cx - z * sx;
  const z2 = y * sx + z * cx;
  return [x * radius, y2 * radius, z2 * radius];
}

function pointColor(set, i) {
  const elevation = set.elevation[i];
  const temperature = set.temperature[i];
  const moisture = set.moisture[i];
  const vegetation = set.vegetation[i];
  const river = set.river[i];
  if (elevation < 0.46) return [20, 64, 98];
  if (temperature < 0.16 || elevation > 0.84) return [226, 232, 235];
  if (river > 0.74) return [38, 132, 177];
  if (set.city[i]) return [241, 195, 100];
  if (moisture < 0.22) return [181, 148, 80];
  if (vegetation > 0.62) return [44, 112, 61];
  if (vegetation > 0.28) return [82, 128, 72];
  return [108, 106, 80];
}

function simulate(set, years) {
  const climatePulse = Math.sin(worldAge * 0.0008) * 0.015;
  const sampleStride = Math.max(1, Math.floor(set.count / 45000));
  for (let i = 0; i < set.count; i += sampleStride) {
    const targetVegetation = clamp(set.moisture[i] * (set.temperature[i] + climatePulse) * 1.55 - 0.14, 0, 1);
    set.vegetation[i] += (targetVegetation - set.vegetation[i]) * Math.min(1, years * 0.008);
  }
}

function render() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  ctx.fillStyle = '#050b12';
  ctx.fillRect(0, 0, width, height);

  const lod = chooseLod();
  const set = pointSets.get(lod);
  const relief = Number(ui.relief.value);
  const zoom = Number(ui.zoom.value);
  const scale = Math.min(width, height) * (0.34 + zoom * 0.14);
  const image = ctx.createImageData(width, height);
  const data = image.data;
  let rendered = 0;

  for (let i = 0; i < set.count; i++) {
    const x0 = set.points[i * 3];
    const y0 = set.points[i * 3 + 1];
    const z0 = set.points[i * 3 + 2];
    const radius = 1 + (set.elevation[i] - 0.46) * 0.16 * relief;
    const [x, y, z] = rotate(x0, y0, z0, radius);
    if (z <= 0) continue;

    const px = Math.round(width / 2 + x * scale);
    const py = Math.round(height / 2 - y * scale);
    if (px < 0 || px >= width || py < 0 || py >= height) continue;

    const color = pointColor(set, i);
    const light = Math.max(0.18, Math.min(1.18, 0.33 - x * 0.18 + y * 0.12 + z * 0.82));
    const index = (py * width + px) * 4;
    data[index] = Math.min(255, Math.round(color[0] * light));
    data[index + 1] = Math.min(255, Math.round(color[1] * light));
    data[index + 2] = Math.min(255, Math.round(color[2] * light));
    data[index + 3] = 255;
    rendered++;
  }

  ctx.putImageData(image, 0, 0);
  const radius = scale * 1.03;
  const glow = ctx.createRadialGradient(width / 2 - radius * 0.28, height / 2 - radius * 0.32, radius * 0.2, width / 2, height / 2, radius * 1.08);
  glow.addColorStop(0, 'rgba(255,255,255,0)');
  glow.addColorStop(0.88, 'rgba(45,110,160,0.015)');
  glow.addColorStop(1, 'rgba(70,145,205,0.26)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, radius * 1.04, 0, Math.PI * 2);
  ctx.fill();

  ui.lod.textContent = `Point level ${lod + 1}`;
  ui.faces.textContent = rendered.toLocaleString();
}

function updateStats() {
  const set = pointSets.get(chooseLod());
  ui.age.textContent = `${Math.round(worldAge).toLocaleString()} yr`;
  ui.rivers.textContent = countAbove(set.river, 0.74);
  ui.cities.textContent = set.city.reduce((sum, value) => sum + value, 0);
  ui.forest.textContent = `${Math.round(average(set.vegetation) * 100)}%`;
  ui.snow.textContent = countSnow(set);
  ui.desert.textContent = countDesert(set);
  ui.hexes.textContent = 'none';
  ui.nodes.textContent = 'none';
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  accumulator += dt * Number(ui.speed.value);
  while (accumulator >= 0.22) {
    worldAge += 20;
    for (const set of pointSets.values()) simulate(set, 20);
    accumulator -= 0.22;
  }
  render();
  updateStats();
}

function fbm(x, y, z, seed) {
  let value = 0, amplitude = 0.5, frequency = 1;
  for (let octave = 0; octave < 5; octave++) {
    value += smoothNoise(x * frequency, y * frequency, z * frequency, seed + octave * 17) * amplitude;
    frequency *= 2;
    amplitude *= 0.5;
  }
  return value;
}

function smoothNoise(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const tx = fade(x - xi), ty = fade(y - yi), tz = fade(z - zi);
  const values = [];
  for (let dz = 0; dz <= 1; dz++) for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) values.push(hash3(xi + dx, yi + dy, zi + dz, seed));
  const x00 = lerp(values[0], values[1], tx), x10 = lerp(values[2], values[3], tx);
  const x01 = lerp(values[4], values[5], tx), x11 = lerp(values[6], values[7], tx);
  return lerp(lerp(x00, x10, ty), lerp(x01, x11, ty), tz);
}

function riverField(x, y, z, elevation, moisture) {
  const drainage = 1 - Math.abs(fbm(x * 9 + 2, y * 9 - 4, z * 9 + 5, 73) - 0.5) * 2;
  return clamp(drainage * moisture * Math.max(0, elevation - 0.44) * 3.2, 0, 1);
}
function hash3(x, y, z, seed) { let h = Math.imul(x ^ seed, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647); h = Math.imul(h ^ h >>> 13, 1274126177); return ((h ^ h >>> 16) >>> 0) / 4294967295; }
function hash01(index, seed) { let h = Math.imul(index ^ seed, 2654435761); h ^= h >>> 16; return (h >>> 0) / 4294967295; }
function countAbove(array, threshold) { let count = 0; for (const value of array) if (value > threshold) count++; return count; }
function countSnow(set) { let count = 0; for (let i = 0; i < set.count; i++) if (set.temperature[i] < 0.16 || set.elevation[i] > 0.84) count++; return count; }
function countDesert(set) { let count = 0; for (let i = 0; i < set.count; i++) if (set.elevation[i] >= 0.46 && set.moisture[i] < 0.22) count++; return count; }
function average(array) { let sum = 0; for (const value of array) sum += value; return sum / array.length; }
const fade = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

window.realitySandboxPointPlanet = { pointSets };
requestAnimationFrame(frame);
