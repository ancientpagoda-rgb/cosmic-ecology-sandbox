const MODEL_VERSION = 1;
const PREDATOR_TRIGGER_ENERGY = 0.62;
const PREDATOR_TARGET_ENERGY = 0.88;
const APEX_TRIGGER_ENERGY = 0.82;
const APEX_TARGET_ENERGY = 1.12;
const ASSIMILATION_EFFICIENCY = 0.94;
const MIN_TRANSFER = 0.005;

async function start() {
  try {
    await waitForSandboxReady();
    await waitForEcologyStack();
    const planet = window.realitySandboxPlanet;
    if (!planet?.world?.ecs) throw new Error('Living world did not become available.');

    const api = installCarnivoreReserveMobilization(planet.world);
    planet.carnivoreReserveMobilization = api;
    window.realitySandboxCarnivoreReserveMobilization = api;
    window.dispatchEvent(new CustomEvent('eidolon-carnivore-reserve-mobilization-ready', {
      detail: api.getSnapshot(),
    }));
    window.addEventListener('pagehide', api.destroy, { once: true });
  } catch (error) {
    console.warn('[carnivore-reserve-mobilization] disabled:', error);
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
  if (window.realitySandboxTrophicSatiety && window.realitySandboxPredatorEncounterEcology) {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const started = performance.now();
    const poll = () => {
      if (window.realitySandboxTrophicSatiety && window.realitySandboxPredatorEncounterEcology) return resolve();
      if (performance.now() - started > 10000) return resolve();
      setTimeout(poll, 25);
    };
    poll();
  });
}

export function installCarnivoreReserveMobilization(world) {
  const previousStep = world.step;
  if (typeof previousStep !== 'function') return emptyApi();
  if (world.__carnivoreReserveMobilizationInstalled) return world.__carnivoreReserveMobilizationInstalled;

  let active = true;
  let predatorMobilizationSteps = 0;
  let apexMobilizationSteps = 0;
  let predatorEmergencyEvents = 0;
  let apexEmergencyEvents = 0;
  let reserveConsumed = 0;
  let somaticEnergyRestored = 0;
  let conversionLoss = 0;
  let lastMobilization = null;

  function wrappedStep(dt) {
    if (!active || !Number.isFinite(dt) || dt <= 0) {
      previousStep.call(world, dt);
      return;
    }

    const c = world.ecs.components;
    mobilizeGroup(c.predator, 'predator', PREDATOR_TRIGGER_ENERGY, PREDATOR_TARGET_ENERGY);
    mobilizeGroup(c.apex, 'apex', APEX_TRIGGER_ENERGY, APEX_TARGET_ENERGY);
    previousStep.call(world, dt);
  }

  function mobilizeGroup(group, guild, triggerEnergy, targetEnergy) {
    for (const [id, organism] of group?.entries?.() || []) {
      const reserve = Math.max(0, finite(organism.reproductiveReserve));
      const energy = Math.max(0, finite(organism.energy));
      if (reserve < MIN_TRANSFER || energy >= triggerEnergy) continue;

      const lowSearchActivity = clamp(finite(organism.searchActivityFactor, 1), 0.2, 1) < 0.78;
      const reproductionSuppressed = Boolean(organism.reproductionSuppressedByPreyScarcity);
      const emergency = energy < triggerEnergy * 0.58;
      if (!lowSearchActivity && !reproductionSuppressed && !emergency) continue;

      const energyNeeded = Math.max(0, targetEnergy - energy);
      const reserveNeeded = energyNeeded / ASSIMILATION_EFFICIENCY;
      const transfer = Math.min(reserve, reserveNeeded);
      if (transfer < MIN_TRANSFER) continue;

      const restored = transfer * ASSIMILATION_EFFICIENCY;
      organism.reproductiveReserve = Math.max(0, reserve - transfer);
      organism.energy = energy + restored;
      organism.reserveMobilizedForSurvival = finite(organism.reserveMobilizedForSurvival) + transfer;
      organism.reserveMobilizationEvents = finite(organism.reserveMobilizationEvents) + 1;
      organism.lastReserveMobilizationTick = world.tick;

      reserveConsumed += transfer;
      somaticEnergyRestored += restored;
      conversionLoss += transfer - restored;
      if (guild === 'predator') {
        predatorMobilizationSteps += 1;
        if (emergency) predatorEmergencyEvents += 1;
      } else {
        apexMobilizationSteps += 1;
        if (emergency) apexEmergencyEvents += 1;
      }

      lastMobilization = {
        id,
        guild,
        tick: world.tick,
        trigger: emergency ? 'critical-energy' : reproductionSuppressed ? 'prey-scarcity' : 'low-search-activity',
        reserveConsumed: round(transfer),
        energyRestored: round(restored),
        resultingEnergy: round(organism.energy),
        remainingReserve: round(organism.reproductiveReserve),
      };
    }
  }

  world.step = wrappedStep;

  const api = {
    getSnapshot() {
      const c = world.ecs.components;
      let livingReserve = 0;
      let carnivoresWithReserve = 0;
      for (const group of [c.predator, c.apex]) {
        for (const organism of group?.values?.() || []) {
          const reserve = Math.max(0, finite(organism.reproductiveReserve));
          livingReserve += reserve;
          if (reserve >= MIN_TRANSFER) carnivoresWithReserve += 1;
        }
      }
      return {
        version: MODEL_VERSION,
        model: 'reversible-meal-surplus-allocation-between-reproduction-and-survival',
        predatorMobilizationSteps,
        apexMobilizationSteps,
        predatorEmergencyEvents,
        apexEmergencyEvents,
        reserveConsumed: round(reserveConsumed),
        somaticEnergyRestored: round(somaticEnergyRestored),
        conversionLoss: round(conversionLoss),
        livingReserve: round(livingReserve),
        carnivoresWithReserve,
        assimilationEfficiency: ASSIMILATION_EFFICIENCY,
        lastMobilization,
        conservation: 'stored meal reserve is debited before somatic energy is restored; conversion loss is dissipated',
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

  Object.defineProperty(world, '__carnivoreReserveMobilizationInstalled', {
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
    getSnapshot: () => ({ version: MODEL_VERSION, model: 'reversible-meal-surplus-allocation-between-reproduction-and-survival', disabled: true }),
    destroy() {},
  };
}

if (typeof window !== 'undefined') start();
