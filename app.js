import { createRng } from './core/rng.js';
import { createWorld } from './core/world.js';
import { createSphericalStepper } from './core/sphere.js';
import { createModuleHost } from './core/module-host.js';
import { createGlobeRenderer } from './core/globe-render-v4.js';
import { createGalaxyRenderLayer } from './core/galaxy-render-layer.js';
import { createGalaxySystem } from './core/galaxy-system.js';
import { createOrbitalSystem } from './core/orbital-system.js';
import { createCosmicOrigin } from './core/cosmic-origin.js';
import { createOriginSurfaceVisuals } from './core/origin-surface-visuals.js';
import { createEmbodiedEvolution } from './core/embodied-evolution.js';
import { createCivilizationEngine } from './core/civilization-engine.js';
import { createPhase8Engine } from './core/phase8-engine.js';
import { createDebugBridge } from './core/debug-bridge.js';
import { createSurfaceCharacter } from './core/surface-character.js';
import { createCloseupPolish } from './core/closeup-polish.js';
import { createGroundLevelPhase } from './core/ground-level-phase.js';
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
let groundLevelPhase;
let originSystem;
let originSurfaceVisuals;
let embodiedEvolution;
let civilizationEngine;
let phase8Engine;
let debugBridge;
let stepSphere;
let moduleHost;
let accumulator = 0;
let lastTime = 0;
let lastSave = 0;
let running = true;
let paused = false;
let timeScale = 1;

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

function stepSimulation(dt = FIXED_DT) {
  stepSphere(dt);
  moduleHost.step(dt);
}

function renderFrame(timestamp) {
  const cameraState = globe.getCameraState();
  globe.render(world);
  galaxyLayer.render(cameraState, timestamp);
  moduleHost.render({
    world,
    globe,
    galaxyLayer,
    surfaceCharacter,
    closeupPolish,
    groundLevelPhase,
    originSystem,
    originSurfaceVisuals,
    embodiedEvolution,
    civilizationEngine,
    phase8Engine,
    debugBridge,
    timestamp,
  });
}

function loop(timestamp) {
  requestAnimationFrame(loop);
  if (!running || document.hidden) return;

  if (!lastTime) lastTime = timestamp;
  if (!paused) accumulator += Math.min(0.12, (timestamp - lastTime) / 1000) * timeScale;
  lastTime = timestamp;

  let steps = 0;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const maxSteps = coarse ? 2 : 4;
  while (!paused && accumulator >= FIXED_DT && steps < maxSteps) {
    stepSimulation();
    accumulator -= FIXED_DT;
    steps++;
  }
  if (steps === maxSteps) accumulator = 0;

  renderFrame(timestamp);

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
    restoreWorldState();

    const galaxySystem = createGalaxySystem({ seed: 20260802 });
    const orbitalSystem = createOrbitalSystem(world, {
      star: galaxySystem.getLocalStar(),
      seed: 20260804,
    });
    originSystem = createCosmicOrigin(world, galaxySystem, orbitalSystem, {
      seed: 20260804,
    });
    originSystem.prepare();

    placeExistingEntitiesOnBiomes(world, Math.random);
    stepSphere = createSphericalStepper(world);
    const living = createLivingSystems(world);
    const biosphere = createBiosphere(world);
    const waterCycle = createWaterCycle(world, orbitalSystem);
    const dynamics = createPlanetDynamics(world, living, waterCycle, orbitalSystem);
    const worldElement = document.getElementById('world');
    const mobile = matchMedia('(max-width: 720px), (pointer: coarse)').matches;

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
      },
    );
    originSystem.attachGlobe(globe);

    galaxyLayer = createGalaxyRenderLayer(worldElement, galaxySystem);
    groundLevelPhase = createGroundLevelPhase(worldElement, globe, { mobile });
    originSurfaceVisuals = createOriginSurfaceVisuals(originSystem, groundLevelPhase, { mobile });
    embodiedEvolution = createEmbodiedEvolution(world, originSystem, groundLevelPhase, {
      mobile,
      seed: 20260805,
      container: worldElement,
    });
    civilizationEngine = createCivilizationEngine(world, embodiedEvolution, groundLevelPhase, {
      mobile,
      seed: 20260806,
      container: worldElement,
    });
    phase8Engine = createPhase8Engine(world, civilizationEngine, orbitalSystem, groundLevelPhase, {
      mobile,
      seed: 20260807,
      container: worldElement,
    });
    closeupPolish = createCloseupPolish(globe);
    surfaceCharacter = createSurfaceCharacter(globe, {
      groundLevel: groundLevelPhase,
    });

    moduleHost = createModuleHost({ world });
    moduleHost.register(originSystem);
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
    moduleHost.register(groundLevelPhase);
    moduleHost.register(originSurfaceVisuals);
    moduleHost.register(embodiedEvolution);
    moduleHost.register(civilizationEngine);
    moduleHost.register(phase8Engine);
    await moduleHost.initialize();
    await moduleHost.load(saved.modules || {});
    moduleHost.list = moduleHost.getStatus;

    window.realitySandboxModules = moduleHost;
    window.realitySandboxOrbits = orbitalSystem;
    window.realitySandboxGalaxy = galaxySystem;
    window.realitySandboxOrigin = originSystem;
    window.realitySandboxOriginSurface = originSurfaceVisuals;
    window.realitySandboxEvolution = embodiedEvolution;
    window.realitySandboxCivilization = civilizationEngine;
    window.realitySandboxPhase8 = phase8Engine;
    window.realitySandboxCharacter = surfaceCharacter;
    window.realitySandboxCloseup = closeupPolish;
    window.realitySandboxGround = groundLevelPhase;

    debugBridge = createDebugBridge({
      world,
      moduleHost,
      globe,
      groundLevel: groundLevelPhase,
      origin: originSystem,
      evolution: embodiedEvolution,
      civilization: civilizationEngine,
      phase8: phase8Engine,
      controls: {
        isPaused: () => paused,
        setPaused: value => { paused = Boolean(value); },
        getTimeScale: () => timeScale,
        setTimeScale: value => { timeScale = Math.max(0.05, Math.min(100, Number(value) || 1)); },
        stepOnce: () => stepSimulation(),
      },
    });

    globe.render(world);
    galaxyLayer.render(globe.getCameraState());
    requestAnimationFrame(loop);
  } catch (error) {
    showError(error);
    window.realitySandboxReady = Promise.reject(error);
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) lastTime = 0;
});
window.addEventListener('pagehide', saveState);
window.addEventListener('DOMContentLoaded', init);
