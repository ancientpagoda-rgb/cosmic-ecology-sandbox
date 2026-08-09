import { createRng } from './core/rng.js';
import { createWorld } from './core/world.js';
import { createSphericalStepper } from './core/sphere.js';
import { createModuleHost } from './core/module-host.js';
import { createOrbitalSystem } from './core/orbital-system.js';
import { createLofiLivingRuntime } from './core/lofi-living-runtime.js?v=20260807-unified-performance-v1';
import {
  configurePlanetGeneration,
  getPlanetGenerationState,
  loadPlanetGeology,
  placeExistingEntitiesOnBiomes,
  savePlanetGeology,
  stepPlanetGeology,
} from './core/planet.js';
import { createLivingSystems } from './core/living-systems.js';
import { createPlanetDynamics } from './core/planet-dynamics.js';
import { createBiosphere } from './core/biosphere.js';
import { createEcologyJournal } from './core/ecology-journal.js';
import { createLineageFoundry } from './core/lineage-foundry.js';
import { createSeasonalResourceFields } from './core/seasonal-resource-fields.js';
import { createWaterCycle } from './core/water-cycle.js';
import { readOriginScenario } from './core/origin-scenario.js';

const FIXED_DT = 0.06;
const MAX_STEPS_PER_FRAME = 3;
const STORAGE_PREFIX = 'reality-sandbox-living-planet-v2';
const PLANET_NAME = 'Eidolon';
const DEFAULT_PLANET_SEED = 'eidolon-living-planet-734221';
const ORIGIN_SCENARIO = readOriginScenario();
const PLANET_SEED = ORIGIN_SCENARIO?.planetSeed || readSeedFromUrl();
const NUMERIC_SEED = hashSeed(PLANET_SEED);
const STORAGE_KEY = `${STORAGE_PREFIX}:${PLANET_SEED}`;

let world;
let orbitalSystem;
let living;
let biosphere;
let waterCycle;
let dynamics;
let ecologyJournal;
let seasonalResources;
let lineageFoundry;
let livingPlanetRuntime;
let moduleHost;
let stepSphere;
let accumulator = 0;
let lastTime = 0;
let lastSave = 0;
let running = true;
let paused = false;
let timeScale = 1;

function normalizeSeed(value) {
  return String(value || '')
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 96);
}

function readSeedFromUrl() {
  const requested = normalizeSeed(new URLSearchParams(location.search).get('seed'));
  return requested || DEFAULT_PLANET_SEED;
}

function hashSeed(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 || 734221;
}

function applyOriginConditions(target, scenario) {
  if (!scenario) return;
  // These are sandbox initial conditions, not a physical derivation of biology
  // from cosmology. The normal ecological feedback loop takes over after boot.
  target.originScenario = scenario;
  target.globals.fertility = Math.max(0.2, Math.min(1.2,
    target.globals.fertility * (0.72 + scenario.energyThroughput * 0.28 + scenario.star.metallicity * 0.12),
  ));
  target.globals.reproductionThreshold = Math.max(1.2, Math.min(2.2,
    target.globals.reproductionThreshold * (0.72 + scenario.selectionPressure * 0.28),
  ));
}

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
  const maxSteps = MAX_STEPS_PER_FRAME;
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

  const geodynamicsModule = {
    id: 'planet.interior-tectonics',
    name: 'Interior, Mantle Convection, and Evolving Plates',
    version: '2.0.0',
    execution: 'browser-reduced-order-geodynamics',
    provides: ['planet.interior', 'planet.tectonics'],
    requires: [],
    initialize({ provideCapability }) {
      const generation = getPlanetGenerationState();
      provideCapability('planet.interior', generation.tectonics.interior);
      provideCapability('planet.tectonics', generation.tectonics);
    },
    step(dt) { stepPlanetGeology(dt); },
    save: savePlanetGeology,
    load: loadPlanetGeology,
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

  const seasonalResourcesModule = {
    id: 'ecology.seasonal-resource-fields',
    name: 'Seasonal Resource Fields',
    version: '1.0.0',
    execution: 'browser-reduced-order-ecology',
    provides: ['ecology.resources.seasonal'],
    requires: ['hydrology.surface', 'vegetation.dynamic', 'ecology.species'],
    initialize({ provideCapability }) { provideCapability('ecology.resources.seasonal', seasonalResources); },
    step(dt) { seasonalResources.step(dt); },
  };

  const dynamicsModule = {
    id: 'planet.climate-terrain-feedbacks',
    name: 'Climate and Terrain Feedbacks',
    version: '1.0.0',
    execution: 'browser',
    provides: ['planet.weather', 'planet.inspection'],
    requires: ['hydrology.surface', 'vegetation.dynamic', 'planet.tectonics'],
    initialize({ provideCapability }) {
      provideCapability('planet.weather', dynamics);
      provideCapability('planet.inspection', dynamics);
    },
    step(dt) { dynamics.step(dt); },
  };

  return [orbitModule, geodynamicsModule, waterModule, ecologyModule, seasonalResourcesModule, dynamicsModule, livingPlanetRuntime];
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
    tectonics: () => getPlanetGenerationState().tectonics,
    snapshot() {
      return {
        planet: PLANET_NAME,
        model: 'procedural',
        seed: PLANET_SEED,
        numericSeed: NUMERIC_SEED,
        originScenario: ORIGIN_SCENARIO,
        tick: world.tick,
        paused,
        timeScale,
        geodynamics: getPlanetGenerationState().tectonics,
        runtime: livingPlanetRuntime.getSnapshot(),
      };
    },
    diagnostics() {
      const runtime = livingPlanetRuntime.runInvariants();
      const rootIds = moduleHost.getStatus().map(module => module.id);
      const forbidden = rootIds.filter(id => /phase(?:8|9|10|11)|civilization|galaxy|cosmology|relativ/i.test(id));
      const tectonics = getPlanetGenerationState().tectonics;
      const failures = [...runtime.failures];
      if (forbidden.length) failures.push(`Frozen universe modules loaded: ${forbidden.join(', ')}`);
      if (!Number.isFinite(tectonics.interior.rayleighNumber)) failures.push('The geodynamic Rayleigh number is invalid.');
      if (!tectonics.plateCount) failures.push('The geodynamic model generated no lithospheric provinces.');
      return { ok: failures.length === 0, failures, modules: rootIds, tectonics };
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
    applyOriginConditions(world, ORIGIN_SCENARIO);
    if (Number.isFinite(saved.timeScale)) timeScale = Math.max(0.25, Math.min(20, saved.timeScale));
    paused = Boolean(saved.paused);

    orbitalSystem = createOrbitalSystem(world, {
      seed: NUMERIC_SEED,
      star: ORIGIN_SCENARIO?.star || {
        id: 'eidolon-star',
        name: 'Eidolon Star',
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

    const home = orbitalSystem.getHomePlanet();
    const star = orbitalSystem.getStar();
    const disk = orbitalSystem.getDisk();
    const formation = orbitalSystem.getFormationState();
    const moon = formation.moon;
    const generation = configurePlanetGeneration({
      seed: NUMERIC_SEED,
      worldSeed: PLANET_SEED,
      massEarth: home.massEarth,
      radiusEarth: home.radiusEarth,
      ageGyr: star.age,
      composition: home.composition,
      waterFraction: home.waterFraction,
      radioactiveAbundance: disk.metalFactor,
      metallicity: star.metallicity,
      equilibriumTemperature: home.equilibriumTemperature,
      atmosphereRetention: home.atmosphereRetention,
      moonMassEarth: moon.massEarth,
      moonPeriodDays: moon.periodDays,
      moonOrbitRadius: moon.orbitRadius,
      impactEnergy: moon.impactEnergy,
    });
    world.geodynamicProfile = generation.tectonics;

    placeExistingEntitiesOnBiomes(world, rng);
    stepSphere = createSphericalStepper(world);
    ecologyJournal = createEcologyJournal(world);
    living = createLivingSystems(world, rng, { onEvent: ecologyJournal.record });
    waterCycle = createWaterCycle(world, orbitalSystem);
    biosphere = createBiosphere(world, rng, { journal: ecologyJournal });
    lineageFoundry = createLineageFoundry({ world, biosphere, living, journal: ecologyJournal, seed: PLANET_SEED });
    seasonalResources = createSeasonalResourceFields(world, living, waterCycle, ecologyJournal);
    world.setForageField(seasonalResources);
    biosphere.setSeasonalResources(seasonalResources);
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
      { orbitalSystem, living, waterCycle, biosphere, dynamics, ecologyJournal, seasonalResources, lineageFoundry },
      { mobile, seed: PLANET_SEED, planetName: PLANET_NAME, controls },
    );
    livingPlanetRuntime.requires = ['planet.weather', 'planet.inspection', 'ecology.species', 'ecology.resources.seasonal'];

    moduleHost = createModuleHost({ world });
    for (const module of createRootModules()) moduleHost.register(module);
    await moduleHost.initialize();
    await moduleHost.load(saved.modules || {});
    moduleHost.list = moduleHost.getStatus;
    world.geodynamicProfile = getPlanetGenerationState().tectonics;

    window.realitySandboxSeed = {
      seed: PLANET_SEED,
      defaultSeed: DEFAULT_PLANET_SEED,
      numericSeed: NUMERIC_SEED,
      storageKey: STORAGE_KEY,
      originScenario: ORIGIN_SCENARIO,
    };
    window.dispatchEvent(new CustomEvent('reality-sandbox-seed-ready', { detail: window.realitySandboxSeed }));
    window.realitySandboxModules = moduleHost;
    window.realitySandboxPlanet = {
      world,
      orbitalSystem,
      living,
      waterCycle,
      biosphere,
      lineageFoundry,
      ecologyJournal,
      seasonalResources,
      dynamics,
      geodynamics: getPlanetGenerationState,
    };
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
