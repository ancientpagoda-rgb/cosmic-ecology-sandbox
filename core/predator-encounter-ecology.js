const MODEL_VERSION = 1;
const PREDATOR_BASE_DETECTION_RADIUS = 78;
const APEX_BASE_DETECTION_RADIUS = 100;
const ENCOUNTER_HOLD_SECONDS = 0.14;

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
  let searchEnergySpent = 0;
  let coveredPreyDetections = 0;
  let peakPredatorDetectionRadius = 0;
  let peakApexDetectionRadius = 0;
  let lastEncounter = null;

  function wrappedStep(dt) {
    if (!active || !Number.isFinite(dt) || dt <= 0) {
      previousStep.call(world, dt);
      return;
    }

    const c = world.ecs.components;
    regulatePredatorEncounters(c, dt);
    regulateApexEncounters(c, dt);
    previousStep.call(world, dt);
  }

  function regulatePredatorEncounters(c, dt) {
    const globalPrey = c.agent?.size || 0;
    for (const [id, predator] of c.predator?.entries?.() || []) {
      if (!shouldSeek(predator)) {
        clearEncounterHold(predator);
        continue;
      }
      if (finite(predator.rest) > 0.22 && !predator.encounterSearchHold) continue;

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
        predatorEncounterSteps += 1;
        if (predator.lastEncounterPreyId !== detection.preyId) {
          predatorEncounterEvents += 1;
          lastEncounter = {
            guild: 'predator',
            hunterId: id,
            preyId: detection.preyId,
            distance: round(detection.distance),
            radius: round(detection.radius),
            cover: round(detection.cover),
            tick: world.tick,
          };
        }
        if (detection.cover > 0.3) coveredPreyDetections += 1;
        predator.lastEncounterPreyId = detection.preyId;
        clearEncounterHold(predator);
        continue;
      }

      predatorSearchSteps += 1;
      if (globalPrey > 0) predatorRefugeMisses += 1;
      predator.lastEncounterPreyId = null;
      holdSearch(predator, dt);
      searchEnergySpent += chargePredatorSearch(predator, dt);
    }
  }

  function regulateApexEncounters(c, dt) {
    const globalPrey = c.predator?.size || 0;
    for (const [id, apex] of c.apex?.entries?.() || []) {
      if (!shouldSeek(apex)) {
        clearEncounterHold(apex);
        continue;
      }
      if (finite(apex.rest) > 0.22 && !apex.encounterSearchHold) continue;

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
        apexEncounterSteps += 1;
        if (apex.lastEncounterPreyId !== detection.preyId) {
          apexEncounterEvents += 1;
          lastEncounter = {
            guild: 'apex',
            hunterId: id,
            preyId: detection.preyId,
            distance: round(detection.distance),
            radius: round(detection.radius),
            cover: 0,
            tick: world.tick,
          };
        }
        apex.lastEncounterPreyId = detection.preyId;
        clearEncounterHold(apex);
        continue;
      }

      apexSearchSteps += 1;
      if (globalPrey > 0) apexRefugeMisses += 1;
      apex.lastEncounterPreyId = null;
      holdSearch(apex, dt);
      searchEnergySpent += chargeApexSearch(apex, dt);
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

    return {
      preyId,
      distance: bestDistance,
      radius: bestRadius,
      cover: bestCover,
    };
  }

  function forageCover(position) {
    const sample = world.forageField?.sample?.(position.x, position.y);
    return clamp(finite(sample?.food), 0, 1);
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

  function chargePredatorSearch(predator, dt) {
    const dna = predator.dna || { speed: 1, sense: 1, metabolism: 1 };
    const aggression = clamp(finite(dna.speed, 1) + finite(dna.sense, 1) - finite(dna.metabolism, 1), 0.2, 1.4);
    const activeDrain = 0.03 * finite(world.globals?.metabolism, 1) * 1.9
      * finite(dna.metabolism, 1) * (0.7 + aggression * 0.4);
    const missing = activeDrain * 0.6 * dt;
    predator.energy = Math.max(0, finite(predator.energy) - missing);
    predator.searchEnergySpent = finite(predator.searchEnergySpent) + missing;
    return missing;
  }

  function chargeApexSearch(apex, dt) {
    const dna = apex.dna || { metabolism: 1 };
    const activeDrain = 0.03 * finite(world.globals?.metabolism, 1) * 1.1 * finite(dna.metabolism, 1);
    const missing = activeDrain * 0.7 * dt;
    apex.energy = Math.max(0, finite(apex.energy) - missing);
    apex.searchEnergySpent = finite(apex.searchEnergySpent) + missing;
    return missing;
  }

  world.step = wrappedStep;

  const api = {
    getSnapshot() {
      const predatorAttempts = predatorSearchSteps + predatorEncounterSteps;
      const apexAttempts = apexSearchSteps + apexEncounterSteps;
      return {
        version: MODEL_VERSION,
        model: 'finite-local-predator-detection-with-vegetated-prey-refugia',
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
        predatorRefugeMisses,
        apexRefugeMisses,
        predatorEncounterFraction: predatorAttempts ? round(predatorEncounterSteps / predatorAttempts) : 0,
        apexEncounterFraction: apexAttempts ? round(apexEncounterSteps / apexAttempts) : 0,
        coveredPreyDetections,
        searchEnergySpent: round(searchEnergySpent),
        lastEncounter,
        refugeMechanism: 'prey-must-fall-within-local-sensory-range; dense-forage-cover-reduces-detection-range',
        searchCost: 'encounter-searching-pays-the-active-metabolic-cost-hidden-by-the-core-rest-gate',
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
    getSnapshot: () => ({
      version: MODEL_VERSION,
      model: 'finite-local-predator-detection-with-vegetated-prey-refugia',
      disabled: true,
    }),
    destroy() {},
  };
}

if (typeof window !== 'undefined') start();
