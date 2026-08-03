import { createRng } from './core/rng.js';
import { createWorld } from './core/world.js';
import { createSphericalStepper } from './core/sphere.js';
import { createModuleHost } from './core/module-host.js';
import { createGlobeRenderer } from './core/globe-render-v4.js';
import { createGalaxySystem } from './core/galaxy-system.js';
import { createGeologicalTime } from './core/geological-time.js';
import { createOrbitalSystem } from './core/orbital-system.js';
import { placeExistingEntitiesOnBiomes } from './core/planet.js';
import { createLivingSystems } from './core/living-systems.js';
import { createPlanetDynamics } from './core/planet-dynamics.js';
import { createBiosphere } from './core/biosphere.js';
import { createWaterCycle } from './core/water-cycle.js';
import { registerCurrentModules } from './integrations/runtime.js';

const FIXED_DT = 0.06;
const STORAGE_KEY = 'reality-sandbox-globe-v1';
const saved = readSavedState();

let world;
let globe;
let galaxyLayer = null;
let hdTerrainLayer = null;
let localSurfaceLayer = null;
let geologicalTime;
let stepSphere;
let moduleHost;
let accumulator = 0;
let lastTime = 0;
let lastSave = 0;
let running = true;

function readSavedState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveState() {
  if (!world || !globe) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      tick: world.tick,
      camera: globe.getCameraState(),
      modules: moduleHost?.save?.(),
    }));
  } catch {
    // Storage can be unavailable in private browsing.
  }
}

function hideLoader() {
  const loader = document.getElementById('loadingState');
  if (!loader) return;
  loader.classList.add('ready');
  setTimeout(() => loader.remove(), 450);
}

function restoreWorldState() {
  if (Number.isFinite(saved.tick)) world.tick = saved.tick;
}

function stepSimulation() {
  stepSphere(FIXED_DT);
  moduleHost.step(FIXED_DT);
}

function loop(timestamp) {
  requestAnimationFrame(loop);
  if (!running || document.hidden) return;

  if (!lastTime) lastTime = timestamp;
  accumulator += Math.min(0.12, (timestamp - lastTime) / 1000);
  lastTime = timestamp;

  let steps = 0;
  const maxSteps = matchMedia('(pointer: coarse)').matches ? 2 : 4;
  while (accumulator >= FIXED_DT && steps < maxSteps) {
    stepSimulation();
    accumulator -= FIXED_DT;
    steps++;
  }
  if (steps === maxSteps) accumulator = 0;

  const cameraState = globe.getCameraState();
  globe.render(world);
  hdTerrainLayer?.render(cameraState);
  localSurfaceLayer?.render(cameraState);
  galaxyLayer?.render(cameraState.distance, timestamp);
  moduleHost.render({
    world,
    globe,
    galaxyLayer,
    hdTerrainLayer,
    localSurfaceLayer,
    geologicalTime,
    timestamp,
  });

  if (timestamp - lastSave > 5000) {
    lastSave = timestamp;
    saveState();
  }
}

function showError(error) {
  running = false;
  document.getElementById('loadingState')?.remove();
  const panel = document.getElementById('errorState');
  if (panel) {
    panel.textContent = error?.message || 'Unable to start the globe.';
    panel.hidden = false;
  }
}

async function loadOptionalVisualLayers(worldElement, galaxySystem) {
  const tasks = [
    import('./core/hd-terrain-layer.js')
      .then(({ createHdTerrainLayer }) => {
        hdTerrainLayer = createHdTerrainLayer(worldElement);
        window.realitySandboxTerrain = hdTerrainLayer;
      }),
    import('./core/local-surface-layer.js')
      .then(({ createLocalSurfaceLayer }) => {
        localSurfaceLayer = createLocalSurfaceLayer(worldElement, geologicalTime);
        window.realitySandboxSurface = localSurfaceLayer;
      }),
    import('./core/galaxy-render-layer.js')
      .then(({ createGalaxyRenderLayer }) => {
        galaxyLayer = createGalaxyRenderLayer(worldElement, galaxySystem);
      }),
  ];

  const results = await Promise.allSettled(tasks);
  for (const result of results) {
    if (result.status === 'rejected') console.warn('Optional visual layer disabled:', result.reason);
  }
}

async function init() {
  try {
    const rng = createRng('stable-world');
    world = createWorld(rng);
    placeExistingEntitiesOnBiomes(world, Math.random);
    restoreWorldState();

    stepSphere = createSphericalStepper(world);
    const orbitalSystem = createOrbitalSystem(world);
    const galaxySystem = createGalaxySystem({ seed: 20260802 });
    geologicalTime = createGeologicalTime({
      seed: 20260802,
      millionYearsPerSecond: matchMedia('(pointer: coarse)').matches ? 0.2 : 0.35,
    });
    const living = createLivingSystems(world);
    const biosphere = createBiosphere(world);
    const waterCycle = createWaterCycle(world, orbitalSystem);
    const dynamics = createPlanetDynamics(world, living, waterCycle, orbitalSystem);
    const worldElement = document.getElementById('world');

    globe = createGlobeRenderer(
      worldElement,
      dynamics,
      null,
      {
        quality: 'auto',
        cameraState: saved.camera,
        orbitalSystem,
        onCameraChange: saveState,
        onError: showError,
        onReady: hideLoader,
      },
    );

    moduleHost = createModuleHost({ world });
    moduleHost.register(geologicalTime);
    registerCurrentModules(moduleHost, {
      globe,
      galaxySystem,
      orbitalSystem,
      living,
      biosphere,
      waterCycle,
      dynamics,
      reboundEndpoint: null,
    });
    await moduleHost.initialize();
    await moduleHost.load(saved.modules || {});

    window.realitySandboxModules = moduleHost;
    window.realitySandboxOrbits = orbitalSystem;
    window.realitySandboxGalaxy = galaxySystem;
    window.realitySandboxGeology = geologicalTime;

    globe.render(world);
    requestAnimationFrame(loop);

    // Fallback in case Safari never fires the first-frame callback.
    setTimeout(hideLoader, 2500);

    // Allow the base globe to display before requesting more WebGL contexts.
    setTimeout(() => {
      void loadOptionalVisualLayers(worldElement, galaxySystem);
    }, 1200);
  } catch (error) {
    showError(error);
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) lastTime = 0;
});
window.addEventListener('pagehide', saveState);
window.addEventListener('DOMContentLoaded', init);
