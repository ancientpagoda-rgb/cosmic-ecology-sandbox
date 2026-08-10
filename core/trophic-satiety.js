async function start() {
  try {
    await waitForSandboxReady();
    const planet = window.realitySandboxPlanet;
    if (!planet?.world?.ecs) throw new Error('Living world did not become available.');

    const api = installTrophicSatiety(planet.world);
    planet.trophicSatiety = api;
    window.realitySandboxTrophicSatiety = api;
    window.dispatchEvent(new CustomEvent('eidolon-trophic-satiety-ready', {
      detail: api.getSnapshot(),
    }));
    window.addEventListener('pagehide', api.destroy, { once: true });
  } catch (error) {
    console.warn('[trophic-satiety] disabled:', error);
  }
}

function waitForSandboxReady() {
  const afterDom = document.readyState === 'loading'
    ? new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }))
    : Promise.resolve();
  return afterDom.then(async () => {
    const ready = window.realitySandboxReady;
    if (ready && typeof ready.then === 'function') await ready;
    if (window.realitySandboxPlanet?.world?.ecs) return;
    await new Promise((resolve, reject) => {
      const started = performance.now();
      const poll = () => {
        if (window.realitySandboxPlanet?.world?.ecs) return resolve();
        if (performance.now() - started > 10000) return reject(new Error('Timed out waiting for the living world.'));
        setTimeout(poll, 25);
      };
      poll();
    });
  });
}

export function installTrophicSatiety(world) {
  const previousStep = world.step;
  if (typeof previousStep !== 'function') return emptyApi();
  if (world.__trophicSatietyInstalled) return world.__trophicSatietyInstalled;

  let active = true;
  let guardedPredatorSteps = 0;
  let guardedApexSteps = 0;
  let predatorHungerSteps = 0;
  let apexHungerSteps = 0;

  function wrappedStep(dt) {
    if (!active || !Number.isFinite(dt) || dt <= 0) {
      previousStep.call(world, dt);
      return;
    }

    const c = world.ecs.components;
    for (const predator of c.predator?.values?.() || []) {
      const threshold = predatorHungerThreshold(predator);
      predator.hungerThreshold = threshold;
      predator.hungry = finite(predator.energy, 0) <= threshold;
      if (predator.hungry) {
        predatorHungerSteps += 1;
      } else {
        // Core steering and predation already honor `rest`. Keep a tiny rolling
        // rest token while satiated; metabolism still consumes energy, so the
        // animal eventually becomes hungry and naturally resumes hunting.
        predator.rest = Math.max(finite(predator.rest), Math.max(0.18, dt * 2.5));
        guardedPredatorSteps += 1;
      }
    }

    for (const apex of c.apex?.values?.() || []) {
      const threshold = apexHungerThreshold(apex);
      apex.hungerThreshold = threshold;
      apex.hungry = finite(apex.energy, 0) <= threshold;
      if (apex.hungry) {
        apexHungerSteps += 1;
      } else {
        apex.rest = Math.max(finite(apex.rest), Math.max(0.22, dt * 3));
        guardedApexSteps += 1;
      }
    }

    previousStep.call(world, dt);
  }

  world.step = wrappedStep;

  const api = {
    getSnapshot() {
      const c = world.ecs.components;
      return {
        version: 1,
        model: 'metabolic-hunger-driven-predation',
        predators: c.predator?.size || 0,
        apex: c.apex?.size || 0,
        hungryPredators: countHungry(c.predator, predatorHungerThreshold),
        hungryApex: countHungry(c.apex, apexHungerThreshold),
        guardedPredatorSteps,
        guardedApexSteps,
        predatorHungerSteps,
        apexHungerSteps,
        populationCap: null,
      };
    },
    destroy() {
      active = false;
      if (world.step === wrappedStep) world.step = previousStep;
    },
  };

  Object.defineProperty(world, '__trophicSatietyInstalled', {
    configurable: true,
    enumerable: false,
    writable: false,
    value: api,
  });
  return api;
}

export function predatorHungerThreshold(predator) {
  const metabolism = clamp(finite(predator?.dna?.metabolism, 1), 0.4, 2.2);
  return clamp(1.48 + metabolism * 0.16, 1.54, 1.82);
}

export function apexHungerThreshold(apex) {
  const metabolism = clamp(finite(apex?.dna?.metabolism, 1), 0.5, 1.6);
  return clamp(2.34 + metabolism * 0.20, 2.44, 2.66);
}

function countHungry(group, thresholdFor) {
  let count = 0;
  for (const organism of group?.values?.() || []) {
    if (finite(organism.energy) <= thresholdFor(organism)) count += 1;
  }
  return count;
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function emptyApi() {
  return {
    getSnapshot: () => ({ version: 1, model: 'metabolic-hunger-driven-predation', disabled: true }),
    destroy() {},
  };
}

if (typeof window !== 'undefined') start();
