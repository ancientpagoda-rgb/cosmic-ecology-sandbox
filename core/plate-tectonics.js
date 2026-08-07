/*
 * Deterministic reduced-order planetary geodynamics for Reality Sandbox.
 *
 * This is not a full mantle-convection solver. It preserves the causal chain:
 * formation/astrophysics -> interior heat and rheology -> convection regime ->
 * spherical mantle flow -> plate-boundary kinematics -> evolving plates.
 */

const TAU = Math.PI * 2;
const EARTH_MASS_KG = 5.9722e24;
const EARTH_RADIUS_M = 6.371e6;
const DEFAULT_SEED = 918273;
const DEFAULT_PROFILE = {
  seed: DEFAULT_SEED,
  massEarth: 1,
  radiusEarth: 1,
  ageGyr: 4.57,
  composition: 'silicate-rocky',
  waterFraction: 0.025,
  radioactiveAbundance: 1,
  metallicity: 0,
  equilibriumTemperature: 278,
  atmosphereRetention: 1,
  moonMassEarth: 0.0123,
  moonPeriodDays: 27.3,
  moonOrbitRadius: 0.38,
  impactEnergy: 1,
};

let activeModel = createGeodynamicModel(DEFAULT_PROFILE);

export function configureTectonics(profile = {}) {
  activeModel = createGeodynamicModel({ ...DEFAULT_PROFILE, ...profile });
  return getTectonicState();
}

export function stepTectonics(dt) {
  if (!Number.isFinite(dt) || dt <= 0) return getTectonicState();
  const geologicalDt = Math.min(0.08, dt * activeModel.evolutionRateMyrPerSecond);
  advanceModel(activeModel, geologicalDt, false);
  return getTectonicState();
}

export function sampleTectonics(nx, ny, nz) {
  const point = normalize({ x: nx, y: ny, z: nz });
  const model = activeModel;
  const flow = sampleMantleFlow(model, point);
  const plates = model.plates;

  if (!plates.length) {
    return fallbackSample(model, flow);
  }

  let nearest = null;
  let second = null;
  for (const plate of plates) {
    const score = plateAffinity(model, plate, point, flow);
    if (!nearest || score > nearest.score) {
      second = nearest;
      nearest = { plate, score };
    } else if (!second || score > second.score) {
      second = { plate, score };
    }
  }

  const a = nearest.plate;
  const b = second?.plate ?? a;
  const scoreGap = Math.max(0, nearest.score - (second?.score ?? nearest.score - 1));
  const boundaryStrength = clamp(Math.exp(-scoreGap * model.boundarySharpness), 0, 1);

  const velocityA = plateVelocityAt(a, point);
  const velocityB = plateVelocityAt(b, point);
  const relative = subtract(velocityB, velocityA);
  const boundaryNormal = safeNormalize(projectTangent(subtract(b.center, a.center), point), flow.velocity);
  const boundaryTangent = safeNormalize(cross(point, boundaryNormal), { x: 0, y: 1, z: 0 });
  const normalRelative = dot(relative, boundaryNormal);
  const shearRelative = Math.abs(dot(relative, boundaryTangent));

  const flowNormal = flow.divergence * model.regime.flowBoundaryCoupling;
  const divergence = clamp(Math.max(0, normalRelative + flowNormal) * model.regime.kinematicGain, 0, 1);
  const convergence = clamp(Math.max(0, -normalRelative - flowNormal) * model.regime.kinematicGain, 0, 1);
  const transform = clamp(shearRelative * model.regime.shearGain, 0, 1);
  const uplift = convergence * boundaryStrength * model.regime.upliftEfficiency;
  const rift = divergence * boundaryStrength * model.regime.riftEfficiency;
  const shear = transform * boundaryStrength;
  const volcanism = clamp(
    flow.heat * model.regime.hotspotStrength +
    rift * 0.62 +
    uplift * 0.48 +
    (model.regime.mode === 'heat-pipe volcanism' ? 0.38 : 0),
    0,
    1,
  );

  let boundaryType = 'intraplate';
  if (boundaryStrength > 0.22) {
    if (divergence >= convergence && divergence >= transform * 0.8) boundaryType = 'ridge';
    else if (convergence >= divergence && convergence >= transform * 0.78) boundaryType = 'trench';
    else boundaryType = 'transform';
  }

  const continentalBias = clamp(
    a.continental * 0.74 +
    b.continental * 0.20 +
    flow.buoyancy * 0.06 -
    Math.max(0, a.density - 1) * 0.08,
    0,
    1,
  );

  return {
    plateId: a.id,
    neighborPlateId: b.id,
    continentalBias,
    boundaryStrength,
    boundaryType,
    convergence,
    divergence,
    transform,
    uplift,
    rift,
    shear,
    volcanism,
    mantleHeat: flow.heat,
    mantleFlowSpeed: length(flow.velocity),
    crustAgeMyr: a.crustAgeMyr,
    plateAgeMyr: Math.max(0, model.geologicAgeMyr - a.birthMyr),
    tectonicMode: model.regime.mode,
  };
}

export function getTectonicState() {
  const model = activeModel;
  return {
    version: 2,
    seed: model.seed,
    geologicAgeMyr: model.geologicAgeMyr,
    evolutionRateMyrPerSecond: model.evolutionRateMyrPerSecond,
    interior: { ...model.interior },
    regime: { ...model.regime },
    plateCount: model.plates.length,
    plates: model.plates.map(plate => ({
      id: plate.id,
      generation: plate.generation,
      parentId: plate.parentId,
      continental: plate.continental,
      density: plate.density,
      areaWeight: plate.areaWeight,
      crustAgeMyr: plate.crustAgeMyr,
      birthMyr: plate.birthMyr,
      center: { ...plate.center },
      velocity: { ...plate.velocity },
    })),
    recentEvents: model.events.slice(-12).map(event => ({ ...event })),
  };
}

export function saveTectonics() {
  const model = activeModel;
  return {
    version: 2,
    seed: model.seed,
    geologicAgeMyr: model.geologicAgeMyr,
    eventCountdownMyr: model.eventCountdownMyr,
    nextPlateId: model.nextPlateId,
    plates: model.plates.map(serializePlate),
    flowModes: model.flowModes.map(mode => ({
      ...mode,
      axis: { ...mode.axis },
      driftAxis: { ...mode.driftAxis },
    })),
    turbulentModes: model.turbulentModes.map(mode => ({ ...mode, axis: { ...mode.axis } })),
    events: model.events.slice(-24),
  };
}

export function loadTectonics(state = {}) {
  if (!state || state.version !== 2 || state.seed !== activeModel.seed) return false;
  if (Number.isFinite(state.geologicAgeMyr)) activeModel.geologicAgeMyr = Math.max(0, state.geologicAgeMyr);
  if (Number.isFinite(state.eventCountdownMyr)) activeModel.eventCountdownMyr = Math.max(0.01, state.eventCountdownMyr);
  if (Number.isFinite(state.nextPlateId)) activeModel.nextPlateId = Math.max(1, Math.floor(state.nextPlateId));
  if (Array.isArray(state.plates) && state.plates.length) {
    activeModel.plates = state.plates.map(deserializePlate).filter(Boolean);
  }
  if (Array.isArray(state.flowModes) && state.flowModes.length) {
    activeModel.flowModes = state.flowModes.map(mode => ({
      ...mode,
      axis: normalize(mode.axis),
      driftAxis: normalize(mode.driftAxis),
    }));
  }
  if (Array.isArray(state.turbulentModes) && state.turbulentModes.length) {
    activeModel.turbulentModes = state.turbulentModes.map(mode => ({ ...mode, axis: normalize(mode.axis) }));
  }
  if (Array.isArray(state.events)) activeModel.events = state.events.slice(-24);
  return true;
}

function createGeodynamicModel(profile) {
  const seed = normalizeSeed(profile.seed);
  const rng = mulberry32(seed);
  const interior = deriveInterior(profile);
  const regime = deriveRegime(interior, rng);
  const ageMyr = interior.ageGyr * 1000;
  const model = {
    seed,
    profile: { ...profile, seed },
    interior,
    regime,
    geologicAgeMyr: Math.max(0, ageMyr - Math.min(ageMyr, regime.preEvolutionMyr)),
    evolutionRateMyrPerSecond: regime.evolutionRateMyrPerSecond,
    boundarySharpness: regime.boundarySharpness,
    flowModes: createFlowModes(rng, regime),
    turbulentModes: createTurbulentModes(rng, regime),
    plates: [],
    events: [],
    nextPlateId: 1,
    eventCountdownMyr: randomRange(rng, regime.eventIntervalMyr[0], regime.eventIntervalMyr[1]),
    rng,
  };

  model.plates = seedPlatesFromMantleFlow(model, rng);

  const remaining = ageMyr - model.geologicAgeMyr;
  if (remaining > 0) {
    const steps = clamp(Math.ceil(remaining / 18), 16, 72);
    const dt = remaining / steps;
    for (let index = 0; index < steps; index++) advanceModel(model, dt, true);
  }

  model.geologicAgeMyr = ageMyr;
  return model;
}

function deriveInterior(profile) {
  const massEarth = clamp(Number(profile.massEarth) || 1, 0.08, 16);
  const radiusEarth = clamp(Number(profile.radiusEarth) || Math.pow(massEarth, 0.27), 0.35, 2.4);
  const ageGyr = clamp(Number(profile.ageGyr) || 4.57, 0.01, 13.7);
  const waterFraction = clamp(Number(profile.waterFraction) || 0, 0, 0.7);
  const metallicity = clamp(Number(profile.metallicity) || 0, -2.5, 0.8);
  const radioactiveAbundance = clamp(Number(profile.radioactiveAbundance) || Math.pow(10, metallicity), 0.08, 3.5);
  const equilibriumTemperature = clamp(Number(profile.equilibriumTemperature) || 278, 35, 1800);
  const atmosphereRetention = clamp(Number(profile.atmosphereRetention) || 0, 0, 1);
  const composition = String(profile.composition || 'silicate-rocky');
  const moonMassEarth = clamp(Number(profile.moonMassEarth) || 0, 0, 0.2);
  const moonPeriodDays = clamp(Number(profile.moonPeriodDays) || 30, 0.2, 300);
  const impactEnergy = clamp(Number(profile.impactEnergy) || 0.5, 0, 5);

  const compositionCoreOffset = composition.includes('carbon') ? 0.035 : composition.includes('ice') ? -0.075 : 0;
  const coreMassFraction = clamp(0.31 + compositionCoreOffset + metallicity * 0.025 + (massEarth - 1) * 0.008, 0.18, 0.48);
  const coreRadiusFraction = clamp(0.43 + coreMassFraction * 0.38, 0.47, 0.64);
  const radiusM = radiusEarth * EARTH_RADIUS_M;
  const massKg = massEarth * EARTH_MASS_KG;
  const surfaceGravity = 6.6743e-11 * massKg / (radiusM * radiusM);
  const mantleThicknessM = radiusM * (1 - coreRadiusFraction);
  const meanMantleDensity = clamp(3900 + 620 * massEarth / Math.max(0.5, radiusEarth ** 3), 3500, 5900);
  const surfaceTemperatureK = clamp(
    equilibriumTemperature + atmosphereRetention * (28 + waterFraction * 38),
    40,
    1900,
  );

  const primordialHeatK = 1320 * Math.exp(-ageGyr / 2.75) * Math.pow(massEarth / radiusEarth, 0.22);
  const radiogenicHeatK = 390 * radioactiveAbundance * Math.exp(-ageGyr / 7.1);
  const tidalIndex = clamp(
    Math.pow(moonMassEarth / 0.0123, 2) *
    Math.pow(27.3 / moonPeriodDays, 4) *
    (0.35 + impactEnergy * 0.35),
    0,
    5,
  );
  const tidalHeatK = 170 * Math.pow(tidalIndex, 0.55);
  const mantlePotentialTemperatureK = clamp(
    1160 + primordialHeatK + radiogenicHeatK + tidalHeatK,
    980,
    2850,
  );
  const deltaTemperatureK = Math.max(80, mantlePotentialTemperatureK - surfaceTemperatureK);
  const mantleWaterIndex = clamp(Math.sqrt(waterFraction / 0.025), 0, 4.5);
  const waterWeakening = 1 + mantleWaterIndex * 0.78;
  const pressureStrengthening = Math.log10(Math.max(0.2, massEarth / radiusEarth ** 2)) * 0.34;
  const log10Viscosity = clamp(
    21.25 + (1550 - mantlePotentialTemperatureK) / 285 + pressureStrengthening - Math.log10(waterWeakening),
    18.2,
    24.2,
  );
  const mantleViscosityPaS = 10 ** log10Viscosity;
  const thermalExpansion = 3e-5 * clamp(1.08 - (massEarth - 1) * 0.025, 0.72, 1.12);
  const thermalDiffusivity = 1e-6;
  const rayleighNumber = clamp(
    meanMantleDensity * surfaceGravity * thermalExpansion * deltaTemperatureK * mantleThicknessM ** 3 /
    (thermalDiffusivity * mantleViscosityPaS),
    1e2,
    1e13,
  );
  const log10Rayleigh = Math.log10(rayleighNumber);

  const hydrationWeakening = clamp(1 - mantleWaterIndex * 0.12, 0.42, 1);
  const thermalWeakening = clamp(1 - Math.max(0, surfaceTemperatureK - 310) / 1700, 0.3, 1);
  const surfaceYieldStrengthMPa = clamp(
    118 * (surfaceGravity / 9.81) ** 0.72 * hydrationWeakening * thermalWeakening *
    (composition.includes('carbon') ? 1.12 : 1),
    12,
    420,
  );
  const buoyancyPressurePa = meanMantleDensity * surfaceGravity * thermalExpansion * deltaTemperatureK * mantleThicknessM;
  const convectiveStressMPa = clamp(
    buoyancyPressurePa * 0.0012 * Math.pow(rayleighNumber / 1e7, 0.20) / 1e6,
    0.4,
    230,
  );
  const mobilityIndex = sigmoid(
    (log10Rayleigh - 6.25) * 0.92 +
    mantleWaterIndex * 0.42 +
    tidalIndex * 0.16 +
    convectiveStressMPa / Math.max(18, surfaceYieldStrengthMPa) * 2.8 -
    1.35,
  );
  const volcanicFluxIndex = clamp(
    Math.pow(rayleighNumber / 1e7, 0.24) *
    (mantlePotentialTemperatureK / 1550) ** 1.8 *
    (1 + tidalIndex * 0.28),
    0.05,
    8,
  );

  return {
    massEarth,
    radiusEarth,
    ageGyr,
    composition,
    waterFraction,
    mantleWaterIndex,
    radioactiveAbundance,
    metallicity,
    equilibriumTemperature,
    surfaceTemperatureK,
    coreMassFraction,
    coreRadiusFraction,
    mantleThicknessKm: mantleThicknessM / 1000,
    surfaceGravity,
    meanMantleDensity,
    mantlePotentialTemperatureK,
    deltaTemperatureK,
    mantleViscosityPaS,
    log10Viscosity,
    rayleighNumber,
    log10Rayleigh,
    surfaceYieldStrengthMPa,
    convectiveStressMPa,
    mobilityIndex,
    volcanicFluxIndex,
    tidalHeatIndex: tidalIndex,
  };
}

function deriveRegime(interior, rng) {
  const { mobilityIndex, volcanicFluxIndex, ageGyr, mantleWaterIndex, log10Rayleigh } = interior;
  let mode;
  if (ageGyr < 1.25 && volcanicFluxIndex > 1.72 && mantleWaterIndex < 1.15) mode = 'heat-pipe volcanism';
  else if (mobilityIndex < 0.27 || log10Rayleigh < 5.2) mode = 'stagnant lid';
  else if (mobilityIndex < 0.44) mode = 'episodic lid';
  else if (mobilityIndex < 0.66) mode = 'sluggish/mobile lid';
  else mode = 'full plate tectonics';

  const settings = {
    'stagnant lid': {
      plateRange: [1, 3], flowDegreeRange: [1, 2], flowModes: 5, turbulentModes: 5,
      minPlates: 1, maxPlates: 4, eventIntervalMyr: [220, 520], preEvolutionMyr: 650,
      evolutionRateMyrPerSecond: 0.00045, upliftEfficiency: 0.38, riftEfficiency: 0.22,
      hotspotStrength: 0.72, flowBoundaryCoupling: 0.18, kinematicGain: 2.2, shearGain: 2.4,
      boundarySharpness: 34,
    },
    'episodic lid': {
      plateRange: [4, 8], flowDegreeRange: [1, 3], flowModes: 7, turbulentModes: 7,
      minPlates: 3, maxPlates: 10, eventIntervalMyr: [80, 210], preEvolutionMyr: 820,
      evolutionRateMyrPerSecond: 0.0008, upliftEfficiency: 0.72, riftEfficiency: 0.58,
      hotspotStrength: 0.62, flowBoundaryCoupling: 0.26, kinematicGain: 2.8, shearGain: 3.0,
      boundarySharpness: 30,
    },
    'sluggish/mobile lid': {
      plateRange: [7, 14], flowDegreeRange: [2, 4], flowModes: 9, turbulentModes: 9,
      minPlates: 5, maxPlates: 17, eventIntervalMyr: [55, 150], preEvolutionMyr: 980,
      evolutionRateMyrPerSecond: 0.0012, upliftEfficiency: 0.92, riftEfficiency: 0.82,
      hotspotStrength: 0.52, flowBoundaryCoupling: 0.34, kinematicGain: 3.3, shearGain: 3.7,
      boundarySharpness: 27,
    },
    'full plate tectonics': {
      plateRange: [10, 19], flowDegreeRange: [2, 5], flowModes: 11, turbulentModes: 11,
      minPlates: 7, maxPlates: 24, eventIntervalMyr: [35, 120], preEvolutionMyr: 1200,
      evolutionRateMyrPerSecond: 0.0017, upliftEfficiency: 1.08, riftEfficiency: 0.98,
      hotspotStrength: 0.46, flowBoundaryCoupling: 0.42, kinematicGain: 3.8, shearGain: 4.2,
      boundarySharpness: 25,
    },
    'heat-pipe volcanism': {
      plateRange: [1, 4], flowDegreeRange: [1, 3], flowModes: 8, turbulentModes: 12,
      minPlates: 1, maxPlates: 6, eventIntervalMyr: [90, 260], preEvolutionMyr: 420,
      evolutionRateMyrPerSecond: 0.001, upliftEfficiency: 0.34, riftEfficiency: 0.28,
      hotspotStrength: 1.18, flowBoundaryCoupling: 0.22, kinematicGain: 2.4, shearGain: 2.5,
      boundarySharpness: 32,
    },
  }[mode];

  const targetPlateCount = randomInteger(rng, settings.plateRange[0], settings.plateRange[1]);
  return {
    mode,
    targetPlateCount,
    convectiveWavelength: TAU / Math.max(1, Math.sqrt(targetPlateCount)),
    ...settings,
  };
}

function createFlowModes(rng, regime) {
  const modes = [];
  for (let index = 0; index < regime.flowModes; index++) {
    const degree = randomInteger(rng, regime.flowDegreeRange[0], regime.flowDegreeRange[1]);
    modes.push({
      axis: randomUnitVector(rng),
      driftAxis: randomUnitVector(rng),
      degree,
      amplitude: (0.36 + rng() * 0.64) / Math.sqrt(degree),
      swirl: (rng() - 0.5) * (0.18 + rng() * 0.34),
      driftRate: (rng() - 0.5) * 0.00024,
    });
  }
  return modes;
}

function createTurbulentModes(rng, regime) {
  return Array.from({ length: regime.turbulentModes }, () => ({
    axis: randomUnitVector(rng),
    frequency: 3 + randomInteger(rng, 0, 9),
    amplitude: 0.025 + rng() * 0.075,
    phase: rng() * TAU,
    drift: (rng() - 0.5) * 0.0018,
    swirl: (rng() - 0.5) * 0.11,
  }));
}

function sampleMantleFlow(model, point) {
  let velocity = { x: 0, y: 0, z: 0 };
  let divergence = 0;
  let vorticity = 0;
  let heat = 0;
  let totalAmplitude = 0;

  for (const mode of model.flowModes) {
    const u = clamp(dot(point, mode.axis), -1, 1);
    const basis = legendre(mode.degree, u);
    const derivative = legendreDerivative(mode.degree, u);
    const tangent = projectTangent(mode.axis, point);
    const rotational = cross(mode.axis, point);
    const amplitude = mode.amplitude;
    velocity = add(velocity, scale(tangent, amplitude * derivative));
    velocity = add(velocity, scale(rotational, mode.swirl * (0.4 + Math.abs(basis))));
    divergence += -mode.degree * (mode.degree + 1) * amplitude * basis;
    vorticity += mode.swirl * basis;
    heat += Math.max(0, basis * amplitude);
    totalAmplitude += Math.abs(amplitude);
  }

  for (const mode of model.turbulentModes) {
    const phase = mode.frequency * dot(point, mode.axis) + mode.phase;
    const wave = Math.sin(phase);
    const tangent = projectTangent(mode.axis, point);
    velocity = add(velocity, scale(tangent, Math.cos(phase) * mode.frequency * mode.amplitude));
    velocity = add(velocity, scale(cross(mode.axis, point), mode.swirl * wave));
    divergence += -wave * mode.frequency * mode.amplitude * 0.55;
    vorticity += mode.swirl * Math.cos(phase);
    heat += Math.max(0, wave) * mode.amplitude * 0.7;
    totalAmplitude += mode.amplitude;
  }

  const normalization = Math.max(0.1, totalAmplitude);
  velocity = scale(projectTangent(velocity, point), 1 / normalization);
  const speed = length(velocity);
  if (speed > 1) velocity = scale(velocity, 1 / speed);

  return {
    velocity,
    divergence: clamp(divergence / (normalization * 7.5), -1, 1),
    vorticity: clamp(vorticity / normalization, -1, 1),
    heat: clamp(heat / (normalization * 0.55), 0, 1),
    buoyancy: clamp(0.5 + divergence / (normalization * 10), 0, 1),
  };
}

function seedPlatesFromMantleFlow(model, rng) {
  const target = model.regime.targetPlateCount;
  const candidateCount = Math.max(96, target * 16);
  const candidates = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let index = 0; index < candidateCount; index++) {
    const y = 1 - (index + 0.5) / candidateCount * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * index + (rng() - 0.5) * 0.22;
    const point = normalize({ x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius });
    const flow = sampleMantleFlow(model, point);
    const coherence = length(flow.velocity) * 0.72 + (1 - Math.abs(flow.divergence)) * 0.28;
    candidates.push({ point, flow, score: coherence + rng() * 0.08 });
  }

  candidates.sort((a, b) => b.score - a.score);
  const selected = [];
  const minimumSeparation = clamp(1.55 / Math.sqrt(Math.max(1, target)), 0.26, 1.2);
  for (const candidate of candidates) {
    if (selected.every(existing => angularDistance(existing.point, candidate.point) >= minimumSeparation)) {
      selected.push(candidate);
      if (selected.length >= target) break;
    }
  }
  while (selected.length < target) selected.push(candidates[selected.length]);

  return selected.map(candidate => createPlate(model, candidate.point, candidate.flow, rng));
}

function createPlate(model, center, flow, rng, overrides = {}) {
  const tangentVelocity = safeNormalize(flow.velocity, randomTangent(center, rng));
  const oceanicChance = clamp(0.48 + model.interior.waterFraction * 0.35 - model.interior.coreMassFraction * 0.12, 0.25, 0.78);
  const continental = overrides.continental ?? (rng() > oceanicChance ? 1 : rng() * 0.28);
  const speedRadPerMyr = overrides.speedRadPerMyr ?? (
    (0.0022 + rng() * 0.0068) *
    (0.45 + model.interior.mobilityIndex * 0.95) *
    (0.65 + length(flow.velocity) * 0.7)
  );
  const id = overrides.id ?? model.nextPlateId++;
  return {
    id,
    generation: overrides.generation ?? 0,
    parentId: overrides.parentId ?? null,
    center: normalize(center),
    velocity: tangentVelocity,
    speedRadPerMyr,
    spin: overrides.spin ?? ((rng() - 0.5) * speedRadPerMyr * 0.7),
    continental: clamp(continental, 0, 1),
    density: overrides.density ?? clamp(0.88 + (1 - continental) * 0.22 + rng() * 0.08, 0.82, 1.2),
    areaWeight: overrides.areaWeight ?? (0.72 + rng() * 0.58) / Math.max(1, model.regime.targetPlateCount),
    strength: overrides.strength ?? clamp(0.65 + rng() * 0.55 + continental * 0.18, 0.45, 1.45),
    birthMyr: overrides.birthMyr ?? model.geologicAgeMyr,
    crustAgeMyr: overrides.crustAgeMyr ?? (continental > 0.5 ? 280 + rng() * 2100 : 4 + rng() * 160),
    warpModes: overrides.warpModes ?? [0, 1].map(() => ({
      axis: randomUnitVector(rng),
      frequency: 2 + randomInteger(rng, 0, 3),
      amplitude: (rng() - 0.5) * 0.075,
      phase: rng() * TAU,
    })),
  };
}

function plateAffinity(model, plate, point, flow) {
  const spatial = dot(point, plate.center);
  const areaBias = Math.log(Math.max(0.015, plate.areaWeight) * model.regime.targetPlateCount + 0.35) * 0.055;
  const plateVelocity = plateVelocityAt(plate, point);
  const flowSpeed = length(flow.velocity);
  const plateSpeed = length(plateVelocity);
  const coherence = flowSpeed > 1e-6 && plateSpeed > 1e-6
    ? dot(flow.velocity, plateVelocity) / (flowSpeed * plateSpeed) * 0.055
    : 0;
  let warp = 0;
  for (const mode of plate.warpModes) {
    warp += Math.sin(mode.frequency * dot(point, mode.axis) + mode.phase) * mode.amplitude;
  }
  const ageStability = clamp((model.geologicAgeMyr - plate.birthMyr) / 180, 0, 1) * 0.016;
  return spatial + areaBias + coherence + warp + ageStability;
}

function plateVelocityAt(plate, point) {
  const translated = projectTangent(plate.velocity, point);
  const rotation = cross(plate.center, point);
  return add(scale(translated, plate.speedRadPerMyr), scale(rotation, plate.spin));
}

function advanceModel(model, dtMyr, precomputing) {
  if (!Number.isFinite(dtMyr) || dtMyr <= 0) return;

  model.geologicAgeMyr += dtMyr;
  for (const mode of model.flowModes) {
    mode.axis = rotateAroundAxis(mode.axis, mode.driftAxis, mode.driftRate * dtMyr);
  }
  for (const mode of model.turbulentModes) mode.phase = wrapAngle(mode.phase + mode.drift * dtMyr);

  for (const plate of model.plates) {
    const flow = sampleMantleFlow(model, plate.center);
    const flowDirection = safeNormalize(flow.velocity, plate.velocity);
    plate.velocity = safeNormalize(lerpVector(plate.velocity, flowDirection, clamp(dtMyr / 80, 0, 0.18)), plate.velocity);
    const displacement = plate.speedRadPerMyr * dtMyr;
    plate.center = moveOnSphere(plate.center, plate.velocity, displacement);
    plate.crustAgeMyr += dtMyr;
    if (flow.divergence > 0.22 && plate.continental < 0.45) plate.crustAgeMyr = Math.max(0, plate.crustAgeMyr - dtMyr * flow.divergence * 0.8);
  }

  model.eventCountdownMyr -= dtMyr;
  while (model.eventCountdownMyr <= 0) {
    evolvePlateNetwork(model, precomputing);
    model.eventCountdownMyr += randomRange(model.rng, model.regime.eventIntervalMyr[0], model.regime.eventIntervalMyr[1]);
  }
}

function evolvePlateNetwork(model, precomputing) {
  const mode = model.regime.mode;
  const count = model.plates.length;
  const random = model.rng();
  const splitBias = mode === 'full plate tectonics' ? 0.46 : mode === 'sluggish/mobile lid' ? 0.38 : mode === 'episodic lid' ? 0.28 : 0.16;
  const subductionBias = mode === 'full plate tectonics' ? 0.72 : mode === 'sluggish/mobile lid' ? 0.58 : mode === 'episodic lid' ? 0.36 : 0.12;

  if (count < model.regime.minPlates) {
    splitLargestPlate(model, 'lid fragmentation');
    return;
  }
  if (count > model.regime.maxPlates) {
    mergeOrSubductClosest(model, true);
    return;
  }

  if (random < splitBias && count < model.regime.maxPlates) {
    splitLargestPlate(model, 'ridge-driven rifting');
  } else if (random < splitBias + subductionBias && count > model.regime.minPlates) {
    mergeOrSubductClosest(model, false);
  } else if (mode === 'heat-pipe volcanism') {
    renewHotspotProvince(model);
  } else if (!precomputing && model.events.length) {
    model.events.push({
      type: 'reorganization',
      ageMyr: model.geologicAgeMyr,
      description: 'Mantle-flow directions reorganized without changing the plate count.',
    });
  }
  if (model.events.length > 48) model.events.splice(0, model.events.length - 48);
}

function splitLargestPlate(model, reason) {
  const candidates = model.plates
    .map(plate => ({ plate, flow: sampleMantleFlow(model, plate.center) }))
    .sort((a, b) => (b.plate.areaWeight + Math.max(0, b.flow.divergence) * 0.12) - (a.plate.areaWeight + Math.max(0, a.flow.divergence) * 0.12));
  const target = candidates[0];
  if (!target) return;
  const parent = target.plate;
  const splitAxis = safeNormalize(cross(parent.center, target.flow.velocity), randomTangent(parent.center, model.rng));
  const offset = clamp(0.16 + parent.areaWeight * 0.42, 0.13, 0.38);
  const childCenter = moveOnSphere(parent.center, splitAxis, offset);
  parent.center = moveOnSphere(parent.center, splitAxis, -offset * 0.46);
  parent.areaWeight *= 0.56;
  parent.generation += 1;
  parent.crustAgeMyr *= 0.82;

  const child = createPlate(model, childCenter, sampleMantleFlow(model, childCenter), model.rng, {
    parentId: parent.id,
    generation: parent.generation,
    continental: clamp(parent.continental + (model.rng() - 0.5) * 0.18, 0, 1),
    density: clamp(parent.density + (model.rng() - 0.5) * 0.08, 0.82, 1.2),
    areaWeight: parent.areaWeight * (0.72 + model.rng() * 0.34),
    crustAgeMyr: Math.max(0, parent.crustAgeMyr * 0.34),
  });
  model.plates.push(child);
  model.events.push({
    type: 'split',
    ageMyr: model.geologicAgeMyr,
    plateId: parent.id,
    childPlateId: child.id,
    description: `Plate ${parent.id} split by ${reason}.`,
  });
}

function mergeOrSubductClosest(model, forceMerge) {
  let best = null;
  for (let i = 0; i < model.plates.length; i++) {
    for (let j = i + 1; j < model.plates.length; j++) {
      const a = model.plates[i];
      const b = model.plates[j];
      const distance = angularDistance(a.center, b.center);
      const midpoint = safeNormalize(add(a.center, b.center), a.center);
      const normal = safeNormalize(projectTangent(subtract(b.center, a.center), midpoint), a.velocity);
      const convergence = -dot(subtract(plateVelocityAt(b, midpoint), plateVelocityAt(a, midpoint)), normal);
      const score = distance - Math.max(0, convergence) * 7 - Math.abs(a.density - b.density) * 0.12;
      if (!best || score < best.score) best = { i, j, a, b, score, convergence };
    }
  }
  if (!best) return;

  const oceanicA = best.a.continental < 0.45;
  const oceanicB = best.b.continental < 0.45;
  const canSubduct = !forceMerge && best.convergence > 0.001 && (oceanicA || oceanicB);

  if (canSubduct) {
    const doomed = oceanicA && oceanicB
      ? (best.a.density >= best.b.density ? best.a : best.b)
      : (oceanicA ? best.a : best.b);
    const survivor = doomed === best.a ? best.b : best.a;
    survivor.areaWeight += doomed.areaWeight * 0.42;
    survivor.continental = clamp(Math.max(survivor.continental, doomed.continental * 0.55), 0, 1);
    model.plates = model.plates.filter(plate => plate !== doomed);
    model.events.push({
      type: 'subduction',
      ageMyr: model.geologicAgeMyr,
      plateId: doomed.id,
      survivorPlateId: survivor.id,
      description: `Dense plate ${doomed.id} was consumed beneath plate ${survivor.id}.`,
    });
    return;
  }

  const areaA = best.a.areaWeight;
  const areaB = best.b.areaWeight;
  const mergedCenter = safeNormalize(add(scale(best.a.center, areaA), scale(best.b.center, areaB)), best.a.center);
  const totalArea = areaA + areaB;
  best.a.center = mergedCenter;
  best.a.velocity = safeNormalize(add(scale(best.a.velocity, areaA), scale(best.b.velocity, areaB)), best.a.velocity);
  best.a.continental = clamp((best.a.continental * areaA + best.b.continental * areaB) / Math.max(1e-6, totalArea), 0, 1);
  best.a.areaWeight = totalArea;
  best.a.density = clamp((best.a.density + best.b.density) * 0.5, 0.82, 1.2);
  best.a.crustAgeMyr = Math.max(best.a.crustAgeMyr, best.b.crustAgeMyr);
  model.plates = model.plates.filter(plate => plate !== best.b);
  model.events.push({
    type: 'merge',
    ageMyr: model.geologicAgeMyr,
    plateId: best.a.id,
    absorbedPlateId: best.b.id,
    description: `Plates ${best.a.id} and ${best.b.id} sutured into one plate.`,
  });
}

function renewHotspotProvince(model) {
  const oldest = [...model.plates].sort((a, b) => b.crustAgeMyr - a.crustAgeMyr)[0];
  if (!oldest) return;
  const flow = sampleMantleFlow(model, oldest.center);
  oldest.center = moveOnSphere(oldest.center, safeNormalize(flow.velocity, oldest.velocity), 0.08 + model.rng() * 0.12);
  oldest.crustAgeMyr *= 0.28;
  oldest.density = clamp(oldest.density - 0.04, 0.82, 1.2);
  model.events.push({
    type: 'resurfacing',
    ageMyr: model.geologicAgeMyr,
    plateId: oldest.id,
    description: `Heat-pipe volcanism resurfaced province ${oldest.id}.`,
  });
}

function fallbackSample(model, flow) {
  return {
    plateId: 0,
    neighborPlateId: 0,
    continentalBias: clamp(flow.buoyancy * 0.65, 0, 1),
    boundaryStrength: 0,
    boundaryType: 'intraplate',
    convergence: 0,
    divergence: 0,
    transform: 0,
    uplift: 0,
    rift: 0,
    shear: 0,
    volcanism: flow.heat,
    mantleHeat: flow.heat,
    mantleFlowSpeed: length(flow.velocity),
    crustAgeMyr: model.geologicAgeMyr,
    plateAgeMyr: model.geologicAgeMyr,
    tectonicMode: model.regime.mode,
  };
}

function serializePlate(plate) {
  return {
    ...plate,
    center: { ...plate.center },
    velocity: { ...plate.velocity },
    warpModes: plate.warpModes.map(mode => ({ ...mode, axis: { ...mode.axis } })),
  };
}

function deserializePlate(plate) {
  if (!plate || !Number.isFinite(plate.id)) return null;
  return {
    ...plate,
    center: normalize(plate.center),
    velocity: safeNormalize(plate.velocity, { x: 1, y: 0, z: 0 }),
    warpModes: Array.isArray(plate.warpModes)
      ? plate.warpModes.map(mode => ({ ...mode, axis: normalize(mode.axis) }))
      : [],
  };
}

function legendre(degree, x) {
  if (degree <= 0) return 1;
  if (degree === 1) return x;
  let previous = 1;
  let current = x;
  for (let n = 2; n <= degree; n++) {
    const next = ((2 * n - 1) * x * current - (n - 1) * previous) / n;
    previous = current;
    current = next;
  }
  return current;
}

function legendreDerivative(degree, x) {
  if (degree <= 0) return 0;
  if (Math.abs(Math.abs(x) - 1) < 1e-5) {
    const sign = x < 0 && degree % 2 === 0 ? -1 : 1;
    return sign * degree * (degree + 1) * 0.5;
  }
  return degree * (x * legendre(degree, x) - legendre(degree - 1, x)) / (x * x - 1);
}

function moveOnSphere(point, tangentDirection, angle) {
  const tangent = safeNormalize(projectTangent(tangentDirection, point), randomOrthogonal(point));
  return normalize(add(scale(point, Math.cos(angle)), scale(tangent, Math.sin(angle))));
}

function rotateAroundAxis(vector, axis, angle) {
  const unitAxis = normalize(axis);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return normalize(add(
    add(scale(vector, cosine), scale(cross(unitAxis, vector), sine)),
    scale(unitAxis, dot(unitAxis, vector) * (1 - cosine)),
  ));
}

function randomTangent(point, rng) {
  return safeNormalize(projectTangent(randomUnitVector(rng), point), randomOrthogonal(point));
}

function randomOrthogonal(point) {
  const reference = Math.abs(point.y) < 0.8 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  return normalize(cross(reference, point));
}

function projectTangent(vector, normal) {
  return subtract(vector, scale(normal, dot(vector, normal)));
}

function randomUnitVector(rng) {
  const y = rng() * 2 - 1;
  const angle = rng() * TAU;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  return { x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius };
}

function normalizeSeed(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return (Math.floor(numeric) >>> 0) || DEFAULT_SEED;
  const text = String(value || DEFAULT_SEED);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 || DEFAULT_SEED;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return function random() {
    let t = state += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function randomInteger(rng, minimum, maximum) {
  return Math.floor(randomRange(rng, minimum, maximum + 1));
}

function randomRange(rng, minimum, maximum) {
  return minimum + (maximum - minimum) * rng();
}

function angularDistance(a, b) {
  return Math.acos(clamp(dot(a, b), -1, 1));
}

function safeNormalize(vector, fallback) {
  const magnitude = length(vector);
  return magnitude > 1e-9 ? scale(vector, 1 / magnitude) : normalize(fallback);
}

function normalize(vector = { x: 1, y: 0, z: 0 }) {
  const magnitude = length(vector);
  return magnitude > 1e-12 ? scale(vector, 1 / magnitude) : { x: 1, y: 0, z: 0 };
}

function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function subtract(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function scale(vector, amount) { return { x: vector.x * amount, y: vector.y * amount, z: vector.z * amount }; }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function cross(a, b) { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
function length(vector) { return Math.hypot(vector.x, vector.y, vector.z); }
function lerpVector(a, b, amount) { return add(scale(a, 1 - amount), scale(b, amount)); }
function sigmoid(value) { return 1 / (1 + Math.exp(-value)); }
function wrapAngle(value) { return ((value % TAU) + TAU) % TAU; }
function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }
