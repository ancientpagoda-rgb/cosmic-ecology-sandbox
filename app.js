import { createRng } from './core/rng.js';
import { createWorld } from './core/world.js';
import { createSphericalStepper } from './core/sphere.js';
import { createModuleHost } from './core/module-host.js';
import { createGlobeRenderer } from './core/globe-render-v4.js';
import { createGalaxyRenderLayer } from './core/galaxy-render-layer.js';
import { createGalaxySystem } from './core/galaxy-system.js';
import { createOrbitalSystem } from './core/orbital-system.js';
import { createSurfaceCharacter } from './core/surface-character.js';
import { createCloseupPolish } from './core/closeup-polish.js';
import { createScaleRuntime } from './core/scale-runtime.js';
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
let galaxyLayer;
let surfaceCharacter;
let closeupPolish;
let scaleRuntime;
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
  scaleRuntime.updateCamera(cameraState);
  globe.render(world);
  galaxyLayer.render(cameraState, timestamp);
  moduleHost.render({
    world,
    globe,
    galaxyLayer,
    surfaceCharacter,
    closeupPolish,
    scaleRuntime,
    lod: scaleRuntime.getLod(),
    simulationBudget: scaleRuntime.simulationBudget(),
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

async function init() {
  try {
    const rng = createRng('stable-world');
    world = createWorld(rng);
    placeExistingEntitiesOnBiomes(world, Math.random);
    restoreWorldState();

    stepSphere = createSphericalStepper(world);
    const orbitalSystem = createOrbitalSystem(world);
    const galaxySystem = createGalaxySystem({ seed: 20260802 });
    const living = createLivingSystems(world);
    const biosphere = createBiosphere(world);
    const waterCycle = createWaterCycle(world, orbitalSystem);
    const dynamics = createPlanetDynamics(world, living, waterCycle, orbitalSystem);
    const worldElement = document.getElementById('world');

    scaleRuntime = createScaleRuntime({
      planetId: 'gaia',
      distance: saved.camera?.distance || 3,
    });
    scaleRuntime.registerEntity({ id: 'milky-way', scale: 'galaxy', kind: 'galaxy' });
    scaleRuntime.registerEntity({ id: 'sol', scale: 'system', kind: 'star' });
    scaleRuntime.registerEntity({ id: 'gaia', scale: 'planet', kind: 'planet' });
    scaleRuntime.registerEntity({ id: 'surface-player', scale: 'surface', kind: 'character' });

    globe = createGlobeRenderer(
      worldElement,
      dynamics,
      null,
      {
        quality: 'auto',
        cameraState: saved.camera,
        orbitalSystem,
        scaleRuntime,
        onCameraChange: saveState,
        onError: showError,
      },
    );

    galaxyLayer = createGalaxyRenderLayer(worldElement, galaxySystem, { scaleRuntime });
    closeupPolish = createCloseupPolish(globe, { scaleRuntime });
    surfaceCharacter = createSurfaceCharacter(globe, { scaleRuntime });

    moduleHost = createModuleHost({ world });
    registerCurrentModules(moduleHost, {
      globe,
      galaxyLayer,
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
    window.realitySandboxCharacter = surfaceCharacter;
    window.realitySandboxCloseup = closeupPolish;
    window.realitySandboxScale = scaleRuntime;
    globe.render(world);
    const cameraState = globe.getCameraState();
    scaleRuntime.updateCamera(cameraState);
    galaxyLayer.render(cameraState);
    requestAnimationFrame(loop);
  } catch (error) {
    showError(error);
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) lastTime = 0;
});
window.addEventListener('pagehide', saveState);
window.addEventListener('DOMContentLoaded', init);
