const MODEL_VERSION = 3;
const PREDATOR_BASE_DETECTION_RADIUS = 78;
const APEX_BASE_DETECTION_RADIUS = 150;
const ENCOUNTER_HOLD_SECONDS = 0.14;
const GRAZER_VIGILANCE_RADIUS = 76;
const PREDATOR_VIGILANCE_RADIUS = 96;

async function start() {
  try {
    await waitForSandboxReady();
    await waitForEcologyStack();
    const planet = window.realitySandboxPlanet;
    if (!planet?.world?.ecs) throw new Error('Living world did not become available.');

    const api = installPredatorEncounterEcology(planet.world);
    planet.predatorEncounterEcology = api;
    window.realitySandboxPredatorEncounterEcology = api;
    window.dispatchEvent(new CustomEvent('eidolon-predator-encounter-ecology-ready', {
      detail: api.getSnapshot(),
    }));
    window.addEventListener('pagehide', api.destroy, { once: true });
  } catch (error) {
    console.warn('[predator-encounter-ecology] disabled:', error);
  }
}

async function waitForSandboxReady() {
  if (document.readyState === 'loading') {
    await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  }
  const ready = window.realitySandboxReady;
  if (ready && typeof ready.then === 'function') await ready;
}

function waitForEcologyStack() {
  if (window.realitySandboxGrazerDigestionPhysiology && window.realitySandboxTrophicSatiety) {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const started = performance.now();
    const poll = () => {
      if (window.realitySandboxGrazerDigestionPhysiology && window.realitySandboxTrophicSatiety) return resolve();
      if (performance.now() - started > 10000) return resolve();
      setTimeout(poll, 25);
    };
    poll();
  });
}

export function installPredatorEncounterEcology(world) {
  const previousStep = world.step;
  if (typeof previousStep !== 'function') return emptyApi();
  if (world.__predatorEncounterEcologyInstalled) return world.__predatorEncounterEcologyInstalled;

  let active = true;
  let predatorSearchSteps = 0;
  let apexSearchSteps = 0;
  let predatorEncounterSteps = 0;
  let apexEncounterSteps = 0;
  let predatorRefugeMisses = 0;
  let apexRefugeMisses = 0;
  let predatorEncounterEvents = 0;
  let apexEncounterEvents = 0;
  let predatorChaseAbandonments = 0;
  let apexChaseAbandonments = 0;
  let grazerVigilanceSteps = 0;
  let grazerFleeEvents = 0;
  let predatorVigilanceSteps = 0;
  let predatorFleeEvents = 0;
  let coveredFleeSteps = 0;
  let searchEnergySpent = 0;
  let searchEnergySaved = 0;
  let scarcityConservingPredatorSteps = 0;
  let scarcityConservingApexSteps = 0;
  let lastPredatorSearchActivity = 1;
  let lastApexSearchActivity = 1;
  let coveredPreyDetections = 0;
  let peakPredatorDetectionRadius = 0;
  let peakApexDetectionRadius = 0;
  let lastEncounter = null;
  let lastEscape = null;

  function wrappedStep(dt) {
    if (!active || !Number.isFinite(dt) || dt <= 0) {
      previousStep.call(world, dt);
      return;
    }

    const c = world.ecs.components;
    applyGrazerVigilance(c, dt);
    applyPredatorVigilance(c, dt);
    regulatePredatorEncounters(c, dt);
    regulateApexEncounters(c, dt);
    previousStep.call(world, dt);
  }

  function applyGrazerVigilance(c, dt) {
    for (const [id, grazer] of c.agent?.entries?.() || []) {
      const pos = c.position?.get(id);
      const velocity = c.velocity?.get(id);
      if (!pos || !velocity) continue;

      const dna = grazer.dna || { speed: 1, sense: 1 };
      const cover = forageCover(pos);
      const vigilanceRadius = GRAZER_VIGILANCE_RADIUS
        * clamp(finite(dna.sense, 1), 0.6, 1.4)
        * (1 + cover * 0.12);
      const threat = nearestThreat(pos, c.predator, c, vigilanceRadius, predator => shouldSeek(predator) && finite(predator.rest) <= 0.22);

      if (!threat) {
        grazer.predatorAlert = false;
        continue;
      }

      grazerVigilanceSteps += 1;
      if (!grazer.predatorAlert) {
        grazerFleeEvents += 1;
        lastEscape = { guild: 'grazer', id, threatId: threat.id, distance: round(threat.distance), cover: round(cover), tick: world.tick };
      }
      grazer.predatorAlert = true;
      grazer.grazeClock = 0;
      if (finite(grazer.forageClock) > 0.22) grazer.forageClock = 0.22;
      if (cover > 0.3) coveredFleeSteps += 1;

      const away = Math.atan2(pos.y - threat.position.y, pos.x - threat.position.x);
      const weave = Math.sin(world.tick * 0.17 + id * 1.73) * (0.18 + cover * 0.22);
      const heading = away + weave;
      const escapeSpeed = 52 * clamp(finite(dna.speed, 1), 0.6, 1.4) * (1 + cover * 0.24);
      const response = 1 - Math.exp(-dt * (8 + finite(dna.sense, 1) * 2));
      const targetVx = Math.cos(heading) * escapeSpeed;
      const targetVy = Math.sin(heading) * escapeSpeed;
      velocity.vx += (targetVx - velocity.vx) * response;
      velocity.vy += (targetVy - velocity.vy) * response;
    }
  }

  function applyPredatorVigilance(c, dt) {
    for (const [id, predator] of c.predator?.entries?.() || []) {
      const pos = c.position?.get(id);
      const velocity = c.velocity?.get(id);
      if (!pos || !velocity) continue;
      const dna = predator.dna || { speed: 1, sense: 1 };
      const vigilanceRadius = PREDATOR_VIGILANCE_RADIUS * clamp(finite(dna.sense, 1), 0.35, 2.1);
      const threat = nearestThreat(pos, c.apex, c, vigilanceRadius, apex => shouldSeek(apex) && finite(apex.rest) <= 0.22);

      if (!threat) {
        predator.apexAlert = false;
        continue;
      }

      predatorVigilanceSteps += 1;
      if (!predator.apexAlert) {
        predatorFleeEvents += 1;
        lastEscape = { guild: 'predator', id, threatId: threat.id, distance: round(threat.distance), cover: 0, tick: world.tick };
      }
      predator.apexAlert = true;
      const away = Math.atan2(pos.y - threat.position.y, pos.x - threat.position.x);
      const heading = away + Math.sin(world.tick * 0.13 + id * 0.91) * 0.16;
      const escapeSpeed = 61 * clamp(finite(dna.speed, 1), 0.45, 2);
      const response = 1 - Math.exp(-dt * 7);
      velocity.vx += (Math.cos(heading) * escapeSpeed - velocity.vx) * response;
      velocity.vy += (Math.sin(heading) * escapeSpeed - velocity.vy) * response;
    }
  }

  function regulatePredatorEncounters(c, dt) {
    const globalPrey = c.agent?.size || 0;
    const consumerCount = Math.max(1, c.predator?.size || 0);
    const preyPerHunter = globalPrey / consumerCount;
    for (const [id, predator] of c.predator?.entries?.() || []) {
      if (coolingDown(predator, dt)) continue;
      if (!shouldSeek(predator)) {
        clearEncounterHold(predator);
        predator.encounterChaseClock = 0;
        continue;
      }
      if (finite(predator.rest) > 0.22 && !predator.encounterSearchHold) {
        predator.encounterChaseClock = 0;
        continue;
      }

      const detection = detectNearest({
        hunterId: id,
        hunter: predator,
        preyGroup: c.agent,
        c,
        baseRadius: PREDATOR_BASE_DETECTION_RADIUS,
        useCover: true,
        skipGrace: true,
      });
      peakPredatorDetectionRadius = Math.max(peakPredatorDetectionRadius, detection.radius);

      if (detection.preyId != null) {
        const sameTarget = predator.lastEncounterPreyId === detection.preyId;
        predator.encounterChaseClock = sameTarget ? finite(predator.encounterChaseClock) + dt : dt;
        const maxChase = predatorMaxChase(predator);
        if (predator.encounterChaseClock > maxChase) {
          predatorChaseAbandonments += 1;
          beginRecovery(predator, predatorRecovery(predator));
          predator.lastEncounterPreyId = null;
          lastEscape = { guild: 'grazer', id: detection.preyId, threatId: id, distance: round(detection.distance), cover: round(detection.cover), tick: world.tick, outcome: 'chase-abandoned' };
          continue;
        }

        predatorEncounterSteps += 1;
        if (!sameTarget) {
          predatorEncounterEvents += 1;
          lastEncounter = {
            guild: 'predator', hunterId: id, preyId: detection.preyId,
            distance: round(detection.distance), radius: round(detection.radius),
            cover: round(detection.cover), maxChase: round(maxChase), tick: world.tick,
          };
        }
        if (detection.cover > 0.3) coveredPreyDetections += 1;
        predator.lastEncounterPreyId = detection.preyId;
        clearEncounterHold(predator);
        continue;
      }

      predator.encounterChaseClock = Math.max(0, finite(predator.encounterChaseClock) - dt * 2);
      predatorSearchSteps += 1;
      if (globalPrey > 0) predatorRefugeMisses += 1;
      predator.lastEncounterPreyId = null;
      holdSearch(predator, dt);
      const search = chargePredatorSearch(predator, dt, preyPerHunter);
      searchEnergySpent += search.spent;
      searchEnergySaved += search.saved;
      lastPredatorSearchActivity = search.activity;
      if (search.activity < 0.72) scarcityConservingPredatorSteps += 1;
    }
  }

  function regulateApexEncounters(c, dt) {
    const globalPrey = c.predator?.size || 0;
    const consumerCount = Math.max(1, c.apex?.size || 0);
    const preyPerHunter = globalPrey / consumerCount;
    for (const [id, apex] of c.apex?.entries?.() || []) {
      if (coolingDown(apex, dt)) continue;
      if (!shouldSeek(apex)) {
        clearEncounterHold(apex);
        apex.encounterChaseClock = 0;
        continue;
      }
      if (finite(apex.rest) > 0.22 && !apex.encounterSearchHold) {
        apex.encounterChaseClock = 0;
        continue;
      }

      const detection = detectNearest({
        hunterId: id,
        hunter: apex,
        preyGroup: c.predator,
        c,
        baseRadius: APEX_BASE_DETECTION_RADIUS,
        useCover: false,
        skipGrace: false,
      });
      peakApexDetectionRadius = Math.max(peakApexDetectionRadius, detection.radius);

      if (detection.preyId != null) {
        const sameTarget = apex.lastEncounterPreyId === detection.preyId;
        apex.encounterChaseClock = sameTarget ? finite(apex.encounterChaseClock) + dt : dt;
        const maxChase = apexMaxChase(apex);
        if (apex.encounterChaseClock > maxChase) {
          apexChaseAbandonments += 1;
          beginRecovery(apex, apexRecovery(apex));
          apex.lastEncounterPreyId = null;
          lastEscape = { guild: 'predator', id: detection.preyId, threatId: id, distance: round(detection.distance), cover: 0, tick: world.tick, outcome: 'chase-abandoned' };
          continue;
        }

        apexEncounterSteps += 1;
        if (!sameTarget) {
          apexEncounterEvents += 1;
          lastEncounter = {
            guild: 'apex', hunterId: id, preyId: detection.preyId,
            distance: round(detection.distance), radius: round(detection.radius),
            cover: 0, maxChase: round(maxChase), tick: world.tick,
          };
        }
        apex.lastEncounterPreyId = detection.preyId;
        clearEncounterHold(apex);
        continue;
      }

      apex.encounterChaseClock = Math.max(0, finite(apex.encounterChaseClock) - dt * 2);
      apexSearchSteps += 1;
      if (globalPrey > 0) apexRefugeMisses += 1;
      apex.lastEncounterPreyId = null;
      holdSearch(apex, dt);
      const search = chargeApexSearch(apex, dt, preyPerHunter);
      searchEnergySpent += search.spent;
      searchEnergySaved += search.saved;
      lastApexSearchActivity = search.activity;
      if (search.activity < 0.72) scarcityConservingApexSteps += 1;
    }
  }

  function detectNearest({ hunterId, hunter, preyGroup, c, baseRadius, useCover, skipGrace }) {
    const hunterPos = c.position?.get(hunterId);
    if (!hunterPos) return { preyId: null, distance: Infinity, radius: 0, cover: 0 };

    const sense = clamp(finite(hunter.dna?.sense, 1), 0.35, 2.1);
    const baseDetection = baseRadius * sense;
    let preyId = null;
    let bestDistance = Infinity;
    let bestRadius = baseDetection;
    let bestCover = 0;

    for (const [candidateId, prey] of preyGroup?.entries?.() || []) {
      if (skipGrace && finite(prey.foundryGrace) > 0) continue;
      const preyPos = c.position?.get(candidateId);
      if (!preyPos) continue;

      const cover = useCover ? forageCover(preyPos) : 0;
      const coverFactor = useCover ? 1 - cover * 0.34 : 1;
      const radius = Math.max(18, baseDetection * coverFactor);
      const dx = preyPos.x - hunterPos.x;
      const dy = preyPos.y - hunterPos.y;
      const distance = Math.hypot(dx, dy);
      if (distance > radius || distance >= bestDistance) continue;

      preyId = candidateId;
      bestDistance = distance;
      bestRadius = radius;
      bestCover = cover;
    }

    return { preyId, distance: bestDistance, radius: bestRadius, cover: bestCover };
  }

  function nearestThreat(position, group, c, radius, predicate) {
    let best = null;
    for (const [id, organism] of group?.entries?.() || []) {
      if (predicate && !predicate(organism)) continue;
      const threatPos = c.position?.get(id);
      if (!threatPos) continue;
      const distance = Math.hypot(threatPos.x - position.x, threatPos.y - position.y);
      if (distance > radius || (best && distance >= best.distance)) continue;
      best = { id, organism, position: threatPos, distance };
    }
    return best;
  }

  function forageCover(position) {
    const sample = world.forageField?.sample?.(position.x, position.y);
    return clamp(finite(sample?.food), 0, 1);
  }

  function predatorMaxChase(predator) {
    const dna = predator.dna || { sense: 1, metabolism: 1 };
    return clamp(1.65 + finite(dna.sense, 1) * 0.65 - finite(dna.metabolism, 1) * 0.28, 1.45, 2.75);
  }

  function apexMaxChase(apex) {
    const dna = apex.dna || { sense: 1, metabolism: 1 };
    return clamp(2.2 + finite(dna.sense, 1) * 0.75 - finite(dna.metabolism, 1) * 0.24, 2.2, 3.6);
  }

  function predatorRecovery(predator) {
    const metabolism = clamp(finite(predator.dna?.metabolism, 1), 0.4, 2.2);
    return clamp(0.7 + metabolism * 0.32, 0.82, 1.35);
  }

  function apexRecovery(apex) {
    const metabolism = clamp(finite(apex.dna?.metabolism, 1), 0.5, 1.6);
    return clamp(0.9 + metabolism * 0.36, 1.05, 1.5);
  }

  function coolingDown(hunter, dt) {
    let recovery = Math.max(0, finite(hunter.encounterRecovery));
    if (recovery <= 0) return false;
    recovery = Math.max(0, recovery - dt);
    hunter.encounterRecovery = recovery;
    hunter.encounterSearchHold = false;
    hunter.rest = Math.max(finite(hunter.rest), Math.max(recovery, dt * 2.2));
    hunter.encounterChaseClock = 0;
    return true;
  }

  function beginRecovery(hunter, duration) {
    hunter.encounterRecovery = Math.max(finite(hunter.encounterRecovery), duration);
    hunter.encounterSearchHold = false;
    hunter.rest = Math.max(finite(hunter.rest), duration);
    hunter.encounterChaseClock = 0;
  }

  function shouldSeek(hunter) {
    if (hunter.hungry === true) return true;
    const threshold = finite(hunter.hungerThreshold, NaN);
    return Number.isFinite(threshold) && finite(hunter.energy) <= threshold;
  }

  function holdSearch(hunter, dt) {
    hunter.encounterSearchHold = true;
    hunter.rest = Math.max(finite(hunter.rest), Math.max(ENCOUNTER_HOLD_SECONDS, dt * 2.2));
  }

  function clearEncounterHold(hunter) {
    if (!hunter.encounterSearchHold) return;
    if (finite(hunter.rest) <= 0.22) hunter.rest = 0;
    hunter.encounterSearchHold = false;
  }

  function chargePredatorSearch(predator, dt, preyPerHunter) {
    const dna = predator.dna || { speed: 1, sense: 1, metabolism: 1 };
    const aggression = clamp(finite(dna.speed, 1) + finite(dna.sense, 1) - finite(dna.metabolism, 1), 0.2, 1.4);
    const activeDrain = 0.03 * finite(world.globals?.metabolism, 1) * 1.9
      * finite(dna.metabolism, 1) * (0.7 + aggression * 0.4);
    const activity = 0.25 + 0.75 * smoothDensityResponse(preyPerHunter, 0.8, 5);
    const fullMissing = activeDrain * 0.6 * dt;
    const spent = fullMissing * activity;
    const saved = Math.max(0, fullMissing - spent);
    predator.energy = Math.max(0, finite(predator.energy) - spent);
    predator.searchEnergySpent = finite(predator.searchEnergySpent) + spent;
    predator.searchEnergySaved = finite(predator.searchEnergySaved) + saved;
    predator.searchActivityFactor = activity;
    predator.preyPerSearchConsumer = preyPerHunter;
    return { spent, saved, activity };
  }

  function chargeApexSearch(apex, dt, preyPerHunter) {
    const dna = apex.dna || { metabolism: 1 };
    const activeDrain = 0.03 * finite(world.globals?.metabolism, 1) * 1.1 * finite(dna.metabolism, 1);
    const activity = 0.2 + 0.8 * smoothDensityResponse(preyPerHunter, 0.8, 4);
    const fullMissing = activeDrain * 0.7 * dt;
    const spent = fullMissing * activity;
    const saved = Math.max(0, fullMissing - spent);
    apex.energy = Math.max(0, finite(apex.energy) - spent);
    apex.searchEnergySpent = finite(apex.searchEnergySpent) + spent;
    apex.searchEnergySaved = finite(apex.searchEnergySaved) + saved;
    apex.searchActivityFactor = activity;
    apex.preyPerSearchConsumer = preyPerHunter;
    return { spent, saved, activity };
  }

  function smoothDensityResponse(value, low, high) {
    const t = clamp((finite(value) - low) / Math.max(0.001, high - low), 0, 1);
    return t * t * (3 - 2 * t);
  }

  world.step = wrappedStep;

  const api = {
    getSnapshot() {
      const predatorAttempts = predatorSearchSteps + predatorEncounterSteps;
      const apexAttempts = apexSearchSteps + apexEncounterSteps;
      return {
        version: MODEL_VERSION,
        model: 'local-encounter-finite-pursuit-and-prey-vigilance',
        predatorBaseDetectionRadius: PREDATOR_BASE_DETECTION_RADIUS,
        apexBaseDetectionRadius: APEX_BASE_DETECTION_RADIUS,
        peakPredatorDetectionRadius: round(peakPredatorDetectionRadius),
        peakApexDetectionRadius: round(peakApexDetectionRadius),
        predatorSearchSteps,
        apexSearchSteps,
        predatorEncounterSteps,
        apexEncounterSteps,
        predatorEncounterEvents,
        apexEncounterEvents,
        predatorChaseAbandonments,
        apexChaseAbandonments,
        grazerVigilanceSteps,
        grazerFleeEvents,
        predatorVigilanceSteps,
        predatorFleeEvents,
        predatorRefugeMisses,
        apexRefugeMisses,
        predatorEncounterFraction: predatorAttempts ? round(predatorEncounterSteps / predatorAttempts) : 0,
        apexEncounterFraction: apexAttempts ? round(apexEncounterSteps / apexAttempts) : 0,
        coveredPreyDetections,
        coveredFleeSteps,
        searchEnergySpent: round(searchEnergySpent),
        searchEnergySaved: round(searchEnergySaved),
        scarcityConservingPredatorSteps,
        scarcityConservingApexSteps,
        lastPredatorSearchActivity: round(lastPredatorSearchActivity),
        lastApexSearchActivity: round(lastApexSearchActivity),
        lastEncounter,
        lastEscape,
        refugeMechanism: 'local detection plus vegetation concealment, active prey escape, finite chase endurance, and recovery',
        topDownControl: 'apex predators locally encounter and pursue mesopredators, which can also flee',
        searchMetabolicMode: 'prey-density-dependent-sit-and-wait-to-active-search',
        searchCost: 'core rest metabolism plus a prey-density-scaled fraction of active-search expenditure',
        populationFloor: null,
        populationCap: null,
      };
    },
    destroy() {
      active = false;
      if (world.step === wrappedStep) world.step = previousStep;
    },
  };

  Object.defineProperty(world, '__predatorEncounterEcologyInstalled', {
    configurable: true,
    enumerable: false,
    writable: false,
    value: api,
  });
  return api;
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value) {
  return Math.round(finite(value) * 1000) / 1000;
}

function emptyApi() {
  return {
    getSnapshot: () => ({ version: MODEL_VERSION, model: 'local-encounter-finite-pursuit-and-prey-vigilance', disabled: true }),
    destroy() {},
  };
}

if (typeof window !== 'undefined') start();
