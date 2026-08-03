import { createRng } from './core/rng.js';
import { createWorld } from './core/world.js';
import { createSphericalStepper } from './core/sphere.js';
import { createGlobeRenderer } from './core/globe-render-v3.js';
import { placeExistingEntitiesOnBiomes, randomHabitablePoint } from './core/planet.js';
import { createLivingSystems } from './core/living-systems.js';
import { createPlanetDynamics } from './core/planet-dynamics.js';

const FIXED_DT = 0.06;

let world;
let globe;
let stepSphere;
let living;
let dynamics;
let running = false;
let accumulator = 0;
let lastTime = 0;
let brushActive = false;

function runStep() {
  stepSphere(FIXED_DT);
  living.step(FIXED_DT);
  dynamics.step(FIXED_DT);
}

function mainLoop(timestamp) {
  if (!running) return;
  if (!lastTime) lastTime = timestamp;
  accumulator += Math.min(0.25, (timestamp - lastTime) / 1000);
  lastTime = timestamp;
  while (accumulator >= FIXED_DT) {
    runStep();
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

function addHistory(event) {
  const list = document.getElementById('historyList');
  if (!list) return;
  const li = document.createElement('li');
  const strong = document.createElement('strong');
  strong.textContent = event.title;
  const span = document.createElement('span');
  span.textContent = event.description;
  li.append(strong, span);
  list.prepend(li);
  while (list.children.length > 12) list.lastElementChild.remove();
}

function renderHistory(items) {
  const list = document.getElementById('historyList');
  if (!list) return;
  list.replaceChildren();
  [...items].reverse().forEach(addHistory);
}

function showInspector(data) {
  document.getElementById('inspectorTitle').textContent = data.title;
  document.getElementById('inspectorBody').innerHTML = `
    <div><b>Biome</b><span>${data.biome}</span></div>
    <div><b>Elevation</b><span>${data.elevation} m</span></div>
    <div><b>Temperature</b><span>${data.temperature} °C</span></div>
    <div><b>Rainfall</b><span>${data.rainfall} mm/yr</span></div>
    <div><b>Water</b><span>${data.water}</span></div>
    <div><b>Weather</b><span>${data.weather}</span></div>
    <div><b>Geology</b><span>${data.geology}</span></div>
    <div><b>Nearby life</b><span>${data.counts.plants} plants · ${data.counts.grazers} grazers · ${data.counts.predators + data.counts.apex} predators</span></div>`;
  document.getElementById('inspector').classList.add('visible');
}

function init() {
  const rng = createRng(Date.now().toString(36));
  world = createWorld(rng);
  placeExistingEntitiesOnBiomes(world, Math.random);
  stepSphere = createSphericalStepper(world);
  living = createLivingSystems(world);
  dynamics = createPlanetDynamics(world, living);
  globe = createGlobeRenderer(document.getElementById('world'), dynamics, showInspector);

  window.addEventListener('reality-history', event => renderHistory(event.detail));
  window.addEventListener('planet-event', event => {
    addHistory(event.detail);
    if (event.detail.narrator) {
      const narrator = document.getElementById('narrator');
      narrator.textContent = event.detail.description;
      narrator.classList.add('visible');
      clearTimeout(narrator.hideTimer);
      narrator.hideTimer = setTimeout(() => narrator.classList.remove('visible'), 9000);
    }
  });
  renderHistory(living.getHistory());

  document.getElementById('startButton').addEventListener('click', () => setRunning(true));
  document.getElementById('pauseButton').addEventListener('click', () => setRunning(false));
  document.getElementById('stepButton').addEventListener('click', () => { runStep(); globe.render(world); });
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
  });

  document.getElementById('zoomInButton').addEventListener('click', globe.zoomIn);
  document.getElementById('zoomOutButton').addEventListener('click', globe.zoomOut);
  document.getElementById('deepZoomButton').addEventListener('click', globe.deepZoom);
  document.getElementById('closeInspector').addEventListener('click', () => document.getElementById('inspector').classList.remove('visible'));

  let painting = false;
  function paint(event) {
    if (!brushActive) return;
    const p = globe.pickWorldPoint(event.clientX, event.clientY);
    if (!p) return;
    world.paintForceField?.(p, event.shiftKey ? -1 : 1);
    globe.render(world);
  }
  globe.element.addEventListener('pointerdown', event => { if (brushActive) { painting = true; paint(event); } });
  globe.element.addEventListener('pointermove', event => { if (painting) paint(event); });
  window.addEventListener('pointerup', () => { painting = false; });

  globe.render(world);
  setRunning(true);
}

window.addEventListener('DOMContentLoaded', init);
