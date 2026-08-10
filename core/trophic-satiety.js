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
  let grazingAssimilationSteps = 0;
  let assimilatedEnergy = 0;
  let reproductiveGrazerSteps = 0;
  let forageTargetLocks = 0;
  let forageTargetsReached = 0;
  let forageTargetsAbandoned = 0;

  function wrappedStep(dt) {
    if (!active || !Number.isFinite(dt) || dt <= 0) {
      previousStep.call(world, dt);
      return;
    }

    const c = world.ecs.components;
    stabilizeForageTargets(c);

    for (const predator of c.predator?.values?.() || []) {
      const threshold = predatorHungerThreshold(predator);
      predator.hungerThreshold = threshold;
      predator.hungry = finite(predator.energy, 0) <= threshold;
      if (predator.hungry) {
        predatorHungerSteps += 1;
      } else {
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
    assimilateActiveGrazing(c, dt);
  }

  function stabilizeForageTargets(c) {
    const field = world.forageField;
    if (!field?.sample) return;

    for (const [id, grazer] of c.agent?.entries?.() || []) {
      const position = c.position?.get(id);
      const target = grazer.forageTarget;
      if (!position || !target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) continue;

      const dx = wrappedDelta(position.x, target.x, world.width);
      const dy = target.y - position.y;
      const distance = Math.hypot(dx, dy);
      const currentFood = clamp(finite(field.sample(position.x, position.y)?.food), 0, 1);
      const targetFood = clamp(finite(field.sample(target.x, target.y)?.food, target.food), 0, 1);

      if (distance <= 24) {
        forageTargetsReached += 1;
        // Once the animal reaches the patch, stop extending the target timer.
        // The core can graze there and then naturally reconsider its route.
        continue;
      }

      const worthTravelling = targetFood >= 0.10 && targetFood >= currentFood + 0.012;
      if (!worthTravelling) {
        if (finite(grazer.forageClock) > 0.18) {
          grazer.forageClock = 0.18;
          forageTargetsAbandoned += 1;
        }
        continue;
      }

      const speed = Math.max(12, 40 * clamp(finite(grazer.dna?.speed, 1), 0.6, 1.4));
      const travelSeconds = distance / speed;
      const lockSeconds = clamp(travelSeconds * 1.45 + 0.55, 0.9, 5.5);
      if (finite(grazer.forageClock) < lockSeconds) {
        grazer.forageClock = lockSeconds;
        forageTargetLocks += 1;
      }
      grazer.committedForageQuality = targetFood;
      grazer.committedForageDistance = distance;
    }
  }

  function assimilateActiveGrazing(c, dt) {
    const field = world.forageField;
    if (!field?.sample) return;

    for (const [id, grazer] of c.agent?.entries?.() || []) {
      if (finite(grazer.grazeClock) <= 0) continue;
      const position = c.position?.get(id);
      if (!position) continue;
      const availability = field.sample(position.x, position.y);
      const food = clamp(finite(availability?.food), 0, 1);
      if (food <= 0.08) continue;

      const metabolism = clamp(finite(grazer.dna?.metabolism, 1), 0.6, 1.6);
      const efficiency = clamp(1.18 - (metabolism - 1) * 0.22, 0.82, 1.28);
      const richness = Math.pow(food, 1.15);
      const gain = dt * richness * 0.18 * efficiency;
      const before = finite(grazer.energy);
      grazer.energy = Math.min(2, before + gain);
      const realized = Math.max(0, grazer.energy - before);
      if (realized > 0) {
        grazingAssimilationSteps += 1;
        assimilatedEnergy += realized;
        grazer.assimilatedForage = finite(grazer.assimilatedForage) + realized;
        grazer.lastForageQuality = food;
      }
      if (grazer.energy >= finite(world.globals?.reproductionThreshold, 1.6)) {
        reproductiveGrazerSteps += 1;
      }
    }
  }

  world.step = wrappedStep;

  const api = {
    getSnapshot() {
      const c = world.ecs.components;
      return {
        version: 3,
        model: 'persistent-resource-pursuit-assimilation-and-hunger-driven-predation',
        grazers: c.agent?.size || 0,
        predators: c.predator?.size || 0,
        apex: c.apex?.size || 0,
        hungryPredators: countHungry(c.predator, predatorHungerThreshold),
        hungryApex: countHungry(c.apex, apexHungerThreshold),
        guardedPredatorSteps,
        guardedApexSteps,
        predatorHungerSteps,
        apexHungerSteps,
        forageTargetLocks,
        forageTargetsReached,
        forageTargetsAbandoned,
        grazingAssimilationSteps,
        assimilatedEnergy: round(assimilatedEnergy),
        reproductiveGrazerSteps,
        forageNavigation: 'valuable-targets-persist-until-reached-or-devalued',
        assimilation: 'only-while-actively-grazing-scaled-by-local-food-and-metabolism',
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

function wrappedDelta(a, b, width) {
  let delta = b - a;
  if (delta > width / 2) delta -= width;
  if (delta < -width / 2) delta += width;
  return delta;
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
    getSnapshot: () => ({ version: 3, model: 'persistent-resource-pursuit-assimilation-and-hunger-driven-predation', disabled: true }),
    destroy() {},
  };
}

if (typeof window !== 'undefined') start();
