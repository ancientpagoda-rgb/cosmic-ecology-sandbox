import { createPointField, updatePointField } from './core/point-planet/point-field.js';
import { createPointOctree } from './core/point-planet/point-octree.js';
import { renderPointNodes } from './core/point-planet/point-renderer.js';

const canvas = document.getElementById('planet');
const ctx = canvas.getContext('2d', { alpha: false });
const ui = Object.fromEntries(['zoom','relief','speed','lod','faces','age','rivers','cities','forest','snow','desert','hexes','nodes'].map(id => [id, document.getElementById(id)]));
const points = createPointField(52000);
const octree = createPointOctree(points, { capacity: 96, maxDepth: 7 });

let rx = -0.18, ry = 0.5, zoom = 0.56;
let pointer = null, lastX = 0, lastY = 0;
let worldAge = 0, last = performance.now(), accumulator = 0;
const touches = new Map();
let pinchStartDistance = 0, pinchStartZoom = zoom;

canvas.addEventListener('pointerdown', event => {
  touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (touches.size === 1) { pointer = event.pointerId; lastX = event.clientX; lastY = event.clientY; }
  else { pointer = null; pinchStartDistance = touchDistance(); pinchStartZoom = zoom; }
  canvas.setPointerCapture?.(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
  if (!touches.has(event.pointerId)) return;
  touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (touches.size >= 2) {
    zoom = clamp(pinchStartZoom + (touchDistance() - pinchStartDistance) / 260, 0, 1);
    ui.zoom.value = String(zoom);
    return;
  }
  if (event.pointerId !== pointer) return;
  ry += (event.clientX - lastX) * 0.009;
  rx = clamp(rx + (event.clientY - lastY) * 0.009, -1.35, 1.35);
  lastX = event.clientX; lastY = event.clientY;
});
function release(event) { touches.delete(event.pointerId); if (!touches.size) pointer = null; if (touches.size < 2) pinchStartDistance = 0; }
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('lostpointercapture', release);
canvas.addEventListener('wheel', event => { event.preventDefault(); zoom = clamp(zoom - event.deltaY * 0.0012, 0, 1); ui.zoom.value = String(zoom); }, { passive: false });

function touchDistance() {
  const values = [...touches.values()];
  return values.length < 2 ? 0 : Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 1.25);
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
}

function render() {
  resize();
  ctx.fillStyle = '#050b12';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const camera = {
    rx, ry, zoom,
    position: [0, 0, 3],
    scale: Math.min(canvas.width, canvas.height) * (0.28 + zoom * 0.55),
  };
  const visibleNodes = octree.visibleNodes(camera);
  const drawn = renderPointNodes(ctx, canvas, visibleNodes, camera, { relief: Number(ui.relief.value) });
  ui.lod.textContent = `${visibleNodes.length} visible nodes`;
  ui.faces.textContent = drawn.toLocaleString();
  ui.nodes.textContent = octree.stats().nodes;
}

function updateStats() {
  let rivers = 0, cities = 0, vegetation = 0, snow = 0, desert = 0;
  for (const point of points) {
    if (point.river > 0.74) rivers++;
    if (point.city) cities++;
    vegetation += point.vegetation;
    if (point.temperature < 0.16 || point.elevation > 0.84) snow++;
    if (point.elevation >= 0.46 && point.moisture < 0.22) desert++;
  }
  ui.age.textContent = `${Math.round(worldAge).toLocaleString()} yr`;
  ui.rivers.textContent = rivers;
  ui.cities.textContent = cities;
  ui.forest.textContent = `${Math.round(vegetation / points.length * 100)}%`;
  ui.snow.textContent = snow;
  ui.desert.textContent = desert;
  ui.hexes.textContent = 'none';
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  accumulator += dt * Number(ui.speed.value);
  while (accumulator >= 0.22) {
    worldAge += 20;
    updatePointField(points, worldAge, 20);
    accumulator -= 0.22;
  }
  render();
  updateStats();
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
window.realitySandboxPointPlanet = { points, octree };
requestAnimationFrame(frame);
