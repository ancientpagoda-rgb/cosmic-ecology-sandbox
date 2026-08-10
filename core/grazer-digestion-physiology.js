async function start() {
  try {
    await waitForSandboxReady();
    await waitForTrophicLayer();
    const planet = window.realitySandboxPlanet;
    if (!planet?.world?.ecs) throw new Error('Living world did not become available.');

    const api = installGrazerDigestionPhysiology(planet.world);
    planet.grazerDigestionPhysiology = api;
    window.realitySandboxGrazerDigestionPhysiology = api;
    window.dispatchEvent(new CustomEvent('eidolon-grazer-digestion-physiology-ready', {
      detail: api.getSnapshot(),
    }));
    window.addEventListener('pagehide', api.destroy, { once: true });
  } catch (error) {
    console.warn('[grazer-digestion-physiology] disabled:', error);
  }
}

async function waitForSandboxReady() {
  if (document.readyState === 'loading') {
    await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  }
  const ready = window.realitySandboxReady;
  if (ready && typeof ready.then === 'function') await ready;
}

function waitForTrophicLayer() {
  if (window.realitySandboxTrophicSatiety) return Promise.resolve();
  return new Promise(resolve => {
    const started = performance.now();
    const poll = () => {
      if (window.realitySandboxTrophicSatiety) return resolve();
      if (performance.now() - started > 10000) return resolve();
      setTimeout(poll, 25);
    };
    poll();
  });
}

export function installGrazerDigestionPhysiology(world) {
  const previousStep = world.step;
  if (typeof previousStep !== 'function') return emptyApi();
  if (world.__grazerDigestionPhysiologyInstalled) return world.__grazerDigestionPhysiologyInstalled;

  let active = true;
  let supplementalDigestionSteps = 0;
  let storedForageDigested = 0;
  let supplementalEnergyAssimilated = 0;
  let peakSupplementalRate = 0;
  let rateTotal = 0;
  let rateSamples = 0;

  function wrappedStep(dt) {
    previousStep.call(world, dt);
    if (!active || !Number.isFinite(dt) || dt <= 0) return;

    const c = world.ecs.components;
    for (const grazer of c.agent?.values?.() || []) {
      let reserve = Math.max(0, finite(grazer.gutReserve));
      const capacity = Math.max(0.01, finite(grazer.gutCapacity, 0.8));
      const energy = Math.max(0, finite(grazer.energy));
      if (reserve <= 0.000001 || energy >= 2) continue;

      const metabolism = clamp(finite(grazer.dna?.metabolism, 1), 0.6, 1.6);
      const fullness = clamp(reserve / capacity, 0, 1);
      // The core trophic layer already performs baseline digestion. This is
      // the physiological throughput component: more substrate in the gut
      // produces faster digestion, while metabolism slightly raises turnover.
      const supplementalRate = clamp(
        0.012 + fullness * 0.022 + (metabolism - 1) * 0.004,
        0.010,
        0.036,
      );
      const assimilationEfficiency = clamp(0.88 - (metabolism - 1) * 0.08, 0.80, 0.94);
      const energyRoom = Math.max(0, 2 - energy);
      const digestible = Math.min(
        reserve,
        dt * supplementalRate,
        energyRoom / Math.max(0.01, assimilationEfficiency),
      );
      if (digestible <= 0) continue;

      const gained = digestible * assimilationEfficiency;
      reserve -= digestible;
      grazer.gutReserve = Math.max(0, reserve);
      grazer.gutFullness = clamp(grazer.gutReserve / capacity, 0, 1);
      grazer.energy = Math.min(2, energy + gained);
      grazer.supplementalDigestedForage = finite(grazer.supplementalDigestedForage) + digestible;
      grazer.supplementalAssimilatedEnergy = finite(grazer.supplementalAssimilatedEnergy) + gained;

      supplementalDigestionSteps += 1;
      storedForageDigested += digestible;
      supplementalEnergyAssimilated += gained;
      peakSupplementalRate = Math.max(peakSupplementalRate, supplementalRate);
      rateTotal += supplementalRate;
      rateSamples += 1;
    }
  }

  world.step = wrappedStep;

  const api = {
    getSnapshot() {
      const c = world.ecs.components;
      let livingReserve = 0;
      let fullGuts = 0;
      for (const grazer of c.agent?.values?.() || []) {
        livingReserve += Math.max(0, finite(grazer.gutReserve));
        if (finite(grazer.gutFullness) >= 0.66) fullGuts += 1;
      }
      return {
        version: 1,
        model: 'fullness-dependent-conserved-digestion-throughput',
        grazers: c.agent?.size || 0,
        supplementalDigestionSteps,
        storedForageDigested: round(storedForageDigested),
        supplementalEnergyAssimilated: round(supplementalEnergyAssimilated),
        meanSupplementalRate: rateSamples ? round(rateTotal / rateSamples) : 0,
        peakSupplementalRate: round(peakSupplementalRate),
        livingGutReserve: round(livingReserve),
        fullGuts,
        conservation: 'every supplemental energy gain consumes stored forage',
        populationCap: null,
      };
    },
    destroy() {
      active = false;
      if (world.step === wrappedStep) world.step = previousStep;
    },
  };

  Object.defineProperty(world, '__grazerDigestionPhysiologyInstalled', {
    configurable: true,
    enumerable: false,
    writable: false,
    value: api,
  });
  return api;
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value) {
  return Math.round(finite(value) * 1000) / 1000;
}

function emptyApi() {
  return {
    getSnapshot: () => ({ version: 1, model: 'fullness-dependent-conserved-digestion-throughput', disabled: true }),
    destroy() {},
  };
}

if (typeof window !== 'undefined') start();
