import { createRng } from './core/rng.js';
import { createWorld } from './core/world.js';
import { createSphericalStepper } from './core/sphere.js';
import { createModuleHost } from './core/module-host.js';
import { createGlobeRenderer } from './core/globe-render-v4.js';
import { placeExistingEntitiesOnBiomes, randomHabitablePoint } from './core/planet.js';
import { createLivingSystems } from './core/living-systems.js';
import { createPlanetDynamics } from './core/planet-dynamics.js';
import { createBiosphere } from './core/biosphere.js';
import { createWaterCycle } from './core/water-cycle.js';
import { registerCurrentModules } from './integrations/runtime.js';

const FIXED_DT = 0.06;
const STORAGE_KEY = 'reality-sandbox-state-v1';
const saved = readSavedState();
let quality = saved.quality || 'auto';
let world, globe, stepSphere, living, dynamics, biosphere, waterCycle, moduleHost;
let running = false;
let accumulator = 0;
let lastTime = 0;
let brushActive = false;
let initialized = false;
let saveTimer = 0;

function runStep() {
  stepSphere(FIXED_DT);
  moduleHost.step(FIXED_DT);
}

function mainLoop(timestamp) {
  if (!running) return;
  if (!lastTime) lastTime = timestamp;
  accumulator += Math.min(0.12, (timestamp - lastTime) / 1000);
  lastTime = timestamp;
  let steps = 0;
  const maxSteps = matchMedia('(pointer: coarse)').matches ? 2 : 4;
  while (accumulator >= FIXED_DT && steps < maxSteps) {
    runStep();
    accumulator -= FIXED_DT;
    steps++;
  }
  if (steps === maxSteps) accumulator = 0;
  globe.render(world);
  moduleHost.render({ world, globe, timestamp });
  if (timestamp - saveTimer > 5000) { saveTimer = timestamp; saveState(); }
  requestAnimationFrame(mainLoop);
}

function setRunning(next) {
  running = Boolean(next && initialized);
  document.getElementById('startButton').disabled = running;
  document.getElementById('pauseButton').disabled = !running;
  document.getElementById('stepButton').disabled = running;
  if (running) { lastTime = 0; accumulator = 0; requestAnimationFrame(mainLoop); }
  saveState();
}

function readSavedState() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
}

function saveState() {
  if (!world) return;
  const positions = {};
  for (const [id, pos] of world.ecs.components.position.entries()) positions[id] = [pos.x, pos.y];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      quality,
      running,
      tick: world.tick,
      camera: globe?.getCameraState?.(),
      positions,
      modules: moduleHost?.save?.(),
    }));
  } catch {}
}

function restoreWorldState() {
  if (!saved.positions) return;
  for (const [idText, pair] of Object.entries(saved.positions)) {
    const pos = world.ecs.components.position.get(Number(idText));
    if (pos && Array.isArray(pair)) { pos.x = pair[0]; pos.y = pair[1]; }
  }
  if (Number.isFinite(saved.tick)) world.tick = saved.tick;
}

function addHistory(event) {
  const list = document.getElementById('historyList');
  if (!list) return;
  const li = document.createElement('li');
  const strong = document.createElement('strong'); strong.textContent = event.title;
  const span = document.createElement('span'); span.textContent = event.description;
  li.append(strong, span); list.prepend(li);
  while (list.children.length > 12) list.lastElementChild.remove();
}

function renderHistory(items) {
  const list = document.getElementById('historyList');
  list.replaceChildren();
  [...items].reverse().forEach(addHistory);
}

function showInspector(data) {
  const nearby = biosphere.getNearbySpecies(data.x, data.y, 120);
  const species = nearby.length ? nearby.slice(0, 4).map(s => `${s.name} (${s.population})`).join(' · ') : 'No classified animal species nearby';
  document.getElementById('inspectorTitle').textContent = data.title;
  document.getElementById('inspectorBody').innerHTML = `
    <div><b>Biome</b><span>${data.biome}</span></div><div><b>Elevation</b><span>${data.elevation} m</span></div>
    <div><b>Temperature</b><span>${data.temperature} °C</span></div><div><b>Rainfall</b><span>${data.rainfall} mm/yr</span></div>
    <div><b>Water</b><span>${data.water}</span></div><div><b>Weather</b><span>${data.weather}</span></div>
    <div><b>Soil moisture</b><span>${data.soilMoisture ?? 0}%</span></div><div><b>Flood risk</b><span>${data.floodRisk ?? 0}%</span></div>
    <div><b>Drought risk</b><span>${data.droughtRisk ?? 0}%</span></div><div><b>Geology</b><span>${data.geology}</span></div>
    <div><b>Species</b><span>${species}</span></div>`;
  document.getElementById('inspector').classList.add('visible');
}

function showError(error) {
  initialized = false;
  setRunning(false);
  document.getElementById('loadingState').hidden = true;
  const panel = document.getElementById('errorState');
  document.getElementById('errorMessage').textContent = error?.message || 'WebGL could not start. Try Mobile quality and reload.';
  panel.hidden = false;
}

async function init() {
  document.getElementById('qualitySelect').value = quality;
  document.getElementById('errorState').hidden = true;
  try {
    const rng = createRng('stable-world');
    world = createWorld(rng);
    placeExistingEntitiesOnBiomes(world, Math.random);
    restoreWorldState();
    stepSphere = createSphericalStepper(world);
    living = createLivingSystems(world);
    biosphere = createBiosphere(world);
    waterCycle = createWaterCycle(world);
    dynamics = createPlanetDynamics(world, living, waterCycle);
    globe = createGlobeRenderer(document.getElementById('world'), dynamics, showInspector, {
      quality,
      cameraState: saved.camera,
      onCameraChange: saveState,
      onError: showError,
      onReady: () => {
        initialized = true;
        const loader = document.getElementById('loadingState');
        loader.classList.add('ready');
        setTimeout(() => loader.remove(), 400);
        if (!saved.camera) globe.resetView();
        setRunning(saved.running !== false);
      },
    });

    moduleHost = createModuleHost({ world });
    registerCurrentModules(moduleHost, { globe, living, biosphere, waterCycle, dynamics });
    await moduleHost.initialize();
    await moduleHost.load(saved.modules || {});
  } catch (error) { showError(error); return; }

  window.realitySandboxModules = moduleHost;
  window.addEventListener('reality-history', event => renderHistory(event.detail));
  window.addEventListener('biosphere-event', event => addHistory(event.detail));
  window.addEventListener('planet-event', event => addHistory(event.detail));
  window.addEventListener('water-cycle-event', event => addHistory(event.detail));
  renderHistory(living.getHistory());
  addHistory({ title: 'Modular engine active', description: `${moduleHost.getStatus().length} simulation modules are running through the new scientific adapter host.` });

  document.getElementById('startButton').addEventListener('click', () => setRunning(true));
  document.getElementById('pauseButton').addEventListener('click', () => setRunning(false));
  document.getElementById('stepButton').addEventListener('click', () => { runStep(); globe.render(world); saveState(); });
  document.getElementById('spawnAgentButton').addEventListener('click', () => { const p = randomHabitablePoint(world.width, world.height, Math.random, 'land'); world.makeAgentAt?.(p.x, p.y); globe.render(world); });
  document.getElementById('spawnResourceButton').addEventListener('click', () => { const p = randomHabitablePoint(world.width, world.height, Math.random, 'plant'); world.makeResourceAt?.(p.x, p.y); globe.render(world); });
  document.getElementById('zoomInButton').addEventListener('click', globe.zoomIn);
  document.getElementById('zoomOutButton').addEventListener('click', globe.zoomOut);
  document.getElementById('deepZoomButton').addEventListener('click', globe.deepZoom);
  document.getElementById('resetViewButton').addEventListener('click', globe.resetView);
  document.getElementById('retryButton').addEventListener('click', () => location.reload());
  document.getElementById('qualitySelect').addEventListener('change', event => { quality = event.target.value; saveState(); location.reload(); });
  document.getElementById('closeInspector').addEventListener('click', () => document.getElementById('inspector').classList.remove('visible'));

  const brush = document.getElementById('forceBrushButton');
  brush.addEventListener('click', () => {
    brushActive = !brushActive;
    brush.classList.toggle('active', brushActive);
    brush.textContent = brushActive ? 'Force Brush: ON' : 'Force Brush';
    globe.element.dataset.brush = brushActive ? 'on' : 'off';
  });
  let painting = false;
  const paint = event => {
    if (!brushActive) return;
    const p = globe.pickWorldPoint(event.clientX, event.clientY);
    if (p) { world.paintForceField?.(p, event.shiftKey ? -1 : 1); globe.render(world); }
  };
  globe.element.addEventListener('pointerdown', event => { if (brushActive) { painting = true; paint(event); } });
  globe.element.addEventListener('pointermove', event => { if (painting) paint(event); });
  window.addEventListener('pointerup', () => { painting = false; });
  window.addEventListener('pagehide', saveState);
  globe.render(world);
}

window.addEventListener('DOMContentLoaded', init);
