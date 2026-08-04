import { samplePlanet, randomHabitablePoint } from './planet.js';
import { sampleHydrology } from './hydrology.js';

const STAGES = [
  { id: 'galactic-enrichment', at: 0, label: 'GALACTIC ENRICHMENT', detail: 'Earlier stars forge and disperse the heavy elements needed for rock, water, and organic chemistry.' },
  { id: 'stellar-disk', at: 4, label: 'STELLAR DISK', detail: 'A young star gathers a rotating disk whose mass and chemistry inherit local galactic conditions.' },
  { id: 'planetary-accretion', at: 9, label: 'PLANETARY ACCRETION', detail: 'Dust becomes pebbles, planetesimals, embryos, and finally differentiated worlds.' },
  { id: 'molten-world', at: 15, label: 'MOLTEN WORLD', detail: 'Impacts, compression, and radioactive decay melt the young planet and separate core, mantle, and crust.' },
  { id: 'ocean-atmosphere', at: 21, label: 'OCEAN + ATMOSPHERE', detail: 'Volcanic gases, cooling, and volatile delivery create an atmosphere and persistent surface water.' },
  { id: 'prebiotic-chemistry', at: 28, label: 'PREBIOTIC CHEMISTRY', detail: 'Wet-dry cycles, minerals, lightning, ultraviolet light, and hydrothermal gradients concentrate organics.' },
  { id: 'protocells', at: 35, label: 'PROTOCELLS', detail: 'Self-assembling membranes enclose catalytic chemistry and create selectable compartments.' },
  { id: 'microbial-life', at: 43, label: 'MICROBIAL LIFE', detail: 'Heritable replicators become cells and spread through chemically favorable water and sediment.' },
  { id: 'photosynthesis', at: 51, label: 'PHOTOSYNTHESIS', detail: 'Light-harvesting microbes turn stellar energy into biomass and begin changing the atmosphere.' },
  { id: 'multicellular-plants', at: 59, label: 'MULTICELLULAR PLANTS', detail: 'Photosynthetic lineages cooperate, specialize, colonize wet land, and build persistent vegetation.' },
  { id: 'motile-consumers', at: 68, label: 'MOTILE CONSUMERS', detail: 'Abundant plant biomass supports mobile grazers with sensing, movement, and inherited behavior.' },
  { id: 'predation', at: 78, label: 'PREDATION', detail: 'Competition rewards organisms that hunt other organisms, creating a new trophic level.' },
  { id: 'apex-ecology', at: 90, label: 'APEX ECOLOGY', detail: 'A mature food web supports rare top predators and complex ecological feedback.' },
];

const TOTAL_DURATION = 96;

export function createCosmicOrigin(world, galaxySystem, orbitalSystem, options = {}) {
  const seed = options.seed ?? hashSeed(`${galaxySystem.getLocalStar()?.id || 'star'}:origin`);
  const rng = mulberry32(seed);
  const star = galaxySystem.getLocalStar();
  const baseWorldStep = world.step.bind(world);
  const initialFormation = orbitalSystem.getFormationState?.() || {};
  const originSite = findOriginSite(world, rng);

  let elapsed = 0;
  let stageIndex = 0;
  let cycle = 1;
  let prepared = false;
  let ecologyReleased = false;
  let destroyed = false;
  let globe = null;
  let lastHudUpdate = -Infinity;
  let chemistry = 0;
  let protocellDiversity = 0;
  let microbialBiomass = 0;
  let oxygenation = 0;
  let plantCoverage = 0;
  let lastPlantSpawn = -Infinity;
  let lastStageApplied = -1;

  const hud = document.createElement('section');
  hud.className = 'origin-hud';
  hud.setAttribute('aria-live', 'polite');
  hud.innerHTML = `
    <div class="origin-hud__title">
      <strong>CAUSAL ORIGIN</strong>
      <span data-origin-cycle>CYCLE 1</span>
    </div>
    <div class="origin-hud__phase" data-origin-phase>GALACTIC ENRICHMENT</div>
    <div class="origin-hud__detail" data-origin-detail>Preparing accelerated cosmic history…</div>
    <div class="origin-hud__bar"><i data-origin-progress></i></div>
    <div class="origin-hud__meta" data-origin-meta></div>
  `;
  document.body.append(hud);

  const phaseElement = hud.querySelector('[data-origin-phase]');
  const detailElement = hud.querySelector('[data-origin-detail]');
  const progressElement = hud.querySelector('[data-origin-progress]');
  const metaElement = hud.querySelector('[data-origin-meta]');
  const cycleElement = hud.querySelector('[data-origin-cycle]');

  function prepare() {
    if (prepared) return api;
    prepared = true;
    clearBiology();
    orbitalSystem.setFormationProgress?.(0);
    world.originState = getState;

    world.step = dt => {
      const c = world.ecs.components;
      const animalCount = c.agent.size + c.predator.size + c.apex.size;

      if (!ecologyReleased) {
        world.tick++;
        return;
      }

      if (animalCount === 0) {
        restartFromChemistry();
        world.tick++;
        return;
      }

      baseWorldStep(dt);
    };

    applyStage(0, false);
    return api;
  }

  function attachGlobe(value) {
    globe = value;
    return api;
  }

  function initialize({ provideCapability }) {
    provideCapability('origin.cosmic', api);
    provideCapability('origin.abiogenesis', api);
    provideCapability('planet.formation', orbitalSystem);
  }

  function step(dt) {
    if (destroyed) return;
    elapsed += dt * (options.rate || 1);

    const nextIndex = stageForElapsed(elapsed);
    while (lastStageApplied < nextIndex) {
      applyStage(lastStageApplied + 1, true);
    }
    stageIndex = nextIndex;

    const stage = STAGES[stageIndex];
    const localProgress = stageProgress(stageIndex, elapsed);
    chemistry = Math.max(chemistry, clamp((elapsed - STAGES[5].at) / 12, 0, 1));
    protocellDiversity = Math.max(protocellDiversity, clamp((elapsed - STAGES[6].at) / 14, 0, 1));
    microbialBiomass = Math.max(microbialBiomass, clamp((elapsed - STAGES[7].at) / 18, 0, 1));
    oxygenation = Math.max(oxygenation, clamp((elapsed - STAGES[8].at) / 25, 0, 1));
    plantCoverage = Math.max(plantCoverage, clamp((elapsed - STAGES[9].at) / 22, 0, 1));

    if (stageIndex >= 9 && stageIndex < 10 && elapsed - lastPlantSpawn > 1.15) {
      lastPlantSpawn = elapsed;
      spawnPlantCluster(2 + Math.floor(rng() * 3));
    }

    const formationProgress = clamp(elapsed / STAGES[4].at, 0, 1);
    orbitalSystem.setFormationProgress?.(formationProgress);
    document.body.dataset.originStage = stage.id;
    document.body.classList.toggle('origin-surface-locked', !getState().surfaceReady);
    document.documentElement.style.setProperty('--origin-stage-progress', String(localProgress));
  }

  function render(frame = {}) {
    if (destroyed) return;
    const timestamp = frame.timestamp ?? performance.now();
    const state = getState();

    if (!state.surfaceReady && globe?.getCameraState?.().distance <= 1.55) {
      globe.zoomOut?.();
    }

    if (timestamp - lastHudUpdate < 220) return;
    lastHudUpdate = timestamp;
    const stage = STAGES[stageIndex];
    phaseElement.textContent = stage.label;
    detailElement.textContent = stage.detail;
    cycleElement.textContent = `CYCLE ${cycle}`;
    progressElement.style.transform = `scaleX(${clamp(elapsed / TOTAL_DURATION, 0, 1)})`;

    const profile = orbitalSystem.getHomePlanet?.() || {};
    const counts = biologicalCounts();
    metaElement.textContent = [
      `${star.spectralClass} star`,
      `${formatSigned(star.metallicity)} metallicity`,
      `${profile.composition || 'forming'} world`,
      `${Math.round((profile.waterFraction || 0) * 100)}% volatiles`,
      counts.plants ? `${counts.plants} plants` : `${Math.round(microbialBiomass * 100)}% microbial biomass`,
      counts.animals ? `${counts.animals} animals` : 'no animals yet',
    ].join(' · ');
  }

  function applyStage(index, announce) {
    lastStageApplied = index;
    stageIndex = index;
    const stage = STAGES[index];

    if (index === 4) {
      world.globals.fertility = clamp(
        0.25 + (orbitalSystem.getHomePlanet?.().waterFraction || 0.25) * 0.9,
        0.25,
        1.1,
      );
    } else if (index === 9) {
      spawnPlantCluster(options.initialPlants || 18);
    } else if (index === 10) {
      spawnGrazers(options.initialGrazers || 9);
      ecologyReleased = true;
    } else if (index === 11) {
      spawnPredators(options.initialPredators || 3);
    } else if (index === 12) {
      spawnApex(options.initialApex || 1);
    }

    if (announce) emit(stage.label, stage.detail);
  }

  function restartFromChemistry() {
    cycle++;
    ecologyReleased = false;
    clearBiology();
    elapsed = STAGES[5].at;
    stageIndex = 5;
    lastStageApplied = 4;
    chemistry = 0.18;
    protocellDiversity = 0;
    microbialBiomass = 0;
    oxygenation = 0;
    plantCoverage = 0;
    applyStage(5, true);
    emit('SECOND ABIOGENESIS ATTEMPT', 'The food web collapsed. Surviving planetary chemistry begins another independent evolutionary trial.');
  }

  function clearBiology() {
    for (const id of [...world.ecs.entities]) world.ecs.destroyEntity(id);
  }

  function spawnPlantCluster(count) {
    for (let i = 0; i < count; i++) {
      const point = nearbyHabitablePoint(originSite, world, rng, 45 + plantCoverage * 180, 'plant');
      const id = world.ecs.createEntity();
      world.ecs.components.position.set(id, point);
      const pod = stageIndex >= 9 && rng() < 0.16;
      world.ecs.components.resource.set(id, {
        kind: pod ? 'pod' : 'plant',
        amount: 0.55 + rng() * 0.45,
        regenTimer: 3 + rng() * 6,
        age: rng() * 4,
        cycles: 0,
        seedTimer: pod ? 10 + rng() * 12 : null,
        origin: 'abiogenesis',
        dna: {
          branchCount: 2 + Math.floor(rng() * 5),
          branchAngle: 0.4 + rng() * 0.8,
          curvature: 0.2 + rng() * 0.6,
          segmentLength: 10 + rng() * 12,
          thickness: 0.6 + rng() * 0.8,
          depth: 0.2 + rng() * 0.7,
          lean: (rng() - 0.5) * 0.6,
        },
      });
    }
  }

  function spawnGrazers(count) {
    for (let i = 0; i < count; i++) {
      const point = nearbyResourcePoint(world, rng, 65);
      createCreature('agent', point, {
        colorHue: 175 + rng() * 85,
        energy: 1.05 + rng() * 0.4,
        age: rng() * 2,
        evolved: false,
        caste: 'pioneer',
        preferredTemperature: 0.5 + (rng() - 0.5) * 0.12,
        diseaseResistance: 0.52 + rng() * 0.16,
        sociality: 0.62 + rng() * 0.26,
      }, 34);
    }
  }

  function spawnPredators(count) {
    const c = world.ecs.components;
    const grazerPositions = [...c.agent.keys()].map(id => c.position.get(id)).filter(Boolean);
    for (let i = 0; i < count; i++) {
      const point = jitterPoint(grazerPositions[i % Math.max(1, grazerPositions.length)] || originSite, world, rng, 70);
      createCreature('predator', point, {
        colorHue: 5 + (rng() - 0.5) * 55,
        energy: 2 + rng() * 0.35,
        age: rng() * 2,
        rest: 0,
        preferredTemperature: 0.52 + (rng() - 0.5) * 0.14,
        diseaseResistance: 0.6 + rng() * 0.15,
        sociality: 0.32 + rng() * 0.25,
      }, 48);
    }
  }

  function spawnApex(count) {
    const c = world.ecs.components;
    const predatorPositions = [...c.predator.keys()].map(id => c.position.get(id)).filter(Boolean);
    for (let i = 0; i < count; i++) {
      const point = jitterPoint(predatorPositions[i % Math.max(1, predatorPositions.length)] || originSite, world, rng, 90);
      createCreature('apex', point, {
        colorHue: 220 + (rng() - 0.5) * 65,
        energy: 3.2,
        age: 0,
        rest: 0,
        preferredTemperature: 0.48 + (rng() - 0.5) * 0.12,
        diseaseResistance: 0.7 + rng() * 0.16,
        sociality: 0.12 + rng() * 0.16,
      }, 31);
    }
  }

  function createCreature(kind, point, traits, speedBase) {
    const id = world.ecs.createEntity();
    const dna = {
      speed: 0.75 + rng() * 0.55,
      sense: 0.72 + rng() * 0.62,
      metabolism: 0.74 + rng() * 0.56,
      hueShift: Math.round((rng() - 0.5) * 30),
    };
    const angle = rng() * Math.PI * 2;
    const speed = speedBase * dna.speed;
    world.ecs.components.position.set(id, point);
    world.ecs.components.velocity.set(id, {
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
    });
    world.ecs.components[kind].set(id, {
      ...traits,
      dna,
      origin: 'abiogenesis',
      originCycle: cycle,
      generation: 0,
    });
    return id;
  }

  function biologicalCounts() {
    const c = world.ecs.components;
    return {
      plants: c.resource.size,
      grazers: c.agent.size,
      predators: c.predator.size,
      apex: c.apex.size,
      animals: c.agent.size + c.predator.size + c.apex.size,
    };
  }

  function getState() {
    const stage = STAGES[stageIndex];
    const counts = biologicalCounts();
    return {
      elapsed,
      cycle,
      stage: stage.id,
      stageLabel: stage.label,
      stageIndex,
      progress: clamp(elapsed / TOTAL_DURATION, 0, 1),
      formation: orbitalSystem.getFormationState?.() || initialFormation,
      originSite: { ...originSite },
      chemistry,
      protocellDiversity,
      microbialBiomass,
      oxygenation,
      plantCoverage,
      ecologyReleased,
      surfaceReady: stageIndex >= 9,
      animalsReady: stageIndex >= 10,
      counts,
    };
  }

  function save() {
    return {
      elapsed,
      cycle,
      chemistry,
      protocellDiversity,
      microbialBiomass,
      oxygenation,
      plantCoverage,
    };
  }

  function load(state) {
    if (!state || !Number.isFinite(state.elapsed)) return;
    clearBiology();
    elapsed = clamp(state.elapsed, 0, TOTAL_DURATION);
    cycle = Math.max(1, Math.floor(state.cycle || 1));
    chemistry = clamp(state.chemistry || 0, 0, 1);
    protocellDiversity = clamp(state.protocellDiversity || 0, 0, 1);
    microbialBiomass = clamp(state.microbialBiomass || 0, 0, 1);
    oxygenation = clamp(state.oxygenation || 0, 0, 1);
    plantCoverage = clamp(state.plantCoverage || 0, 0, 1);
    ecologyReleased = false;
    lastStageApplied = -1;
    const target = stageForElapsed(elapsed);
    for (let index = 0; index <= target; index++) applyStage(index, false);
    stageIndex = target;
    orbitalSystem.setFormationProgress?.(clamp(elapsed / STAGES[4].at, 0, 1));
  }

  function emit(title, description) {
    window.dispatchEvent(new CustomEvent('origin-event', {
      detail: { title, description, stage: STAGES[stageIndex].id, cycle },
    }));
    window.dispatchEvent(new CustomEvent('reality-history', {
      detail: [{ title, description, tick: world.tick, date: new Date().toISOString() }],
    }));
  }

  function destroy() {
    destroyed = true;
    hud.remove();
    document.body.classList.remove('origin-surface-locked');
    delete document.body.dataset.originStage;
  }

  const api = {
    id: 'origin.cosmic-biological',
    name: 'Cosmic Formation and Abiogenesis',
    version: '1.0.0',
    execution: 'browser-deterministic',
    source: 'Reality Sandbox causal origin model',
    license: 'Project license',
    provides: ['origin.cosmic', 'origin.abiogenesis', 'planet.formation'],
    requires: ['stellar.metadata', 'orbits.system'],
    prepare,
    attachGlobe,
    initialize,
    step,
    render,
    save,
    load,
    getState,
    destroy,
  };

  return api;
}

function findOriginSite(world, rng) {
  let best = randomHabitablePoint(world.width, world.height, rng, 'land');
  let bestScore = -Infinity;
  for (let i = 0; i < 180; i++) {
    const point = {
      x: rng() * world.width,
      y: rng() * world.height,
    };
    const terrain = samplePlanet(point.x, point.y, world.width, world.height);
    const hydro = sampleHydrology(point.x, point.y, world.width, world.height);
    const temperatureFit = 1 - Math.abs(terrain.temperature - 0.58) * 1.8;
    const waterGradient = hydro.river * 0.7 + hydro.delta * 0.9 + hydro.lake * 0.45;
    const coast = terrain.land ? 0.2 : -0.5;
    const score = temperatureFit + waterGradient + coast + terrain.rainfall * 0.35;
    if (score > bestScore) {
      bestScore = score;
      best = point;
    }
  }
  return best;
}

function nearbyHabitablePoint(center, world, rng, radius, mode) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const point = jitterPoint(center, world, rng, radius);
    const terrain = samplePlanet(point.x, point.y, world.width, world.height);
    const hydro = sampleHydrology(point.x, point.y, world.width, world.height);
    if (!terrain.land || hydro.lake > 0.72) continue;
    if (mode === 'plant' && (terrain.rainfall < 0.3 || terrain.temperature < 0.16)) continue;
    return point;
  }
  return randomHabitablePoint(world.width, world.height, rng, 'land');
}

function nearbyResourcePoint(world, rng, radius) {
  const c = world.ecs.components;
  const resources = [...c.resource.keys()].map(id => c.position.get(id)).filter(Boolean);
  if (!resources.length) return randomHabitablePoint(world.width, world.height, rng, 'land');
  return jitterPoint(resources[Math.floor(rng() * resources.length)], world, rng, radius);
}

function jitterPoint(center, world, rng, radius) {
  const angle = rng() * Math.PI * 2;
  const distance = Math.sqrt(rng()) * radius;
  return {
    x: wrap(center.x + Math.cos(angle) * distance, world.width),
    y: clamp(center.y + Math.sin(angle) * distance, 0, world.height),
  };
}

function stageForElapsed(elapsed) {
  let index = 0;
  for (let i = 1; i < STAGES.length; i++) {
    if (elapsed < STAGES[i].at) break;
    index = i;
  }
  return index;
}

function stageProgress(index, elapsed) {
  const start = STAGES[index].at;
  const end = STAGES[index + 1]?.at ?? TOTAL_DURATION;
  return clamp((elapsed - start) / Math.max(0.001, end - start), 0, 1);
}

function formatSigned(value) {
  const number = Number(value) || 0;
  return `${number >= 0 ? '+' : ''}${number.toFixed(2)}`;
}

function hashSeed(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

const wrap = (value, max) => ((value % max) + max) % max;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
