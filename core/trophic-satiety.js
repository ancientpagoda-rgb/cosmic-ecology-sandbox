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

  const knownPredators = new Set(world.ecs.components.predator?.keys?.() || []);
  const knownApex = new Set(world.ecs.components.apex?.keys?.() || []);
  let active = true;
  let guardedPredatorSteps = 0;
  let guardedApexSteps = 0;
  let predatorHungerSteps = 0;
  let apexHungerSteps = 0;
  let forageTargetLocks = 0;
  let forageTargetsReached = 0;
  let forageTargetsAbandoned = 0;
  let grazingIntakeSteps = 0;
  let digestionSteps = 0;
  let forageIntake = 0;
  let assimilatedEnergy = 0;
  let reproductiveGrazerSteps = 0;
  let peakGutReserve = 0;
  let conservedPredatorBirths = 0;
  let conservedApexBirths = 0;
  let constructorEnergyRemoved = 0;
  let lastConservedBirth = null;

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
    conserveCarnivoreBirthEnergy(c);
    processGrazerDigestion(c, dt);
    rememberCarnivores(c);
  }

  function conserveCarnivoreBirthEnergy(c) {
    conserveGroupBirths(c.predator, knownPredators, 'predator', 1);
    conserveGroupBirths(c.apex, knownApex, 'apex', 0.45 / 0.55);
  }

  function conserveGroupBirths(group, known, guild, childToParentPostSplitRatio) {
    for (const [id, child] of group?.entries?.() || []) {
      if (known.has(id)) continue;
      if (child.parentageMethod !== 'causal-reproduction-event' || child.parentEntityId == null) continue;
      const parent = findOrganism(world.ecs.components, child.parentEntityId);
      if (!parent) continue;

      // The legacy constructors assign predator/apex newborns a full default
      // energy value. The core then only reduces the parent, which manufactures
      // energy at birth. Restore the intended partition of the first parent's
      // post-reproduction energy while preserving independently paid second-
      // parent investment and juvenile-care transfers.
      const firstParentShare = Math.max(0.04, finite(parent.energy) * childToParentPostSplitRatio);
      const secondParentContribution = Math.max(0, finite(child.secondParentInvestment)) * 0.58;
      const careContribution = Math.max(0, finite(child.parentalCareReceived));
      const allowed = firstParentShare + secondParentContribution + careContribution;
      const current = Math.max(0, finite(child.energy));
      const removed = Math.max(0, current - allowed);
      if (removed <= 0.000001) continue;

      child.energy = Math.max(0.04, allowed);
      child.constructorEnergyCorrection = removed;
      child.birthEnergyConserved = true;
      constructorEnergyRemoved += removed;
      if (guild === 'predator') conservedPredatorBirths += 1;
      else conservedApexBirths += 1;
      lastConservedBirth = {
        childId: id,
        parentId: child.parentEntityId,
        guild,
        removed: round(removed),
        resultingEnergy: round(child.energy),
        tick: world.tick,
      };
    }
  }

  function rememberCarnivores(c) {
    knownPredators.clear();
    for (const id of c.predator?.keys?.() || []) knownPredators.add(id);
    knownApex.clear();
    for (const id of c.apex?.keys?.() || []) knownApex.add(id);
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

  function processGrazerDigestion(c, dt) {
    const field = world.forageField;
    if (!field?.sample) return;

    for (const [id, grazer] of c.agent?.entries?.() || []) {
      const position = c.position?.get(id);
      if (!position) continue;

      const metabolism = clamp(finite(grazer.dna?.metabolism, 1), 0.6, 1.6);
      const gutCapacity = clamp(0.82 - (metabolism - 1) * 0.12, 0.68, 0.90);
      let reserve = clamp(finite(grazer.gutReserve), 0, gutCapacity);

      if (finite(grazer.grazeClock) > 0) {
        const food = clamp(finite(field.sample(position.x, position.y)?.food), 0, 1);
        if (food > 0.08 && reserve < gutCapacity) {
          const intakeEfficiency = clamp(1.08 - (metabolism - 1) * 0.08, 0.94, 1.16);
          const requested = dt * food * 1.50 * intakeEfficiency;
          const intake = Math.min(gutCapacity - reserve, requested);
          if (intake > 0) {
            reserve += intake;
            forageIntake += intake;
            grazingIntakeSteps += 1;
            grazer.lastForageQuality = food;
            grazer.totalForageIntake = finite(grazer.totalForageIntake) + intake;
          }
        }
      }

      if (reserve > 0 && finite(grazer.energy) < 2) {
        const assimilationEfficiency = clamp(0.88 - (metabolism - 1) * 0.08, 0.80, 0.94);
        const digestionRate = clamp(0.047 + (metabolism - 1) * 0.004, 0.043, 0.051);
        const maxDigest = dt * digestionRate;
        const energyRoom = Math.max(0, 2 - finite(grazer.energy));
        const digested = Math.min(reserve, maxDigest, energyRoom / Math.max(0.01, assimilationEfficiency));
        if (digested > 0) {
          reserve -= digested;
          const gained = digested * assimilationEfficiency;
          grazer.energy = Math.min(2, finite(grazer.energy) + gained);
          assimilatedEnergy += gained;
          digestionSteps += 1;
          grazer.assimilatedForage = finite(grazer.assimilatedForage) + gained;
        }
      }

      grazer.gutCapacity = gutCapacity;
      grazer.gutReserve = clamp(reserve, 0, gutCapacity);
      grazer.gutFullness = gutCapacity > 0 ? grazer.gutReserve / gutCapacity : 0;
      peakGutReserve = Math.max(peakGutReserve, grazer.gutReserve);

      if (grazer.energy >= finite(world.globals?.reproductionThreshold, 1.6)) {
        reproductiveGrazerSteps += 1;
      }
    }
  }

  world.step = wrappedStep;

  const api = {
    getSnapshot() {
      const c = world.ecs.components;
      let gutReserve = 0;
      let grazersWithFoodStored = 0;
      for (const grazer of c.agent?.values?.() || []) {
        const reserve = Math.max(0, finite(grazer.gutReserve));
        gutReserve += reserve;
        if (reserve > 0.001) grazersWithFoodStored += 1;
      }
      return {
        version: 5,
        model: 'conservative-trophic-reproduction-finite-digestion-and-hunger-driven-predation',
        grazers: c.agent?.size || 0,
        predators: c.predator?.size || 0,
        apex: c.apex?.size || 0,
        hungryPredators: countHungry(c.predator, predatorHungerThreshold),
        hungryApex: countHungry(c.apex, apexHungerThreshold),
        guardedPredatorSteps,
        guardedApexSteps,
        predatorHungerSteps,
        apexHungerSteps,
        conservedPredatorBirths,
        conservedApexBirths,
        constructorEnergyRemoved: round(constructorEnergyRemoved),
        lastConservedBirth,
        forageTargetLocks,
        forageTargetsReached,
        forageTargetsAbandoned,
        grazingIntakeSteps,
        digestionSteps,
        forageIntake: round(forageIntake),
        assimilatedEnergy: round(assimilatedEnergy),
        reproductiveGrazerSteps,
        livingGutReserve: round(gutReserve),
        grazersWithFoodStored,
        peakGutReserve: round(peakGutReserve),
        forageNavigation: 'valuable-targets-persist-until-reached-or-devalued',
        energyPath: 'resource-or-prey-energy-is-conserved-through-feeding-and-reproduction',
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
  // A mature predator must be hungry enough to hunt, but a successful prey
  // capture can create a genuine reproductive surplus. Conservation at birth
  // prevents that surplus from becoming duplicated energy.
  return clamp(1.78 + metabolism * 0.10, 1.82, 1.98);
}

export function apexHungerThreshold(apex) {
  const metabolism = clamp(finite(apex?.dna?.metabolism, 1), 0.5, 1.6);
  // Apex animals wait for a deeper energy deficit before risking another kill;
  // this prevents one predator meal from automatically triggering an apex boom.
  return clamp(1.56 + metabolism * 0.12, 1.62, 1.75);
}

function findOrganism(components, id) {
  if (id == null) return null;
  return components.agent?.get(id) || components.predator?.get(id) || components.apex?.get(id) || null;
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
    getSnapshot: () => ({ version: 5, model: 'conservative-trophic-reproduction-finite-digestion-and-hunger-driven-predation', disabled: true }),
    destroy() {},
  };
}

if (typeof window !== 'undefined') start();
