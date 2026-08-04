const COLONY_TYPES = ['orbital-habitat', 'moon-base', 'planetary-colony', 'asteroid-outpost', 'deep-space-station'];
const MACHINE_OBJECTIVES = ['maintenance', 'science', 'logistics', 'mining', 'ecology', 'construction', 'communication'];
const CONTACT_STATES = ['unknown', 'candidate', 'detected', 'signal-inbound', 'decoding', 'translated', 'exchange', 'cooperation', 'avoidance', 'conflict', 'silent', 'extinct'];

export function createPhase9Engine(world, phase8, orbitalSystem, galaxySystem, options = {}) {
  const mobile = options.mobile ?? matchMedia('(max-width: 720px), (pointer: coarse)').matches;
  const rng = mulberry32(options.seed ?? 0xA9E2026);
  const yearsPerSecond = options.yearsPerSecond ?? 0.35;
  const lightYearsPerGalaxyUnit = options.lightYearsPerGalaxyUnit ?? 420;
  const colonies = new Map();
  const transfers = new Map();
  const shipments = new Map();
  const machineLineages = new Map();
  const machines = new Map();
  const roboticAssets = new Map();
  const alienCivilizations = new Map();
  const signals = new Map();
  const contacts = new Map();
  const history = [];
  const consumedMissions = new Set();
  let elapsed = 0;
  let colonyClock = 0;
  let logisticsClock = 0;
  let machineClock = 0;
  let ecologyClock = 0;
  let contactClock = 0;
  let nextColony = 1;
  let nextTransfer = 1;
  let nextShipment = 1;
  let nextMachine = 1;
  let nextLineage = 1;
  let nextRobot = 1;
  let nextAlien = 1;
  let nextSignal = 1;
  let nextEvent = 1;
  let initializedAliens = false;
  let destroyed = false;
  const hud = createHud();

  function initialize({ provideCapability }) {
    initializeAlienCivilizations();
    provideCapability('colonies.multiworld', api);
    provideCapability('machines.autonomous', api);
    provideCapability('ecology.closed-loop', api);
    provideCapability('signals.interstellar', api);
    provideCapability('contact.first', api);
  }

  function step(dt) {
    if (destroyed) return;
    const amount = Math.max(0, dt);
    elapsed += amount;
    colonyClock += amount;
    logisticsClock += amount;
    machineClock += amount;
    ecologyClock += amount;
    contactClock += amount;
    synchronizePhase8Missions();

    if (colonyClock >= (mobile ? 3.5 : 1.8)) {
      colonyCycle(colonyClock);
      colonyClock = 0;
    }
    if (logisticsClock >= (mobile ? 4.2 : 2.2)) {
      logisticsCycle(logisticsClock);
      logisticsClock = 0;
    }
    if (machineClock >= (mobile ? 3.2 : 1.6)) {
      machineCycle(machineClock);
      machineClock = 0;
    }
    if (ecologyClock >= (mobile ? 4.8 : 2.5)) {
      ecologyCycle(ecologyClock);
      ecologyClock = 0;
    }
    if (contactClock >= (mobile ? 6 : 3)) {
      contactCycle(contactClock);
      contactClock = 0;
    }
    advanceTransfers(amount);
    advanceShipments();
    advanceSignals(amount);
  }

  function initializeAlienCivilizations() {
    if (initializedAliens) return;
    initializedAliens = true;
    const local = galaxySystem.getLocalStar?.() || { position: { x: 0, y: 0, z: 0 } };
    const candidates = galaxySystem.getNearbyStars?.(local.position, mobile ? 18 : 26, mobile ? 96 : 320) || [];
    const stride = Math.max(1, Math.floor(candidates.length / (mobile ? 32 : 90)));
    for (let index = 0; index < candidates.length; index += stride) {
      const star = candidates[index];
      if (!star || star.id === local.id) continue;
      const habitability = alienHabitability(star);
      if (rng() > habitability * 0.085) continue;
      const distanceUnits = distance3(local.position, star.position);
      const id = `alien-${nextAlien++}`;
      const ageFactor = clamp((star.age - 1) / 10, 0, 1);
      const civilization = {
        id,
        starId: star.id,
        name: `${syllableName(rng)} Collective`,
        position: { ...star.position },
        distanceLy: Math.max(0.01, distanceUnits * lightYearsPerGalaxyUnit),
        habitability,
        biologicalAgeGyr: star.age,
        technologicalLevel: clamp(habitability * 0.45 + ageFactor * 0.35 + rng() * 0.25, 0.08, 1.25),
        detectability: clamp(0.05 + rng() * 0.45, 0.02, 0.85),
        cooperation: clamp(0.25 + rng() * 0.55, 0, 1),
        caution: clamp(0.2 + rng() * 0.65, 0, 1),
        translationComplexity: clamp(0.3 + rng() * 0.6, 0, 1),
        status: rng() < 0.08 ? 'extinct' : 'active',
        technosignatures: makeTechnosignatures(rng),
        createdAt: elapsed,
      };
      alienCivilizations.set(id, civilization);
      contacts.set(id, {
        alienId: id,
        state: civilization.status === 'extinct' ? 'extinct' : 'unknown',
        confidence: 0,
        translation: 0,
        trust: 0,
        messagesSent: 0,
        messagesReceived: 0,
        lastSignalAt: null,
        firstDetectedAt: null,
      });
      if (alienCivilizations.size >= (mobile ? 5 : 14)) break;
    }
  }

  function synchronizePhase8Missions() {
    for (const mission of phase8.getMissions?.() || []) {
      if (!mission.success || mission.status !== 'completed' || consumedMissions.has(mission.id)) continue;
      consumedMissions.add(mission.id);
      if (mission.type === 'station') createColonyFromMission(mission, 'orbital-habitat');
      else if (mission.type === 'colony') createColonyFromMission(mission, targetColonyType(mission.targetId));
      else if (mission.type === 'probe') createRoboticAssetFromMission(mission, 'probe');
      else if (mission.type === 'satellite') createRoboticAssetFromMission(mission, 'relay');
      else if (mission.type === 'interstellar') createInterstellarSignalFromMission(mission);
    }
  }

  function createColonyFromMission(mission, colonyType) {
    const environment = environmentForTarget(mission.targetId);
    const transfer = createTransfer({
      sourceId: mission.communityId,
      targetId: mission.targetId,
      payloadMass: 18 + mission.capability * 42,
      purpose: 'colonization',
      reliability: clamp(0.46 + mission.capability * 0.34, 0.25, 0.94),
      linkedMissionId: mission.id,
    });
    const id = `colony-${nextColony++}`;
    const colony = makeColony({
      id,
      name: `${targetName(mission.targetId)} ${colonyType === 'orbital-habitat' ? 'Habitat' : 'Settlement'} ${nextColony - 1}`,
      type: colonyType,
      targetId: mission.targetId,
      parentCommunityId: mission.communityId,
      transferId: transfer.id,
      environment,
      status: 'in-transit',
      population: 0,
      founders: Math.max(4, Math.round(8 + mission.capability * 18)),
    });
    colonies.set(id, colony);
    record('Colony mission begins', `${colony.name} departed with ${colony.founders} founders toward ${targetName(colony.targetId)}.`, 'colony', id);
    return colony;
  }

  function makeColony(input) {
    const environment = input.environment || environmentForTarget(input.targetId);
    return {
      id: input.id,
      name: input.name,
      type: input.type || 'orbital-habitat',
      targetId: input.targetId || 'gaia-orbit',
      parentCommunityId: input.parentCommunityId || 'unknown',
      transferId: input.transferId || null,
      status: input.status || 'operational',
      population: input.population ?? 12,
      founders: input.founders ?? 12,
      births: input.births ?? 0,
      deaths: input.deaths ?? 0,
      gravity: input.gravity ?? environment.gravity,
      radiation: input.radiation ?? environment.radiation,
      temperature: input.temperature ?? environment.temperature,
      pressure: input.pressure ?? environment.pressure,
      water: input.water ?? 0.72,
      oxygen: input.oxygen ?? 0.78,
      food: input.food ?? 0.84,
      energy: input.energy ?? 0.76,
      spareParts: input.spareParts ?? 0.62,
      lifeSupport: input.lifeSupport ?? 0.78,
      ecology: input.ecology ?? 0.68,
      biodiversity: input.biodiversity ?? 0.42,
      waste: input.waste ?? 0.12,
      localExtraction: input.localExtraction ?? 0.04,
      manufacturing: input.manufacturing ?? 0.08,
      research: input.research ?? 0.1,
      autonomy: input.autonomy ?? 0.08,
      legitimacy: input.legitimacy ?? 0.6,
      inequality: input.inequality ?? 0.12,
      institutionalState: input.institutionalState || 'charter',
      cultureDivergence: input.cultureDivergence ?? 0,
      languageDivergence: input.languageDivergence ?? 0,
      biologicalDivergence: input.biologicalDivergence ?? 0,
      machineDependence: input.machineDependence ?? 0.16,
      terraforming: input.terraforming ?? 0,
      fusionResearch: input.fusionResearch ?? 0,
      orbitalPower: input.orbitalPower ?? 0,
      wasteHeat: input.wasteHeat ?? 0,
      megastructurePrecursor: input.megastructurePrecursor ?? 0,
      soil: input.soil ?? 0,
      atmosphereProcessing: input.atmosphereProcessing ?? 0,
      irreversibleDamage: input.irreversibleDamage ?? 0,
      communicationDelayYears: input.communicationDelayYears ?? communicationDelayYears(input.targetId),
      lastResupplyAt: input.lastResupplyAt ?? elapsed,
      createdAt: input.createdAt ?? elapsed,
      history: [...(input.history || [])],
    };
  }

  function createTransfer(input) {
    const id = input.id || `transfer-${nextTransfer++}`;
    const trajectory = transferTrajectory(input.sourceId, input.targetId);
    const transfer = {
      id,
      sourceId: input.sourceId,
      targetId: input.targetId,
      purpose: input.purpose || 'cargo',
      payloadMass: Math.max(0.1, input.payloadMass || 10),
      propellantMass: input.propellantMass ?? trajectory.deltaV * (input.payloadMass || 10) * 0.055,
      launchWindow: trajectory.windowQuality,
      deltaV: trajectory.deltaV,
      durationDays: trajectory.durationDays,
      durationSeconds: trajectory.durationSeconds,
      communicationDelayYears: trajectory.communicationDelayYears,
      reliability: clamp(input.reliability ?? 0.72, 0.05, 0.995),
      progress: 0,
      status: trajectory.windowQuality < 0.12 ? 'holding-for-window' : 'in-transit',
      launchedAt: elapsed,
      arrivesAt: elapsed + trajectory.durationSeconds,
      trajectoryModel: trajectory.model,
      samples: trajectory.samples,
      linkedMissionId: input.linkedMissionId || null,
    };
    transfers.set(id, transfer);
    return transfer;
  }

  function transferTrajectory(sourceId, targetId) {
    const bodies = orbitalSystem.getBodies?.() || [];
    const source = bodies.find(body => body.id === sourceId) || bodies.find(body => body.id === 'gaia') || { semiMajorAxis: 1, position: { x: 0, y: 0, z: 0 } };
    const target = bodies.find(body => body.id === targetId) || { semiMajorAxis: source.semiMajorAxis || 1.05, position: { x: 0.05, y: 0, z: 0.05 } };
    const r1 = Math.max(0.05, source.semiMajorAxis || 1);
    const r2 = Math.max(0.05, target.semiMajorAxis || (target.type === 'moon' ? r1 + 0.0026 : 1.2));
    const starMass = orbitalSystem.getStar?.().mass || 1;
    const durationDays = Math.max(0.5, 129.1 * Math.sqrt(((r1 + r2) / 2) ** 3 / starMass));
    const velocity1 = 29.78 * Math.sqrt(starMass / r1);
    const velocity2 = 29.78 * Math.sqrt(starMass / r2);
    const transferV1 = 29.78 * Math.sqrt(starMass * (2 / r1 - 2 / (r1 + r2)));
    const transferV2 = 29.78 * Math.sqrt(starMass * (2 / r2 - 2 / (r1 + r2)));
    const deltaV = Math.abs(transferV1 - velocity1) + Math.abs(velocity2 - transferV2);
    const a1 = Math.atan2(source.position?.z || 0, source.position?.x || 1);
    const a2 = Math.atan2(target.position?.z || 0, target.position?.x || 1);
    const desiredPhase = Math.PI * (1 - Math.sqrt((2 * r1 / (r1 + r2)) ** 3));
    const phaseError = wrapAngle((a2 - a1) - desiredPhase);
    const windowQuality = clamp((Math.cos(phaseError) + 1) * 0.5, 0, 1);
    const durationSeconds = Math.max(0.8, durationDays / (365.25 * yearsPerSecond));
    const sampleCount = mobile ? 8 : 18;
    const samples = Array.from({ length: sampleCount }, (_, index) => {
      const t = index / Math.max(1, sampleCount - 1);
      return {
        t,
        x: lerp(source.position?.x || 0, target.position?.x || 0, t) + Math.sin(Math.PI * t) * 0.08 * Math.sign(r2 - r1 || 1),
        y: lerp(source.position?.y || 0, target.position?.y || 0, t) + Math.sin(Math.PI * t) * 0.025,
        z: lerp(source.position?.z || 0, target.position?.z || 0, t),
      };
    });
    return {
      model: 'rebound-compatible-hohmann-from-live-orbital-state',
      durationDays,
      durationSeconds,
      deltaV,
      windowQuality,
      communicationDelayYears: communicationDelayYears(target.id),
      samples,
    };
  }

  function advanceTransfers(dt) {
    for (const transfer of transfers.values()) {
      if (transfer.status === 'holding-for-window') {
        const current = transferTrajectory(transfer.sourceId, transfer.targetId);
        transfer.launchWindow = current.windowQuality;
        if (current.windowQuality > 0.34) {
          transfer.status = 'in-transit';
          transfer.launchedAt = elapsed;
          transfer.arrivesAt = elapsed + current.durationSeconds;
          record('Launch window opens', `${transfer.id} departed for ${targetName(transfer.targetId)}.`, 'transfer', transfer.id);
        }
        continue;
      }
      if (transfer.status !== 'in-transit') continue;
      transfer.progress = clamp(transfer.progress + dt / Math.max(0.1, transfer.durationSeconds), 0, 1);
      if (transfer.progress < 1) continue;
      const success = rng() < transfer.reliability * (0.65 + transfer.launchWindow * 0.35);
      transfer.status = success ? 'arrived' : 'lost';
      for (const colony of colonies.values()) {
        if (colony.transferId !== transfer.id) continue;
        if (success) {
          colony.status = 'operational';
          colony.population = colony.founders;
          colony.lastResupplyAt = elapsed;
          record('Colony established', `${colony.name} became operational at ${targetName(colony.targetId)}.`, 'colony', colony.id);
        } else {
          colony.status = 'lost';
          colony.deaths += colony.founders;
          record('Colony mission lost', `${colony.name} was lost during transfer.`, 'collapse', colony.id);
        }
      }
    }
  }

  function colonyCycle(dt) {
    const economies = mapById(phase8.getEconomies?.() || []);
    const sciences = mapById(phase8.getSciences?.() || []);
    const institutions = mapById(phase8.getInstitutions?.() || []);
    for (const colony of colonies.values()) {
      if (!['operational', 'stressed', 'recovering'].includes(colony.status)) continue;
      const economy = economies.get(colony.parentCommunityId);
      const science = sciences.get(colony.parentCommunityId);
      const institution = institutions.get(colony.parentCommunityId);
      const isolation = clamp(colony.communicationDelayYears / 8 + (elapsed - colony.lastResupplyAt) / 180, 0, 1.5);
      const environmentalStress = clamp(colony.radiation * 0.28 + Math.abs(colony.temperature - 288) / 420 + Math.abs(colony.gravity - 1) * 0.18, 0, 1.5);
      const maintenance = colony.manufacturing * 0.25 + colony.machineDependence * machineReliabilityAt(colony.id) * 0.22 + (economy?.inventory?.machines || 0) * 0.008;
      colony.lifeSupport = clamp(colony.lifeSupport + dt * (maintenance * 0.004 + colony.energy * 0.003 - colony.population * 0.00018 - colony.waste * 0.002 - environmentalStress * 0.0015), 0, 1.2);
      colony.energy = clamp(colony.energy + dt * (colony.localExtraction * 0.004 + colony.manufacturing * 0.0015 + colony.orbitalPower * 0.001 - colony.population * 0.00012 - colony.lifeSupport * 0.0008), 0, 1.5);
      colony.spareParts = clamp(colony.spareParts + dt * (colony.manufacturing * 0.003 - colony.machineDependence * 0.0015 - colony.population * 0.00004), 0, 1.5);
      colony.water = clamp(colony.water + dt * (colony.ecology * 0.002 - colony.population * 0.00007 - colony.waste * 0.001), 0, 1.2);
      colony.oxygen = clamp(colony.oxygen + dt * (colony.ecology * colony.biodiversity * 0.0025 - colony.population * 0.00009 - colony.waste * 0.0008), 0, 1.2);
      colony.food = clamp(colony.food + dt * (colony.ecology * colony.biodiversity * 0.002 + colony.soil * 0.0015 - colony.population * 0.00011), 0, 1.5);
      colony.waste = clamp(colony.waste + dt * (colony.population * 0.00009 + colony.manufacturing * 0.0006 + colony.wasteHeat * 0.0002 - colony.ecology * 0.0018), 0, 1.2);
      colony.localExtraction = clamp(colony.localExtraction + dt * (colony.research * 0.0008 + machineCapacityAt(colony.id, 'mining') * 0.001 - colony.irreversibleDamage * 0.0006), 0, 1);
      const partsPenalty = colony.spareParts < 0.12 ? 0.0005 : 0;
      colony.manufacturing = clamp(colony.manufacturing + dt * (colony.localExtraction * 0.001 + machineCapacityAt(colony.id, 'construction') * 0.001 - partsPenalty), 0, 1);
      colony.research = clamp(colony.research + dt * ((science?.knowledge || 0) * 0.00008 + machineCapacityAt(colony.id, 'science') * 0.0015 - environmentalStress * 0.0003), 0, 1.5);
      colony.machineDependence = clamp(colony.machineDependence + dt * (colony.population > 20 ? 0.00025 : 0.00008), 0, 1);
      colony.fusionResearch = clamp(colony.fusionResearch + dt * colony.research * colony.energy * 0.00012, 0, 1);
      colony.orbitalPower = clamp(colony.orbitalPower + dt * colony.fusionResearch * colony.manufacturing * 0.00008, 0, 1);
      colony.wasteHeat = clamp(colony.wasteHeat + dt * (colony.energy * 0.00035 + colony.orbitalPower * 0.0005 - colony.ecology * 0.00015), 0, 1);
      colony.megastructurePrecursor = clamp(colony.megastructurePrecursor + dt * colony.orbitalPower * colony.localExtraction * colony.manufacturing * 0.000025, 0, 0.35);
      colony.cultureDivergence = clamp(colony.cultureDivergence + dt * isolation * 0.0007, 0, 1);
      colony.languageDivergence = clamp(colony.languageDivergence + dt * isolation * 0.00055, 0, 1);
      colony.biologicalDivergence = clamp(colony.biologicalDivergence + dt * environmentalStress * 0.00008, 0, 1);
      colony.autonomy = clamp(colony.autonomy + dt * (isolation * 0.0005 + colony.localExtraction * 0.00035 - (institution?.legitimacy || 0.5) * 0.0001), 0, 1);
      colony.legitimacy = clamp(colony.legitimacy + dt * ((colony.food + colony.energy + colony.lifeSupport - 1.6) * 0.0008 - colony.inequality * 0.0005), 0, 1);
      colony.inequality = clamp(colony.inequality + dt * (colony.machineDependence * 0.00035 + isolation * 0.00015 - colony.legitimacy * 0.00012), 0, 1);

      const viability = mean([colony.lifeSupport, colony.water, colony.oxygen, colony.food, colony.energy]);
      const birthRate = clamp((viability - 0.45) * 0.0024 * (1 - environmentalStress * 0.35), 0, 0.003);
      const deathRate = clamp((0.48 - viability) * 0.006 + environmentalStress * 0.00035 + colony.radiation * 0.00018, 0.00002, 0.01);
      const births = colony.population * birthRate * dt;
      const deaths = colony.population * deathRate * dt;
      colony.population = Math.max(0, colony.population + births - deaths);
      colony.births += births;
      colony.deaths += deaths;
      colony.status = viability < 0.2 || colony.population < 1 ? 'collapsed' : viability < 0.42 ? 'stressed' : viability < 0.58 ? 'recovering' : 'operational';
      colony.institutionalState = colony.autonomy > 0.82 && colony.legitimacy < 0.42 ? 'secession' : colony.autonomy > 0.58 ? 'autonomous-council' : colony.population > 40 ? 'colonial-administration' : 'charter';
      if (colony.status === 'collapsed') recordOnce(colony, 'collapsed', 'Habitat collapse', `${colony.name} collapsed after life-support, ecological, or logistical failure.`, 'collapse');
      if (colony.institutionalState === 'secession') recordOnce(colony, 'secession', 'Colonial secession', `${colony.name} declared political separation after prolonged isolation and legitimacy loss.`, 'institution');
      maybeCreateMachines(colony, science, economy, dt);
      maybeScheduleResupply(colony, economy, dt);
    }
  }

  function logisticsCycle(dt) {
    for (const colony of colonies.values()) {
      if (!['operational', 'stressed', 'recovering'].includes(colony.status)) continue;
      const ageSinceSupply = elapsed - colony.lastResupplyAt;
      if (ageSinceSupply > 100 && colony.food < 0.5 && !activeShipmentTo(colony.id)) {
        createShipment(colony, { food: 0.45, water: 0.25, spareParts: 0.22, energy: 0.12 }, 0.72);
      }
      if (colony.localExtraction > 0.45 && colony.manufacturing > 0.38 && rng() < dt * 0.006) createRoboticAsset(colony.id, 'automated-mine', 'mining');
    }
  }

  function maybeScheduleResupply(colony, economy, dt) {
    if (activeShipmentTo(colony.id)) return;
    const need = clamp(1 - mean([colony.food, colony.water, colony.spareParts, colony.energy]), 0, 1);
    const parentCapacity = clamp((economy?.capital || 0) / 20 + (economy?.inventory?.energy || 0) / 20, 0, 1);
    if (need < 0.22 || parentCapacity < 0.18 || rng() > dt * need * parentCapacity * 0.012) return;
    createShipment(colony, { food: 0.25 + need * 0.3, water: 0.18, spareParts: 0.2, energy: 0.12 }, 0.62 + parentCapacity * 0.28);
  }

  function createShipment(colony, cargo, reliability = 0.75) {
    const transfer = createTransfer({ sourceId: colony.parentCommunityId, targetId: colony.targetId, payloadMass: 6 + Object.values(cargo).reduce((sum, value) => sum + value, 0) * 18, purpose: 'resupply', reliability });
    const id = `shipment-${nextShipment++}`;
    const shipment = { id, colonyId: colony.id, transferId: transfer.id, cargo: { ...cargo }, status: transfer.status, createdAt: elapsed, deliveredAt: null };
    shipments.set(id, shipment);
    record('Resupply dispatched', `${shipment.id} departed for ${colony.name}.`, 'logistics', colony.id);
    return shipment;
  }

  function advanceShipments() {
    for (const shipment of shipments.values()) {
      if (['delivered', 'lost'].includes(shipment.status)) continue;
      const transfer = transfers.get(shipment.transferId);
      if (!transfer) continue;
      shipment.status = transfer.status;
      if (transfer.status === 'arrived') {
        const colony = colonies.get(shipment.colonyId);
        if (!colony) continue;
        colony.food = clamp(colony.food + (shipment.cargo.food || 0), 0, 1.5);
        colony.water = clamp(colony.water + (shipment.cargo.water || 0), 0, 1.5);
        colony.spareParts = clamp(colony.spareParts + (shipment.cargo.spareParts || 0), 0, 1.5);
        colony.energy = clamp(colony.energy + (shipment.cargo.energy || 0), 0, 1.5);
        colony.lastResupplyAt = elapsed;
        shipment.status = 'delivered';
        shipment.deliveredAt = elapsed;
        record('Resupply delivered', `${shipment.id} restored supplies at ${colony.name}.`, 'logistics', colony.id);
      } else if (transfer.status === 'lost') {
        shipment.status = 'lost';
        record('Supply loss', `${shipment.id} was lost en route to ${colonyName(shipment.colonyId)}.`, 'logistics', shipment.colonyId);
      }
    }
  }

  function machineCycle(dt) {
    for (const machine of machines.values()) {
      if (machine.status === 'destroyed') continue;
      const colony = colonies.get(machine.colonyId);
      if (!colony || colony.status === 'collapsed') {
        machine.status = 'dormant';
        continue;
      }
      const maintenance = colony.spareParts * 0.45 + colony.manufacturing * 0.35;
      machine.energy = clamp(machine.energy + dt * (colony.energy * 0.003 - machine.compute * 0.0015), 0, 1.2);
      machine.integrity = clamp(machine.integrity + dt * (maintenance * 0.0012 + machine.selfMaintenance * 0.001 - machine.compute * 0.0005 - colony.radiation * 0.0002), 0, 1);
      machine.performance = clamp(machine.performance + dt * (machine.energy * machine.integrity * 0.0014 + machine.learning * 0.0008 - machine.objectiveConflict * 0.001), 0, 1.5);
      machine.learning = clamp(machine.learning + dt * (machine.compute * 0.0009 + colony.research * 0.0005), 0, 1);
      machine.autonomy = clamp(machine.autonomy + dt * (machine.learning * 0.00045 + colony.communicationDelayYears * 0.00008 - machine.trust * 0.00008), 0, 1);
      machine.trust = clamp(machine.trust + dt * (machine.performance * 0.00035 - machine.failures * 0.00012 - machine.objectiveConflict * 0.0004), 0, 1);
      machine.objectiveConflict = clamp(machine.objectiveConflict + dt * (machine.autonomy * 0.0003 + colony.inequality * 0.00015 - machine.trust * 0.0002), 0, 1);
      if (rng() < dt * (1 - machine.integrity) * 0.012) {
        machine.failures++;
        machine.performance *= 0.82;
        record('Machine failure', `${machine.name} experienced a failure while assigned to ${machine.objective}.`, 'machine', machine.id);
      }
      machine.status = machine.integrity < 0.05 || machine.energy < 0.02 ? 'dormant' : machine.objectiveConflict > 0.75 ? 'contested' : 'active';
      const lineage = machineLineages.get(machine.lineageId);
      if (lineage) {
        lineage.experience += dt * machine.performance;
        lineage.policyDivergence = clamp(lineage.policyDivergence + dt * machine.autonomy * 0.00012, 0, 1);
      }
    }
  }

  function maybeCreateMachines(colony, science, economy, dt) {
    const discoveries = new Set(science?.discoveries || []);
    const capability = clamp((discoveries.has('automation') ? 0.35 : 0) + (discoveries.has('computation') ? 0.25 : 0) + colony.research * 0.2 + colony.energy * 0.15 + (economy?.capital || 0) * 0.006, 0, 1.5);
    if (capability < 0.5 || machinesAt(colony.id).length >= (mobile ? 8 : 24) || rng() > dt * capability * 0.008) return;
    createMachine(colony.id, MACHINE_OBJECTIVES[Math.floor(rng() * MACHINE_OBJECTIVES.length)], capability);
  }

  function createMachine(colonyId, objective = 'maintenance', capability = 0.7, lineageId = null) {
    let lineage = lineageId ? machineLineages.get(lineageId) : null;
    if (!lineage) {
      const id = `machine-lineage-${nextLineage++}`;
      lineage = { id, parentId: null, name: `Lineage ${id.split('-').pop()}`, objectiveBias: objective, createdAt: elapsed, experience: 0, policyDivergence: 0, descendants: 0 };
      machineLineages.set(id, lineage);
    }
    const id = `machine-${nextMachine++}`;
    const machine = {
      id,
      colonyId,
      lineageId: lineage.id,
      name: `${objective.toUpperCase()}-${String(nextMachine - 1).padStart(3, '0')}`,
      objective,
      status: 'active',
      compute: clamp(0.25 + capability * 0.5, 0.1, 1.2),
      energy: 0.82,
      integrity: 0.88,
      selfMaintenance: clamp(0.15 + capability * 0.45, 0, 1),
      performance: 0.42,
      learning: 0.08,
      autonomy: 0.06,
      trust: 0.62,
      objectiveConflict: 0.04,
      failures: 0,
      laborDisplacement: clamp(capability * 0.12, 0, 0.6),
      scientificAssistance: objective === 'science' ? capability * 0.25 : 0,
      createdAt: elapsed,
    };
    machines.set(id, machine);
    lineage.descendants++;
    record('Autonomous machine deployed', `${machine.name} joined ${colonyName(colonyId)} for ${objective}.`, 'machine', id);
    return machine;
  }

  function createRoboticAssetFromMission(mission, kind) {
    const colonyId = [...colonies.values()].find(colony => colony.targetId === mission.targetId)?.id || null;
    return createRoboticAsset(colonyId, kind, kind === 'relay' ? 'communication' : 'science', mission.targetId);
  }

  function createRoboticAsset(colonyId, kind, objective, targetId = null) {
    const id = `robot-${nextRobot++}`;
    const asset = { id, colonyId, targetId: targetId || colonies.get(colonyId)?.targetId || 'gaia-orbit', kind, objective, status: 'active', reliability: 0.74 + rng() * 0.2, output: 0.1, selfMaintenance: 0.12 + rng() * 0.4, createdAt: elapsed };
    roboticAssets.set(id, asset);
    return asset;
  }

  function ecologyCycle(dt) {
    for (const colony of colonies.values()) {
      if (!['operational', 'stressed', 'recovering'].includes(colony.status)) continue;
      const environmentalStress = clamp(colony.radiation * 0.28 + Math.abs(colony.temperature - 288) / 420, 0, 1);
      colony.biodiversity = clamp(colony.biodiversity + dt * (colony.ecology * 0.001 - environmentalStress * 0.0006 - colony.waste * 0.0008), 0, 1);
      colony.ecology = clamp(colony.ecology + dt * (colony.biodiversity * 0.0012 + machineCapacityAt(colony.id, 'ecology') * 0.001 - colony.waste * 0.0014), 0, 1);
      colony.soil = clamp(colony.soil + dt * (colony.ecology * colony.biodiversity * 0.0008 - colony.irreversibleDamage * 0.0005), 0, 1);
      colony.atmosphereProcessing = clamp(colony.atmosphereProcessing + dt * (colony.energy * colony.research * 0.00045 - colony.waste * 0.0002), 0, 1);
      const engineeringCapability = colony.research * colony.energy * colony.manufacturing;
      if (engineeringCapability > 0.22) colony.terraforming = clamp(colony.terraforming + dt * engineeringCapability * 0.00018, 0, 1);
      const ecologicalOvershoot = clamp(colony.terraforming - colony.ecology - colony.research * 0.2, 0, 1);
      colony.irreversibleDamage = clamp(colony.irreversibleDamage + dt * (ecologicalOvershoot * 0.0008 + colony.waste * 0.00018 + colony.wasteHeat * 0.00012 - colony.ecology * 0.00012), 0, 1);
      if (colony.irreversibleDamage > 0.72) recordOnce(colony, 'irreversible-damage', 'Irreversible ecological damage', `${colony.name} crossed an ecological recovery threshold during planetary engineering.`, 'ecology');
    }
  }

  function contactCycle(dt) {
    const science = strongestScience();
    const economy = strongestEconomy();
    const observation = clamp((science?.knowledge || 0) * 0.09 + (science?.discoveries?.includes('astronomy') ? 0.24 : 0) + (science?.discoveries?.includes('communications') ? 0.18 : 0) + roboticObservation() * 0.2, 0, 1.4);
    for (const alien of alienCivilizations.values()) {
      const contact = contacts.get(alien.id);
      if (!contact || ['cooperation', 'avoidance', 'conflict', 'extinct'].includes(contact.state)) continue;
      const signalStrength = alien.detectability * alien.technologicalLevel / Math.max(1, Math.sqrt(alien.distanceLy));
      if (contact.state === 'unknown' && observation * signalStrength > 0.012 && rng() < dt * observation * signalStrength * 0.08) {
        contact.state = 'candidate';
        contact.confidence = 0.16;
        contact.firstDetectedAt = elapsed;
        record('Technosignature candidate', `A possible technosignature was found near ${alien.starId}, ${alien.distanceLy.toFixed(1)} light-years away.`, 'contact', alien.id);
      } else if (contact.state === 'candidate') {
        contact.confidence = clamp(contact.confidence + dt * observation * signalStrength * 0.012, 0, 1);
        if (contact.confidence > 0.72) {
          contact.state = 'detected';
          record('Technological civilization detected', `${alien.name} was detected with ${(contact.confidence * 100).toFixed(0)}% confidence.`, 'contact', alien.id);
          maybeGenerateAlienSignal(alien, contact);
        }
      } else if (contact.state === 'detected' && !activeSignalFrom(alien.id)) maybeGenerateAlienSignal(alien, contact);
      else if (contact.state === 'decoding') {
        const compute = machineGlobalCapacity('communication') + machineGlobalCapacity('science');
        contact.translation = clamp(contact.translation + dt * (observation * 0.0014 + compute * 0.002) / Math.max(0.25, alien.translationComplexity), 0, 1);
        if (contact.translation >= 1) {
          contact.state = 'translated';
          record('Alien message translated', `A delayed message from ${alien.name} was translated.`, 'contact', alien.id);
          decideContactResponse(alien, contact, economy);
        }
      }
    }
  }

  function maybeGenerateAlienSignal(alien, contact) {
    if (alien.status !== 'active') return null;
    const id = `signal-${nextSignal++}`;
    const travelSeconds = Math.max(0.1, alien.distanceLy / yearsPerSecond);
    const signal = { id, alienId: alien.id, direction: 'inbound', kind: alien.technosignatures[0] || 'narrowband-radio', sentAt: elapsed - travelSeconds * (0.2 + rng() * 0.8), detectedAt: elapsed, arrivesAt: elapsed + travelSeconds, progress: 0, status: 'propagating', distanceLy: alien.distanceLy, strength: alien.detectability, encodedComplexity: alien.translationComplexity };
    signals.set(id, signal);
    contact.state = 'signal-inbound';
    contact.lastSignalAt = elapsed;
    record('Interstellar signal propagating', `A signal from ${alien.name} is crossing ${alien.distanceLy.toFixed(1)} light-years of space.`, 'signal', alien.id);
    return signal;
  }

  function createInterstellarSignalFromMission(mission) {
    const alien = nearestActiveAlien();
    return alien ? sendSignal(alien.id, 'intentional-message', mission.communityId) : null;
  }

  function sendSignal(alienId, kind = 'intentional-message', senderId = 'gaia') {
    const alien = alienCivilizations.get(alienId);
    if (!alien) return null;
    const id = `signal-${nextSignal++}`;
    const travelSeconds = Math.max(0.1, alien.distanceLy / yearsPerSecond);
    const signal = { id, alienId, direction: 'outbound', kind, senderId, sentAt: elapsed, arrivesAt: elapsed + travelSeconds, progress: 0, status: 'propagating', distanceLy: alien.distanceLy, strength: 0.7, encodedComplexity: 0.45 };
    signals.set(id, signal);
    const contact = contacts.get(alienId);
    if (contact) contact.messagesSent++;
    record('Interstellar message sent', `A message began a ${alien.distanceLy.toFixed(1)}-light-year journey toward ${alien.name}.`, 'signal', alienId);
    return signal;
  }

  function advanceSignals(dt) {
    for (const signal of signals.values()) {
      if (signal.status !== 'propagating') continue;
      const duration = Math.max(0.1, signal.arrivesAt - signal.sentAt);
      signal.progress = clamp(signal.progress + dt / duration, 0, 1);
      if (elapsed < signal.arrivesAt && signal.progress < 1) continue;
      signal.progress = 1;
      signal.status = 'arrived';
      const contact = contacts.get(signal.alienId);
      const alien = alienCivilizations.get(signal.alienId);
      if (!contact || !alien) continue;
      if (signal.direction === 'inbound') {
        contact.state = 'decoding';
        contact.messagesReceived++;
        record('Alien signal arrives', `A message from ${alien.name} reached the local system after light-speed delay.`, 'contact', alien.id);
      } else {
        alien.caution = clamp(alien.caution + (signal.kind === 'threat' ? 0.3 : -0.08), 0, 1);
        contact.state = 'exchange';
        record('Message reaches alien system', `The outbound message reached ${alien.name}; any answer will require another light-speed journey.`, 'contact', alien.id);
      }
    }
  }

  function decideContactResponse(alien, contact, economy) {
    const localTrust = clamp((economy?.wealth || 0) / 100 + machineGlobalTrust() * 0.4, 0, 1);
    const cooperativeScore = alien.cooperation * 0.45 + localTrust * 0.35 + (1 - alien.caution) * 0.2;
    contact.state = cooperativeScore > 0.65 ? 'cooperation' : alien.caution > 0.72 ? 'avoidance' : cooperativeScore < 0.28 ? 'conflict' : 'exchange';
    contact.trust = cooperativeScore;
    record('First-contact outcome', `${alien.name} entered a state of ${contact.state} after translation, uncertainty, and strategic assessment.`, 'contact', alien.id);
  }

  function render(frame = {}) {
    const timestamp = frame.timestamp ?? performance.now();
    if (timestamp - hud.lastUpdate < 500) return;
    hud.lastUpdate = timestamp;
    const state = getState();
    hud.element.hidden = state.colonies === 0 && state.detectedCivilizations === 0;
    if (hud.element.hidden) return;
    hud.summary.textContent = `${state.colonies} colonies · ${state.machines} machines · ${state.activeTransfers} transfers · ${state.detectedCivilizations} detected civilizations`;
    hud.detail.textContent = `${state.population.toFixed(0)} offworld population · ${state.activeSignals} signals · ${state.collapsedColonies} collapsed habitats · ${state.firstContacts} resolved contacts`;
  }

  function getState() {
    const activeColonies = [...colonies.values()].filter(colony => colony.status !== 'lost');
    return {
      elapsed,
      simulationYear: elapsed * yearsPerSecond,
      colonies: activeColonies.length,
      operationalColonies: activeColonies.filter(colony => colony.status === 'operational').length,
      collapsedColonies: activeColonies.filter(colony => colony.status === 'collapsed').length,
      population: activeColonies.reduce((sum, colony) => sum + colony.population, 0),
      transfers: transfers.size,
      activeTransfers: [...transfers.values()].filter(transfer => ['holding-for-window', 'in-transit'].includes(transfer.status)).length,
      shipments: shipments.size,
      machines: machines.size,
      activeMachines: [...machines.values()].filter(machine => machine.status === 'active').length,
      machineLineages: machineLineages.size,
      roboticAssets: roboticAssets.size,
      alienCivilizations: alienCivilizations.size,
      detectedCivilizations: [...contacts.values()].filter(contact => !['unknown', 'extinct'].includes(contact.state)).length,
      firstContacts: [...contacts.values()].filter(contact => ['cooperation', 'avoidance', 'conflict', 'exchange'].includes(contact.state)).length,
      signals: signals.size,
      activeSignals: [...signals.values()].filter(signal => signal.status === 'propagating').length,
      events: history.length,
      trajectoryModel: 'live-orbital-state + Hohmann approximation; REBOUND-compatible validation path',
    };
  }

  function getSnapshot() {
    return {
      state: getState(),
      colonies: [...colonies.values()].map(clone),
      transfers: [...transfers.values()].map(clone),
      shipments: [...shipments.values()].map(clone),
      machines: [...machines.values()].map(clone),
      machineLineages: [...machineLineages.values()].map(clone),
      roboticAssets: [...roboticAssets.values()].map(clone),
      alienCivilizations: [...alienCivilizations.values()].map(clone),
      signals: [...signals.values()].map(clone),
      contacts: [...contacts.values()].map(clone),
      history: history.slice(0, 160).map(clone),
    };
  }

  function runInvariants() {
    const failures = [];
    const values = [
      ...[...colonies.values()].flatMap(colony => [colony.population, colony.lifeSupport, colony.water, colony.oxygen, colony.food, colony.energy, colony.ecology, colony.autonomy]),
      ...[...transfers.values()].flatMap(transfer => [transfer.payloadMass, transfer.propellantMass, transfer.durationDays, transfer.progress, transfer.reliability]),
      ...[...machines.values()].flatMap(machine => [machine.compute, machine.energy, machine.integrity, machine.performance, machine.autonomy, machine.trust]),
      ...[...signals.values()].flatMap(signal => [signal.progress, signal.distanceLy, signal.arrivesAt]),
    ];
    if (values.some(value => !Number.isFinite(value))) failures.push('non-finite-state');
    for (const colony of colonies.values()) {
      if (colony.population < 0) failures.push(`negative-population:${colony.id}`);
      if (!COLONY_TYPES.includes(colony.type)) failures.push(`invalid-colony-type:${colony.id}`);
      if (colony.transferId && !transfers.has(colony.transferId)) failures.push(`orphan-colony-transfer:${colony.id}`);
    }
    for (const transfer of transfers.values()) {
      if (transfer.progress < 0 || transfer.progress > 1) failures.push(`invalid-transfer-progress:${transfer.id}`);
      if (!['holding-for-window', 'in-transit', 'arrived', 'lost'].includes(transfer.status)) failures.push(`invalid-transfer-status:${transfer.id}`);
    }
    for (const machine of machines.values()) if (!machineLineages.has(machine.lineageId)) failures.push(`orphan-machine-lineage:${machine.id}`);
    for (const contact of contacts.values()) if (!CONTACT_STATES.includes(contact.state)) failures.push(`invalid-contact-state:${contact.alienId}`);
    for (const signal of signals.values()) if (!alienCivilizations.has(signal.alienId)) failures.push(`orphan-signal:${signal.id}`);
    return { ok: failures.length === 0, failures, checkedAt: elapsed };
  }

  function debugSeedScenario(kind = 'orbital-colony') {
    initializeAlienCivilizations();
    if (kind === 'orbital-colony') {
      const colony = ensureDebugColony('debug-orbital-colony', 'orbital-habitat', 'gaia-orbit');
      colony.status = 'operational'; colony.population = Math.max(colony.population, 34);
      colony.lifeSupport = 0.9; colony.water = 0.9; colony.oxygen = 0.92; colony.food = 0.86; colony.energy = 0.95;
      colony.ecology = 0.78; colony.biodiversity = 0.64; colony.manufacturing = 0.55; colony.localExtraction = 0.34;
      createMachine(colony.id, 'maintenance', 0.9);
      createRoboticAsset(colony.id, 'orbital-constructor', 'construction', colony.targetId);
      return { ok: true, kind, colonyId: colony.id };
    }
    if (kind === 'machine-economy') {
      const colony = ensureDebugColony('debug-machine-economy', 'asteroid-outpost', debugTargetId());
      colony.status = 'operational'; colony.population = 22; colony.energy = 1.1; colony.manufacturing = 0.82; colony.localExtraction = 0.76; colony.spareParts = 0.9; colony.research = 0.7;
      for (const objective of ['mining', 'logistics', 'construction', 'science', 'maintenance']) createMachine(colony.id, objective, 1);
      return { ok: true, kind, colonyId: colony.id };
    }
    if (kind === 'supply-failure') {
      const colony = ensureDebugColony('debug-supply-failure', 'planetary-colony', debugTargetId());
      colony.status = 'stressed'; colony.population = 48; colony.food = 0.18; colony.water = 0.24; colony.spareParts = 0.12; colony.energy = 0.32; colony.lastResupplyAt = elapsed - 180;
      const shipment = createShipment(colony, { food: 0.7, water: 0.5, spareParts: 0.5 }, 0.01);
      const transfer = transfers.get(shipment.transferId); transfer.status = 'lost'; transfer.progress = 1; shipment.status = 'lost';
      record('Forced supply-chain failure', `${shipment.id} was lost during the deterministic test scenario.`, 'logistics', colony.id);
      return { ok: true, kind, colonyId: colony.id, shipmentId: shipment.id };
    }
    if (kind === 'habitat-collapse') {
      const colony = ensureDebugColony('debug-habitat-collapse', 'deep-space-station', 'deep-space');
      colony.status = 'stressed'; colony.population = 31; colony.lifeSupport = 0.08; colony.oxygen = 0.06; colony.water = 0.1; colony.food = 0.08; colony.energy = 0.12; colony.ecology = 0.04; colony.biodiversity = 0.03; colony.waste = 0.96;
      return { ok: true, kind, colonyId: colony.id };
    }
    if (kind === 'first-contact') {
      let alien = nearestActiveAlien();
      if (!alien) alien = createDebugAlien();
      alien.distanceLy = 0.7; alien.detectability = 1; alien.technologicalLevel = 1;
      const contact = contacts.get(alien.id); contact.state = 'detected'; contact.confidence = 1;
      const signal = maybeGenerateAlienSignal(alien, contact) || [...signals.values()].find(item => item.alienId === alien.id);
      if (signal) signal.arrivesAt = elapsed + 1.5;
      return { ok: true, kind, alienId: alien.id, signalId: signal?.id || null };
    }
    return { ok: false, reason: 'unknown-scenario', kind };
  }

  function ensureDebugColony(id, type, targetId) {
    if (colonies.has(id)) return colonies.get(id);
    const transferId = `debug-transfer-${id}`;
    transfers.set(transferId, { id: transferId, sourceId: 'debug-home', targetId, purpose: 'debug', payloadMass: 20, propellantMass: 10, launchWindow: 1, deltaV: 1, durationDays: 1, durationSeconds: 0.1, communicationDelayYears: communicationDelayYears(targetId), reliability: 1, progress: 1, status: 'arrived', launchedAt: elapsed, arrivesAt: elapsed, trajectoryModel: 'debug-deterministic', samples: [], linkedMissionId: null });
    const colony = makeColony({ id, name: id.replaceAll('-', ' '), type, targetId, parentCommunityId: 'debug-home', transferId, status: 'operational', population: 18, founders: 18, environment: environmentForTarget(targetId) });
    colonies.set(id, colony);
    return colony;
  }

  function createDebugAlien() {
    const id = `alien-${nextAlien++}`;
    const alien = { id, starId: 'debug-star', name: 'Debug Contact', position: { x: 0.001, y: 0, z: 0 }, distanceLy: 0.7, habitability: 1, biologicalAgeGyr: 7, technologicalLevel: 1, detectability: 1, cooperation: 0.74, caution: 0.32, translationComplexity: 0.2, status: 'active', technosignatures: ['narrowband-radio'], createdAt: elapsed };
    alienCivilizations.set(id, alien);
    contacts.set(id, { alienId: id, state: 'unknown', confidence: 0, translation: 0, trust: 0, messagesSent: 0, messagesReceived: 0, lastSignalAt: null, firstDetectedAt: null });
    return alien;
  }

  function save() {
    return {
      version: 1,
      elapsed,
      counters: { nextColony, nextTransfer, nextShipment, nextMachine, nextLineage, nextRobot, nextAlien, nextSignal, nextEvent },
      colonies: [...colonies.values()].map(clone), transfers: [...transfers.values()].map(clone), shipments: [...shipments.values()].map(clone),
      machineLineages: [...machineLineages.values()].map(clone), machines: [...machines.values()].map(clone), roboticAssets: [...roboticAssets.values()].map(clone),
      alienCivilizations: [...alienCivilizations.values()].map(clone), signals: [...signals.values()].map(clone), contacts: [...contacts.values()].map(clone),
      consumedMissions: [...consumedMissions], history: history.slice(0, 400).map(clone),
    };
  }

  function load(state) {
    if (!state) return;
    elapsed = Math.max(0, state.elapsed || 0);
    const counters = state.counters || {};
    nextColony = Math.max(1, counters.nextColony || 1); nextTransfer = Math.max(1, counters.nextTransfer || 1);
    nextShipment = Math.max(1, counters.nextShipment || 1); nextMachine = Math.max(1, counters.nextMachine || 1);
    nextLineage = Math.max(1, counters.nextLineage || 1); nextRobot = Math.max(1, counters.nextRobot || 1);
    nextAlien = Math.max(1, counters.nextAlien || 1); nextSignal = Math.max(1, counters.nextSignal || 1); nextEvent = Math.max(1, counters.nextEvent || 1);
    for (const item of state.colonies || []) colonies.set(item.id, { ...item, history: [...(item.history || [])] });
    for (const item of state.transfers || []) transfers.set(item.id, item);
    for (const item of state.shipments || []) shipments.set(item.id, item);
    for (const item of state.machineLineages || []) machineLineages.set(item.id, item);
    for (const item of state.machines || []) machines.set(item.id, item);
    for (const item of state.roboticAssets || []) roboticAssets.set(item.id, item);
    for (const item of state.alienCivilizations || []) alienCivilizations.set(item.id, item);
    for (const item of state.signals || []) signals.set(item.id, item);
    for (const item of state.contacts || []) contacts.set(item.alienId, item);
    for (const id of state.consumedMissions || []) consumedMissions.add(id);
    history.push(...(state.history || []).slice(0, 400));
    initializedAliens = alienCivilizations.size > 0;
  }

  function destroy() {
    destroyed = true;
    hud.element.remove();
    colonies.clear(); transfers.clear(); shipments.clear(); machineLineages.clear(); machines.clear(); roboticAssets.clear(); alienCivilizations.clear(); signals.clear(); contacts.clear();
  }

  function record(title, description, type, subjectId = null) {
    const event = { id: `phase9-${nextEvent++}`, title, description, type, subjectId, at: elapsed, simulationYear: elapsed * yearsPerSecond, tick: world.tick };
    history.unshift(event);
    if (history.length > 600) history.length = 600;
    window.dispatchEvent(new CustomEvent('phase9-history', { detail: event }));
    return event;
  }

  function recordOnce(subject, key, title, description, type) {
    subject.history ||= [];
    if (subject.history.includes(key)) return;
    subject.history.push(key);
    record(title, description, type, subject.id);
  }

  function environmentForTarget(targetId) {
    const body = (orbitalSystem.getBodies?.() || []).find(item => item.id === targetId);
    if (targetId === 'gaia-orbit') return { gravity: 0, radiation: 0.42, temperature: 286, pressure: 0 };
    if (targetId === 'deep-space') return { gravity: 0, radiation: 0.82, temperature: 80, pressure: 0 };
    if (!body) return { gravity: 0.25, radiation: 0.58, temperature: 210, pressure: 0.02 };
    const radiusEarth = body.radiusEarth || Math.max(0.2, (body.radius || 0.1) * 5);
    const gravity = body.type === 'moon' ? 0.16 : clamp((body.massEarth || 0.3) / (radiusEarth ** 2), 0.03, 3.5);
    const temperature = body.equilibriumTemperature || (body.type === 'moon' ? 250 : 220);
    const pressure = body.atmosphereRetention == null ? 0.02 : body.atmosphereRetention;
    const radiation = clamp(0.72 - pressure * 0.48 + Math.abs(temperature - 288) / 800, 0.08, 1);
    return { gravity, radiation, temperature, pressure };
  }

  function communicationDelayYears(targetId) {
    if (targetId === 'gaia-orbit') return 0.00000004;
    const body = (orbitalSystem.getBodies?.() || []).find(item => item.id === targetId);
    const distanceAu = Math.hypot(body?.position?.x || 0.01, body?.position?.y || 0, body?.position?.z || 0.01);
    return Math.max(0.0000001, distanceAu * 0.0000158125);
  }

  function strongestScience() { return [...(phase8.getSciences?.() || [])].sort((a, b) => (b.knowledge || 0) - (a.knowledge || 0))[0]; }
  function strongestEconomy() { return [...(phase8.getEconomies?.() || [])].sort((a, b) => (b.wealth || 0) - (a.wealth || 0))[0]; }
  function nearestActiveAlien() { return [...alienCivilizations.values()].filter(item => item.status === 'active').sort((a, b) => a.distanceLy - b.distanceLy)[0]; }
  function activeSignalFrom(alienId) { return [...signals.values()].some(signal => signal.alienId === alienId && signal.status === 'propagating'); }
  function activeShipmentTo(colonyId) { return [...shipments.values()].some(shipment => shipment.colonyId === colonyId && !['delivered', 'lost'].includes(shipment.status)); }
  function machinesAt(colonyId) { return [...machines.values()].filter(machine => machine.colonyId === colonyId); }
  function machineReliabilityAt(colonyId) { return mean(machinesAt(colonyId).map(machine => machine.integrity * machine.performance)); }
  function machineCapacityAt(colonyId, objective) { return mean(machinesAt(colonyId).filter(machine => machine.objective === objective && machine.status === 'active').map(machine => machine.performance)); }
  function machineGlobalCapacity(objective) { return mean([...machines.values()].filter(machine => machine.objective === objective && machine.status === 'active').map(machine => machine.performance)); }
  function machineGlobalTrust() { return mean([...machines.values()].map(machine => machine.trust)); }
  function roboticObservation() { return mean([...roboticAssets.values()].filter(asset => ['science', 'communication'].includes(asset.objective)).map(asset => asset.output + asset.reliability)); }
  function colonyName(id) { return colonies.get(id)?.name || id; }
  function targetName(id) { return (orbitalSystem.getBodies?.() || []).find(body => body.id === id)?.name || String(id).replaceAll('-', ' '); }
  function debugTargetId() { return (orbitalSystem.getBodies?.() || []).find(body => body.id !== 'gaia' && body.id !== 'sun' && body.type === 'planet')?.id || 'selene'; }
  function targetColonyType(targetId) { const body = (orbitalSystem.getBodies?.() || []).find(item => item.id === targetId); return body?.type === 'moon' ? 'moon-base' : body?.type === 'planet' ? 'planetary-colony' : 'deep-space-station'; }

  const api = {
    id: 'civilization.phase9-multiworld-ai-contact',
    name: 'Multi-World Civilizations, Autonomous Machines, and Galactic Contact',
    version: '1.0.0',
    execution: 'browser-deterministic-orbital-lod',
    source: 'Reality Sandbox deterministic multi-world, closed-ecology, machine-lineage, and light-delay simulation using live orbital and galaxy state',
    license: 'Project license',
    provides: ['colonies.multiworld', 'machines.autonomous', 'ecology.closed-loop', 'signals.interstellar', 'contact.first'],
    requires: ['spaceflight.emergent', 'economy.production', 'science.discovery', 'orbits.system', 'galaxy.population'],
    after: ['civilization.phase8-institutions-industry-spaceflight'],
    initialize, step, render, save, load, destroy, getState, getSnapshot, runInvariants,
    getColonies: () => [...colonies.values()].map(clone),
    getTransfers: () => [...transfers.values()].map(clone),
    getShipments: () => [...shipments.values()].map(clone),
    getMachines: () => [...machines.values()].map(clone),
    getMachineLineages: () => [...machineLineages.values()].map(clone),
    getRoboticAssets: () => [...roboticAssets.values()].map(clone),
    getAlienCivilizations: () => [...alienCivilizations.values()].map(clone),
    getSignals: () => [...signals.values()].map(clone),
    getContacts: () => [...contacts.values()].map(clone),
    getHistory: () => history.slice().map(clone),
    createTransfer, createMachine, sendSignal, debugSeedScenario,
  };
  return api;
}

function createHud() {
  const element = document.createElement('section');
  element.hidden = true;
  element.setAttribute('aria-live', 'polite');
  element.style.cssText = 'position:fixed;right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));z-index:18;max-width:min(430px,calc(100vw - 24px));padding:10px 12px;border:1px solid rgba(184,140,255,.3);border-radius:12px;background:rgba(8,4,18,.76);backdrop-filter:blur(10px);color:#f0e7ff;font:600 11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.035em;pointer-events:none';
  element.innerHTML = '<strong style="display:block;margin-bottom:4px;color:#d7b8ff">PHASE 9 · MULTI-WORLD CONTACT</strong><span data-summary></span><small data-detail style="display:block;margin-top:4px;color:rgba(240,231,255,.68)"></small>';
  document.body.append(element);
  return { element, summary: element.querySelector('[data-summary]'), detail: element.querySelector('[data-detail]'), lastUpdate: -Infinity };
}

function alienHabitability(star) {
  const age = clamp((star.age || 0) / 12, 0, 1);
  const metallicity = clamp(((star.metallicity || -1) + 1.5) / 2.2, 0, 1);
  const spectral = String(star.spectralClass || 'M')[0];
  const stability = ({ F: 0.7, G: 1, K: 0.95, M: 0.55, A: 0.2, B: 0.04, O: 0.01 })[spectral] ?? 0.4;
  return clamp(age * 0.35 + metallicity * 0.3 + stability * 0.35, 0, 1);
}

function makeTechnosignatures(rng) {
  const signatures = ['narrowband-radio'];
  if (rng() < 0.5) signatures.push('infrared-waste-heat');
  if (rng() < 0.28) signatures.push('transit-engineering');
  if (rng() < 0.14) signatures.push('stellar-energy-harvesting');
  return signatures;
}

function syllableName(rng) {
  const a = ['Ari', 'Bel', 'Cae', 'Dru', 'Eli', 'Fae', 'Gho', 'Iri', 'Khe', 'Luo', 'Myr', 'Nae', 'Oru', 'Pha', 'Qua', 'Rin', 'Sae', 'Tyr', 'Ulo', 'Vae', 'Xen', 'Yri', 'Zha'];
  const b = ['dan', 'eth', 'ion', 'ara', 'uun', 'esh', 'ora', 'iel', 'oth', 'yne'];
  return `${a[Math.floor(rng() * a.length)]}${b[Math.floor(rng() * b.length)]}`;
}

function mapById(items) { return new Map(items.map(item => [item.id, item])); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function mean(values) { const finite = values.filter(Number.isFinite); return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0; }
function distance3(a, b) { return Math.hypot((a?.x || 0) - (b?.x || 0), (a?.y || 0) - (b?.y || 0), (a?.z || 0) - (b?.z || 0)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function wrapAngle(value) { const tau = Math.PI * 2; return ((value + Math.PI) % tau + tau) % tau - Math.PI; }
function mulberry32(seed) { let value = seed >>> 0; return () => { value += 0x6D2B79F5; let result = value; result = Math.imul(result ^ result >>> 15, result | 1); result ^= result + Math.imul(result ^ result >>> 7, result | 61); return ((result ^ result >>> 14) >>> 0) / 4294967296; }; }
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
