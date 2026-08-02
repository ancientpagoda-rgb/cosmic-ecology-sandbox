import { createRng } from './core/rng.js';
import { createWorld } from './core/world.js';
import { createSphericalStepper } from './core/sphere.js';
import { createGlobeRenderer } from './core/globe-render-v2.js';
import { placeExistingEntitiesOnBiomes, randomHabitablePoint, samplePlanet } from './core/planet.js';

const FIXED_DT = 0.06;

let world;
let globe;
let stepSphere;
let running = false;
let accumulator = 0;
let lastTime = 0;
let brushActive = false;

function mainLoop(timestamp) {
  if (!running) return;
  if (!lastTime) lastTime = timestamp;
  accumulator += (timestamp - lastTime) / 1000;
  lastTime = timestamp;

  while (accumulator >= FIXED_DT) {
    stepSphere(FIXED_DT);
    keepLifeHabitable();
    accumulator -= FIXED_DT;
  }

  globe.render(world);
  requestAnimationFrame(mainLoop);
}

function setRunning(next) {
  running = next;
  document.getElementById('startButton').disabled = next;
  document.getElementById('pauseButton').disabled = !next;
  document.getElementById('stepButton').disabled = next;
  if (next) {
    lastTime = 0;
    accumulator = 0;
    requestAnimationFrame(mainLoop);
  }
}

function keepLifeHabitable() {
  const { position, resource } = world.ecs.components;
  for (const [id, res] of resource.entries()) {
    if (res.amount <= 0) continue;
    const pos = position.get(id);
    if (!pos) continue;
    const biome = samplePlanet(pos.x, pos.y, world.width, world.height);
    if (!biome.land || biome.biome === 'ice') {
      const p = randomHabitablePoint(world.width, world.height, Math.random, 'plant');
      pos.x = p.x;
      pos.y = p.y;
    }
  }
}

function init() {
  const rng = createRng(Date.now().toString(36));
  world = createWorld(rng);
  placeExistingEntitiesOnBiomes(world, Math.random);
  stepSphere = createSphericalStepper(world);
  globe = createGlobeRenderer(document.getElementById('world'));

  document.getElementById('startButton').addEventListener('click', () => setRunning(true));
  document.getElementById('pauseButton').addEventListener('click', () => setRunning(false));
  document.getElementById('stepButton').addEventListener('click', () => {
    stepSphere(FIXED_DT);
    keepLifeHabitable();
    globe.render(world);
  });

  document.getElementById('spawnAgentButton').addEventListener('click', () => {
    const p = randomHabitablePoint(world.width, world.height, Math.random, 'land');
    world.makeAgentAt?.(p.x, p.y);
    globe.render(world);
  });

  document.getElementById('spawnResourceButton').addEventListener('click', () => {
    const p = randomHabitablePoint(world.width, world.height, Math.random, 'plant');
    world.makeResourceAt?.(p.x, p.y);
    globe.render(world);
  });

  const forceBrushButton = document.getElementById('forceBrushButton');
  forceBrushButton.addEventListener('click', () => {
    brushActive = !brushActive;
    forceBrushButton.classList.toggle('active', brushActive);
    forceBrushButton.textContent = brushActive ? 'Force Brush: ON' : 'Force Brush';
    globe.element.dataset.brush = brushActive ? 'on' : 'off';
    globe.element.style.cursor = brushActive ? 'crosshair' : 'grab';
  });

  document.getElementById('zoomInButton').addEventListener('click', globe.zoomIn);
  document.getElementById('zoomOutButton').addEventListener('click', globe.zoomOut);

  let painting = false;

  function paint(event) {
    if (!brushActive) return;
    const p = globe.pickWorldPoint(event.clientX, event.clientY);
    if (!p) return;
    world.paintForceField?.(p, event.shiftKey ? -1 : 1);
    globe.render(world);
  }

  globe.element.addEventListener('pointerdown', event => {
    if (!brushActive) return;
    painting = true;
    paint(event);
  });
  globe.element.addEventListener('pointermove', event => {
    if (painting) paint(event);
  });
  window.addEventListener('pointerup', () => { painting = false; });

  globe.render(world);
}

window.addEventListener('DOMContentLoaded', init);
