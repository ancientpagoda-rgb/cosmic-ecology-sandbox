import { samplePlanet, randomHabitablePoint } from './planet.js';
import { sampleHydrology } from './hydrology.js';
import { createAbiogenesisField } from './abiogenesis-field.js';

const STAGES = [
  { id: 'galactic-enrichment', label: 'GALACTIC ENRICHMENT', detail: 'Earlier stars forge and disperse the heavy elements needed for rock, water, and organic chemistry.' },
  { id: 'stellar-disk', label: 'STELLAR DISK', detail: 'A young star gathers a rotating disk whose mass and chemistry inherit local galactic conditions.' },
  { id: 'planetary-accretion', label: 'PLANETARY ACCRETION', detail: 'Dust becomes pebbles, planetesimals, embryos, and differentiated worlds through gravity and collisions.' },
  { id: 'molten-world', label: 'MOLTEN WORLD', detail: 'Impacts, compression, and radioactive decay separate the young planet into core, mantle, and crust.' },
  { id: 'ocean-atmosphere', label: 'OCEAN + ATMOSPHERE', detail: 'Cooling, volcanic gases, and volatile delivery create persistent water, weather, and chemical gradients.' },
  { id: 'prebiotic-chemistry', label: 'PREBIOTIC CHEMISTRY', detail: 'Minerals, ultraviolet light, vents, and wet-dry cycles are concentrating organic molecules in favorable niches.' },
  { id: 'protocells', label: 'PROTOCELLS', detail: 'Membranes and catalytic replicators are assembling independently wherever local chemistry permits.' },
  { id: 'microbial-life', label: 'MICROBIAL LIFE', detail: 'Heritable protocells are surviving, mutating, competing, and spreading between connected environments.' },
  { id: 'photosynthesis', label: 'PHOTOSYNTHESIS', detail: 'Mutations that harvest starlight are being selected and oxygen is beginning to escape mineral sinks.' },
  { id: 'multicellular-plants', label: 'MULTICELLULAR PLANTS', detail: 'Cooperative photosynthetic lineages are building mats, tissues, and persistent terrestrial vegetation.' },
  { id: 'motile-consumers', label: 'MOTILE CONSUMERS', detail: 'Plant biomass and oxygen now support independently evolved mobile consumers and grazers.' },
  { id: 'predation', label: 'PREDATION', detail: 'Selection is rewarding organisms that sense, pursue, and consume other mobile organisms.' },
  { id: 'apex-ecology', label: 'APEX ECOLOGY', detail: 'Long-lived trophic complexity now supports rare top predators and mature ecological feedback.' },
];

const FORMATION_END = 23;
const FORMATION_BOUNDARIES = [0, 4, 9, 15, FORMATION_END];

export function createCosmicOrigin(world, galaxySystem, orbitalSystem, options = {}) {
  const seed = options.seed ?? hashSeed(`${galaxySystem.getLocalStar()?.id || 'star'}:origin`);
  const rng = mulberry32(seed);
  const star = galaxySystem.getLocalStar();
  const baseWorldStep = world.step.bind(world);
  const field = createAbiogenesisField(world, orbitalSystem, {
    seed: seed ^ 0x9E3779B9,
    columns: options.fieldColumns,
    rows: options.fieldRows,
    rate: options.chemistryRate || 8.2,
  });
  const originSite = findOriginSite(world, rng);

  let elapsed = 0;
  let stageIndex = 0;
  let highestStage = 0;
  let cycle = 1;
  let prepared = false;
  let ecologyReleased = false;
  let destroyed = false;
  let globe = null;
  let lastHudUpdate = -Infinity;
  let lastAnnouncedStage = 0;
  let plantSpawnAccumulator = 0;
  let consumerPressure = 0;
  let predatorPressure = 0;
  let apexPressure = 0;
  let savedCounts = null;

  const hud = document.createElement('section');
  hud.className = 'origin-hud';
  hud.setAttribute('aria-live', 'polite');
  hud.innerHTML = `
    <div class="origin-hud__title">
      <strong>EMERGENT ORIGIN</strong>
      <span data-origin-cycle>CYCLE 1</span>
    </div>
    <div class="origin-hud__phase" data-origin-phase>GALACTIC ENRICHMENT</div>
    <div class="origin-hud__detail" data-origin-detail>Preparing accelerated cosmic history…</div>
    <div class="origin-hud__bar"><i data-origin-progress></i></div>
    <div class="origin-hud__signals">
      <span>ORGANICS <b data-origin-organics>0%</b></span>
      <span>CELLS <b data-origin-cells>0%</b></span>
      <span>O₂ <b data-origin-oxygen>0%</b></span>
      <span>PLANTS <b data-origin-plants>0%</b></span>
    </div>
    <div class="origin-hud__meta" data-origin-meta></div>
  `;
  document.body.append(hud);

  const phaseElement = hud.querySelector('[data-origin-phase]');
  const detailElement = hud.querySelector('[data-origin-detail]');
  const progressElement = hud.querySelector('[data-origin-progress]');
  const metaElement = hud.querySelector('[data-origin-meta]');
  const cycleElement = hud.querySelector('[data-origin-cycle]');
  const organicsElement = hud.querySelector('[data-origin-organics]');
  const cellsElement = hud.querySelector('[data-origin-cells]');
  const oxygenElement = hud.querySelector('[data-origin-oxygen]');
  const plantsElement = hud.querySelector('[data-origin-plants]');

  function prepare() {
    if (prepared) return api;
    prepared = true;
    clearBiology();
    orbitalSystem.setFormationProgress?.(0);
    world.originState = getState;

    world.step = dt => {
      const counts = biologicalCounts();

      if (!ecologyReleased) {
        world.tick++;
        return;
      }

      if (counts.animals === 0) {
        ecologyReleased = false;
        world.tick++;
        return;
      }

      baseWorldStep(dt);
    };

    updateStage(false);
    return api;
  }

  function attachGlobe(value) {
    globe = value;
    return api;
  }

  function initialize({ provideCapability }) {
    provideCapability('origin.cosmic', api);
    provideCapability('origin.abiogenesis', api);
    provideCapability('biosphere.prebiotic', field);
  }

  function step(dt) {
    if (destroyed) return;
    elapsed += Math.max(0, dt) * (options.formationRate || 1);

    const formationProgress = clamp(elapsed / FORMATION_END, 0, 1);
    orbitalSystem.setFormationProgress?.(formationProgress);
    const metrics = field.step(dt, { surfaceProgress: formationProgress });

    if (formationProgress >= 0.98) {
      synchronizePlantEntities(dt, metrics);
      evolveTrophicLevels(dt, metrics);
    }

    updateStage(true);
    const state = getState();
    document.body.dataset.originStage = state.stage;
    document.body.classList.toggle('origin-surface-locked', !state.surfaceReady);
    document.documentElement.style.setProperty('--origin-stage-progress', String(state.stageReadiness));
  }

  function synchronizePlantEntities(dt, metrics) {
    const target = clamp(
      Math.round(metrics.plantCoverage * 145 + metrics.plants * 95),
      0,
      options.maxPlants || 150,
    );
    const current = world.ecs.components.resource.size;
    if (current >= target || target === 0) return;

    plantSpawnAccumulator += dt * (0.5 + metrics.plants * 10 + metrics.plantCoverage * 8);
    let budget = Math.min(4, Math.floor(plantSpawnAccumulator));
    if (!budget) return;
    plantSpawnAccumulator -= budget;

    const hotspots = field.findHotspots('plants', 20, { land: true, habitability: 0.38 });
    while (budget-- > 0 && world.ecs.components.resource.size < target) {
      const source = hotspots[Math.floor(rng() * Math.max(1, hotspots.length))];
      const point = source
        ? jitterPoint({ x: source.x, y: source.y }, world, rng, 22 + (1 - source.value) * 30)
        : nearbyHabitablePoint(originSite, world, rng, 140, 'plant');
      createPlant(point, source?.value || metrics.plants);
    }
  }

  function evolveTrophicLevels(dt, metrics) {
    const counts = biologicalCounts();
    const plantSupport = clamp(metrics.plantCoverage * 4 + metrics.plants * 3 + counts.plants / 80, 0, 1.5);
    const oxygenSupport = clamp(metrics.oxygen * 5 + metrics.oxygenatedCoverage * 2, 0, 1.3);
    const evolutionaryOpportunity = clamp(metrics.diversity * 0.8 + metrics.lineageEstimate / 120, 0.05, 1.4);

    if (counts.grazers === 0) {
      consumerPressure = clamp(
        consumerPressure + dt * plantSupport * oxygenSupport * evolutionaryOpportunity * 0.16,
        0,
        1.5,
      );
      if (consumerPressure >= 1) {
        spawnGrazers(4 + Math.floor(rng() * 3));
        consumerPressure = 0;
        ecologyReleased = true;
        emit('MOTILE CONSUMERS', 'A photosynthetic food base, oxygen, mutation, and selection produced the first mobile grazers.');
      }
    } else {
      ecologyReleased = true;
      consumerPressure = clamp(consumerPressure - dt * 0.04, 0, 1);
    }

    const updated = biologicalCounts();
    if (updated.grazers >= 4 && updated.predators === 0) {
      const preyPressure = clamp(updated.grazers / 14, 0, 1.5);
      predatorPressure = clamp(
        predatorPressure + dt * preyPressure * evolutionaryOpportunity * metrics.oxygen * 0.42,
        0,
        1.5,
      );
      if (predatorPressure >= 1) {
        spawnPredators(2);
        predatorPressure = 0;
        emit('PREDATION', 'A mobile lineage crossed into active hunting under sustained prey competition.');
      }
    }

    const trophic = biologicalCounts();
    if (trophic.predators >= 2 && trophic.apex === 0) {
      apexPressure = clamp(
        apexPressure + dt * clamp(trophic.predators / 5, 0, 1) * evolutionaryOpportunity * 0.085,
        0,
        1.5,
      );
      if (apexPressure >= 1) {
        spawnApex(1);
        apexPressure = 0;
        emit('APEX ECOLOGY', 'A rare lineage evolved the size, senses, and metabolism needed to dominate the mature food web.');
      }
    }
  }

  function updateStage(announce) {
    const next = deriveStageIndex();
    stageIndex = Math.max(stageIndex, next);
    highestStage = Math.max(highestStage, stageIndex);

    if (announce && stageIndex > lastAnnouncedStage) {
      for (let index = lastAnnouncedStage + 1; index <= stageIndex; index++) {
        emit(STAGES[index].label, STAGES[index].detail);
      }
      lastAnnouncedStage = stageIndex;
    }
  }

  function deriveStageIndex() {
    if (elapsed < FORMATION_BOUNDARIES[1]) return 0;
    if (elapsed < FORMATION_BOUNDARIES[2]) return 1;
    if (elapsed < FORMATION_BOUNDARIES[3]) return 2;
    if (elapsed < FORMATION_BOUNDARIES[4]) return 3;

    const metrics = field.getMetrics();
    const counts = biologicalCounts();
    let index = 4;
    if (metrics.organicCoverage > 0.045 || metrics.organics > 0.032) index = 5;
    if (metrics.protocellCoverage > 0.0025 || metrics.protocells > 0.0015) index = 6;
    if (metrics.microbialCoverage > 0.0025 || metrics.microbes > 0.0018) index = 7;
    if (metrics.photoCoverage > 0.0015 && metrics.oxygen > 0.0009) index = 8;
    if (metrics.plantCoverage > 0.0015 || counts.plants > 0) index = 9;
    if (counts.grazers > 0) index = 10;
    if (counts.predators > 0) index = 11;
    if (counts.apex > 0) index = 12;
    return index;
  }

  function render(frame = {}) {
    if (destroyed) return;
    const timestamp = frame.timestamp ?? performance.now();
    const state = getState();

    if (!state.surfaceReady && globe?.getCameraState?.().distance <= 1.55) globe.zoomOut?.();
    if (timestamp - lastHudUpdate < 180) return;
    lastHudUpdate = timestamp;

    const stage = STAGES[state.stageIndex];
    const metrics = state.metrics;
    phaseElement.textContent = stage.label;
    detailElement.textContent = stage.detail;
    cycleElement.textContent = `CYCLE ${cycle}`;
    progressElement.style.transform = `scaleX(${state.stageReadiness})`;
    organicsElement.textContent = percent(metrics.organicCoverage);
    cellsElement.textContent = percent(metrics.microbialCoverage);
    oxygenElement.textContent = percent(metrics.oxygen);
    plantsElement.textContent = percent(metrics.plantCoverage);

    const profile = orbitalSystem.getHomePlanet?.() || {};
    const counts = state.counts;
    metaElement.textContent = [
      `${star.spectralClass} star`,
      `${formatSigned(star.metallicity)} metallicity`,
      `${profile.composition || 'forming'} world`,
      `${metrics.activeNiches} viable niches`,
      `${metrics.lineageEstimate} lineages`,
      counts.plants ? `${counts.plants} plants` : 'no macroscopic plants',
      counts.animals ? `${counts.animals} animals` : 'no animals',
    ].join(' · ');
  }

  function createPlant(point, fieldStrength) {
    const id = world.ecs.createEntity();
    const pod = fieldStrength > 0.28 && rng() < 0.12;
    world.ecs.components.position.set(id, point);
    world.ecs.components.resource.set(id, {
      kind: pod ? 'pod' : 'plant',
      amount: clamp(0.42 + fieldStrength * 0.5 + rng() * 0.2, 0.35, 1),
      regenTimer: 3 + rng() * 6,
      age: rng() * 3,
      cycles: 0,
      seedTimer: pod ? 10 + rng() * 12 : null,
      origin: 'emergent-abiogenesis',
      originCycle: cycle,
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
    return id;
  }

  function spawnGrazers(count) {
    const hotspots = field.findHotspots('plants', 12, { land: true });
    for (let index = 0; index < count; index++) {
      const source = hotspots[index % Math.max(1, hotspots.length)];
      const point = source
        ? jitterPoint({ x: source.x, y: source.y }, world, rng, 38)
        : nearbyResourcePoint(world, rng, 65);
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
    for (let index = 0; index < count; index++) {
      const point = jitterPoint(grazerPositions[index % Math.max(1, grazerPositions.length)] || originSite, world, rng, 70);
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
    for (let index = 0; index < count; index++) {
      const point = jitterPoint(predatorPositions[index % Math.max(1, predatorPositions.length)] || originSite, world, rng, 90);
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
      origin: 'emergent-abiogenesis',
      originCycle: cycle,
      generation: 0,
    });
    return id;
  }

  function clearBiology() {
    for (const id of [...world.ecs.entities]) world.ecs.destroyEntity(id);
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
    const metrics = field.getMetrics();
    const formationProgress = clamp(elapsed / FORMATION_END, 0, 1);
    const counts = biologicalCounts();
    return {
      elapsed,
      cycle,
      stage: STAGES[stageIndex].id,
      stageLabel: STAGES[stageIndex].label,
      stageIndex,
      highestStage,
      stageReadiness: stageReadiness(stageIndex, elapsed, metrics, counts),
      formation: orbitalSystem.getFormationState?.(),
      formationProgress,
      originSite: { ...originSite },
      metrics,
      pressures: { consumerPressure, predatorPressure, apexPressure },
      ecologyReleased,
      surfaceReady: formationProgress >= 0.92,
      animalsReady: counts.animals > 0,
      counts,
    };
  }

  function getSurfaceSignal(u, v) {
    return field.getSurfaceSignal(u, v);
  }

  function save() {
    return {
      elapsed,
      cycle,
      stageIndex,
      highestStage,
      ecologyReleased,
      consumerPressure,
      predatorPressure,
      apexPressure,
      counts: biologicalCounts(),
      field: field.save(),
    };
  }

  function load(state) {
    if (!state || !Number.isFinite(state.elapsed)) return;
    clearBiology();
    elapsed = Math.max(0, state.elapsed);
    cycle = Math.max(1, Math.floor(state.cycle || 1));
    stageIndex = clamp(Math.floor(state.stageIndex || 0), 0, STAGES.length - 1);
    highestStage = clamp(Math.floor(state.highestStage ?? stageIndex), stageIndex, STAGES.length - 1);
    ecologyReleased = Boolean(state.ecologyReleased);
    consumerPressure = clamp(state.consumerPressure || 0, 0, 1.5);
    predatorPressure = clamp(state.predatorPressure || 0, 0, 1.5);
    apexPressure = clamp(state.apexPressure || 0, 0, 1.5);
    field.load(state.field);
    savedCounts = state.counts || null;
    rebuildEcology(savedCounts);
    orbitalSystem.setFormationProgress?.(clamp(elapsed / FORMATION_END, 0, 1));
    lastAnnouncedStage = stageIndex;
    updateStage(false);
  }

  function rebuildEcology(counts = {}) {
    const plantTarget = clamp(Math.floor(counts.plants || 0), 0, options.maxPlants || 150);
    const hotspots = field.findHotspots('plants', 20, { land: true });
    for (let index = 0; index < plantTarget; index++) {
      const source = hotspots[index % Math.max(1, hotspots.length)];
      const point = source
        ? jitterPoint({ x: source.x, y: source.y }, world, rng, 35)
        : nearbyHabitablePoint(originSite, world, rng, 120, 'plant');
      createPlant(point, source?.value || field.getMetrics().plants);
    }
    if (counts.grazers) spawnGrazers(clamp(Math.floor(counts.grazers), 0, 30));
    if (counts.predators) spawnPredators(clamp(Math.floor(counts.predators), 0, 12));
    if (counts.apex) spawnApex(clamp(Math.floor(counts.apex), 0, 4));
    ecologyReleased = biologicalCounts().animals > 0;
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
    name: 'Emergent Cosmic Formation and Abiogenesis',
    version: '2.0.0',
    execution: 'browser-deterministic',
    source: 'Reality Sandbox spatial chemistry and selection model',
    license: 'Project license',
    provides: ['origin.cosmic', 'origin.abiogenesis', 'biosphere.prebiotic'],
    requires: ['stellar.metadata', 'orbits.system'],
    prepare,
    attachGlobe,
    initialize,
    step,
    render,
    save,
    load,
    getState,
    getSurfaceSignal,
    getVisualRevision: () => field.getVisualRevision() + highestStage * 100000,
    getField: () => field,
    destroy,
  };

  return api;
}

function stageReadiness(stageIndex, elapsed, metrics, counts) {
  if (stageIndex <= 3) {
    const start = FORMATION_BOUNDARIES[stageIndex];
    const end = FORMATION_BOUNDARIES[stageIndex + 1];
    return clamp((elapsed - start) / Math.max(0.001, end - start), 0, 1);
  }
  switch (stageIndex) {
    case 4: return clamp(Math.max(metrics.organicCoverage / 0.045, metrics.organics / 0.032), 0, 1);
    case 5: return clamp(Math.max(metrics.protocellCoverage / 0.0025, metrics.protocells / 0.0015), 0, 1);
    case 6: return clamp(Math.max(metrics.microbialCoverage / 0.0025, metrics.microbes / 0.0018), 0, 1);
    case 7: return clamp(Math.min(metrics.photoCoverage / 0.0015, metrics.oxygen / 0.0009), 0, 1);
    case 8: return clamp(Math.max(metrics.plantCoverage / 0.0015, counts.plants / 4), 0, 1);
    case 9: return clamp(Math.max(counts.grazers / 2, metrics.plants * 5), 0, 1);
    case 10: return clamp(Math.max(counts.predators, counts.grazers / 8), 0, 1);
    case 11: return clamp(Math.max(counts.apex, counts.predators / 4), 0, 1);
    default: return 1;
  }
}

function findOriginSite(world, rng) {
  let best = randomHabitablePoint(world.width, world.height, rng, 'land');
  let bestScore = -Infinity;
  for (let index = 0; index < 180; index++) {
    const point = { x: rng() * world.width, y: rng() * world.height };
    const terrain = samplePlanet(point.x, point.y, world.width, world.height);
    const hydro = sampleHydrology(point.x, point.y, world.width, world.height);
    const temperatureFit = 1 - Math.abs(terrain.temperature - 0.58) * 1.8;
    const gradients = hydro.river * 0.7 + hydro.delta * 0.9 + hydro.lake * 0.45 + terrain.plateBoundary * 0.28;
    const score = temperatureFit + gradients + (terrain.land ? 0.2 : -0.2) + terrain.rainfall * 0.35;
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

function percent(value) {
  return `${Math.round(clamp(value, 0, 1) * 100)}%`;
}

function formatSigned(value) {
  const number = Number(value) || 0;
  return `${number >= 0 ? '+' : ''}${number.toFixed(2)}`;
}

function hashSeed(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
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
