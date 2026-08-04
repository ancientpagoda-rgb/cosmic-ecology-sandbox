const C = 299792458;
const SECONDS_PER_YEAR = 31557600;
const JOULES_PER_TWH = 3.6e15;
const MISSION_TYPES = ['relativistic-probe', 'generation-ship', 'seed-craft', 'laser-sail', 'magnetic-sail', 'fusion-ark'];
const MISSION_STATES = ['planned', 'accelerating', 'cruise', 'decelerating', 'arrived', 'failed', 'lost'];
const STELLAR_STAGES = ['main-sequence', 'subgiant', 'red-giant', 'white-dwarf', 'neutron-star', 'black-hole', 'supernova-remnant'];
const PROJECT_TYPES = ['asteroid-industry', 'orbital-ring', 'habitat-swarm', 'stellar-collector', 'dyson-swarm', 'star-lifting', 'computation-array', 'beamed-power', 'black-hole-experiment'];
const BRANCH_STATES = ['settled', 'expanding', 'federated', 'isolated', 'post-biological', 'silent', 'declining', 'extinct'];
const CAUSAL_TYPES = ['launch', 'arrival', 'signal-send', 'signal-arrival', 'contact', 'migration', 'stellar-event', 'engineering', 'extinction', 'archaeology'];

export function createPhase10Engine(world, phase9, galaxySystem, orbitalSystem, options = {}) {
  const mobile = options.mobile ?? matchMedia('(max-width: 720px), (pointer: coarse)').matches;
  const rng = mulberry32(options.seed ?? 0xA10E2026);
  const lightYearsPerGalaxyUnit = options.lightYearsPerGalaxyUnit ?? 420;
  const yearsPerSecond = options.yearsPerSecond ?? 1200;
  const gigaYearsPerSecond = yearsPerSecond / 1e9;
  const detailedMissionLimit = mobile ? 12 : 36;
  const detailedStarLimit = mobile ? 96 : 360;
  const missions = new Map();
  const starTracks = new Map();
  const branches = new Map();
  const projects = new Map();
  const ruins = new Map();
  const signals = new Map();
  const causalEvents = new Map();
  const causalEdges = [];
  const aggregate = {
    distantMissions: 0,
    distantSettlements: 0,
    silentRegions: 0,
    extinctCivilizations: 0,
    postBiologicalBranches: 0,
    archaeologicalSites: 0,
  };
  let elapsed = 0;
  let simulatedYears = 0;
  let missionClock = 0;
  let stellarClock = 0;
  let branchClock = 0;
  let engineeringClock = 0;
  let archaeologyClock = 0;
  let nextMission = 1;
  let nextBranch = 1;
  let nextProject = 1;
  let nextRuin = 1;
  let nextSignal = 1;
  let nextEvent = 1;
  let destroyed = false;
  const hud = createHud();

  function initialize({ provideCapability }) {
    initializeLocalBranch();
    initializeStellarTracks();
    provideCapability('travel.relativistic', api);
    provideCapability('stars.evolution', api);
    provideCapability('civilization.galactic', api);
    provideCapability('engineering.astro', api);
    provideCapability('archaeology.cosmic', api);
    provideCapability('history.causal-galaxy', api);
  }

  function step(dt) {
    if (destroyed) return;
    const amount = Math.max(0, dt);
    elapsed += amount;
    simulatedYears += amount * yearsPerSecond;
    missionClock += amount;
    stellarClock += amount;
    branchClock += amount;
    engineeringClock += amount;
    archaeologyClock += amount;
    synchronizePhase9();

    if (missionClock >= (mobile ? 1.8 : 0.9)) {
      missionCycle(missionClock);
      missionClock = 0;
    }
    if (stellarClock >= (mobile ? 5 : 2.4)) {
      stellarCycle(stellarClock);
      stellarClock = 0;
    }
    if (branchClock >= (mobile ? 3.8 : 1.8)) {
      branchCycle(branchClock);
      branchClock = 0;
    }
    if (engineeringClock >= (mobile ? 4.6 : 2.2)) {
      engineeringCycle(engineeringClock);
      engineeringClock = 0;
    }
    if (archaeologyClock >= (mobile ? 7 : 3.4)) {
      archaeologyCycle(archaeologyClock);
      archaeologyClock = 0;
    }
    advanceSignals(amount);
  }

  function initializeLocalBranch() {
    if (branches.has('branch-local')) return;
    const local = galaxySystem.getLocalStar?.() || { id: 'sol', position: { x: 0, y: 0, z: 0 } };
    branches.set('branch-local', makeBranch({
      id: 'branch-local',
      name: 'Local Civilization',
      starId: local.id,
      position: local.position,
      parentId: null,
      population: phase9.getState?.().population || 0,
      state: 'settled',
      technology: 0.64,
      machineFraction: 0.12,
      detectability: 0.35,
      expansionDrive: 0.18,
    }));
  }

  function initializeStellarTracks() {
    const local = galaxySystem.getLocalStar?.();
    const nearby = galaxySystem.getNearbyStars?.(local?.position || { x: 0, y: 0, z: 0 }, mobile ? 24 : 38, detailedStarLimit) || galaxySystem.getStars?.().slice(0, detailedStarLimit) || [];
    for (const star of nearby) ensureStarTrack(star);
    if (local) ensureStarTrack(local);
  }

  function ensureStarTrack(star) {
    if (!star || starTracks.has(star.id)) return starTracks.get(star?.id);
    const mass = clamp(Number(star.mass) || 1, 0.08, 60);
    const lifetimeGyr = mainSequenceLifetimeGyr(mass);
    const track = {
      id: star.id,
      name: star.name || star.id,
      position: { ...(star.position || { x: 0, y: 0, z: 0 }) },
      massInitial: mass,
      massCurrent: mass,
      ageGyr: Math.max(0, Number(star.age) || 0),
      metallicity: Number(star.metallicity) || 0,
      spectralClass: star.spectralClass || 'G2V',
      luminosityInitial: Math.max(0.0001, Number(star.luminosity) || stellarLuminosity(mass)),
      luminosity: Math.max(0.0001, Number(star.luminosity) || stellarLuminosity(mass)),
      lifetimeGyr,
      stage: 'main-sequence',
      habitableZoneAu: Math.sqrt(Math.max(0.0001, Number(star.luminosity) || stellarLuminosity(mass))),
      radiationHazard: 0.04,
      remnant: null,
      lastStage: 'main-sequence',
      migrationPressure: 0,
      settled: false,
    };
    updateStellarTrack(track, 0);
    starTracks.set(track.id, track);
    return track;
  }

  function synchronizePhase9() {
    const localBranch = branches.get('branch-local');
    const p9State = phase9.getState?.() || {};
    if (localBranch) {
      localBranch.population = Math.max(localBranch.population, p9State.population || 0);
      localBranch.machineFraction = clamp((p9State.machines || 0) / Math.max(1, p9State.population || 1), 0, 1);
      localBranch.technology = clamp(0.58 + (p9State.operationalColonies || 0) * 0.025 + (p9State.firstContacts || 0) * 0.03, 0, 1.5);
      localBranch.detectability = clamp(0.22 + (p9State.activeSignals || 0) * 0.04 + localBranch.technology * 0.18, 0.05, 1);
    }

    for (const colony of phase9.getColonies?.() || []) {
      if (colony.status === 'collapsed' || colony.status === 'lost') continue;
      const id = `branch-colony-${colony.id}`;
      if (!branches.has(id)) {
        const star = targetStarForColony(colony);
        const branch = makeBranch({
          id,
          name: colony.name,
          starId: star.id,
          position: star.position,
          parentId: 'branch-local',
          population: colony.population,
          state: colony.autonomy > 0.6 ? 'isolated' : 'settled',
          technology: clamp(0.35 + colony.research * 0.35 + colony.manufacturing * 0.2, 0, 1.2),
          machineFraction: clamp(colony.machineDependence, 0, 1),
          detectability: clamp(0.1 + colony.energy * 0.15 + colony.orbitalPower * 0.2, 0.02, 1),
          expansionDrive: clamp(colony.autonomy * 0.2 + colony.localExtraction * 0.22, 0, 1),
          sourceColonyId: colony.id,
        });
        branches.set(id, branch);
        ensureStarTrack(star).settled = true;
        addEvent('migration', `${colony.name} becomes an independent deep-time branch.`, [], { branchId: id, starId: star.id });
      } else {
        const branch = branches.get(id);
        branch.population = colony.population;
        branch.machineFraction = clamp(colony.machineDependence, 0, 1);
        branch.technology = clamp(branch.technology + colony.research * 0.0004, 0, 1.5);
      }
    }

    for (const alien of phase9.getAlienCivilizations?.() || []) {
      const id = `branch-alien-${alien.id}`;
      if (branches.has(id)) continue;
      branches.set(id, makeBranch({
        id,
        name: alien.name,
        starId: alien.starId,
        position: alien.position,
        parentId: null,
        population: 1000 + alien.technologicalLevel * 12000,
        state: alien.status === 'extinct' ? 'extinct' : alien.caution > 0.75 ? 'silent' : 'settled',
        technology: alien.technologicalLevel,
        machineFraction: clamp(alien.technologicalLevel * 0.2 + rng() * 0.3, 0, 1),
        detectability: alien.detectability,
        expansionDrive: clamp(alien.cooperation * 0.25 + alien.technologicalLevel * 0.2 - alien.caution * 0.2, 0, 1),
      }));
      const sourceStar = galaxySystem.getStars?.().find(star => star.id === alien.starId) || { id: alien.starId, position: alien.position, mass: 1, age: alien.biologicalAgeGyr, luminosity: 1 };
      ensureStarTrack(sourceStar).settled = alien.status !== 'extinct';
      if (alien.status === 'extinct') createRuin({ branchId: id, starId: alien.starId, kind: 'extinct-technological-system', visibility: 0.25 + alien.detectability * 0.5 });
    }
  }

  function makeBranch(input) {
    return {
      id: input.id || `branch-${nextBranch++}`,
      name: input.name || `Branch ${nextBranch}`,
      starId: input.starId || 'sol',
      position: { ...(input.position || { x: 0, y: 0, z: 0 }) },
      parentId: input.parentId ?? null,
      sourceColonyId: input.sourceColonyId || null,
      population: Math.max(0, input.population || 0),
      state: BRANCH_STATES.includes(input.state) ? input.state : 'settled',
      technology: clamp(input.technology ?? 0.2, 0, 2),
      machineFraction: clamp(input.machineFraction ?? 0, 0, 1),
      detectability: clamp(input.detectability ?? 0.1, 0, 1),
      expansionDrive: clamp(input.expansionDrive ?? 0.1, 0, 1),
      cooperation: clamp(input.cooperation ?? 0.5, 0, 1),
      caution: clamp(input.caution ?? 0.4, 0, 1),
      ecology: clamp(input.ecology ?? 0.65, 0, 1),
      institutions: clamp(input.institutions ?? 0.55, 0, 1),
      economy: clamp(input.economy ?? 0.5, 0, 1.5),
      valueDrift: clamp(input.valueDrift ?? 0, 0, 1),
      culturalDivergence: clamp(input.culturalDivergence ?? 0, 0, 1),
      machineDivergence: clamp(input.machineDivergence ?? 0, 0, 1),
      silence: clamp(input.silence ?? 0, 0, 1),
      ageYears: Math.max(0, input.ageYears || 0),
      children: input.children || 0,
      extinctions: input.extinctions || 0,
      lastExpansionAt: input.lastExpansionAt ?? -Infinity,
      createdAt: input.createdAt ?? simulatedYears,
    };
  }

  function branchCycle(dt) {
    const scaleYears = dt * yearsPerSecond;
    for (const branch of branches.values()) {
      if (branch.state === 'extinct') continue;
      const star = starTracks.get(branch.starId);
      branch.ageYears += scaleYears;
      const stellarStress = star ? clamp(star.migrationPressure + star.radiationHazard, 0, 2) : 0.1;
      const growth = clamp(branch.economy * branch.ecology * (1 - stellarStress * 0.35) * 0.0000006, -0.000002, 0.000002);
      branch.population = Math.max(0, branch.population * Math.exp(growth * scaleYears));
      branch.culturalDivergence = clamp(branch.culturalDivergence + scaleYears * (branch.parentId ? 2e-10 : 4e-11), 0, 1);
      branch.machineDivergence = clamp(branch.machineDivergence + scaleYears * branch.machineFraction * 3e-10, 0, 1);
      branch.valueDrift = clamp(branch.valueDrift + scaleYears * branch.machineFraction * branch.machineDivergence * 1e-10, 0, 1);
      branch.technology = clamp(branch.technology + scaleYears * branch.economy * branch.institutions * 2e-11, 0, 2);
      branch.detectability = clamp(branch.detectability + scaleYears * (branch.technology * 1e-11 - branch.silence * 1.5e-11), 0, 1);
      branch.silence = clamp(branch.silence + scaleYears * (branch.caution * 5e-12 + aggregate.extinctCivilizations * 2e-13 - branch.cooperation * 3e-12), 0, 1);
      branch.machineFraction = clamp(branch.machineFraction + scaleYears * branch.technology * 1.5e-11, 0, 1);
      if (branch.machineFraction > 0.82 && branch.technology > 1.05) branch.state = 'post-biological';
      else if (branch.silence > 0.82) branch.state = 'silent';
      else if (stellarStress > 0.75) branch.state = 'declining';
      else if (branch.expansionDrive > 0.48 && branch.technology > 0.72) branch.state = 'expanding';

      if (branch.population < 1 || (stellarStress > 1.25 && branch.technology < 0.55)) {
        branch.state = 'extinct';
        branch.extinctions++;
        aggregate.extinctCivilizations++;
        createRuin({ branchId: branch.id, starId: branch.starId, kind: 'extinct-colony', visibility: clamp(branch.detectability * 0.7 + branch.technology * 0.2, 0.05, 1) });
        addEvent('extinction', `${branch.name} becomes extinct after combined stellar, ecological, and institutional stress.`, [], { branchId: branch.id, starId: branch.starId });
        continue;
      }

      const canExpand = branch.state === 'expanding' && simulatedYears - branch.lastExpansionAt > 20000 / Math.max(0.1, branch.expansionDrive);
      if (canExpand && missions.size < detailedMissionLimit && rng() < dt * 0.018 * branch.expansionDrive) {
        launchMissionFromBranch(branch, selectMissionType(branch));
        branch.lastExpansionAt = simulatedYears;
      } else if (canExpand && missions.size >= detailedMissionLimit && rng() < dt * 0.01) {
        aggregate.distantMissions++;
        aggregate.distantSettlements += rng() < branch.expansionDrive ? 1 : 0;
        branch.lastExpansionAt = simulatedYears;
      }
    }
    aggregate.postBiologicalBranches = [...branches.values()].filter(branch => branch.state === 'post-biological').length;
    aggregate.silentRegions = [...branches.values()].filter(branch => branch.state === 'silent').length;
  }

  function selectMissionType(branch) {
    if (branch.machineFraction > 0.7) return branch.technology > 1.15 ? 'seed-craft' : 'relativistic-probe';
    if (branch.population > 5000 && branch.ecology > 0.5) return 'generation-ship';
    if (branch.technology > 1.2) return 'fusion-ark';
    return branch.technology > 0.85 ? 'laser-sail' : 'magnetic-sail';
  }

  function launchMissionFromBranch(branch, type, targetStarId = null, overrides = {}) {
    const sourceStar = starTracks.get(branch.starId) || ensureStarTrack(galaxySystem.getStars?.().find(star => star.id === branch.starId));
    const targetStar = targetStarId ? ensureStarTrack(galaxySystem.getStars?.().find(star => star.id === targetStarId) || { id: targetStarId, position: overrides.targetPosition || { x: 0.01, y: 0, z: 0 } }) : chooseTargetStar(sourceStar, branch);
    if (!sourceStar || !targetStar || sourceStar.id === targetStar.id) return null;
    const propulsion = propulsionFor(type, branch.technology, overrides);
    const distanceLy = distance3(sourceStar.position, targetStar.position) * lightYearsPerGalaxyUnit;
    const beta = clamp(overrides.beta ?? propulsion.beta, 0.00001, 0.999999);
    const gamma = lorentzFactor(beta);
    const coordinateYears = distanceLy / beta + propulsion.accelerationYears * 2;
    const properYears = coordinateYears / gamma;
    const dryMassKg = Math.max(1, overrides.dryMassKg ?? propulsion.dryMassKg);
    const payloadKg = Math.max(0, overrides.payloadKg ?? propulsion.payloadKg);
    const propellantKg = Math.max(0, overrides.propellantKg ?? propulsion.propellantFraction * dryMassKg);
    const totalMassKg = dryMassKg + payloadKg + propellantKg;
    const kineticEnergyJ = (gamma - 1) * totalMassKg * C * C;
    const id = overrides.id || `mission-${nextMission++}`;
    const launchEvent = addEvent('launch', `${branch.name} launches ${type} ${id} toward ${targetStar.name}.`, overrides.parentEvents || [], { missionId: id, branchId: branch.id, sourceStarId: sourceStar.id, targetStarId: targetStar.id });
    const mission = {
      id,
      type,
      state: 'accelerating',
      sourceBranchId: branch.id,
      sourceStarId: sourceStar.id,
      targetStarId: targetStar.id,
      sourcePosition: { ...sourceStar.position },
      targetPosition: { ...targetStar.position },
      distanceLy,
      beta,
      velocityMps: beta * C,
      gamma,
      coordinateYears,
      properYears,
      elapsedCoordinateYears: 0,
      elapsedProperYears: 0,
      arrivalCoordinateYear: simulatedYears + coordinateYears,
      launchCoordinateYear: simulatedYears,
      communicationDelayYears: distanceLy,
      arrivalTimeDivergenceYears: coordinateYears - properYears,
      dryMassKg,
      payloadKg,
      propellantKg,
      totalMassKg,
      energyJ: kineticEnergyJ,
      energyTWh: kineticEnergyJ / JOULES_PER_TWH,
      powerW: propulsion.powerW,
      exhaustVelocityMps: propulsion.exhaustVelocityMps,
      accelerationMps2: propulsion.accelerationMps2,
      shielding: propulsion.shielding,
      reliability: clamp(overrides.reliability ?? propulsion.reliability, 0.02, 0.9999),
      maintenance: clamp(overrides.maintenance ?? propulsion.maintenance, 0, 1),
      wasteHeat: clamp(overrides.wasteHeat ?? propulsion.wasteHeat, 0, 1.5),
      infrastructure: propulsion.infrastructure,
      population: overrides.population ?? (type === 'generation-ship' || type === 'fusion-ark' ? 600 : 0),
      demographicHealth: overrides.demographicHealth ?? 0.78,
      ecology: overrides.ecology ?? (type === 'generation-ship' || type === 'fusion-ark' ? 0.72 : 0),
      archives: overrides.archives ?? 0.8,
      machineFraction: overrides.machineFraction ?? branch.machineFraction,
      progress: 0,
      launchedEventId: launchEvent.id,
      lastEventId: launchEvent.id,
      trajectoryModel: 'special-relativistic-straight-line-galaxy-coordinate',
      createdAt: elapsed,
    };
    missions.set(id, mission);
    return mission;
  }

  function propulsionFor(type, technology, overrides = {}) {
    const catalog = {
      'relativistic-probe': { beta: 0.22, dryMassKg: 1.2e5, payloadKg: 2e4, propellantFraction: 1.8, powerW: 2e15, exhaustVelocityMps: 0.12 * C, accelerationMps2: 0.12, shielding: 0.58, reliability: 0.82, maintenance: 0.68, wasteHeat: 0.34, infrastructure: 0.72, accelerationYears: 0.18 },
      'generation-ship': { beta: 0.035, dryMassKg: 7e10, payloadKg: 1.8e10, propellantFraction: 2.4, powerW: 8e14, exhaustVelocityMps: 0.025 * C, accelerationMps2: 0.001, shielding: 0.88, reliability: 0.7, maintenance: 0.75, wasteHeat: 0.62, infrastructure: 0.82, accelerationYears: 1.5 },
      'seed-craft': { beta: 0.42, dryMassKg: 8e4, payloadKg: 4e4, propellantFraction: 0.4, powerW: 7e15, exhaustVelocityMps: 0.2 * C, accelerationMps2: 0.25, shielding: 0.46, reliability: 0.77, maintenance: 0.82, wasteHeat: 0.28, infrastructure: 0.86, accelerationYears: 0.12 },
      'laser-sail': { beta: 0.18, dryMassKg: 2e3, payloadKg: 400, propellantFraction: 0, powerW: 1.5e14, exhaustVelocityMps: C, accelerationMps2: 0.45, shielding: 0.18, reliability: 0.68, maintenance: 0.86, wasteHeat: 0.08, infrastructure: 0.62, accelerationYears: 0.04 },
      'magnetic-sail': { beta: 0.012, dryMassKg: 4e6, payloadKg: 8e5, propellantFraction: 0.15, powerW: 1e12, exhaustVelocityMps: 0.008 * C, accelerationMps2: 0.0004, shielding: 0.62, reliability: 0.74, maintenance: 0.7, wasteHeat: 0.2, infrastructure: 0.44, accelerationYears: 4 },
      'fusion-ark': { beta: 0.095, dryMassKg: 2e11, payloadKg: 5e10, propellantFraction: 3.2, powerW: 5e16, exhaustVelocityMps: 0.08 * C, accelerationMps2: 0.006, shielding: 0.92, reliability: 0.76, maintenance: 0.8, wasteHeat: 0.72, infrastructure: 0.94, accelerationYears: 0.8 },
    };
    const base = { ...(catalog[type] || catalog['relativistic-probe']) };
    const capability = clamp((technology - 0.45) / 0.9, 0, 1);
    base.beta = clamp(overrides.beta ?? base.beta * (0.72 + capability * 0.5), 0.00001, 0.92);
    base.reliability = clamp(base.reliability + capability * 0.08, 0, 0.98);
    base.infrastructure = clamp(base.infrastructure, 0, 1);
    return base;
  }

  function chooseTargetStar(sourceStar, branch) {
    const nearby = galaxySystem.getNearbyStars?.(sourceStar.position, mobile ? 8 : 14, mobile ? 48 : 160) || [];
    const candidates = nearby.filter(star => star.id !== sourceStar.id && !branchesAtStar(star.id).length);
    const selected = candidates.sort((a, b) => targetScore(b, branch) - targetScore(a, branch))[0];
    return selected ? ensureStarTrack(selected) : null;
  }

  function targetScore(star, branch) {
    const track = ensureStarTrack(star);
    const distanceLy = distance3(track.position, starTracks.get(branch.starId)?.position) * lightYearsPerGalaxyUnit;
    const stable = track.stage === 'main-sequence' ? 0.5 : -0.4;
    return stable + Math.log10(Math.max(0.001, track.luminosity + 0.01)) * 0.08 - distanceLy * 0.004 + rng() * 0.04;
  }

  function missionCycle(dt) {
    const coordinateDeltaYears = dt * yearsPerSecond;
    for (const mission of missions.values()) {
      if (!['accelerating', 'cruise', 'decelerating'].includes(mission.state)) continue;
      mission.elapsedCoordinateYears += coordinateDeltaYears;
      mission.elapsedProperYears += coordinateDeltaYears / mission.gamma;
      mission.progress = clamp(mission.elapsedCoordinateYears / Math.max(1e-9, mission.coordinateYears), 0, 1);
      mission.state = mission.progress < 0.08 ? 'accelerating' : mission.progress < 0.9 ? 'cruise' : mission.progress < 1 ? 'decelerating' : mission.state;
      const radiationStress = mission.beta * mission.beta * (1 - mission.shielding) * 0.001;
      mission.maintenance = clamp(mission.maintenance - coordinateDeltaYears * (1e-8 + radiationStress * 1e-8), 0, 1);
      mission.reliability = clamp(mission.reliability - coordinateDeltaYears * (1 - mission.maintenance) * 2e-10, 0, 1);
      mission.wasteHeat = clamp(mission.wasteHeat + coordinateDeltaYears * mission.powerW / 1e30 - mission.maintenance * 1e-8, 0, 2);

      if (mission.population > 0) {
        mission.ecology = clamp(mission.ecology + coordinateDeltaYears * (mission.maintenance * 8e-10 - mission.wasteHeat * 1.2e-9), 0, 1);
        mission.demographicHealth = clamp(mission.demographicHealth + coordinateDeltaYears * (mission.ecology * 7e-10 - (1 - mission.maintenance) * 1.4e-9), 0, 1);
        const netRate = (mission.demographicHealth - 0.5) * 1.2e-5;
        mission.population = Math.max(0, mission.population * Math.exp(netRate * Math.min(coordinateDeltaYears, 5000)));
      }

      const failurePressure = clamp((1 - mission.reliability) * 0.4 + (1 - mission.maintenance) * 0.35 + mission.wasteHeat * 0.15 + (mission.population > 0 ? 1 - mission.demographicHealth : 0) * 0.2, 0, 1.5);
      if (failurePressure > 0.92 || mission.population < 1 && mission.type === 'generation-ship') {
        failMission(mission, failurePressure > 1.15 ? 'lost' : 'failed');
        continue;
      }
      if (mission.progress >= 1) arriveMission(mission);
    }
  }

  function failMission(mission, state) {
    mission.state = state;
    const event = addEvent('extinction', `${mission.id} ${state} after maintenance, heat, radiation, or demographic failure.`, [mission.lastEventId], { missionId: mission.id, sourceBranchId: mission.sourceBranchId, targetStarId: mission.targetStarId });
    mission.lastEventId = event.id;
    createRuin({ branchId: mission.sourceBranchId, starId: mission.targetStarId, kind: `${mission.type}-${state}`, visibility: clamp(mission.archives * 0.6 + mission.totalMassKg / 1e12, 0.05, 0.9), position: interpolate3(mission.sourcePosition, mission.targetPosition, mission.progress) });
  }

  function arriveMission(mission) {
    mission.progress = 1;
    mission.state = 'arrived';
    const event = addEvent('arrival', `${mission.id} arrives at ${mission.targetStarId} after ${mission.coordinateYears.toFixed(2)} coordinate years and ${mission.properYears.toFixed(2)} proper years.`, [mission.lastEventId], { missionId: mission.id, targetStarId: mission.targetStarId });
    mission.lastEventId = event.id;
    if (['generation-ship', 'seed-craft', 'fusion-ark'].includes(mission.type)) {
      const parent = branches.get(mission.sourceBranchId);
      const id = `branch-${nextBranch++}`;
      const branch = makeBranch({
        id,
        name: `${parent?.name || 'Interstellar'} ${mission.targetStarId} Branch`,
        starId: mission.targetStarId,
        position: mission.targetPosition,
        parentId: mission.sourceBranchId,
        population: mission.population > 0 ? mission.population : 120,
        state: 'settled',
        technology: clamp((parent?.technology || 0.7) * (0.82 + mission.archives * 0.18), 0, 1.5),
        machineFraction: mission.type === 'seed-craft' ? 0.92 : mission.machineFraction,
        detectability: 0.08,
        expansionDrive: 0.12,
        culturalDivergence: 0.05,
        machineDivergence: mission.type === 'seed-craft' ? 0.08 : 0.02,
      });
      branches.set(id, branch);
      ensureStarTrack(galaxySystem.getStars?.().find(star => star.id === mission.targetStarId) || { id: mission.targetStarId, position: mission.targetPosition }).settled = true;
      if (parent) parent.children++;
    }
  }

  function stellarCycle(dt) {
    const deltaGyr = dt * gigaYearsPerSecond;
    for (const track of starTracks.values()) updateStellarTrack(track, deltaGyr);
  }

  function updateStellarTrack(track, deltaGyr) {
    track.ageGyr += deltaGyr;
    const ratio = track.ageGyr / Math.max(0.001, track.lifetimeGyr);
    const priorStage = track.stage;
    if (ratio < 0.92) {
      track.stage = 'main-sequence';
      const brightening = clamp(0.7 + 0.55 * ratio, 0.55, 1.35);
      track.luminosity = track.luminosityInitial * brightening;
      track.massCurrent = track.massInitial;
      track.radiationHazard = clamp(0.03 + ratio * 0.08, 0, 0.2);
    } else if (ratio < 1.0) {
      track.stage = 'subgiant';
      track.luminosity = track.luminosityInitial * (1.4 + (ratio - 0.92) * 45);
      track.massCurrent = track.massInitial * 0.99;
      track.radiationHazard = 0.18 + (ratio - 0.92) * 2;
    } else if (ratio < 1.08) {
      track.stage = 'red-giant';
      track.luminosity = track.luminosityInitial * (5 + (ratio - 1) * 450);
      track.massCurrent = track.massInitial * (1 - (ratio - 1) * 2.5);
      track.radiationHazard = clamp(0.35 + (ratio - 1) * 6, 0, 1);
    } else {
      const remnant = remnantForMass(track.massInitial);
      track.stage = remnant.stage;
      track.remnant = remnant.kind;
      track.massCurrent = remnant.mass;
      track.luminosity = remnant.luminosity;
      track.radiationHazard = remnant.hazard;
    }
    track.habitableZoneAu = Math.sqrt(Math.max(0.000001, track.luminosity));
    track.migrationPressure = clamp(Math.abs(Math.log10(Math.max(0.02, track.luminosity / Math.max(0.0001, track.luminosityInitial)))) * 0.7 + track.radiationHazard * 0.8, 0, 2);
    if (track.stage !== priorStage) {
      track.lastStage = priorStage;
      addEvent('stellar-event', `${track.name} transitions from ${priorStage} to ${track.stage}.`, [], { starId: track.id, stage: track.stage });
      handleStellarTransition(track, priorStage);
    }
  }

  function handleStellarTransition(track, priorStage) {
    const affected = branchesAtStar(track.id);
    for (const branch of affected) {
      if (track.stage === 'red-giant' || track.stage === 'supernova-remnant' || track.stage === 'neutron-star' || track.stage === 'black-hole') {
        branch.ecology = clamp(branch.ecology - 0.28 - track.radiationHazard * 0.25, 0, 1);
        branch.expansionDrive = clamp(branch.expansionDrive + 0.32, 0, 1);
        branch.state = branch.technology > 0.65 ? 'expanding' : 'declining';
        const event = addEvent('migration', `${branch.name} faces forced migration as ${track.name} enters ${track.stage}.`, [], { branchId: branch.id, starId: track.id });
        if (branch.technology > 0.75 && missions.size < detailedMissionLimit) launchMissionFromBranch(branch, selectMissionType(branch), null, { parentEvents: [event.id], reliability: 0.88 });
      }
    }
    if (priorStage === 'red-giant' && track.stage !== 'red-giant') {
      for (const branch of affected.filter(item => item.state === 'extinct')) createRuin({ branchId: branch.id, starId: track.id, kind: 'stellar-transition-ruins', visibility: 0.7 });
    }
  }

  function engineeringCycle(dt) {
    const scaleYears = dt * yearsPerSecond;
    for (const branch of branches.values()) {
      if (branch.state === 'extinct') continue;
      if (projectsForBranch(branch.id).length < (mobile ? 2 : 5) && rng() < dt * 0.008 * branch.technology * branch.economy) maybeStartProject(branch);
    }
    for (const project of projects.values()) {
      if (['completed', 'failed', 'abandoned'].includes(project.state)) continue;
      const branch = branches.get(project.branchId);
      if (!branch || branch.state === 'extinct') { project.state = 'abandoned'; continue; }
      const availableEnergy = branch.technology * branch.economy * (0.4 + branch.machineFraction * 0.6);
      const materials = branch.economy * (0.35 + branch.expansionDrive * 0.4);
      const institutionalStability = branch.institutions * (1 - branch.valueDrift * 0.25);
      const maintenance = clamp(project.maintenance + branch.machineFraction * 0.2, 0, 1);
      const heatRejection = clamp(project.radiators + branch.technology * 0.2, 0, 1.4);
      project.energyInput = availableEnergy;
      project.materialInput = materials;
      project.wasteHeat = clamp(project.wasteHeat + scaleYears * project.powerScale * 1e-10 - scaleYears * heatRejection * 7e-11, 0, 2);
      project.stability = clamp(project.stability + scaleYears * (institutionalStability * maintenance * 6e-11 - project.wasteHeat * 8e-11), 0, 1);
      const bottleneck = Math.min(availableEnergy / project.energyNeed, materials / project.materialNeed, maintenance / project.maintenanceNeed, heatRejection / project.heatNeed, project.stability + 0.1);
      project.progress = clamp(project.progress + scaleYears * Math.max(0, bottleneck) * project.ratePerYear, 0, 1);
      if (project.wasteHeat > project.heatLimit) {
        project.progress = Math.max(0, project.progress - scaleYears * (project.wasteHeat - project.heatLimit) * project.ratePerYear * 0.8);
        project.state = 'heat-limited';
      } else project.state = 'building';
      if (project.stability < 0.08) {
        project.state = 'failed';
        createRuin({ branchId: branch.id, starId: branch.starId, kind: `${project.type}-failure`, visibility: clamp(project.progress, 0.1, 1) });
        addEvent('engineering', `${project.name} fails after stability and waste-heat limits are exceeded.`, [project.lastEventId], { projectId: project.id, branchId: branch.id });
      } else if (project.progress >= 1) {
        project.state = 'completed';
        branch.technology = clamp(branch.technology + project.technologyGain, 0, 2);
        branch.economy = clamp(branch.economy + project.economyGain, 0, 1.5);
        branch.detectability = clamp(branch.detectability + project.detectability, 0, 1);
        addEvent('engineering', `${project.name} is completed by ${branch.name}.`, [project.lastEventId], { projectId: project.id, branchId: branch.id });
      }
    }
  }

  function maybeStartProject(branch, forcedType = null, overrides = {}) {
    const type = forcedType || chooseProjectType(branch);
    const spec = projectSpec(type);
    if (branch.technology < spec.techNeed || branch.economy < spec.economyNeed) return null;
    const id = overrides.id || `project-${nextProject++}`;
    const event = addEvent('engineering', `${branch.name} begins ${type}.`, overrides.parentEvents || [], { projectId: id, branchId: branch.id });
    const project = {
      id,
      name: `${branch.name} ${type.replaceAll('-', ' ')}`,
      type,
      branchId: branch.id,
      starId: branch.starId,
      state: 'building',
      progress: overrides.progress ?? 0,
      energyNeed: spec.energyNeed,
      materialNeed: spec.materialNeed,
      maintenanceNeed: spec.maintenanceNeed,
      heatNeed: spec.heatNeed,
      heatLimit: overrides.heatLimit ?? spec.heatLimit,
      powerScale: spec.powerScale,
      ratePerYear: spec.ratePerYear,
      technologyGain: spec.technologyGain,
      economyGain: spec.economyGain,
      detectability: spec.detectability,
      energyInput: 0,
      materialInput: 0,
      maintenance: overrides.maintenance ?? branch.machineFraction * 0.6 + branch.institutions * 0.3,
      radiators: overrides.radiators ?? 0.3 + branch.technology * 0.2,
      wasteHeat: overrides.wasteHeat ?? 0.05,
      stability: overrides.stability ?? 0.82,
      lastEventId: event.id,
      createdAt: simulatedYears,
    };
    projects.set(id, project);
    return project;
  }

  function chooseProjectType(branch) {
    if (branch.technology > 1.5 && branch.machineFraction > 0.75) return 'computation-array';
    if (branch.technology > 1.35 && branch.economy > 1) return rng() < 0.5 ? 'dyson-swarm' : 'star-lifting';
    if (branch.technology > 1.1) return rng() < 0.5 ? 'stellar-collector' : 'orbital-ring';
    if (branch.machineFraction > 0.5) return 'asteroid-industry';
    return 'habitat-swarm';
  }

  function projectSpec(type) {
    const specs = {
      'asteroid-industry': { techNeed: 0.6, economyNeed: 0.35, energyNeed: 0.4, materialNeed: 0.3, maintenanceNeed: 0.25, heatNeed: 0.15, heatLimit: 0.75, powerScale: 0.3, ratePerYear: 3e-6, technologyGain: 0.03, economyGain: 0.08, detectability: 0.01 },
      'orbital-ring': { techNeed: 0.95, economyNeed: 0.6, energyNeed: 0.8, materialNeed: 0.75, maintenanceNeed: 0.55, heatNeed: 0.4, heatLimit: 0.82, powerScale: 0.8, ratePerYear: 8e-7, technologyGain: 0.06, economyGain: 0.12, detectability: 0.03 },
      'habitat-swarm': { techNeed: 0.72, economyNeed: 0.45, energyNeed: 0.55, materialNeed: 0.5, maintenanceNeed: 0.42, heatNeed: 0.28, heatLimit: 0.78, powerScale: 0.55, ratePerYear: 1.5e-6, technologyGain: 0.04, economyGain: 0.1, detectability: 0.02 },
      'stellar-collector': { techNeed: 1.05, economyNeed: 0.7, energyNeed: 1, materialNeed: 0.8, maintenanceNeed: 0.6, heatNeed: 0.65, heatLimit: 0.7, powerScale: 1.2, ratePerYear: 5e-7, technologyGain: 0.08, economyGain: 0.16, detectability: 0.08 },
      'dyson-swarm': { techNeed: 1.28, economyNeed: 0.9, energyNeed: 1.25, materialNeed: 1.1, maintenanceNeed: 0.75, heatNeed: 0.95, heatLimit: 0.58, powerScale: 2, ratePerYear: 1.8e-7, technologyGain: 0.14, economyGain: 0.28, detectability: 0.2 },
      'star-lifting': { techNeed: 1.42, economyNeed: 1, energyNeed: 1.35, materialNeed: 0.85, maintenanceNeed: 0.8, heatNeed: 0.9, heatLimit: 0.62, powerScale: 2.3, ratePerYear: 9e-8, technologyGain: 0.18, economyGain: 0.22, detectability: 0.24 },
      'computation-array': { techNeed: 1.25, economyNeed: 0.8, energyNeed: 1.2, materialNeed: 0.7, maintenanceNeed: 0.7, heatNeed: 1.1, heatLimit: 0.5, powerScale: 2.6, ratePerYear: 1.3e-7, technologyGain: 0.2, economyGain: 0.12, detectability: 0.18 },
      'beamed-power': { techNeed: 1.02, economyNeed: 0.65, energyNeed: 0.9, materialNeed: 0.55, maintenanceNeed: 0.5, heatNeed: 0.55, heatLimit: 0.72, powerScale: 1.1, ratePerYear: 6e-7, technologyGain: 0.08, economyGain: 0.15, detectability: 0.12 },
      'black-hole-experiment': { techNeed: 1.75, economyNeed: 1.15, energyNeed: 1.5, materialNeed: 0.9, maintenanceNeed: 0.92, heatNeed: 1.2, heatLimit: 0.45, powerScale: 3.5, ratePerYear: 4e-8, technologyGain: 0.25, economyGain: 0.08, detectability: 0.3 },
    };
    return specs[type] || specs['asteroid-industry'];
  }

  function archaeologyCycle(dt) {
    const observers = [...branches.values()].filter(branch => branch.state !== 'extinct' && branch.technology > 0.55);
    for (const ruin of ruins.values()) {
      if (ruin.discovered) continue;
      const observer = observers.sort((a, b) => distance3(a.position, ruin.position) - distance3(b.position, ruin.position))[0];
      if (!observer) continue;
      const distanceLy = distance3(observer.position, ruin.position) * lightYearsPerGalaxyUnit;
      const chance = dt * ruin.visibility * observer.technology * observer.detectability / Math.max(1, Math.sqrt(distanceLy + 1)) * 0.015;
      if (rng() < chance) discoverRuin(ruin, observer.id);
    }
  }

  function createRuin(input) {
    const id = input.id || `ruin-${nextRuin++}`;
    if (ruins.has(id)) return ruins.get(id);
    const star = starTracks.get(input.starId);
    const ruin = {
      id,
      branchId: input.branchId || null,
      starId: input.starId || 'unknown',
      kind: input.kind || 'abandoned-habitat',
      position: { ...(input.position || star?.position || { x: 0, y: 0, z: 0 }) },
      ageYears: input.ageYears ?? 0,
      visibility: clamp(input.visibility ?? 0.3, 0.01, 1),
      preservation: clamp(input.preservation ?? 0.72, 0, 1),
      artificialIsotopes: input.artificialIsotopes ?? 0.4,
      archives: input.archives ?? 0.5,
      megastructureFragments: input.megastructureFragments ?? 0,
      discovered: Boolean(input.discovered),
      discoveredBy: input.discoveredBy || null,
      discoveredAt: input.discoveredAt || null,
      createdAt: simulatedYears,
    };
    ruins.set(id, ruin);
    aggregate.archaeologicalSites = ruins.size;
    return ruin;
  }

  function discoverRuin(ruin, observerId) {
    ruin.discovered = true;
    ruin.discoveredBy = observerId;
    ruin.discoveredAt = simulatedYears;
    addEvent('archaeology', `${branches.get(observerId)?.name || observerId} discovers ${ruin.kind} at ${ruin.starId}.`, [], { ruinId: ruin.id, observerId, starId: ruin.starId });
  }

  function sendCausalSignal(sourceBranchId, targetBranchId, kind = 'message', parentEvents = []) {
    const source = branches.get(sourceBranchId);
    const target = branches.get(targetBranchId);
    if (!source || !target) return null;
    const distanceLy = distance3(source.position, target.position) * lightYearsPerGalaxyUnit;
    const sendEvent = addEvent('signal-send', `${source.name} sends ${kind} to ${target.name}.`, parentEvents, { sourceBranchId, targetBranchId, distanceLy });
    const id = `deep-signal-${nextSignal++}`;
    const signal = {
      id,
      sourceBranchId,
      targetBranchId,
      kind,
      distanceLy,
      sentAtYear: simulatedYears,
      arrivesAtYear: simulatedYears + distanceLy,
      progress: 0,
      state: 'propagating',
      sendEventId: sendEvent.id,
      arrivalEventId: null,
    };
    signals.set(id, signal);
    return signal;
  }

  function advanceSignals() {
    for (const signal of signals.values()) {
      if (signal.state !== 'propagating') continue;
      signal.progress = clamp((simulatedYears - signal.sentAtYear) / Math.max(1e-9, signal.distanceLy), 0, 1);
      if (simulatedYears < signal.arrivesAtYear) continue;
      signal.state = 'arrived';
      const source = branches.get(signal.sourceBranchId);
      const target = branches.get(signal.targetBranchId);
      const event = addEvent('signal-arrival', `${signal.kind} from ${source?.name || signal.sourceBranchId} reaches ${target?.name || signal.targetBranchId}.`, [signal.sendEventId], { signalId: signal.id, sourceBranchId: signal.sourceBranchId, targetBranchId: signal.targetBranchId });
      signal.arrivalEventId = event.id;
      if (source && target) {
        const compatibility = source.cooperation * target.cooperation * (1 - Math.abs(source.valueDrift - target.valueDrift));
        addEvent('contact', `${source.name} and ${target.name} establish a causally valid ${compatibility > 0.55 ? 'cooperative' : 'uncertain'} exchange.`, [event.id], { sourceBranchId: source.id, targetBranchId: target.id, compatibility });
      }
    }
  }

  function addEvent(type, description, parents = [], data = {}) {
    const id = `phase10-${nextEvent++}`;
    const event = {
      id,
      type: CAUSAL_TYPES.includes(type) ? type : 'engineering',
      description,
      coordinateYear: simulatedYears,
      properYear: data.properYear ?? null,
      tick: world.tick,
      parents: [...new Set(parents.filter(parent => causalEvents.has(parent)))],
      data: { ...data },
    };
    causalEvents.set(id, event);
    for (const parent of event.parents) causalEdges.push({ from: parent, to: id });
    if (causalEvents.size > 1200) {
      const oldest = causalEvents.keys().next().value;
      causalEvents.delete(oldest);
      for (let index = causalEdges.length - 1; index >= 0; index--) if (causalEdges[index].from === oldest || causalEdges[index].to === oldest) causalEdges.splice(index, 1);
    }
    window.dispatchEvent(new CustomEvent('phase10-history', { detail: event }));
    return event;
  }

  function render(frame = {}) {
    const timestamp = frame.timestamp ?? performance.now();
    if (timestamp - hud.lastUpdate < 500) return;
    hud.lastUpdate = timestamp;
    const state = getState();
    hud.element.hidden = state.missions === 0 && state.projects === 0 && state.ruins === 0;
    if (hud.element.hidden) return;
    hud.summary.textContent = `${state.missions} interstellar missions · ${state.branches} branches · ${state.projects} astroprojects · ${state.ruins} ruins`;
    hud.detail.textContent = `${state.simulatedYears.toExponential(2)} simulated years · ${state.activeSignals} signals · ${state.relativisticMissions} relativistic missions · ${state.stellarTransitions} evolved stars`;
  }

  function getState() {
    return {
      elapsed,
      simulatedYears,
      missions: missions.size,
      activeMissions: [...missions.values()].filter(mission => ['accelerating', 'cruise', 'decelerating'].includes(mission.state)).length,
      relativisticMissions: [...missions.values()].filter(mission => mission.beta >= 0.1).length,
      arrivedMissions: [...missions.values()].filter(mission => mission.state === 'arrived').length,
      failedMissions: [...missions.values()].filter(mission => ['failed', 'lost'].includes(mission.state)).length,
      branches: branches.size,
      livingBranches: [...branches.values()].filter(branch => branch.state !== 'extinct').length,
      extinctBranches: [...branches.values()].filter(branch => branch.state === 'extinct').length,
      postBiologicalBranches: aggregate.postBiologicalBranches,
      silentRegions: aggregate.silentRegions,
      stars: starTracks.size,
      stellarTransitions: [...starTracks.values()].filter(track => track.stage !== 'main-sequence').length,
      projects: projects.size,
      completedProjects: [...projects.values()].filter(project => project.state === 'completed').length,
      heatLimitedProjects: [...projects.values()].filter(project => project.state === 'heat-limited').length,
      ruins: ruins.size,
      discoveredRuins: [...ruins.values()].filter(ruin => ruin.discovered).length,
      signals: signals.size,
      activeSignals: [...signals.values()].filter(signal => signal.state === 'propagating').length,
      causalEvents: causalEvents.size,
      causalEdges: causalEdges.length,
      aggregate: { ...aggregate },
    };
  }

  function getSnapshot() {
    return {
      state: getState(),
      missions: [...missions.values()].map(clone),
      stars: [...starTracks.values()].map(clone),
      branches: [...branches.values()].map(clone),
      projects: [...projects.values()].map(clone),
      ruins: [...ruins.values()].map(clone),
      signals: [...signals.values()].map(clone),
      causalEvents: [...causalEvents.values()].map(clone),
      causalEdges: causalEdges.map(clone),
    };
  }

  function runInvariants() {
    const failures = [];
    for (const mission of missions.values()) {
      const values = [mission.beta, mission.gamma, mission.coordinateYears, mission.properYears, mission.energyJ, mission.progress, mission.reliability, mission.maintenance];
      if (values.some(value => !Number.isFinite(value))) failures.push(`non-finite-mission:${mission.id}`);
      if (mission.beta <= 0 || mission.beta >= 1) failures.push(`ftl-or-static-mission:${mission.id}`);
      if (mission.gamma < 1) failures.push(`invalid-gamma:${mission.id}`);
      if (mission.properYears > mission.coordinateYears + 1e-9) failures.push(`time-dilation-inverted:${mission.id}`);
      if (!MISSION_TYPES.includes(mission.type)) failures.push(`invalid-mission-type:${mission.id}`);
      if (!MISSION_STATES.includes(mission.state)) failures.push(`invalid-mission-state:${mission.id}`);
      if (mission.progress < 0 || mission.progress > 1) failures.push(`invalid-mission-progress:${mission.id}`);
    }
    for (const track of starTracks.values()) {
      if (!STELLAR_STAGES.includes(track.stage)) failures.push(`invalid-stellar-stage:${track.id}`);
      if (![track.ageGyr, track.luminosity, track.massCurrent, track.habitableZoneAu].every(Number.isFinite)) failures.push(`non-finite-star:${track.id}`);
      if (track.luminosity < 0 || track.massCurrent < 0) failures.push(`negative-star-state:${track.id}`);
    }
    for (const branch of branches.values()) {
      if (!BRANCH_STATES.includes(branch.state)) failures.push(`invalid-branch-state:${branch.id}`);
      if (branch.population < 0 || !Number.isFinite(branch.population)) failures.push(`invalid-branch-population:${branch.id}`);
    }
    for (const project of projects.values()) {
      if (!PROJECT_TYPES.includes(project.type)) failures.push(`invalid-project-type:${project.id}`);
      if (project.progress < 0 || project.progress > 1 || !Number.isFinite(project.progress)) failures.push(`invalid-project-progress:${project.id}`);
    }
    for (const edge of causalEdges) {
      const from = causalEvents.get(edge.from);
      const to = causalEvents.get(edge.to);
      if (!from || !to) failures.push(`orphan-causal-edge:${edge.from}:${edge.to}`);
      else if (to.coordinateYear + 1e-9 < from.coordinateYear) failures.push(`causal-order-violation:${edge.from}:${edge.to}`);
    }
    for (const signal of signals.values()) {
      if (signal.arrivesAtYear + 1e-9 < signal.sentAtYear + signal.distanceLy) failures.push(`superluminal-signal:${signal.id}`);
      if (signal.progress < 0 || signal.progress > 1) failures.push(`invalid-signal-progress:${signal.id}`);
    }
    return { ok: failures.length === 0, failures, checkedAtYear: simulatedYears };
  }

  function debugSeedScenario(kind = 'relativistic-probe') {
    initializeLocalBranch();
    initializeStellarTracks();
    const local = branches.get('branch-local');
    if (kind === 'relativistic-probe') {
      local.technology = Math.max(local.technology, 1.35);
      local.economy = Math.max(local.economy, 1.1);
      const target = ensureDebugStar('debug-relativistic-target', { x: 0.006, y: 0, z: 0.002 }, 1, 5);
      const mission = launchMissionFromBranch(local, 'relativistic-probe', target.id, { id: 'debug-relativistic-probe', beta: 0.8, reliability: 0.99, maintenance: 0.98, payloadKg: 1500, dryMassKg: 8000 });
      return { ok: Boolean(mission), kind, missionId: mission?.id, gamma: mission?.gamma, coordinateYears: mission?.coordinateYears, properYears: mission?.properYears };
    }
    if (kind === 'generation-ship-crisis') {
      local.technology = Math.max(local.technology, 1);
      local.economy = Math.max(local.economy, 0.9);
      const target = ensureDebugStar('debug-generation-target', { x: 0.003, y: 0, z: 0 }, 0.9, 6);
      const mission = launchMissionFromBranch(local, 'generation-ship', target.id, { id: 'debug-generation-ship', beta: 0.02, reliability: 0.15, maintenance: 0.01, population: 820, demographicHealth: 0.05, ecology: 0.04, wasteHeat: 1.2 });
      return { ok: Boolean(mission), kind, missionId: mission?.id };
    }
    if (kind === 'stellar-migration') {
      const track = ensureDebugStar('debug-aging-star', { x: 0.002, y: 0, z: 0.004 }, 1, 9.95);
      track.lifetimeGyr = 10;
      track.ageGyr = 10.1;
      track.stage = 'subgiant';
      const id = 'debug-stellar-branch';
      branches.set(id, makeBranch({ id, name: 'Helios Migrants', starId: track.id, position: track.position, population: 22000, technology: 1.1, economy: 0.9, expansionDrive: 0.7, state: 'settled' }));
      updateStellarTrack(track, 0.02);
      return { ok: true, kind, starId: track.id, branchId: id, stage: track.stage };
    }
    if (kind === 'dyson-waste-heat') {
      local.technology = 1.6;
      local.economy = 1.3;
      local.machineFraction = 0.82;
      const project = maybeStartProject(local, 'dyson-swarm', { id: 'debug-dyson-swarm', progress: 0.42, wasteHeat: 0.92, heatLimit: 0.55, radiators: 0.08, maintenance: 0.75 });
      return { ok: Boolean(project), kind, projectId: project?.id };
    }
    if (kind === 'extinct-colony-archaeology') {
      const star = ensureDebugStar('debug-ruin-star', { x: 0.0015, y: 0, z: 0.001 }, 0.8, 8);
      const branchId = 'debug-extinct-colony';
      branches.set(branchId, makeBranch({ id: branchId, name: 'Ash Archive Colony', starId: star.id, position: star.position, population: 0, state: 'extinct', technology: 0.9, detectability: 0.5 }));
      const ruin = createRuin({ id: 'debug-cosmic-ruin', branchId, starId: star.id, kind: 'extinct-interstellar-colony', visibility: 1, preservation: 0.92, archives: 0.88, artificialIsotopes: 0.95 });
      discoverRuin(ruin, local.id);
      return { ok: true, kind, ruinId: ruin.id, discovered: ruin.discovered };
    }
    if (kind === 'causal-contact') {
      const starA = ensureDebugStar('debug-contact-a', { x: 0.001, y: 0, z: 0 }, 1, 5);
      const starB = ensureDebugStar('debug-contact-b', { x: 0.002, y: 0, z: 0 }, 0.9, 6);
      const branchA = makeBranch({ id: 'debug-contact-branch-a', name: 'Aster Network', starId: starA.id, position: starA.position, population: 4000, technology: 1, cooperation: 0.8 });
      const branchB = makeBranch({ id: 'debug-contact-branch-b', name: 'Boreal Network', starId: starB.id, position: starB.position, population: 4500, technology: 1.05, cooperation: 0.76 });
      branches.set(branchA.id, branchA);
      branches.set(branchB.id, branchB);
      const signal1 = sendCausalSignal(branchA.id, branchB.id, 'greeting');
      const signal2 = sendCausalSignal(branchB.id, branchA.id, 'independent-beacon');
      return { ok: Boolean(signal1 && signal2), kind, signalIds: [signal1?.id, signal2?.id] };
    }
    return { ok: false, kind, reason: 'unknown-scenario' };
  }

  function ensureDebugStar(id, position, mass = 1, age = 5) {
    if (starTracks.has(id)) return starTracks.get(id);
    return ensureStarTrack({ id, name: id.replaceAll('-', ' '), position, mass, age, luminosity: stellarLuminosity(mass), metallicity: 0, spectralClass: mass > 1.2 ? 'F5V' : mass < 0.8 ? 'K5V' : 'G2V' });
  }

  function targetStarForColony(colony) {
    const local = galaxySystem.getLocalStar?.() || { id: 'sol', position: { x: 0, y: 0, z: 0 } };
    if (!colony.targetId || colony.targetId === 'gaia-orbit' || colony.targetId === 'deep-space') return local;
    const candidate = galaxySystem.getStars?.().find(star => star.id === colony.targetId);
    return candidate || local;
  }

  function branchesAtStar(starId) { return [...branches.values()].filter(branch => branch.starId === starId); }
  function projectsForBranch(branchId) { return [...projects.values()].filter(project => project.branchId === branchId && !['failed', 'abandoned'].includes(project.state)); }

  function save() {
    return {
      version: 1,
      elapsed,
      simulatedYears,
      counters: { nextMission, nextBranch, nextProject, nextRuin, nextSignal, nextEvent },
      aggregate: { ...aggregate },
      missions: [...missions.values()].map(clone),
      starTracks: [...starTracks.values()].map(clone),
      branches: [...branches.values()].map(clone),
      projects: [...projects.values()].map(clone),
      ruins: [...ruins.values()].map(clone),
      signals: [...signals.values()].map(clone),
      causalEvents: [...causalEvents.values()].map(clone),
      causalEdges: causalEdges.map(clone),
    };
  }

  function load(state) {
    if (!state) return;
    elapsed = Math.max(0, state.elapsed || 0);
    simulatedYears = Math.max(0, state.simulatedYears || 0);
    const counters = state.counters || {};
    nextMission = Math.max(1, counters.nextMission || 1);
    nextBranch = Math.max(1, counters.nextBranch || 1);
    nextProject = Math.max(1, counters.nextProject || 1);
    nextRuin = Math.max(1, counters.nextRuin || 1);
    nextSignal = Math.max(1, counters.nextSignal || 1);
    nextEvent = Math.max(1, counters.nextEvent || 1);
    Object.assign(aggregate, state.aggregate || {});
    for (const item of state.missions || []) missions.set(item.id, item);
    for (const item of state.starTracks || []) starTracks.set(item.id, item);
    for (const item of state.branches || []) branches.set(item.id, item);
    for (const item of state.projects || []) projects.set(item.id, item);
    for (const item of state.ruins || []) ruins.set(item.id, item);
    for (const item of state.signals || []) signals.set(item.id, item);
    for (const item of state.causalEvents || []) causalEvents.set(item.id, item);
    causalEdges.push(...(state.causalEdges || []));
  }

  function destroy() {
    destroyed = true;
    hud.element.remove();
    missions.clear();
    starTracks.clear();
    branches.clear();
    projects.clear();
    ruins.clear();
    signals.clear();
    causalEvents.clear();
    causalEdges.length = 0;
  }

  const api = {
    id: 'civilization.phase10-relativistic-deep-time',
    name: 'Relativistic Expansion, Stellar Evolution, and Galactic Deep Time',
    version: '1.0.0',
    execution: 'browser-deterministic-relativistic-lod',
    source: 'Reality Sandbox special-relativistic mission model, analytic stellar tracks, constrained astroengineering, galactic causal history, and deterministic LOD',
    license: 'Project license',
    provides: ['travel.relativistic', 'stars.evolution', 'civilization.galactic', 'engineering.astro', 'archaeology.cosmic', 'history.causal-galaxy'],
    requires: ['colonies.multiworld', 'machines.autonomous', 'signals.interstellar', 'galaxy.population', 'orbits.system'],
    after: ['civilization.phase9-multiworld-ai-contact'],
    initialize, step, render, save, load, destroy, getState, getSnapshot, runInvariants,
    getMissions: () => [...missions.values()].map(clone),
    getStarTracks: () => [...starTracks.values()].map(clone),
    getBranches: () => [...branches.values()].map(clone),
    getProjects: () => [...projects.values()].map(clone),
    getRuins: () => [...ruins.values()].map(clone),
    getSignals: () => [...signals.values()].map(clone),
    getCausalEvents: () => [...causalEvents.values()].map(clone),
    getCausalEdges: () => causalEdges.map(clone),
    launchMissionFromBranch, sendCausalSignal, maybeStartProject, debugSeedScenario,
  };
  return api;
}

function createHud() {
  const element = document.createElement('section');
  element.hidden = true;
  element.setAttribute('aria-live', 'polite');
  element.style.cssText = 'position:fixed;left:max(12px,env(safe-area-inset-left));bottom:max(12px,env(safe-area-inset-bottom));z-index:19;max-width:min(460px,calc(100vw - 24px));padding:10px 12px;border:1px solid rgba(117,231,255,.3);border-radius:12px;background:rgba(2,10,16,.78);backdrop-filter:blur(10px);color:#e3fbff;font:600 11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.035em;pointer-events:none';
  element.innerHTML = '<strong style="display:block;margin-bottom:4px;color:#8eeeff">PHASE 10 · GALACTIC DEEP TIME</strong><span data-summary></span><small data-detail style="display:block;margin-top:4px;color:rgba(227,251,255,.68)"></small>';
  document.body.append(element);
  return { element, summary: element.querySelector('[data-summary]'), detail: element.querySelector('[data-detail]'), lastUpdate: -Infinity };
}

function mainSequenceLifetimeGyr(mass) { return clamp(10 * Math.pow(Math.max(0.08, mass), -2.5), 0.003, 1500); }
function stellarLuminosity(mass) { if (mass < 0.43) return 0.23 * Math.pow(mass, 2.3); if (mass < 2) return Math.pow(mass, 4); if (mass < 20) return 1.5 * Math.pow(mass, 3.5); return 3200 * mass; }
function remnantForMass(mass) {
  if (mass < 8) return { stage: 'white-dwarf', kind: 'white-dwarf', mass: clamp(0.109 * mass + 0.394, 0.45, 1.35), luminosity: 0.002, hazard: 0.08 };
  if (mass < 20) return { stage: 'neutron-star', kind: 'neutron-star', mass: 1.4, luminosity: 0.0003, hazard: 0.72 };
  if (mass < 40) return { stage: 'supernova-remnant', kind: 'neutron-star-remnant', mass: 1.8, luminosity: 0.001, hazard: 1 };
  return { stage: 'black-hole', kind: 'stellar-black-hole', mass: Math.max(3, mass * 0.2), luminosity: 0.000001, hazard: 0.42 };
}
function lorentzFactor(beta) { return 1 / Math.sqrt(1 - beta * beta); }
function distance3(a, b) { return Math.hypot((a?.x || 0) - (b?.x || 0), (a?.y || 0) - (b?.y || 0), (a?.z || 0) - (b?.z || 0)); }
function interpolate3(a, b, t) { return { x: lerp(a?.x || 0, b?.x || 0, t), y: lerp(a?.y || 0, b?.y || 0, t), z: lerp(a?.z || 0, b?.z || 0, t) }; }
function lerp(a, b, t) { return a + (b - a) * t; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function mulberry32(seed) { let value = seed >>> 0; return () => { value += 0x6D2B79F5; let result = value; result = Math.imul(result ^ result >>> 15, result | 1); result ^= result + Math.imul(result ^ result >>> 7, result | 61); return ((result ^ result >>> 14) >>> 0) / 4294967296; }; }
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
