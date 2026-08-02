import { createRng } from './core/rng.js';
import { createWorld } from './core/world.js';
import { createRenderer } from './core/render.js';
import { createSphericalStepper } from './core/sphere.js';

const FIXED_DT = 0.06; // 60 ms in seconds, fixed sim step

let seed = null;
let rng = null;
let world = null;
let renderer = null;
let stepSphere = null;

let running = false;
let accumulator = 0;
let lastTime = 0;
let brushActive = false;

function updateLabels() {
  const tickLabel = document.getElementById('tickLabel');
  const seedValue = document.getElementById('seedValue');
  if (tickLabel) tickLabel.textContent = `Tick: ${world.tick}`;
  if (seedValue) seedValue.textContent = seed;
}

function mainLoop(timestamp) {
  if (!running) return;

  if (!lastTime) lastTime = timestamp;
  const deltaMs = timestamp - lastTime;
  lastTime = timestamp;

  accumulator += deltaMs / 1000;

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
  requestAnimationFrame(mainLoop);
}

function pause() {
  running = false;
  document.getElementById('startButton').disabled = false;
  document.getElementById('pauseButton').disabled = true;
  document.getElementById('stepButton').disabled = false;
}

function stepOnce() {
  if (!world) return;
  stepSphere(FIXED_DT);
  renderer.render(world);
  updateLabels();
}

function worldToCanvas(evt, canvas, world) {
  const rect = canvas.getBoundingClientRect();
  const x = evt.clientX - rect.left;
  const y = evt.clientY - rect.top;
  const sx = world.width / rect.width;
  const sy = world.height / rect.height;
  return { x: x * sx, y: y * sy };
}

function init() {
  seed = Date.now().toString(36);
  rng = createRng(seed);
  world = createWorld(rng);
  stepSphere = createSphericalStepper(world);
  const canvas = document.getElementById('world');
  renderer = createRenderer(canvas);

  updateLabels();

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
    if (!world.makeAgentAt) return;
    world.makeAgentAt(Math.random() * world.width, Math.random() * world.height);
    renderer.render(world);
  });

  spawnResourceBtn.addEventListener('click', () => {
    if (!world.makeResourceAt) return;
    world.makeResourceAt(Math.random() * world.width, Math.random() * world.height);
    renderer.render(world);
  });

  forceBrushBtn.addEventListener('click', () => {
    brushActive = !brushActive;
    forceBrushBtn.classList.toggle('active', brushActive);
  });

  if (zoomInBtn && zoomOutBtn) {
    zoomInBtn.addEventListener('click', () => {
      world.camera.zoom = Math.min(3, world.camera.zoom * 1.2);
      renderer.render(world);
    });
    zoomOutBtn.addEventListener('click', () => {
      world.camera.zoom = Math.max(0.5, world.camera.zoom / 1.2);
      renderer.render(world);
    });
  }

  let drawing = false;

  function brushAtClient(x, y, polarity) {
    const p = worldToCanvas({ clientX: x, clientY: y }, canvas, world);
    world.paintForceField?.(p, polarity);
  }

  canvas.addEventListener('mousedown', (evt) => {
    if (!brushActive) return;
    drawing = true;
    brushAtClient(evt.clientX, evt.clientY, evt.shiftKey ? -1 : 1);
  });
  canvas.addEventListener('mousemove', (evt) => {
    if (!brushActive || !drawing) return;
    brushAtClient(evt.clientX, evt.clientY, evt.shiftKey ? -1 : 1);
  });
  window.addEventListener('mouseup', () => {
    drawing = false;
  });

  canvas.addEventListener('touchstart', (evt) => {
    if (!brushActive) return;
    const t = evt.touches[0];
    if (!t) return;
    evt.preventDefault();
    drawing = true;
    const polarity = evt.touches.length > 1 ? -1 : 1;
    brushAtClient(t.clientX, t.clientY, polarity);
  }, { passive: false });

  canvas.addEventListener('touchmove', (evt) => {
    if (!brushActive || !drawing) return;
    const t = evt.touches[0];
    if (!t) return;
    evt.preventDefault();
    const polarity = evt.touches.length > 1 ? -1 : 1;
    brushAtClient(t.clientX, t.clientY, polarity);
  }, { passive: false });

  window.addEventListener('touchend', () => {
    drawing = false;
  });

  renderer.render(world);
}

window.addEventListener('DOMContentLoaded', init);
