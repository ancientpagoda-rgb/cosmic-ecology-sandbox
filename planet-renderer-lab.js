const canvas = document.getElementById('planet');
const ctx = canvas.getContext('2d', { alpha: false });
const ui = Object.fromEntries(['zoom','relief','speed','lod','faces','age','rivers','cities','forest','snow','desert','hexes','nodes'].map(id => [id, document.getElementById(id)]));

const COUNT = 52000;
const planet = createPointPlanet(COUNT);
let rx = -0.18;
let ry = 0.5;
let pointer = null;
let lastX = 0;
let lastY = 0;
let worldAge = 0;
let last = performance.now();
let accumulator = 0;
let zoom = 0.56;
const touches = new Map();
let pinchStartDistance = 0;
let pinchStartZoom = zoom;

canvas.addEventListener('pointerdown', event => {
  touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (touches.size === 1) {
    pointer = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
  } else if (touches.size === 2) {
    pinchStartDistance = touchDistance();
    pinchStartZoom = zoom;
    pointer = null;
  }
  canvas.setPointerCapture?.(event.pointerId);
});

canvas.addEventListener('pointermove', event => {
  if (!touches.has(event.pointerId)) return;
  touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (touches.size >= 2) {
    const distance = touchDistance();
    if (pinchStartDistance > 0) zoom = clamp(pinchStartZoom + (distance - pinchStartDistance) / 260, 0, 1);
    ui.zoom.value = String(zoom);
    return;
  }
  if (event.pointerId !== pointer) return;
  ry += (event.clientX - lastX) * 0.009;
  rx += (event.clientY - lastY) * 0.009;
  rx = clamp(rx, -1.35, 1.35);
  lastX = event.clientX;
  lastY = event.clientY;
});

function releasePointer(event) {
  touches.delete(event.pointerId);
  if (touches.size === 0) pointer = null;
  if (touches.size < 2) pinchStartDistance = 0;
}
canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);
canvas.addEventListener('lostpointercapture', releasePointer);
canvas.addEventListener('wheel', event => {
  event.preventDefault();
  zoom = clamp(zoom - event.deltaY * 0.0012, 0, 1);
  ui.zoom.value = String(zoom);
}, { passive: false });

function touchDistance() {
  const values = [...touches.values()];
  if (values.length < 2) return 0;
  return Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
}

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
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    points[i * 3] = x;
    points[i * 3 + 1] = y;
    points[i * 3 + 2] = z;

    const continent = 0.5 + 0.24 * Math.sin(x * 5.2 + z * 2.4) + 0.18 * Math.sin(y * 7.1 - x * 3.3) + 0.11 * Math.sin((x + y + z) * 13.7);
    const ridge = Math.abs(Math.sin(x * 15.3 + y * 9.2 - z * 11.7)) * 0.2;
    elevation[i] = clamp(continent + ridge, 0, 1);
    temperature[i] = clamp(0.84 - Math.abs(y) * 0.74 - Math.max(0, elevation[i] - 0.58) * 0.7, 0, 1);
    moisture[i] = clamp(0.5 + 0.28 * Math.sin(z * 6.4 - x * 2.7) + 0.2 * Math.sin(y * 11.2 + z * 4.3), 0, 1);
    vegetation[i] = clamp(moisture[i] * temperature[i] * 1.6 - 0.15, 0, 1);
    river[i] = clamp((1 - Math.abs(Math.sin(x * 22 + y * 13 - z * 17))) * moisture[i] * Math.max(0, elevation[i] - 0.44) * 2.8, 0, 1);
    city[i] = elevation[i] > 0.48 && elevation[i] < 0.66 && moisture[i] > 0.56 && river[i] > 0.72 && hash01(i) > 0.997 ? 1 : 0;
  }
  return { count, points, elevation, moisture, temperature, vegetation, river, city };
}

function rotate(x0, y0, z0, radius) {
  const cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx);
  let x = x0 * cy - z0 * sy;
  let z = x0 * sy + z0 * cy;
  const y = y0;
  const y2 = y * cx - z * sx;
  const z2 = y * sx + z * cx;
  return [x * radius, y2 * radius, z2 * radius];
}

function pointColor(i) {
  const elevation = planet.elevation[i];
  const temperature = planet.temperature[i];
  const moisture = planet.moisture[i];
  const vegetation = planet.vegetation[i];
  if (elevation < 0.46) return [20, 64, 98];
  if (temperature < 0.16 || elevation > 0.84) return [226, 232, 235];
  if (planet.river[i] > 0.74) return [38, 132, 177];
  if (planet.city[i]) return [241, 195, 100];
  if (moisture < 0.22) return [181, 148, 80];
  if (vegetation > 0.62) return [44, 112, 61];
  if (vegetation > 0.28) return [82, 128, 72];
  return [108, 106, 80];
}

function render() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 1.25);
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  ctx.fillStyle = '#050b12';
  ctx.fillRect(0, 0, width, height);
  const relief = Number(ui.relief.value);
  const scale = Math.min(width, height) * (0.28 + zoom * 0.55);
  const stride = zoom > 0.7 ? 1 : zoom > 0.35 ? 2 : 3;
  const image = ctx.createImageData(width, height);
  const data = image.data;
  let rendered = 0;

  for (let i = 0; i < planet.count; i += stride) {
    const x0 = planet.points[i * 3];
    const y0 = planet.points[i * 3 + 1];
    const z0 = planet.points[i * 3 + 2];
    const radius = 1 + (planet.elevation[i] - 0.46) * 0.16 * relief;
    const [x, y, z] = rotate(x0, y0, z0, radius);
    if (z <= 0) continue;
    const px = Math.round(width / 2 + x * scale);
    const py = Math.round(height / 2 - y * scale);
    if (px < 0 || px >= width || py < 0 || py >= height) continue;
    const color = pointColor(i);
    const light = clamp(0.34 - x * 0.18 + y * 0.12 + z * 0.82, 0.18, 1.18);
    const index = (py * width + px) * 4;
    data[index] = Math.min(255, Math.round(color[0] * light));
    data[index + 1] = Math.min(255, Math.round(color[1] * light));
    data[index + 2] = Math.min(255, Math.round(color[2] * light));
    data[index + 3] = 255;
    rendered++;
  }
  ctx.putImageData(image, 0, 0);

  ui.lod.textContent = `Point stride ${stride}`;
  ui.faces.textContent = rendered.toLocaleString();
}

function updateStats() {
  ui.age.textContent = `${Math.round(worldAge).toLocaleString()} yr`;
  ui.rivers.textContent = countAbove(planet.river, 0.74);
  ui.cities.textContent = planet.city.reduce((sum, value) => sum + value, 0);
  ui.forest.textContent = `${Math.round(average(planet.vegetation) * 100)}%`;
  ui.snow.textContent = countSnow();
  ui.desert.textContent = countDesert();
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
    accumulator -= 0.22;
  }
  render();
  updateStats();
}

function countAbove(array, threshold) { let count = 0; for (const value of array) if (value > threshold) count++; return count; }
function countSnow() { let count = 0; for (let i = 0; i < planet.count; i++) if (planet.temperature[i] < 0.16 || planet.elevation[i] > 0.84) count++; return count; }
function countDesert() { let count = 0; for (let i = 0; i < planet.count; i++) if (planet.elevation[i] >= 0.46 && planet.moisture[i] < 0.22) count++; return count; }
function average(array) { let sum = 0; for (const value of array) sum += value; return sum / array.length; }
function hash01(index) { let h = Math.imul(index ^ 91, 2654435761); h ^= h >>> 16; return (h >>> 0) / 4294967295; }
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

window.realitySandboxPointPlanet = { planet };
requestAnimationFrame(frame);
