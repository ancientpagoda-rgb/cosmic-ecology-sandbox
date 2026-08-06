import { createRng } from './core/rng.js';
import { createWorld } from './core/world.js';
import { createSphericalStepper } from './core/sphere.js';
import { createModuleHost } from './core/module-host.js';
import { createOrbitalSystem } from './core/orbital-system.js';
import { createLofiLivingRuntime } from './core/lofi-living-runtime.js';
import { placeExistingEntitiesOnBiomes } from './core/planet.js';
import { createLivingSystems } from './core/living-systems.js';
import { createPlanetDynamics } from './core/planet-dynamics.js';
import { createBiosphere } from './core/biosphere.js';
import { createWaterCycle } from './core/water-cycle.js';

const FIXED_DT = 0.06;
const STORAGE_KEY = 'reality-sandbox-living-planet-v1';
const PLANET_NAME = 'Nysa';
const PLANET_SEED = 'nysa-living-planet-734221';

let world;
let orbitalSystem;
let living;
let biosphere;
let waterCycle;
let dynamics;
let livingPlanetRuntime;
let moduleHost;
let stepSphere;
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
  if (!world || !moduleHost) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      paused,
      timeScale,
      modules: moduleHost.save(),
    }));
  } catch {
    // Storage can be unavailable in private browsing.
  }
}

function stepSimulation(dt = FIXED_DT) {
  stepSphere(dt);
  moduleHost.step(dt);
}

function renderFrame(timestamp = performance.now()) {
  moduleHost.render({ timestamp });
}

function loop(timestamp) {
  requestAnimationFrame(loop);
  if (!running || document.hidden) return;
  if (!lastTime) lastTime = timestamp;
  if (!paused) accumulator += Math.min(0.12, (timestamp - lastTime) / 1000) * timeScale;
  lastTime = timestamp;

  let steps = 0;
  const maxSteps = matchMedia('(pointer: coarse)').matches ? 3 : 6;
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

function createRootModules() {
  const orbitModule = {
    ...orbitalSystem,
    id: 'planet.orbit-seasons',
    name: 'Procedural Orbit, Seasons, and Tides',
    provides: ['climate.seasons', 'hydrology.tides'],
    initialize({ provideCapability }) {
      provideCapability('climate.seasons', orbitalSystem);
      provideCapability('hydrology.tides', orbitalSystem);
    },
  };

  const waterModule = {
    id: 'planet.water-cycle',
    name: 'Coupled Water Cycle',
    version: '1.0.0',
    execution: 'browser',
    provides: ['hydrology.surface', 'atmosphere.moisture'],
    requires: ['climate.seasons', 'hydrology.tides'],
    initialize({ provideCapability }) {
      provideCapability('hydrology.surface', waterCycle);
      provideCapability('atmosphere.moisture', waterCycle);
    },
    step(dt) { waterCycle.step(dt); },
  };

  const ecologyModule = {
    id: 'planet.living-ecology',
    name: 'Plants, Animals, and Evolution',
    version: '1.0.0',
    execution: 'browser',
    provides: ['ecology.species', 'vegetation.dynamic'],
    requires: ['hydrology.surface'],
    initialize({ provideCapability }) {
      provideCapability('ecology.species', biosphere);
      provideCapability('vegetation.dynamic', living);
    },
    step(dt) {
      living.step(dt);
      biosphere.step(dt);
    },
  };

  const dynamicsModule = {
    id: 'planet.climate-terrain-feedbacks',
    name: 'Climate and Terrain Feedbacks',
    version: '1.0.0',
    execution: 'browser',
    provides: ['planet.weather', 'planet.inspection'],
    requires: ['hydrology.surface', 'vegetation.dynamic'],
    initialize({ provideCapability }) {
      provideCapability('planet.weather', dynamics);
      provideCapability('planet.inspection', dynamics);
    },
    step(dt) { dynamics.step(dt); },
  };

  return [orbitModule, waterModule, ecologyModule, dynamicsModule, livingPlanetRuntime];
}

function installDebugApi() {
  const api = {
    ready: true,
    pause() { paused = true; livingPlanetRuntime.updateInterface(); },
    resume() { paused = false; lastTime = 0; livingPlanetRuntime.updateInterface(); },
    isPaused: () => paused,
    setTimeScale(value) {
      timeScale = Math.max(0.25, Math.min(20, Number(value) || 1));
      livingPlanetRuntime.updateInterface();
      return timeScale;
    },
    advance(steps = 1) {
      const count = Math.max(0, Math.min(10000, Math.floor(steps)));
      for (let index = 0; index < count; index++) stepSimulation();
      renderFrame();
      livingPlanetRuntime.updateInterface(true);
      return api.snapshot();
    },
    snapshot() {
      return {
        planet: PLANET_NAME,
        model: 'procedural',
        seed: PLANET_SEED,
        tick: world.tick,
        paused,
        timeScale,
        runtime: livingPlanetRuntime.getSnapshot(),
      };
    },
    diagnostics() {
      const runtime = livingPlanetRuntime.runInvariants();
      const rootIds = moduleHost.getStatus().map(module => module.id);
      const forbidden = rootIds.filter(id => /phase(?:8|9|10|11)|civilization|galaxy|cosmology|relativ/i.test(id));
      const failures = [...runtime.failures];
      if (forbidden.length) failures.push(`Frozen universe modules loaded: ${forbidden.join(', ')}`);
      return { ok: failures.length === 0, failures, modules: rootIds };
    },
    seedScenario: kind => livingPlanetRuntime.debugScenario(kind),
  };
  window.realitySandboxDebug = api;
}

function showError(error) {
  running = false;
  const panel = document.getElementById('errorState');
  if (panel) {
    panel.textContent = error?.message || 'Unable to start the living planet.';
    panel.hidden = false;
  }
}

async function init() {
  try {
    const saved = readSavedState();
    const rng = createRng(PLANET_SEED);
    world = createWorld(rng);
    world.planetName = PLANET_NAME;
    world.model = 'procedural';
    world.seed = PLANET_SEED;
    if (Number.isFinite(saved.timeScale)) timeScale = Math.max(0.25, Math.min(20, saved.timeScale));
    paused = Boolean(saved.paused);

    placeExistingEntitiesOnBiomes(world, rng);
    stepSphere = createSphericalStepper(world);

    orbitalSystem = createOrbitalSystem(world, {
      seed: 734221,
      star: {
        id: 'nysa-star',
        name: 'Nysa Star',
        mass: 0.94,
        luminosity: 0.86,
        age: 5.1,
        metallicity: -0.08,
        temperature: 5520,
        spectralClass: 'G8V',
        color: [1, 0.88, 0.68],
      },
    });
    orbitalSystem.setFormationProgress(1);

    living = createLivingSystems(world, rng);
    waterCycle = createWaterCycle(world, orbitalSystem);
    biosphere = createBiosphere(world, rng);
    dynamics = createPlanetDynamics(world, living, waterCycle, rng);

    const mobile = matchMedia('(max-width: 720px), (pointer: coarse)').matches;
    const controls = {
      isPaused: () => paused,
      setPaused(value) { paused = Boolean(value); lastTime = 0; },
      getTimeScale: () => timeScale,
      setTimeScale(value) { timeScale = Math.max(0.25, Math.min(20, Number(value) || 1)); },
      stepOnce() { stepSimulation(); renderFrame(); },
    };
    livingPlanetRuntime = createLofiLivingRuntime(
      world,
      { orbitalSystem, living, waterCycle, biosphere, dynamics },
      { mobile, seed: 734221, planetName: PLANET_NAME, controls },
    );
    livingPlanetRuntime.requires = ['planet.weather', 'planet.inspection', 'ecology.species'];

    moduleHost = createModuleHost({ world });
    for (const module of createRootModules()) moduleHost.register(module);
    await moduleHost.initialize();
    await moduleHost.load(saved.modules || {});
    moduleHost.list = moduleHost.getStatus;

    window.realitySandboxModules = moduleHost;
    window.realitySandboxPlanet = { world, orbitalSystem, living, waterCycle, biosphere, dynamics };
    window.realitySandboxUnified = livingPlanetRuntime;
    installDebugApi();

    renderFrame();
    livingPlanetRuntime.updateInterface(true);
    requestAnimationFrame(loop);
    return window.realitySandboxDebug;
  } catch (error) {
    showError(error);
    throw error;
  }
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) lastTime = 0; });
window.addEventListener('pagehide', saveState);
window.addEventListener('DOMContentLoaded', () => {
  window.realitySandboxReady = init();
  window.realitySandboxReady.catch(() => {});
});
