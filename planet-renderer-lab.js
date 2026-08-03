import { createWorldState } from './core/world-core/world-state.js';
import { createHexSphereGrid } from './core/world-core/hex-sphere-grid.js';
import { createOctree } from './core/world-core/octree.js';
import { createHexPlanetModule } from './core/world-core/modules/hex-planet.js';

const canvas = document.getElementById('planet');
const ctx = canvas.getContext('2d', { alpha: false });
const ui = Object.fromEntries(['zoom','relief','speed','lod','faces','age','rivers','cities','forest','snow','desert','hexes','nodes'].map(id => [id, document.getElementById(id)]));

const simGrid = createHexSphereGrid(3);
const octree = createOctree({ x: 0, y: 0, z: 0, half: 1.2 }, { capacity: 10, maxDepth: 7 });
for (const cell of simGrid.cells) octree.insert({ id: cell.id, position: cell.position, cell });
const world = createWorldState({ seed: 'planet-point-cloud-1' });
const planet = createHexPlanetModule(simGrid, octree);
world.registerModule(planet);

const pointSets = new Map([
  [0, createFibonacciSphere(28000)],
  [1, createFibonacciSphere(72000)],
  [2, createFibonacciSphere(150000)],
]);
const nearestCache = new Map();
let rx = -0.18;
let ry = 0.5;
let pointer = null;
let lastX = 0;
let lastY = 0;
let last = performance.now();
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

function createFibonacciSphere(count) {
  const points = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    points[i * 3] = Math.cos(theta) * radius;
    points[i * 3 + 1] = y;
    points[i * 3 + 2] = Math.sin(theta) * radius;
  }
  return { count, points };
}

function chooseLod() {
  const zoom = Number(ui.zoom.value);
  return zoom > 0.68 ? 2 : zoom > 0.28 ? 1 : 0;
}

function nearestCell(pointIndex, set, x, y, z) {
  const key = `${set.count}:${pointIndex}`;
  if (nearestCache.has(key)) return nearestCache.get(key);
  const cell = octree.nearest([x, y, z], 0.4)?.item?.cell || simGrid.cells[0];
  nearestCache.set(key, cell);
  return cell;
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

function cellColor(cell) {
  if (cell.elevation < planet.getSeaLevel()) return [21, 65, 99];
  if (cell.fire > 0.1) return [198, 82, 39];
  if (cell.temperature < 0.18 || cell.elevation > 0.82) return [226, 231, 234];
  if (cell.flow > 0.055) return [38, 128, 173];
  if (cell.settlementId) return [236, 192, 101];
  if (cell.moisture < 0.22) return [177, 145, 78];
  if (cell.vegetation > 0.58) return [45, 111, 62];
  if (cell.vegetation > 0.24) return [82, 126, 71];
  return [106, 104, 79];
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
    const cell = nearestCell(i, set, x0, y0, z0);
    const radius = 1 + (cell.elevation - planet.getSeaLevel()) * 0.16 * relief;
    const [x, y, z] = rotate(x0, y0, z0, radius);
    if (z <= 0) continue;

    const px = Math.round(width / 2 + x * scale);
    const py = Math.round(height / 2 - y * scale);
    if (px < 0 || px >= width || py < 0 || py >= height) continue;

    const color = cellColor(cell);
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
  const cells = simGrid.cells;
  const cities = planet.getSettlements().filter(item => item.alive);
  ui.age.textContent = `${Math.round(world.getTimeYears()).toLocaleString()} yr`;
  ui.rivers.textContent = cells.filter(cell => cell.flow > 0.055).length;
  ui.cities.textContent = cities.length;
  ui.forest.textContent = `${Math.round(cells.reduce((sum, cell) => sum + cell.vegetation, 0) / cells.length * 100)}%`;
  ui.snow.textContent = cells.filter(cell => cell.temperature < 0.18 || cell.elevation > 0.82).length;
  ui.desert.textContent = cells.filter(cell => cell.elevation >= planet.getSeaLevel() && cell.moisture < 0.22).length;
  ui.hexes.textContent = 'hidden';
  ui.nodes.textContent = octree.stats().nodes;
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  accumulator += dt * Number(ui.speed.value);
  while (accumulator >= 0.22) {
    world.step(20);
    accumulator -= 0.22;
  }
  render();
  updateStats();
}

window.realitySandboxPointPlanet = { world, planet, simGrid, octree };
requestAnimationFrame(frame);
