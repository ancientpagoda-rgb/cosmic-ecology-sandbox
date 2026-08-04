const C_KM_S = 299792.458;
const MPC_TO_LY = 3.261563777e6;
const SECONDS_PER_YEAR = 31557600;
const KM_PER_MPC = 3.0856775814913673e19;
const HUBBLE_TIME_YEARS_FACTOR = KM_PER_MPC / SECONDS_PER_YEAR;
const GALAXY_STATES = ['forming', 'star-forming', 'starburst', 'quenched', 'merging', 'remnant'];
const CIV_STATES = ['active', 'migrating', 'hibernating', 'silent', 'consolidated', 'unreachable', 'extinct'];
const EVENT_TYPES = ['galaxy-merger', 'starburst', 'agn', 'signal-emission', 'signal-observation', 'horizon-crossing', 'gw-emission', 'gw-detection', 'multimessenger', 'migration', 'archaeology', 'strategy', 'extinction'];

export function createPhase11Engine(world, phase10, galaxySystem, options = {}) {
  const mobile = options.mobile ?? matchMedia('(max-width: 720px), (pointer: coarse)').matches;
  const rng = mulberry32(options.seed ?? 0xA11E2026);
  const yearsPerSecond = options.yearsPerSecond ?? 5e6;
  const detailedGalaxyLimit = mobile ? 32 : 96;
  const parameters = normalizeCosmology({
    H0KmSPerMpc: options.H0KmSPerMpc ?? 67.4,
    omegaMatter: options.omegaMatter ?? 0.315,
    omegaRadiation: options.omegaRadiation ?? 0.00009,
    omegaBaryon: options.omegaBaryon ?? 0.049,
    omegaLambda: options.omegaLambda ?? 0.68491,
    omegaCurvature: options.omegaCurvature ?? 0,
    darkEnergyW: options.darkEnergyW ?? -1,
  });
  const assumptions = {
    acceleratedExpansion: options.acceleratedExpansion ?? true,
    protonDecayEnabled: options.protonDecayEnabled ?? false,
    protonLifetimeYears: options.protonLifetimeYears ?? 1e35,
    darkMatterStable: options.darkMatterStable ?? true,
    blackHoleEvaporation: options.blackHoleEvaporation ?? true,
    vacuumDecayEnabled: options.vacuumDecayEnabled ?? false,
    speculative: true,
  };

  const structures = { galaxies: new Map(), groups: new Map(), clusters: new Map(), filaments: new Map(), voids: new Map() };
  const civilizations = new Map();
  const signals = new Map();
  const gravitationalWaves = new Map();
  const archaeology = new Map();
  const causalEvents = new Map();
  const causalEdges = [];
  const distanceSamples = new Map();
  const aggregate = { statisticalGalaxies: 0, statisticalClusters: 0, unreachableGalaxies: 0, vanishedSources: 0, falsePositiveGW: 0 };

  let elapsed = 0;
  let simulatedYears = 0;
  let cosmicAgeGyr = options.cosmicAgeGyr ?? 13.797;
  let scaleFactor = options.scaleFactor ?? 1;
  let galaxyClock = 0;
  let signalClock = 0;
  let horizonClock = 0;
  let civilizationClock = 0;
  let nextGalaxy = 1;
  let nextCivilization = 1;
  let nextSignal = 1;
  let nextWave = 1;
  let nextArtifact = 1;
  let nextEvent = 1;
  let destroyed = false;
  const hud = createHud();

  function initialize({ provideCapability }) {
    initializeHierarchy();
    synchronizePhase10();
    provideCapability('cosmology.flrw', api);
    provideCapability('universe.large-scale-structure', api);
    provideCapability('galaxies.evolution', api);
    provideCapability('waves.gravitational', api);
    provideCapability('history.spacetime-causal', api);
    provideCapability('archaeology.cosmological', api);
  }

  function step(dt) {
    if (destroyed) return;
    const amount = Math.max(0, dt);
    elapsed += amount;
    const deltaYears = amount * yearsPerSecond;
    simulatedYears += deltaYears;
    evolveScaleFactor(deltaYears);
    for (const galaxy of structures.galaxies.values()) if (!galaxy.bound) galaxy.properDistanceMpc = galaxy.comovingDistanceMpc * scaleFactor;
    galaxyClock += amount;
    signalClock += amount;
    horizonClock += amount;
    civilizationClock += amount;
    synchronizePhase10();

    if (galaxyClock >= (mobile ? 4 : 2)) {
      evolveGalaxies(galaxyClock * yearsPerSecond);
      galaxyClock = 0;
    }
    if (signalClock >= (mobile ? 2 : 1)) {
      propagateSignalsAndWaves();
      signalClock = 0;
    }
    if (horizonClock >= (mobile ? 6 : 3)) {
      updateHorizons();
      horizonClock = 0;
    }
    if (civilizationClock >= (mobile ? 5 : 2.5)) {
      evolveCivilizations(civilizationClock * yearsPerSecond);
      civilizationClock = 0;
    }
  }

  function initializeHierarchy() {
    if (structures.galaxies.size) return;
    const localCluster = { id: 'cluster-local', name: 'Local Cluster', comovingPositionMpc: { x: 0, y: 0, z: 0 }, haloMassSolar: 2e14, galaxyIds: [], bound: true };
    const localGroup = { id: 'group-local', name: 'Local Group', clusterId: localCluster.id, comovingPositionMpc: { x: 0, y: 0, z: 0 }, haloMassSolar: 3e12, galaxyIds: [], bound: true };
    structures.clusters.set(localCluster.id, localCluster);
    structures.groups.set(localGroup.id, localGroup);
    structures.filaments.set('filament-local', { id: 'filament-local', name: 'Local Filament', clusterIds: [localCluster.id], lengthMpc: 80, densityContrast: 4.2 });
    structures.voids.set('void-nearby', { id: 'void-nearby', name: 'Nearby Void', centerMpc: { x: 55, y: -12, z: 20 }, radiusMpc: 28, densityContrast: -0.82 });

    const local = makeGalaxy({ id: 'galaxy-local', name: 'Home Galaxy', groupId: localGroup.id, clusterId: localCluster.id, bound: true, comovingPositionMpc: { x: 0, y: 0, z: 0 }, properDistanceMpc: 0, haloMassSolar: 1.2e12, stellarMassSolar: 6e10, gasMassSolar: 8e9, starFormationRate: 1.8, metallicitySolar: 1, smbhMassSolar: 4.3e6, morphology: 'barred-spiral' });
    structures.galaxies.set(local.id, local);
    localGroup.galaxyIds.push(local.id);
    localCluster.galaxyIds.push(local.id);

    const nearbySpecs = [
      ['galaxy-companion-a', 'Companion A', 0.78, 9e11, 7e10, 3.4, 'spiral'],
      ['galaxy-companion-b', 'Companion B', 0.86, 1.4e12, 1e11, 1.1, 'spiral'],
      ['galaxy-dwarf-a', 'Dwarf A', 0.25, 8e9, 7e8, 0.05, 'irregular'],
      ['galaxy-dwarf-b', 'Dwarf B', 0.42, 1.2e10, 1e9, 0.08, 'dwarf-spheroidal'],
    ];
    for (let index = 0; index < nearbySpecs.length; index++) {
      const [id, name, distance, halo, stellar, sfr, morphology] = nearbySpecs[index];
      const galaxy = makeGalaxy({ id, name, groupId: localGroup.id, clusterId: localCluster.id, bound: true, comovingPositionMpc: { x: distance, y: index * 0.08, z: index * -0.04 }, properDistanceMpc: distance, haloMassSolar: halo, stellarMassSolar: stellar, gasMassSolar: stellar * 0.12, starFormationRate: sfr, metallicitySolar: 0.4 + index * 0.12, smbhMassSolar: Math.max(1e4, stellar * 1e-4), morphology });
      structures.galaxies.set(id, galaxy);
      localGroup.galaxyIds.push(id);
      localCluster.galaxyIds.push(id);
    }

    const explicitDistant = mobile ? 12 : 30;
    for (let index = 0; index < explicitDistant; index++) {
      const distanceMpc = 20 + index * 70 + rng() * 40;
      const angle = rng() * Math.PI * 2;
      const z = redshiftFromComovingMpc(distanceMpc);
      const id = `galaxy-distant-${index + 1}`;
      structures.galaxies.set(id, makeGalaxy({
        id,
        name: `Distant Galaxy ${index + 1}`,
        groupId: null,
        clusterId: index % 4 === 0 ? 'cluster-statistical' : null,
        bound: false,
        comovingPositionMpc: { x: Math.cos(angle) * distanceMpc, y: (rng() - 0.5) * distanceMpc * 0.4, z: Math.sin(angle) * distanceMpc },
        properDistanceMpc: distanceMpc * scaleFactor,
        redshift: z,
        haloMassSolar: 1e10 * Math.pow(10, rng() * 4),
        stellarMassSolar: 1e8 * Math.pow(10, rng() * 3),
        gasMassSolar: 1e8 * Math.pow(10, rng() * 3),
        starFormationRate: rng() * 20,
        metallicitySolar: 0.1 + rng() * 1.2,
        smbhMassSolar: 1e5 * Math.pow(10, rng() * 4),
        morphology: rng() < 0.5 ? 'spiral' : 'elliptical',
      }));
    }
    structures.clusters.set('cluster-statistical', { id: 'cluster-statistical', name: 'Selected Distant Cluster', comovingPositionMpc: { x: 900, y: 40, z: -120 }, haloMassSolar: 8e14, galaxyIds: [...structures.galaxies.keys()].filter(id => id.startsWith('galaxy-distant-') && Number(id.split('-').pop()) % 4 === 1), bound: true });
    aggregate.statisticalGalaxies = mobile ? 2e8 : 1e9;
    aggregate.statisticalClusters = mobile ? 2e5 : 1e6;
  }

  function makeGalaxy(input) {
    return {
      id: input.id || `galaxy-${nextGalaxy++}`,
      name: input.name || `Galaxy ${nextGalaxy}`,
      groupId: input.groupId || null,
      clusterId: input.clusterId || null,
      bound: Boolean(input.bound),
      referenceFrame: input.bound ? 'gravitationally-bound-proper' : 'flrw-comoving',
      comovingPositionMpc: { ...(input.comovingPositionMpc || { x: 0, y: 0, z: 0 }) },
      comovingDistanceMpc: magnitude(input.comovingPositionMpc || { x: 0, y: 0, z: 0 }),
      properDistanceMpc: Math.max(0, input.properDistanceMpc ?? magnitude(input.comovingPositionMpc || { x: 0, y: 0, z: 0 }) * scaleFactor),
      redshift: Math.max(0, input.redshift ?? redshiftFromComovingMpc(magnitude(input.comovingPositionMpc || { x: 0, y: 0, z: 0 }))),
      state: GALAXY_STATES.includes(input.state) ? input.state : 'star-forming',
      morphology: input.morphology || 'spiral',
      haloMassSolar: Math.max(0, input.haloMassSolar || 1e11),
      stellarMassSolar: Math.max(0, input.stellarMassSolar || 1e9),
      gasMassSolar: Math.max(0, input.gasMassSolar || 1e8),
      diskFraction: clamp(input.diskFraction ?? 0.65, 0, 1),
      spheroidFraction: clamp(input.spheroidFraction ?? 0.35, 0, 1),
      starFormationRate: Math.max(0, input.starFormationRate || 0),
      metallicitySolar: Math.max(0, input.metallicitySolar || 0.1),
      supernovaRate: Math.max(0, (input.starFormationRate || 0) * 0.01),
      feedback: clamp(input.feedback ?? 0.1, 0, 2),
      ramPressure: clamp(input.ramPressure ?? 0, 0, 2),
      tidalStress: clamp(input.tidalStress ?? 0, 0, 2),
      quenching: clamp(input.quenching ?? 0, 0, 1),
      smbhMassSolar: Math.max(1e3, input.smbhMassSolar || 1e5),
      accretionEddington: clamp(input.accretionEddington ?? 0.01, 0, 3),
      agnLuminositySolar: Math.max(0, input.agnLuminositySolar || 0),
      jetPowerW: Math.max(0, input.jetPowerW || 0),
      mergerPartnerId: input.mergerPartnerId || null,
      mergerProgress: clamp(input.mergerProgress ?? 0, 0, 1),
      environmentalTemperatureK: Math.max(0, input.environmentalTemperatureK ?? 12),
      reachable: input.reachable ?? true,
      unreachableAtYear: input.unreachableAtYear ?? null,
      vanished: Boolean(input.vanished),
      createdAtYear: simulatedYears,
    };
  }

  function synchronizePhase10() {
    const localGalaxy = structures.galaxies.get('galaxy-local');
    for (const branch of phase10.getBranches?.() || []) {
      if (civilizations.has(branch.id)) continue;
      civilizations.set(branch.id, {
        id: branch.id,
        name: branch.name,
        sourceBranchId: branch.id,
        galaxyId: localGalaxy.id,
        state: branch.state === 'extinct' ? 'extinct' : branch.state === 'silent' ? 'silent' : 'active',
        population: branch.population,
        technology: branch.technology,
        machineFraction: branch.machineFraction,
        institutions: branch.institutions,
        detectability: branch.detectability,
        strategy: chooseSurvivalStrategy(branch),
        targetGalaxyId: null,
        migrationProgress: 0,
        reachable: true,
        temperaturePreferenceK: 20 - branch.machineFraction * 17,
        archiveIntegrity: 0.8,
        createdAtYear: simulatedYears,
      });
    }
    for (const ruin of phase10.getRuins?.() || []) {
      const id = `phase10-${ruin.id}`;
      if (archaeology.has(id)) continue;
      archaeology.set(id, {
        id,
        kind: ruin.kind,
        sourceGalaxyId: 'galaxy-local',
        sourceReachable: true,
        emissionRedshift: 0,
        observedRedshift: 0,
        lookbackYears: 0,
        preservation: ruin.preservation,
        archiveIntegrity: ruin.archives,
        artificialSignal: ruin.artificialIsotopes,
        discovered: ruin.discovered,
        discoveredAtYear: ruin.discoveredAt,
        referenceFrame: 'local-bound',
      });
    }
  }

  function chooseSurvivalStrategy(branch) {
    if (branch.machineFraction > 0.7) return 'low-temperature-computation';
    if (branch.technology > 1.3) return 'black-hole-energy';
    if (branch.expansionDrive > 0.5) return 'galaxy-migration';
    if (branch.caution > 0.7) return 'intentional-silence';
    return 'distributed-redundancy';
  }

  function evolveScaleFactor(deltaYears) {
    const substeps = 4;
    const dtGyr = deltaYears / 1e9 / substeps;
    for (let index = 0; index < substeps; index++) {
      const hGyr = hubblePerGyr(scaleFactor);
      scaleFactor = Math.max(1e-8, scaleFactor + scaleFactor * hGyr * dtGyr);
      cosmicAgeGyr += dtGyr;
    }
  }

  function evolveGalaxies(deltaYears) {
    for (const galaxy of structures.galaxies.values()) {
      if (!galaxy.bound) {
        galaxy.properDistanceMpc = galaxy.comovingDistanceMpc * scaleFactor;
        galaxy.redshift = Math.max(galaxy.redshift, Math.max(0, scaleFactor - 1));
      }
      if (galaxy.vanished) continue;
      const consumption = Math.min(galaxy.gasMassSolar, galaxy.starFormationRate * deltaYears);
      galaxy.gasMassSolar -= consumption;
      galaxy.stellarMassSolar += consumption * 0.72;
      galaxy.metallicitySolar = Math.max(0, galaxy.metallicitySolar + consumption / Math.max(1, galaxy.stellarMassSolar) * 0.03);
      galaxy.supernovaRate = galaxy.starFormationRate * 0.01;
      galaxy.feedback = clamp(galaxy.feedback + galaxy.supernovaRate * 0.001 - deltaYears * 1e-11, 0, 2);
      galaxy.starFormationRate = Math.max(0, galaxy.starFormationRate * Math.exp(-deltaYears / Math.max(1e7, 3e9 * (1 - galaxy.quenching * 0.8))) + galaxy.tidalStress * 1e-8 * deltaYears);
      galaxy.accretionEddington = clamp(galaxy.accretionEddington + galaxy.gasMassSolar / Math.max(1, galaxy.stellarMassSolar) * 1e-4 - galaxy.feedback * 2e-5, 0, 3);
      galaxy.smbhMassSolar += galaxy.smbhMassSolar * galaxy.accretionEddington * deltaYears / 4.5e8;
      galaxy.agnLuminositySolar = galaxy.smbhMassSolar * galaxy.accretionEddington * 3.2e4;
      galaxy.jetPowerW = galaxy.agnLuminositySolar * 3.828e26 * clamp(galaxy.accretionEddington * 0.1, 0, 0.3);
      galaxy.environmentalTemperatureK = cosmicBackground().cmbTemperatureK + Math.pow(Math.max(0, galaxy.starFormationRate), 0.25) * 5 + Math.pow(Math.max(0, galaxy.agnLuminositySolar), 0.15) * 0.2;
      if (galaxy.gasMassSolar / Math.max(1, galaxy.stellarMassSolar) < 0.005 || galaxy.quenching > 0.8) galaxy.state = 'quenched';
      if (galaxy.mergerPartnerId) advanceGalaxyMerger(galaxy, deltaYears);
    }
  }

  function advanceGalaxyMerger(galaxy, deltaYears) {
    const partner = structures.galaxies.get(galaxy.mergerPartnerId);
    if (!partner || partner.vanished) { galaxy.mergerPartnerId = null; return; }
    galaxy.state = 'merging';
    partner.state = 'merging';
    galaxy.mergerProgress = clamp(galaxy.mergerProgress + deltaYears / 5e8, 0, 1);
    partner.mergerProgress = galaxy.mergerProgress;
    const stress = clamp(galaxy.mergerProgress * 1.4, 0, 1.4);
    galaxy.tidalStress = partner.tidalStress = stress;
    galaxy.starFormationRate = Math.max(galaxy.starFormationRate, (galaxy.gasMassSolar + partner.gasMassSolar) / 8e8 * stress);
    if (galaxy.mergerProgress < 1) return;
    completeGalaxyMerger(galaxy, partner);
  }

  function completeGalaxyMerger(primary, secondary) {
    if (secondary.vanished) return;
    const parent = addEvent('galaxy-merger', `${primary.name} and ${secondary.name} merge into a gravitationally bound remnant.`, [], { galaxyIds: [primary.id, secondary.id], referenceFrame: 'gravitationally-bound-proper' });
    primary.name = `${primary.name}–${secondary.name} Remnant`;
    primary.state = 'starburst';
    primary.morphology = 'merger-remnant';
    primary.haloMassSolar += secondary.haloMassSolar;
    primary.stellarMassSolar += secondary.stellarMassSolar;
    primary.gasMassSolar += secondary.gasMassSolar;
    primary.starFormationRate = Math.max(25, primary.starFormationRate + secondary.starFormationRate) * 3;
    primary.smbhMassSolar += secondary.smbhMassSolar;
    primary.accretionEddington = Math.max(0.65, primary.accretionEddington);
    primary.agnLuminositySolar = primary.smbhMassSolar * primary.accretionEddington * 3.2e4;
    primary.jetPowerW = primary.agnLuminositySolar * 3.828e26 * 0.12;
    primary.mergerPartnerId = null;
    primary.mergerProgress = 1;
    secondary.vanished = true;
    secondary.state = 'remnant';
    secondary.starFormationRate = 0;
    aggregate.vanishedSources++;
    addEvent('starburst', `${primary.name} enters a merger-driven starburst.`, [parent.id], { galaxyId: primary.id, starFormationRate: primary.starFormationRate });
    addEvent('agn', `${primary.name} ignites an active galactic nucleus through black-hole accretion.`, [parent.id], { galaxyId: primary.id, agnLuminositySolar: primary.agnLuminositySolar, jetPowerW: primary.jetPowerW });
  }

  function updateHorizons() {
    const eventHorizonGly = horizons().eventHorizonGly;
    aggregate.unreachableGalaxies = 0;
    for (const galaxy of structures.galaxies.values()) {
      if (galaxy.bound) { galaxy.reachable = true; continue; }
      const distanceGly = galaxy.properDistanceMpc * MPC_TO_LY / 1e9;
      const reachable = distanceGly <= eventHorizonGly;
      if (!reachable) aggregate.unreachableGalaxies++;
      if (galaxy.reachable && !reachable) {
        galaxy.reachable = false;
        galaxy.unreachableAtYear = simulatedYears;
        const event = addEvent('horizon-crossing', `${galaxy.name} becomes permanently unreachable beyond the cosmological event horizon.`, [], { galaxyId: galaxy.id, properDistanceGly: distanceGly, eventHorizonGly, referenceFrame: 'flrw-comoving' });
        for (const civ of [...civilizations.values()].filter(item => item.galaxyId === galaxy.id)) {
          civ.reachable = false;
          civ.state = 'unreachable';
          addEvent('horizon-crossing', `${civ.name} becomes causally unreachable.`, [event.id], { civilizationId: civ.id, galaxyId: galaxy.id });
        }
      }
    }
  }

  function evolveCivilizations(deltaYears) {
    for (const civ of civilizations.values()) {
      if (civ.state === 'extinct' || civ.state === 'unreachable') continue;
      const galaxy = structures.galaxies.get(civ.galaxyId);
      if (!galaxy) continue;
      const temperature = galaxy.environmentalTemperatureK;
      if (civ.machineFraction > 0.7 && civ.strategy === 'low-temperature-computation' && temperature > civ.temperaturePreferenceK && !civ.targetGalaxyId) {
        const target = [...structures.galaxies.values()].filter(item => item.reachable && !item.vanished && item.environmentalTemperatureK < temperature && item.id !== galaxy.id).sort((a, b) => a.environmentalTemperatureK - b.environmentalTemperatureK)[0];
        if (target) beginCivilizationMigration(civ, target.id);
      }
      if (civ.state === 'migrating') {
        civ.migrationProgress = clamp(civ.migrationProgress + deltaYears / 2e8, 0, 1);
        if (civ.migrationProgress >= 1) {
          const sourceGalaxyId = civ.galaxyId;
          civ.galaxyId = civ.targetGalaxyId;
          civ.targetGalaxyId = null;
          civ.state = 'active';
          addEvent('migration', `${civ.name} completes migration to a lower-temperature computation environment.`, [], { civilizationId: civ.id, sourceGalaxyId, targetGalaxyId: civ.galaxyId });
        }
      }
      if (civ.strategy === 'hibernation') civ.state = 'hibernating';
      if (civ.strategy === 'intentional-silence') civ.state = 'silent';
      if (civ.machineFraction > 0.9 && civ.institutions > 0.75) civ.state = 'consolidated';
    }
  }

  function beginCivilizationMigration(civ, targetGalaxyId) {
    const target = structures.galaxies.get(targetGalaxyId);
    if (!target?.reachable) return false;
    civ.targetGalaxyId = targetGalaxyId;
    civ.state = 'migrating';
    civ.migrationProgress = 0;
    addEvent('strategy', `${civ.name} begins a migration strategy toward ${target.name}.`, [], { civilizationId: civ.id, sourceGalaxyId: civ.galaxyId, targetGalaxyId, strategy: civ.strategy });
    return true;
  }

  function emitCosmologicalSignal(input) {
    const source = structures.galaxies.get(input.sourceGalaxyId);
    const target = structures.galaxies.get(input.targetGalaxyId || 'galaxy-local');
    if (!source || !target || !source.reachable && source.id !== target.id) return null;
    const z = Math.max(0, input.redshift ?? source.redshift);
    const distances = cosmologicalDistances(z);
    const lightTravelYears = Math.max(1, input.lightTravelYears ?? distances.lookbackTimeGyr * 1e9);
    const event = addEvent('signal-emission', `${input.kind || 'signal'} is emitted by ${source.name}.`, input.parentEvents || [], { sourceGalaxyId: source.id, targetGalaxyId: target.id, redshift: z, referenceFrame: 'source-comoving' });
    const signal = {
      id: input.id || `cosmic-signal-${nextSignal++}`,
      kind: input.kind || 'narrowband-technosignature',
      sourceGalaxyId: source.id,
      targetGalaxyId: target.id,
      emittedAtYear: simulatedYears,
      arrivesAtYear: simulatedYears + lightTravelYears,
      lightTravelYears,
      emissionRedshift: z,
      emittedWavelengthNm: Math.max(1e-12, input.emittedWavelengthNm ?? 1420),
      observedWavelengthNm: Math.max(1e-12, input.emittedWavelengthNm ?? 1420) * (1 + z),
      emittedFrequencyHz: input.emittedFrequencyHz ?? 1.42e9,
      observedFrequencyHz: (input.emittedFrequencyHz ?? 1.42e9) / (1 + z),
      comovingDistanceMpc: distances.comovingDistanceMpc,
      luminosityDistanceMpc: distances.luminosityDistanceMpc,
      state: 'propagating',
      progress: 0,
      uncertainty: clamp(input.uncertainty ?? 0.08, 0, 1),
      emissionEventId: event.id,
      observationEventId: null,
      referenceFrame: 'flrw-null-geodesic-approximation',
    };
    signals.set(signal.id, signal);
    return signal;
  }

  function emitGravitationalWave(input) {
    const source = structures.galaxies.get(input.sourceGalaxyId);
    if (!source) return null;
    const z = Math.max(0, input.redshift ?? source.redshift);
    const distances = cosmologicalDistances(z);
    const lightTravelYears = Math.max(1, input.lightTravelYears ?? distances.lookbackTimeGyr * 1e9);
    const sourceMassSolar = Math.max(0.1, input.sourceMassSolar ?? 60);
    const sourceFrequencyHz = Math.max(1e-9, input.sourceFrequencyHz ?? 150);
    const event = addEvent('gw-emission', `Compact objects merge in ${source.name}, emitting gravitational waves.`, input.parentEvents || [], { sourceGalaxyId: source.id, redshift: z, sourceMassSolar, sourceFrequencyHz, referenceFrame: 'source-frame' });
    const wave = {
      id: input.id || `gw-${nextWave++}`,
      sourceGalaxyId: source.id,
      emittedAtYear: simulatedYears,
      arrivesAtYear: simulatedYears + lightTravelYears,
      lightTravelYears,
      redshift: z,
      sourceMassSolar,
      detectorFrameMassSolar: sourceMassSolar * (1 + z),
      sourceFrequencyHz,
      observedFrequencyHz: sourceFrequencyHz / (1 + z),
      luminosityDistanceMpc: distances.luminosityDistanceMpc,
      strain: input.strain ?? 1e-21 / Math.max(1, distances.luminosityDistanceMpc / 100),
      localizationSquareDegrees: input.localizationSquareDegrees ?? 120,
      detectorSensitivity: input.detectorSensitivity ?? 2e-22,
      detectorsRequired: input.detectorsRequired ?? 2,
      detectorConfirmations: 0,
      state: 'propagating',
      falsePositive: Boolean(input.falsePositive),
      emissionEventId: event.id,
      detectionEventId: null,
      followupEventIds: [],
      referenceFrame: 'observer-redshifted',
    };
    gravitationalWaves.set(wave.id, wave);
    return wave;
  }

  function propagateSignalsAndWaves() {
    for (const signal of signals.values()) {
      if (signal.state !== 'propagating') continue;
      signal.progress = clamp((simulatedYears - signal.emittedAtYear) / signal.lightTravelYears, 0, 1);
      if (simulatedYears < signal.arrivesAtYear) continue;
      signal.state = 'observed';
      const event = addEvent('signal-observation', `${signal.kind} is observed at redshift ${signal.emissionRedshift.toFixed(4)}.`, [signal.emissionEventId], { signalId: signal.id, observedWavelengthNm: signal.observedWavelengthNm, observedFrequencyHz: signal.observedFrequencyHz, redshift: signal.emissionRedshift, referenceFrame: 'observer-frame' });
      signal.observationEventId = event.id;
    }
    for (const wave of gravitationalWaves.values()) {
      if (wave.state !== 'propagating') continue;
      if (simulatedYears < wave.arrivesAtYear) continue;
      if (wave.falsePositive) {
        wave.state = 'rejected';
        aggregate.falsePositiveGW++;
        continue;
      }
      wave.detectorConfirmations = wave.strain >= wave.detectorSensitivity ? Math.max(wave.detectorsRequired, 2) : 1;
      if (wave.detectorConfirmations < wave.detectorsRequired) { wave.state = 'candidate'; continue; }
      wave.state = 'detected';
      const detection = addEvent('gw-detection', `A redshifted gravitational-wave event is detected from ${wave.sourceGalaxyId}.`, [wave.emissionEventId], { waveId: wave.id, observedFrequencyHz: wave.observedFrequencyHz, detectorFrameMassSolar: wave.detectorFrameMassSolar, redshift: wave.redshift, referenceFrame: 'observer-frame' });
      wave.detectionEventId = detection.id;
      const electromagnetic = addEvent('multimessenger', 'Electromagnetic observatories begin causal follow-up after the gravitational-wave detection.', [detection.id], { waveId: wave.id, messenger: 'electromagnetic', delayYears: 0 });
      const neutrino = addEvent('multimessenger', 'Neutrino observatories begin causal follow-up after the gravitational-wave detection.', [detection.id], { waveId: wave.id, messenger: 'neutrino', delayYears: 0 });
      wave.followupEventIds.push(electromagnetic.id, neutrino.id);
    }
  }

  function createCosmologicalArtifact(input) {
    const source = structures.galaxies.get(input.sourceGalaxyId);
    if (!source) return null;
    const z = Math.max(0, input.redshift ?? source.redshift);
    const distances = cosmologicalDistances(z);
    const artifact = {
      id: input.id || `cosmic-artifact-${nextArtifact++}`,
      kind: input.kind || 'redshifted-technosignature',
      sourceGalaxyId: source.id,
      sourceReachable: source.reachable,
      emissionRedshift: z,
      observedRedshift: z,
      lookbackYears: distances.lookbackTimeGyr * 1e9,
      preservation: clamp(input.preservation ?? 0.6, 0, 1),
      archiveIntegrity: clamp(input.archiveIntegrity ?? 0.5, 0, 1),
      artificialSignal: clamp(input.artificialSignal ?? 0.7, 0, 1),
      discovered: Boolean(input.discovered),
      discoveredAtYear: input.discovered ? simulatedYears : null,
      referenceFrame: 'observer-past-light-cone',
    };
    archaeology.set(artifact.id, artifact);
    if (artifact.discovered) addEvent('archaeology', `A ${artifact.kind} is observed from ${source.name}; its source is ${source.reachable ? 'reachable' : 'no longer reachable'}.`, [], { artifactId: artifact.id, sourceGalaxyId: source.id, redshift: z, sourceReachable: source.reachable, referenceFrame: artifact.referenceFrame });
    return artifact;
  }

  function addEvent(type, description, parents = [], data = {}) {
    const id = `phase11-${nextEvent++}`;
    const event = {
      id,
      type: EVENT_TYPES.includes(type) ? type : 'strategy',
      description,
      coordinateYear: simulatedYears,
      cosmicAgeGyr,
      scaleFactor,
      redshift: data.redshift ?? Math.max(0, 1 / scaleFactor - 1),
      lookbackTimeGyr: data.redshift != null ? cosmologicalDistances(Math.max(0, data.redshift)).lookbackTimeGyr : 0,
      referenceFrame: data.referenceFrame || 'flrw-comoving',
      observationalUncertainty: data.uncertainty ?? 0,
      tick: world.tick,
      parents: [...new Set(parents.filter(parent => causalEvents.has(parent)))],
      data: { ...data },
    };
    causalEvents.set(id, event);
    for (const parent of event.parents) causalEdges.push({ from: parent, to: id });
    if (causalEvents.size > 1600) {
      const oldest = causalEvents.keys().next().value;
      causalEvents.delete(oldest);
      for (let index = causalEdges.length - 1; index >= 0; index--) if (causalEdges[index].from === oldest || causalEdges[index].to === oldest) causalEdges.splice(index, 1);
    }
    window.dispatchEvent(new CustomEvent('phase11-history', { detail: event }));
    return event;
  }

  function cosmologyE(a) {
    const safeA = Math.max(1e-12, a);
    const de = parameters.omegaLambda * Math.pow(safeA, -3 * (1 + parameters.darkEnergyW));
    return Math.sqrt(parameters.omegaRadiation / safeA ** 4 + parameters.omegaMatter / safeA ** 3 + parameters.omegaCurvature / safeA ** 2 + de);
  }

  function hubbleKmSPerMpc(a = scaleFactor) { return parameters.H0KmSPerMpc * cosmologyE(a); }
  function hubblePerGyr(a = scaleFactor) { return hubbleKmSPerMpc(a) / KM_PER_MPC * SECONDS_PER_YEAR * 1e9; }

  function cosmologicalDistances(z) {
    const safeZ = clamp(Number(z) || 0, 0, 50);
    const integralDistance = integrateSimpson(value => 1 / eOfZ(value), 0, safeZ, mobile ? 64 : 160);
    const integralTime = integrateSimpson(value => 1 / ((1 + value) * eOfZ(value)), 0, safeZ, mobile ? 64 : 160);
    const hubbleDistanceMpc = C_KM_S / parameters.H0KmSPerMpc;
    const comovingDistanceMpc = hubbleDistanceMpc * integralDistance;
    const lookbackTimeGyr = integralTime * HUBBLE_TIME_YEARS_FACTOR / parameters.H0KmSPerMpc / 1e9;
    return {
      redshift: safeZ,
      comovingDistanceMpc,
      properDistanceMpc: comovingDistanceMpc * scaleFactor,
      luminosityDistanceMpc: comovingDistanceMpc * (1 + safeZ),
      angularDiameterDistanceMpc: comovingDistanceMpc / (1 + safeZ),
      lookbackTimeGyr,
      referenceFrame: 'flrw-comoving-observer-at-z0',
      units: { distance: 'Mpc', time: 'Gyr', H0: 'km s^-1 Mpc^-1' },
    };
  }

  function eOfZ(z) {
    const one = 1 + z;
    return Math.sqrt(parameters.omegaRadiation * one ** 4 + parameters.omegaMatter * one ** 3 + parameters.omegaCurvature * one ** 2 + parameters.omegaLambda * one ** (3 * (1 + parameters.darkEnergyW)));
  }

  function horizons() {
    const hubbleDistanceMpc = C_KM_S / parameters.H0KmSPerMpc;
    const particleIntegral = integrateLogA(a => 1 / (a * a * cosmologyE(a)), 1e-7, scaleFactor, mobile ? 96 : 240);
    const futureMax = assumptions.acceleratedExpansion ? 1e4 : 100;
    const eventIntegral = integrateLogA(a => 1 / (a * a * cosmologyE(a)), scaleFactor, futureMax, mobile ? 96 : 240);
    return {
      particleHorizonMpc: hubbleDistanceMpc * scaleFactor * particleIntegral,
      eventHorizonMpc: hubbleDistanceMpc * scaleFactor * eventIntegral,
      particleHorizonGly: hubbleDistanceMpc * scaleFactor * particleIntegral * MPC_TO_LY / 1e9,
      eventHorizonGly: hubbleDistanceMpc * scaleFactor * eventIntegral * MPC_TO_LY / 1e9,
      referenceFrame: 'flrw-proper-at-current-scale-factor',
    };
  }

  function cosmicBackground() {
    const cmbTemperatureK = 2.7255 / scaleFactor;
    const radiationDensityRelative = parameters.omegaRadiation / scaleFactor ** 4;
    const peakCosmicSfr = 0.15;
    const decline = Math.exp(-Math.max(0, cosmicAgeGyr - 3.5) / 6);
    return {
      cmbTemperatureK,
      radiationDensityRelative,
      cosmicStarFormationDensity: peakCosmicSfr * decline,
      meanMetallicitySolar: clamp((cosmicAgeGyr / 13.8) ** 1.4, 0, 2),
      ionizingBackground: Math.exp(-Math.max(0, cosmicAgeGyr - 6) / 8),
      intergalacticMediumTemperatureK: 1e4 * Math.exp(-Math.max(0, cosmicAgeGyr - 4) / 20) + cmbTemperatureK,
      units: { temperature: 'K', starFormationDensity: 'solar masses yr^-1 Mpc^-3' },
    };
  }

  function redshiftFromComovingMpc(distanceMpc) {
    if (distanceMpc <= 0) return 0;
    let low = 0;
    let high = 20;
    for (let index = 0; index < 36; index++) {
      const mid = (low + high) / 2;
      if (cosmologicalDistances(mid).comovingDistanceMpc < distanceMpc) low = mid;
      else high = mid;
    }
    return (low + high) / 2;
  }

  function sampleDistanceInvariant(id, comovingDistanceMpc, a0, a1, bound = false) {
    const sample = {
      id,
      comovingDistanceMpc,
      a0,
      a1,
      proper0Mpc: bound ? comovingDistanceMpc : comovingDistanceMpc * a0,
      proper1Mpc: bound ? comovingDistanceMpc : comovingDistanceMpc * a1,
      bound,
      referenceFrame: bound ? 'gravitationally-bound-proper' : 'flrw-comoving',
    };
    distanceSamples.set(id, sample);
    return sample;
  }

  function runInvariants() {
    const failures = [];
    const sum = parameters.omegaMatter + parameters.omegaRadiation + parameters.omegaLambda + parameters.omegaCurvature;
    if (Math.abs(sum - 1) > 1e-6) failures.push(`density-closure:${sum}`);
    if (parameters.omegaBaryon > parameters.omegaMatter) failures.push('baryons-exceed-matter');
    if (!(scaleFactor > 0) || !Number.isFinite(scaleFactor)) failures.push('invalid-scale-factor');
    if (!(hubbleKmSPerMpc() > 0)) failures.push('invalid-hubble-parameter');
    const horizon = horizons();
    if (![horizon.particleHorizonMpc, horizon.eventHorizonMpc].every(value => Number.isFinite(value) && value > 0)) failures.push('invalid-causal-horizon');

    for (const galaxy of structures.galaxies.values()) {
      if (!GALAXY_STATES.includes(galaxy.state)) failures.push(`invalid-galaxy-state:${galaxy.id}`);
      const values = [galaxy.comovingDistanceMpc, galaxy.properDistanceMpc, galaxy.haloMassSolar, galaxy.stellarMassSolar, galaxy.gasMassSolar, galaxy.smbhMassSolar];
      if (values.some(value => !Number.isFinite(value) || value < 0)) failures.push(`invalid-galaxy-numerics:${galaxy.id}`);
      if (!galaxy.bound && Math.abs(galaxy.properDistanceMpc - galaxy.comovingDistanceMpc * scaleFactor) > Math.max(1e-6, galaxy.properDistanceMpc * 1e-9)) failures.push(`comoving-proper-mismatch:${galaxy.id}`);
      if (galaxy.bound && galaxy.referenceFrame !== 'gravitationally-bound-proper') failures.push(`bound-frame-mismatch:${galaxy.id}`);
    }
    for (const civ of civilizations.values()) {
      if (!CIV_STATES.includes(civ.state)) failures.push(`invalid-civilization-state:${civ.id}`);
      if (civ.state === 'unreachable' && civ.reachable) failures.push(`unreachable-civ-marked-reachable:${civ.id}`);
    }
    for (const signal of signals.values()) {
      if (signal.arrivesAtYear + 1e-6 < signal.emittedAtYear + signal.lightTravelYears) failures.push(`superluminal-signal:${signal.id}`);
      if (Math.abs(signal.observedWavelengthNm - signal.emittedWavelengthNm * (1 + signal.emissionRedshift)) > 1e-8) failures.push(`wavelength-redshift-mismatch:${signal.id}`);
      if (Math.abs(signal.observedFrequencyHz - signal.emittedFrequencyHz / (1 + signal.emissionRedshift)) > Math.max(1e-6, signal.observedFrequencyHz * 1e-9)) failures.push(`frequency-redshift-mismatch:${signal.id}`);
    }
    for (const wave of gravitationalWaves.values()) {
      if (wave.arrivesAtYear + 1e-6 < wave.emittedAtYear + wave.lightTravelYears) failures.push(`superluminal-gw:${wave.id}`);
      if (Math.abs(wave.observedFrequencyHz - wave.sourceFrequencyHz / (1 + wave.redshift)) > 1e-8) failures.push(`gw-frequency-redshift-mismatch:${wave.id}`);
      if (Math.abs(wave.detectorFrameMassSolar - wave.sourceMassSolar * (1 + wave.redshift)) > 1e-8) failures.push(`gw-mass-redshift-mismatch:${wave.id}`);
      if (wave.detectionEventId && wave.followupEventIds.some(id => causalEvents.get(id)?.coordinateYear < causalEvents.get(wave.detectionEventId)?.coordinateYear)) failures.push(`multimessenger-before-detection:${wave.id}`);
    }
    for (const sample of distanceSamples.values()) {
      if (!sample.bound) {
        if (Math.abs(sample.proper0Mpc - sample.comovingDistanceMpc * sample.a0) > 1e-9) failures.push(`distance-sample-a0:${sample.id}`);
        if (Math.abs(sample.proper1Mpc - sample.comovingDistanceMpc * sample.a1) > 1e-9) failures.push(`distance-sample-a1:${sample.id}`);
      } else if (Math.abs(sample.proper0Mpc - sample.proper1Mpc) > 1e-9) failures.push(`bound-distance-expanded:${sample.id}`);
    }
    for (const edge of causalEdges) {
      const from = causalEvents.get(edge.from);
      const to = causalEvents.get(edge.to);
      if (!from || !to) failures.push(`orphan-causal-edge:${edge.from}:${edge.to}`);
      else if (to.coordinateYear + 1e-9 < from.coordinateYear) failures.push(`causal-order-violation:${edge.from}:${edge.to}`);
    }
    return { ok: failures.length === 0, failures, scaleFactor, cosmicAgeGyr, checkedAtYear: simulatedYears };
  }

  function debugSeedScenario(kind = 'galaxy-merger') {
    initializeHierarchy();
    if (kind === 'galaxy-merger') {
      const a = structures.galaxies.get('debug-merger-a') || makeGalaxy({ id: 'debug-merger-a', name: 'Merger A', bound: true, comovingPositionMpc: { x: 0.1, y: 0, z: 0 }, properDistanceMpc: 0.1, haloMassSolar: 1e12, stellarMassSolar: 7e10, gasMassSolar: 2e10, starFormationRate: 8, smbhMassSolar: 8e7, mergerPartnerId: 'debug-merger-b', mergerProgress: 0.99 });
      const b = structures.galaxies.get('debug-merger-b') || makeGalaxy({ id: 'debug-merger-b', name: 'Merger B', bound: true, comovingPositionMpc: { x: 0.11, y: 0, z: 0 }, properDistanceMpc: 0.11, haloMassSolar: 8e11, stellarMassSolar: 5e10, gasMassSolar: 1.5e10, starFormationRate: 6, smbhMassSolar: 5e7, mergerPartnerId: 'debug-merger-a', mergerProgress: 0.99 });
      a.mergerPartnerId = b.id; b.mergerPartnerId = a.id; a.mergerProgress = b.mergerProgress = 0.99;
      structures.galaxies.set(a.id, a); structures.galaxies.set(b.id, b);
      return { ok: true, kind, galaxyIds: [a.id, b.id] };
    }
    if (kind === 'redshifted-signal') {
      const source = ensureDebugGalaxy('debug-signal-source', 4.28, 0.001, true);
      const signal = emitCosmologicalSignal({ id: 'debug-redshifted-signal', sourceGalaxyId: source.id, targetGalaxyId: 'galaxy-local', redshift: 0.001, emittedWavelengthNm: 500, emittedFrequencyHz: 6e14, lightTravelYears: 1e7, kind: 'cosmological-beacon' });
      return { ok: Boolean(signal), kind, signalId: signal?.id, observedWavelengthNm: signal?.observedWavelengthNm };
    }
    if (kind === 'event-horizon') {
      const galaxy = ensureDebugGalaxy('debug-horizon-galaxy', 9000, 3, false);
      galaxy.properDistanceMpc = Math.max(galaxy.properDistanceMpc, horizons().eventHorizonMpc * 1.3);
      galaxy.comovingDistanceMpc = galaxy.properDistanceMpc / scaleFactor;
      galaxy.comovingPositionMpc = { x: galaxy.comovingDistanceMpc, y: 0, z: 0 };
      galaxy.reachable = true;
      const id = 'debug-horizon-civ';
      civilizations.set(id, { id, name: 'Horizon Branch', sourceBranchId: null, galaxyId: galaxy.id, state: 'active', population: 1e6, technology: 1.5, machineFraction: 0.5, institutions: 0.7, detectability: 0.4, strategy: 'distributed-redundancy', targetGalaxyId: null, migrationProgress: 0, reachable: true, temperaturePreferenceK: 5, archiveIntegrity: 0.9, createdAtYear: simulatedYears });
      updateHorizons();
      return { ok: !galaxy.reachable && civilizations.get(id)?.state === 'unreachable', kind, galaxyId: galaxy.id, civilizationId: id, eventHorizonGly: horizons().eventHorizonGly };
    }
    if (kind === 'gravitational-wave') {
      const source = ensureDebugGalaxy('debug-gw-source', 850, 0.2, true);
      const wave = emitGravitationalWave({ id: 'debug-gw-event', sourceGalaxyId: source.id, redshift: 0.2, sourceMassSolar: 62, sourceFrequencyHz: 180, lightTravelYears: 8e6, strain: 8e-21, detectorSensitivity: 1e-22, detectorsRequired: 2 });
      return { ok: Boolean(wave), kind, waveId: wave?.id, observedFrequencyHz: wave?.observedFrequencyHz };
    }
    if (kind === 'machine-cold-migration') {
      const hot = ensureDebugGalaxy('debug-machine-hot', 0.2, 0, true); hot.environmentalTemperatureK = 80;
      const cold = ensureDebugGalaxy('debug-machine-cold', 0.3, 0, true); cold.environmentalTemperatureK = 3;
      const id = 'debug-machine-civilization';
      const civ = { id, name: 'Cryogenic Machine Archive', sourceBranchId: null, galaxyId: hot.id, state: 'active', population: 5e7, technology: 1.8, machineFraction: 0.98, institutions: 0.9, detectability: 0.2, strategy: 'low-temperature-computation', targetGalaxyId: null, migrationProgress: 0, reachable: true, temperaturePreferenceK: 20, archiveIntegrity: 0.99, createdAtYear: simulatedYears };
      civilizations.set(id, civ);
      beginCivilizationMigration(civ, cold.id);
      civ.migrationProgress = 0.99;
      return { ok: true, kind, civilizationId: id, targetGalaxyId: cold.id };
    }
    if (kind === 'unreachable-archaeology') {
      const source = ensureDebugGalaxy('debug-archaeology-source', 10000, 2.5, false);
      source.properDistanceMpc = horizons().eventHorizonMpc * 1.5;
      source.comovingDistanceMpc = source.properDistanceMpc / scaleFactor;
      source.reachable = false;
      const artifact = createCosmologicalArtifact({ id: 'debug-redshifted-artifact', sourceGalaxyId: source.id, redshift: 2.5, kind: 'redshifted-technosignature', preservation: 0.8, archiveIntegrity: 0.72, artificialSignal: 0.95, discovered: true });
      return { ok: Boolean(artifact?.discovered && !artifact.sourceReachable), kind, artifactId: artifact?.id };
    }
    if (kind === 'distance-frames') {
      const expanding = sampleDistanceInvariant('debug-unbound-distance', 100, 0.8, 1.2, false);
      const bound = sampleDistanceInvariant('debug-bound-distance', 0.8, 0.8, 1.2, true);
      return { ok: true, kind, expanding, bound };
    }
    return { ok: false, kind, reason: 'unknown-scenario' };
  }

  function ensureDebugGalaxy(id, distanceMpc, redshift, reachable) {
    if (structures.galaxies.has(id)) return structures.galaxies.get(id);
    const galaxy = makeGalaxy({ id, name: id.replaceAll('-', ' '), bound: distanceMpc < 1, comovingPositionMpc: { x: distanceMpc, y: 0, z: 0 }, properDistanceMpc: distanceMpc * scaleFactor, redshift, haloMassSolar: 1e12, stellarMassSolar: 8e10, gasMassSolar: 9e9, starFormationRate: 2, smbhMassSolar: 1e7, reachable });
    structures.galaxies.set(id, galaxy);
    return galaxy;
  }

  function render(frame = {}) {
    const timestamp = frame.timestamp ?? performance.now();
    if (timestamp - hud.lastUpdate < 600) return;
    hud.lastUpdate = timestamp;
    const state = getState();
    hud.element.hidden = state.signals === 0 && state.gravitationalWaves === 0 && state.causalEvents === 0;
    if (hud.element.hidden) return;
    hud.summary.textContent = `${state.galaxies} selected galaxies · a=${state.scaleFactor.toFixed(5)} · H=${state.hubbleKmSPerMpc.toFixed(2)} km/s/Mpc`;
    hud.detail.textContent = `${state.unreachableGalaxies} beyond horizon · ${state.gravitationalWaves} GW events · ${state.archaeology} cosmic records · CMB ${state.cmbTemperatureK.toFixed(3)} K`;
  }

  function getState() {
    const background = cosmicBackground();
    const horizon = horizons();
    return {
      elapsed, simulatedYears, cosmicAgeGyr, scaleFactor,
      hubbleKmSPerMpc: hubbleKmSPerMpc(),
      galaxies: structures.galaxies.size,
      groups: structures.groups.size,
      clusters: structures.clusters.size,
      filaments: structures.filaments.size,
      voids: structures.voids.size,
      galaxyMergers: [...causalEvents.values()].filter(event => event.type === 'galaxy-merger').length,
      starbursts: [...structures.galaxies.values()].filter(galaxy => galaxy.state === 'starburst').length,
      activeGalacticNuclei: [...structures.galaxies.values()].filter(galaxy => galaxy.accretionEddington > 0.1).length,
      civilizations: civilizations.size,
      unreachableCivilizations: [...civilizations.values()].filter(civ => civ.state === 'unreachable').length,
      migrations: [...civilizations.values()].filter(civ => civ.state === 'migrating').length,
      signals: signals.size,
      observedSignals: [...signals.values()].filter(signal => signal.state === 'observed').length,
      gravitationalWaves: gravitationalWaves.size,
      detectedWaves: [...gravitationalWaves.values()].filter(wave => wave.state === 'detected').length,
      archaeology: archaeology.size,
      unreachableArtifacts: [...archaeology.values()].filter(item => !item.sourceReachable).length,
      causalEvents: causalEvents.size,
      causalEdges: causalEdges.length,
      distanceSamples: distanceSamples.size,
      particleHorizonGly: horizon.particleHorizonGly,
      eventHorizonGly: horizon.eventHorizonGly,
      cmbTemperatureK: background.cmbTemperatureK,
      unreachableGalaxies: aggregate.unreachableGalaxies,
      aggregate: { ...aggregate },
    };
  }

  function getSnapshot() {
    return {
      model: { name: 'Flat wCDM FLRW deterministic browser approximation', parameters: { ...parameters }, assumptions: { ...assumptions }, units: { H0: 'km s^-1 Mpc^-1', distance: 'Mpc', cosmicTime: 'Gyr', temperature: 'K' } },
      state: getState(),
      background: cosmicBackground(),
      horizons: horizons(),
      galaxies: [...structures.galaxies.values()].map(clone),
      groups: [...structures.groups.values()].map(clone),
      clusters: [...structures.clusters.values()].map(clone),
      filaments: [...structures.filaments.values()].map(clone),
      voids: [...structures.voids.values()].map(clone),
      civilizations: [...civilizations.values()].map(clone),
      signals: [...signals.values()].map(clone),
      gravitationalWaves: [...gravitationalWaves.values()].map(clone),
      archaeology: [...archaeology.values()].map(clone),
      causalEvents: [...causalEvents.values()].map(clone),
      causalEdges: causalEdges.map(clone),
      distanceSamples: [...distanceSamples.values()].map(clone),
    };
  }

  function save() {
    return { version: 1, elapsed, simulatedYears, cosmicAgeGyr, scaleFactor, counters: { nextGalaxy, nextCivilization, nextSignal, nextWave, nextArtifact, nextEvent }, aggregate: { ...aggregate }, assumptions: { ...assumptions }, structures: { galaxies: [...structures.galaxies.values()], groups: [...structures.groups.values()], clusters: [...structures.clusters.values()], filaments: [...structures.filaments.values()], voids: [...structures.voids.values()] }, civilizations: [...civilizations.values()], signals: [...signals.values()], gravitationalWaves: [...gravitationalWaves.values()], archaeology: [...archaeology.values()], causalEvents: [...causalEvents.values()], causalEdges: causalEdges.map(clone), distanceSamples: [...distanceSamples.values()] };
  }

  function load(state) {
    if (!state) return;
    elapsed = Math.max(0, state.elapsed || 0); simulatedYears = Math.max(0, state.simulatedYears || 0); cosmicAgeGyr = Math.max(0, state.cosmicAgeGyr || 13.797); scaleFactor = Math.max(1e-8, state.scaleFactor || 1);
    const counters = state.counters || {}; nextGalaxy = counters.nextGalaxy || 1; nextCivilization = counters.nextCivilization || 1; nextSignal = counters.nextSignal || 1; nextWave = counters.nextWave || 1; nextArtifact = counters.nextArtifact || 1; nextEvent = counters.nextEvent || 1;
    Object.assign(aggregate, state.aggregate || {}); Object.assign(assumptions, state.assumptions || {});
    for (const key of Object.keys(structures)) { structures[key].clear(); for (const item of state.structures?.[key] || []) structures[key].set(item.id, item); }
    for (const [map, items] of [[civilizations, state.civilizations], [signals, state.signals], [gravitationalWaves, state.gravitationalWaves], [archaeology, state.archaeology], [causalEvents, state.causalEvents], [distanceSamples, state.distanceSamples]]) { map.clear(); for (const item of items || []) map.set(item.id, item); }
    causalEdges.length = 0; causalEdges.push(...(state.causalEdges || []));
  }

  function destroy() {
    destroyed = true; hud.element.remove();
    for (const map of [...Object.values(structures), civilizations, signals, gravitationalWaves, archaeology, causalEvents, distanceSamples]) map.clear();
    causalEdges.length = 0;
  }

  const api = {
    id: 'civilization.phase11-cosmological-evolution',
    name: 'Cosmological Evolution, Galaxy Dynamics, and Observable-Universe Horizons',
    version: '1.0.0',
    execution: 'browser-deterministic-flrw-galaxy-lod',
    source: 'Reality Sandbox numerical FLRW approximation, deterministic galaxy evolution, gravitational-wave causality, and cosmological archaeology',
    license: 'Project license',
    provides: ['cosmology.flrw', 'universe.large-scale-structure', 'galaxies.evolution', 'waves.gravitational', 'history.spacetime-causal', 'archaeology.cosmological'],
    requires: ['travel.relativistic', 'stars.evolution', 'civilization.galactic', 'history.causal-galaxy'],
    after: ['civilization.phase10-relativistic-deep-time'],
    initialize, step, render, save, load, destroy, getState, getSnapshot, runInvariants,
    getCosmology: () => ({ parameters: { ...parameters }, scaleFactor, cosmicAgeGyr, hubbleKmSPerMpc: hubbleKmSPerMpc(), horizons: horizons(), background: cosmicBackground() }),
    getGalaxies: () => [...structures.galaxies.values()].map(clone),
    getCivilizations: () => [...civilizations.values()].map(clone),
    getSignals: () => [...signals.values()].map(clone),
    getGravitationalWaves: () => [...gravitationalWaves.values()].map(clone),
    getArchaeology: () => [...archaeology.values()].map(clone),
    getCausalEvents: () => [...causalEvents.values()].map(clone),
    getCausalEdges: () => causalEdges.map(clone),
    getDistanceSamples: () => [...distanceSamples.values()].map(clone),
    cosmologicalDistances, emitCosmologicalSignal, emitGravitationalWave, createCosmologicalArtifact, beginCivilizationMigration, debugSeedScenario,
  };
  return api;
}

function normalizeCosmology(input) {
  const total = input.omegaMatter + input.omegaRadiation + input.omegaLambda + input.omegaCurvature;
  return { ...input, omegaLambda: input.omegaLambda + (1 - total), modelLabel: 'flat-wCDM-FLRW-approximation' };
}

function integrateSimpson(fn, start, end, steps) {
  if (end <= start) return 0;
  let count = Math.max(2, Math.floor(steps)); if (count % 2) count++;
  const h = (end - start) / count;
  let sum = fn(start) + fn(end);
  for (let index = 1; index < count; index++) sum += fn(start + index * h) * (index % 2 ? 4 : 2);
  return sum * h / 3;
}

function integrateLogA(fn, start, end, steps) {
  if (end <= start) return 0;
  const lo = Math.log(start), hi = Math.log(end);
  return integrateSimpson(x => fn(Math.exp(x)) * Math.exp(x), lo, hi, steps);
}

function createHud() {
  const element = document.createElement('section');
  element.hidden = true;
  element.setAttribute('aria-live', 'polite');
  element.style.cssText = 'position:fixed;left:max(12px,env(safe-area-inset-left));top:max(12px,env(safe-area-inset-top));z-index:20;max-width:min(480px,calc(100vw - 24px));padding:10px 12px;border:1px solid rgba(255,174,92,.32);border-radius:12px;background:rgba(16,7,2,.8);backdrop-filter:blur(10px);color:#fff4e7;font:600 11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.035em;pointer-events:none';
  element.innerHTML = '<strong style="display:block;margin-bottom:4px;color:#ffc17f">PHASE 11 · OBSERVABLE UNIVERSE</strong><span data-summary></span><small data-detail style="display:block;margin-top:4px;color:rgba(255,244,231,.68)"></small>';
  document.body.append(element);
  return { element, summary: element.querySelector('[data-summary]'), detail: element.querySelector('[data-detail]'), lastUpdate: -Infinity };
}

function magnitude(value) { return Math.hypot(value?.x || 0, value?.y || 0, value?.z || 0); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function mulberry32(seed) { let value = seed >>> 0; return () => { value += 0x6D2B79F5; let result = value; result = Math.imul(result ^ result >>> 15, result | 1); result ^= result + Math.imul(result ^ result >>> 7, result | 61); return ((result ^ result >>> 14) >>> 0) / 4294967296; }; }
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
