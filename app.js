import { createRng } from './core/rng.js';
import { createWorld } from './core/world.js';
import { createSphericalStepper } from './core/sphere.js';
import { createModuleHost } from './core/module-host.js';
import { createGalaxySystem } from './core/galaxy-system.js';
import { createOrbitalSystem } from './core/orbital-system.js';
import { createCosmicOrigin } from './core/cosmic-origin.js';
import { createHeadlessGroundLevel } from './core/headless-ground-level.js';
import { createHeadlessEvolution } from './core/headless-evolution.js';
import { createHeadlessCivilizationEngine } from './core/headless-societies.js';
import { createPhase8Engine } from './core/phase8-engine.js';
import { createPhase9Engine } from './core/phase9-engine.js';
import { createPhase10Engine } from './core/phase10-engine.js';
import { createPhase11Engine } from './core/phase11-engine.js';
import { createLofiLivingRuntime } from './core/lofi-living-runtime.js';
import { installUnifiedDebugExtension } from './core/unified-debug-extension.js';
import { createDebugBridge } from './core/debug-bridge.js';
import { placeExistingEntitiesOnBiomes } from './core/planet.js';
import { createLivingSystems } from './core/living-systems.js';
import { createPlanetDynamics } from './core/planet-dynamics.js';
import { createBiosphere } from './core/biosphere.js';
import { createWaterCycle } from './core/water-cycle.js';
import { registerCurrentModules } from './integrations/runtime.js';

const FIXED_DT = 0.06;
const STORAGE_KEY = 'reality-sandbox-globe-v1';
const PLANET_AREA_SCALE = 100;
const PLANET_LINEAR_SCALE = Math.sqrt(PLANET_AREA_SCALE);
const saved = readSavedState();
const rootView = {
  getCameraState: () => ({ mode: 'lofi-living-world', rotationX: 0, rotationY: 0, distance: 1, targetDistance: 1 }),
  render() {},
  zoomOut() {},
};

let world;
let groundLevelPhase;
let originSystem;
let embodiedEvolution;
let civilizationEngine;
let phase8Engine;
let phase9Engine;
let phase10Engine;
let phase10Module;
let phase11Engine;
let phase11Module;
let unifiedRuntime;
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
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
}

function saveState() {
  if (!world) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tick: world.tick, modules: moduleHost?.save?.() }));
  } catch {
    // Storage can be unavailable in private browsing.
  }
}

function restoreWorldState() {
  if (Number.isFinite(saved.tick)) world.tick = saved.tick;
}

function scalePlanetSurface(targetWorld, linearScale = PLANET_LINEAR_SCALE) {
  if (!targetWorld || !Number.isFinite(linearScale) || linearScale <= 1) return;

  targetWorld.width *= linearScale;
  targetWorld.height *= linearScale;

  if (targetWorld.camera) {
    targetWorld.camera.x *= linearScale;
    targetWorld.camera.y *= linearScale;
  }

  for (const position of targetWorld.ecs?.components?.position?.values?.() || []) {
    position.x *= linearScale;
    position.y *= linearScale;
  }

  targetWorld.globals = {
    ...(targetWorld.globals || {}),
    planetAreaScale: PLANET_AREA_SCALE,
    planetLinearScale: linearScale,
  };
}

function stepSimulation(dt = FIXED_DT) {
  stepSphere(dt);
  moduleHost.step(dt);
}

function renderFrame(timestamp) {
  moduleHost.render({
    world,
    groundLevelPhase,
    originSystem,
    embodiedEvolution,
    civilizationEngine,
    phase8Engine,
    phase9Engine,
    phase10Engine,
    phase11Engine,
    unifiedRuntime,
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
  const maxSteps = matchMedia('(pointer: coarse)').matches ? 2 : 4;
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
    panel.textContent = error?.message || 'Unable to start the living world.';
    panel.hidden = false;
  }
}

async function init() {
  try {
    const rng = createRng('stable-world');
    world = createWorld(rng);
    scalePlanetSurface(world);
    restoreWorldState();

    const mobile = matchMedia('(max-width: 720px), (pointer: coarse)').matches;
    const galaxySystem = createGalaxySystem({ seed: 20260802, mobile });
    const orbitalSystem = createOrbitalSystem(world, { star: galaxySystem.getLocalStar(), seed: 20260804 });
    originSystem = createCosmicOrigin(world, galaxySystem, orbitalSystem, { seed: 20260804 });
    originSystem.prepare();

    placeExistingEntitiesOnBiomes(world, rng);
    stepSphere = createSphericalStepper(world);
    const living = createLivingSystems(world);
    const biosphere = createBiosphere(world);
    const waterCycle = createWaterCycle(world, orbitalSystem);
    const dynamics = createPlanetDynamics(world, living, waterCycle, orbitalSystem);

    groundLevelPhase = createHeadlessGroundLevel({ mobile, seed: 20260805 });
    embodiedEvolution = createHeadlessEvolution(world, originSystem, { mobile, seed: 20260806 });
    civilizationEngine = createHeadlessCivilizationEngine(world, embodiedEvolution, { mobile, seed: 20260807 });
    phase8Engine = createPhase8Engine(world, civilizationEngine, orbitalSystem, groundLevelPhase, { mobile, seed: 20260808, headless: true });
    phase9Engine = createPhase9Engine(world, phase8Engine, orbitalSystem, galaxySystem, { mobile, seed: 20260809, headless: true });
    phase10Engine = createPhase10Engine(world, phase9Engine, galaxySystem, orbitalSystem, { mobile, seed: 20260810, headless: true });
    phase10Module = {
      ...phase10Engine,
      step(dt) {
        const phase9State = phase9Engine.getState?.() || {};
        const phase10State = phase10Engine.getState?.() || {};
        const explicitlySeeded = phase10State.missions > 0 || phase10State.projects > 0 || phase10State.ruins > 0 || phase10State.signals > 0;
        if ((phase9State.population || 0) > 0 || explicitlySeeded) phase10Engine.step(dt);
      },
    };
    phase11Engine = createPhase11Engine(world, phase10Engine, galaxySystem, { mobile, seed: 20260811 });
    phase11Module = {
      ...phase11Engine,
      step(dt) {
        const phase10State = phase10Engine.getState?.() || {};
        const phase11State = phase11Engine.getState?.() || {};
        const explicitlySeeded = phase11State.signals > 0 || phase11State.gravitationalWaves > 0 || phase11State.causalEvents > 0 || phase11State.distanceSamples > 0;
        if ((phase10State.simulatedYears || 0) > 0 || explicitlySeeded) phase11Engine.step(dt);
      },
    };
    unifiedRuntime = createLofiLivingRuntime(world, { orbitalSystem, dynamics, phase8: phase8Engine, phase9: phase9Engine, phase10: phase10Engine, phase11: phase11Engine }, { mobile, seed: 20260812 });
    unifiedRuntime.requires = ['orbits.system', 'cosmology.flrw'];

    moduleHost = createModuleHost({ world });
    moduleHost.register(originSystem);
    registerCurrentModules(moduleHost, { galaxySystem, orbitalSystem, living, biosphere, waterCycle, dynamics, reboundEndpoint: null });
    moduleHost.register(groundLevelPhase);
    moduleHost.register(embodiedEvolution);
    moduleHost.register(civilizationEngine);
    moduleHost.register(phase8Engine);
    moduleHost.register(phase9Engine);
    moduleHost.register(phase10Module);
    moduleHost.register(phase11Module);
    moduleHost.register(unifiedRuntime);
    await moduleHost.initialize();
    await moduleHost.load(saved.modules || {});
    phase11Engine.step(0);
    moduleHost.list = moduleHost.getStatus;

    window.realitySandboxModules = moduleHost;
    window.realitySandboxOrbits = orbitalSystem;
    window.realitySandboxGalaxy = galaxySystem;
    window.realitySandboxOrigin = originSystem;
    window.realitySandboxOriginSurface = null;
    window.realitySandboxEvolution = embodiedEvolution;
    window.realitySandboxCivilization = civilizationEngine;
    window.realitySandboxPhase8 = phase8Engine;
    window.realitySandboxPhase9 = phase9Engine;
    window.realitySandboxPhase10 = phase10Engine;
    window.realitySandboxPhase11 = phase11Engine;
    window.realitySandboxUnified = unifiedRuntime;
    window.realitySandboxFactories = {
      createPhase8Engine,
      createPhase9Engine,
      createPhase10Engine,
      createPhase11Engine,
      createHeadlessGroundLevel,
      createHeadlessEvolution,
      createHeadlessCivilizationEngine,
      createLofiLivingRuntime,
      createUnifiedRuntime: createLofiLivingRuntime,
    };
    window.realitySandboxCharacter = null;
    window.realitySandboxCloseup = null;
    window.realitySandboxGround = groundLevelPhase;

    debugBridge = createDebugBridge({
      world,
      moduleHost,
      globe: rootView,
      groundLevel: groundLevelPhase,
      origin: originSystem,
      evolution: embodiedEvolution,
      civilization: civilizationEngine,
      phase8: phase8Engine,
      phase9: phase9Engine,
      phase10: phase10Engine,
      phase11: phase11Engine,
      controls: {
        isPaused: () => paused,
        setPaused: value => { paused = Boolean(value); },
        getTimeScale: () => timeScale,
        setTimeScale: value => { timeScale = Math.max(0.05, Math.min(100, Number(value) || 1)); },
        stepOnce: () => stepSimulation(),
      },
    });
    installUnifiedDebugExtension(debugBridge, unifiedRuntime);

    renderFrame(performance.now());
    requestAnimationFrame(loop);
  } catch (error) {
    showError(error);
    window.realitySandboxReady = Promise.reject(error);
  }
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) lastTime = 0; });
window.addEventListener('pagehide', saveState);
window.addEventListener('DOMContentLoaded', init);
