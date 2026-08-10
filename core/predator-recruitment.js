const MODEL_VERSION = 1;
const MATURITY_AGE = 10;
const CORE_REPRODUCTION_THRESHOLD = 2.8;
const FUNDING_TARGET_ENERGY = 2.86;
const MIN_PREY_PER_PREDATOR = 3.0;
const FULL_FECUNDITY_PREY_RATIO = 5.5;
const SCARCE_PREY_RESERVE_REQUIREMENT = 1.25;
const ABUNDANT_PREY_RESERVE_REQUIREMENT = 0.75;
const RESERVE_TO_SOMATIC_EFFICIENCY = 0.97;
const RECRUITMENT_COOLDOWN = 18;

async function start() {
  try {
    await waitForSandboxReady();
    await waitForEcologyStack();
    const planet = window.realitySandboxPlanet;
    if (!planet?.world?.ecs) throw new Error('Living world did not become available.');

    const api = installPredatorRecruitment(planet.world);
    planet.predatorRecruitment = api;
    window.realitySandboxPredatorRecruitment = api;
    window.dispatchEvent(new CustomEvent('eidolon-predator-recruitment-ready', {
      detail: api.getSnapshot(),
    }));
    window.addEventListener('pagehide', api.destroy, { once: true });
  } catch (error) {
    console.warn('[predator-recruitment] disabled:', error);
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
  if (window.realitySandboxTrophicSatiety && window.realitySandboxCarnivoreReserveMobilization) {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const started = performance.now();
    const poll = () => {
      if (window.realitySandboxTrophicSatiety && window.realitySandboxCarnivoreReserveMobilization) return resolve();
      if (performance.now() - started > 10000) return resolve();
      setTimeout(poll, 25);
    };
    poll();
  });
}

export function installPredatorRecruitment(world) {
  const previousStep = world.step;
  if (typeof previousStep !== 'function') return emptyApi();
  if (world.__predatorRecruitmentInstalled) return world.__predatorRecruitmentInstalled;

  const knownPredators = new Set(world.ecs.components.predator?.keys?.() || []);
  let active = true;
  let eligibleSteps = 0;
  let scarcitySuppressedSteps = 0;
  let reserveSuppressedSteps = 0;
  let cooldownSuppressedSteps = 0;
  let recruitmentFundings = 0;
  let recruitmentBirths = 0;
  let reserveCommitted = 0;
  let somaticEnergyFunded = 0;
  let conversionLoss = 0;
  let lastPreyPerPredator = 0;
  let lastRequiredReserve = SCARCE_PREY_RESERVE_REQUIREMENT;
  let lastRecruitment = null;

  function wrappedStep(dt) {
    if (!active || !Number.isFinite(dt) || dt <= 0) {
      previousStep.call(world, dt);
      return;
    }

    const c = world.ecs.components;
    const grazers = c.agent?.size || 0;
    const predators = c.predator?.size || 0;
    const preyPerPredator = predators > 0 ? grazers / predators : grazers;
    lastPreyPerPredator = preyPerPredator;
    const density = smoothDensityResponse(preyPerPredator, MIN_PREY_PER_PREDATOR, FULL_FECUNDITY_PREY_RATIO);
    const requiredReserve = mix(SCARCE_PREY_RESERVE_REQUIREMENT, ABUNDANT_PREY_RESERVE_REQUIREMENT, density);
    lastRequiredReserve = requiredReserve;

    for (const [id, predator] of c.predator?.entries?.() || []) {
      predator.recruitmentCooldown = Math.max(0, finite(predator.recruitmentCooldown) - dt);
      if (finite(predator.age) <= MATURITY_AGE) continue;
      if (finite(predator.energy) >= CORE_REPRODUCTION_THRESHOLD) continue;

      if (preyPerPredator < MIN_PREY_PER_PREDATOR) {
        scarcitySuppressedSteps += 1;
        predator.recruitmentSuppressedByPreyDensity = true;
        continue;
      }
      predator.recruitmentSuppressedByPreyDensity = false;

      if (finite(predator.recruitmentCooldown) > 0) {
        cooldownSuppressedSteps += 1;
        continue;
      }

      const reserve = Math.max(0, finite(predator.reproductiveReserve));
      if (reserve < requiredReserve) {
        reserveSuppressedSteps += 1;
        continue;
      }

      const energy = Math.max(0, finite(predator.energy));
      const energyNeeded = Math.max(0, FUNDING_TARGET_ENERGY - energy);
      const reserveNeeded = energyNeeded / RESERVE_TO_SOMATIC_EFFICIENCY;
      if (reserve + 1e-9 < Math.max(requiredReserve, reserveNeeded)) {
        reserveSuppressedSteps += 1;
        continue;
      }

      eligibleSteps += 1;
      const transfer = reserveNeeded;
      const restored = transfer * RESERVE_TO_SOMATIC_EFFICIENCY;
      predator.reproductiveReserve = Math.max(0, reserve - transfer);
      predator.energy = energy + restored;
      predator.recruitmentCooldown = RECRUITMENT_COOLDOWN;
      predator.densityFundedRecruitment = true;
      predator.lastRecruitmentFundingTick = world.tick;
      predator.lastRecruitmentPreyRatio = preyPerPredator;
      predator.lastRecruitmentReserveRequirement = requiredReserve;

      recruitmentFundings += 1;
      reserveCommitted += transfer;
      somaticEnergyFunded += restored;
      conversionLoss += transfer - restored;
      lastRecruitment = {
        kind: 'funded',
        predatorId: id,
        tick: world.tick,
        preyPerPredator: round(preyPerPredator),
        requiredReserve: round(requiredReserve),
        reserveCommitted: round(transfer),
        resultingEnergy: round(predator.energy),
      };
    }

    previousStep.call(world, dt);
    countBirths(c);
  }

  function countBirths(c) {
    for (const [id, predator] of c.predator?.entries?.() || []) {
      if (knownPredators.has(id)) continue;
      recruitmentBirths += 1;
      lastRecruitment = {
        kind: 'birth',
        childId: id,
        parentId: predator.parentEntityId ?? null,
        tick: world.tick,
        preyPerPredator: round(lastPreyPerPredator),
      };
    }
    knownPredators.clear();
    for (const id of c.predator?.keys?.() || []) knownPredators.add(id);
  }

  world.step = wrappedStep;

  const api = {
    getSnapshot() {
      const c = world.ecs.components;
      return {
        version: MODEL_VERSION,
        model: 'continuous-prey-density-and-meal-reserve-funded-predator-recruitment',
        grazers: c.agent?.size || 0,
        predators: c.predator?.size || 0,
        preyPerPredator: round(lastPreyPerPredator),
        requiredReserve: round(lastRequiredReserve),
        minimumPreyPerPredator: MIN_PREY_PER_PREDATOR,
        fullFecundityPreyRatio: FULL_FECUNDITY_PREY_RATIO,
        eligibleSteps,
        scarcitySuppressedSteps,
        reserveSuppressedSteps,
        cooldownSuppressedSteps,
        recruitmentFundings,
        recruitmentBirths,
        reserveCommitted: round(reserveCommitted),
        somaticEnergyFunded: round(somaticEnergyFunded),
        conversionLoss: round(conversionLoss),
        lastRecruitment,
        regulation: 'fecundity declines continuously as prey-per-predator approaches the scarcity threshold; no predator count target is imposed',
        conservation: 'recruitment energy is debited from meal-derived reproductive reserve before the core birth split',
        energyGrant: 0,
        populationFloor: null,
        populationCap: null,
      };
    },
    destroy() {
      active = false;
      if (world.step === wrappedStep) world.step = previousStep;
    },
  };

  Object.defineProperty(world, '__predatorRecruitmentInstalled', {
    configurable: true,
    enumerable: false,
    writable: false,
    value: api,
  });
  return api;
}

function smoothDensityResponse(value, low, high) {
  const t = clamp((finite(value) - low) / Math.max(0.001, high - low), 0, 1);
  return t * t * (3 - 2 * t);
}

function mix(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
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
    getSnapshot: () => ({ version: MODEL_VERSION, model: 'continuous-prey-density-and-meal-reserve-funded-predator-recruitment', disabled: true }),
    destroy() {},
  };
}

if (typeof window !== 'undefined') start();
