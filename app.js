import { createRng } from './core/rng.js';
import { createWorld } from './core/world.js';
import { createRenderer } from './core/render.js';
import { createSphericalStepper } from './core/sphere.js';

const FIXED_DT = 0.06;

let seed = null;
let rng = null;
let world = null;
let renderer = null;
let stepSphere = null;

let running = false;
let accumulator = 0;
let lastTime = 0;
let brushActive = false;

function setAction(message) {
  const el = document.getElementById('actionLabel');
  if (el) el.textContent = message;
}

function updateLabels() {
  const tickLabel = document.getElementById('tickLabel');
  const seedValue = document.getElementById('seedValue');
  if (tickLabel) tickLabel.textContent = `Tick: ${world.tick}`;
  if (seedValue) seedValue.textContent = seed;
}

function mainLoop(timestamp) {
  if (!running) return;
  if (!lastTime) lastTime = timestamp;
  accumulator += (timestamp - lastTime) / 1000;
  lastTime = timestamp;

  while (accumulator >= FIXED_DT) {
    stepSphere(FIXED_DT);
    accumulator -= FIXED_DT;
  }

  renderer.render(world);
  updateLabels();
  requestAnimationFrame(mainLoop);
}

function start() {
  if (running) return;
  running = true;
  lastTime = 0;
  accumulator = 0;
  document.getElementById('startButton').disabled = true;
  document.getElementById('pauseButton').disabled = false;
  document.getElementById('stepButton').disabled = true;
  setAction('Running');
  requestAnimationFrame(mainLoop);
}

function pause() {
  running = false;
  document.getElementById('startButton').disabled = false;
  document.getElementById('pauseButton').disabled = true;
  document.getElementById('stepButton').disabled = false;
  setAction('Paused');
}

function stepOnce() {
  stepSphere(FIXED_DT);
  renderer.render(world);
  updateLabels();
  setAction('Advanced one tick');
}

function randomVisiblePoint() {
  return {
    x: world.width * (0.15 + Math.random() * 0.7),
    y: world.height * (0.15 + Math.random() * 0.7),
  };
}

function worldToCanvas(evt, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (evt.clientX - rect.left) * world.width / rect.width,
    y: (evt.clientY - rect.top) * world.height / rect.height,
  };
}

function init() {
  seed = Date.now().toString(36);
  rng = createRng(seed);
  world = createWorld(rng);
  stepSphere = createSphericalStepper(world);

  const canvas = document.getElementById('world');
  renderer = createRenderer(canvas);

  const startBtn = document.getElementById('startButton');
  const pauseBtn = document.getElementById('pauseButton');
  const stepBtn = document.getElementById('stepButton');
  const spawnAgentBtn = document.getElementById('spawnAgentButton');
  const spawnResourceBtn = document.getElementById('spawnResourceButton');
  const forceBrushBtn = document.getElementById('forceBrushButton');
  const zoomInBtn = document.getElementById('zoomInButton');
  const zoomOutBtn = document.getElementById('zoomOutButton');

  startBtn.addEventListener('click', start);
  pauseBtn.addEventListener('click', pause);
  stepBtn.addEventListener('click', stepOnce);

  spawnAgentBtn.addEventListener('click', () => {
    const p = randomVisiblePoint();
    world.makeAgentAt?.(p.x, p.y);
    renderer.render(world);
    setAction('Agent added');
  });

  spawnResourceBtn.addEventListener('click', () => {
    const p = randomVisiblePoint();
    world.makeResourceAt?.(p.x, p.y);
    renderer.render(world);
    setAction('Resource added');
  });

  forceBrushBtn.addEventListener('click', () => {
    brushActive = !brushActive;
    forceBrushBtn.classList.toggle('active', brushActive);
    forceBrushBtn.textContent = brushActive ? 'Force Brush: ON' : 'Force Brush';
    canvas.style.cursor = brushActive ? 'crosshair' : 'default';
    setAction(brushActive ? 'Drag on globe to paint force' : 'Force brush off');
  });

  zoomInBtn.addEventListener('click', () => {
    world.camera.zoom = Math.min(3, world.camera.zoom * 1.25);
    renderer.render(world);
    setAction(`Zoom ${world.camera.zoom.toFixed(2)}×`);
  });

  zoomOutBtn.addEventListener('click', () => {
    world.camera.zoom = Math.max(0.5, world.camera.zoom / 1.25);
    renderer.render(world);
    setAction(`Zoom ${world.camera.zoom.toFixed(2)}×`);
  });

  let drawing = false;

  function brushAtClient(x, y, polarity) {
    const p = worldToCanvas({ clientX: x, clientY: y }, canvas);
    world.paintForceField?.(p, polarity);
    renderer.render(world);
    setAction(polarity < 0 ? 'Repulsive force painted' : 'Attractive force painted');
  }

  canvas.addEventListener('mousedown', (evt) => {
    if (!brushActive) return;
    drawing = true;
    brushAtClient(evt.clientX, evt.clientY, evt.shiftKey ? -1 : 1);
  });
  canvas.addEventListener('mousemove', (evt) => {
    if (brushActive && drawing) brushAtClient(evt.clientX, evt.clientY, evt.shiftKey ? -1 : 1);
  });
  window.addEventListener('mouseup', () => { drawing = false; });

  canvas.addEventListener('touchstart', (evt) => {
    if (!brushActive || !evt.touches[0]) return;
    evt.preventDefault();
    drawing = true;
    const t = evt.touches[0];
    brushAtClient(t.clientX, t.clientY, evt.touches.length > 1 ? -1 : 1);
  }, { passive: false });

  canvas.addEventListener('touchmove', (evt) => {
    if (!brushActive || !drawing || !evt.touches[0]) return;
    evt.preventDefault();
    const t = evt.touches[0];
    brushAtClient(t.clientX, t.clientY, evt.touches.length > 1 ? -1 : 1);
  }, { passive: false });

  window.addEventListener('touchend', () => { drawing = false; });

  updateLabels();
  setAction('Ready');
  renderer.render(world);
}

window.addEventListener('DOMContentLoaded', init);
