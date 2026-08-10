const MODEL_VERSION = 2;
const GRID_COLUMNS = 18;
const GRID_ROWS = 10;
const ENTER_ENERGY = 0.72;
const EXIT_ENERGY = 0.95;
const ENTER_GUT = 0.18;
const EXIT_GUT = 0.44;
const LOCAL_FOOD_FLOOR = 0.12;
const INTERCEPT_FOOD = 0.16;
const MIN_DESTINATION_FOOD = 0.18;
const ARRIVAL_RADIUS = 30;
const RESCAN_TICKS = 75;
const SURVIVAL_ENERGY_RESERVE = 0.16;

async function start() {
  try {
    await waitForSandboxReady();
    await waitForEcologyStack();
    const planet = window.realitySandboxPlanet;
    if (!planet?.world?.ecs || !planet.world.forageField?.sample) {
      throw new Error('Living forage field did not become available.');
    }

    const api = installGrazerFamineMigration(planet.world);
    planet.grazerFamineMigration = api;
    window.realitySandboxGrazerFamineMigration = api;
    window.dispatchEvent(new CustomEvent('eidolon-grazer-famine-migration-ready', {
      detail: api.getSnapshot(),
    }));
    window.addEventListener('pagehide', api.destroy, { once: true });
  } catch (error) {
    console.warn('[grazer-famine-migration] disabled:', error);
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
  if (window.realitySandboxPredatorEncounterEcology && window.realitySandboxGrazerDigestionPhysiology) {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const started = performance.now();
    const poll = () => {
      if (window.realitySandboxPredatorEncounterEcology && window.realitySandboxGrazerDigestionPhysiology) return resolve();
      if (performance.now() - started > 10000) return resolve();
      setTimeout(poll, 25);
    };
    poll();
  });
}

export function installGrazerFamineMigration(world) {
  const previousStep = world.step;
  if (typeof previousStep !== 'function') return emptyApi();
  if (world.__grazerFamineMigrationInstalled) return world.__grazerFamineMigrationInstalled;

  let active = true;
  let patchCache = [];
  let lastPatchScanTick = -Infinity;
  let migrationsStarted = 0;
  let migrationsRetargeted = 0;
  let destinationsReached = 0;
  let opportunisticStops = 0;
  let migrationsRecovered = 0;
  let migrationSteps = 0;
  let strandedSteps = 0;
  let localFeedingDeferrals = 0;
  let unaffordablePatchesRejected = 0;
  let cumulativeDistanceCommitted = 0;
  let peakMigrationDistance = 0;
  let lastMigration = null;

  function wrappedStep(dt) {
    if (!active || !Number.isFinite(dt) || dt <= 0) {
      previousStep.call(world, dt);
      return;
    }

    refreshPatchCache();
    prepareMigrations(dt);
    previousStep.call(world, dt);
    resolveMigrations();
  }

  function refreshPatchCache() {
    if (world.tick - lastPatchScanTick < RESCAN_TICKS && patchCache.length) return;
    lastPatchScanTick = world.tick;
    const field = world.forageField;
    const patches = [];

    for (let row = 0; row < GRID_ROWS; row += 1) {
      for (let column = 0; column < GRID_COLUMNS; column += 1) {
        const x = (column + 0.5) / GRID_COLUMNS * world.width;
        const y = (row + 0.5) / GRID_ROWS * world.height;
        const food = clamp(finite(field.sample(x, y)?.food), 0, 1);
        if (food < MIN_DESTINATION_FOOD) continue;
        patches.push({ x, y, food });
      }
    }

    patches.sort((a, b) => b.food - a.food || a.y - b.y || a.x - b.x);
    patchCache = patches;
  }

  function prepareMigrations(dt) {
    const c = world.ecs.components;
    for (const [id, grazer] of c.agent?.entries?.() || []) {
      const position = c.position?.get(id);
      if (!position) continue;

      const energy = Math.max(0, finite(grazer.energy));
      const gut = Math.max(0, finite(grazer.gutReserve));
      const currentFood = clamp(finite(world.forageField.sample(position.x, position.y)?.food), 0, 1);
      let migration = grazer.famineMigration || null;

      if (migration && (energy >= EXIT_ENERGY || gut >= EXIT_GUT)) {
        grazer.famineMigration = null;
        grazer.famineMigrationRecovered = true;
        migrationsRecovered += 1;
        lastMigration = {
          kind: 'recovered', id, energy: round(energy), gutReserve: round(gut),
          localFood: round(currentFood), tick: world.tick,
        };
        continue;
      }

      if (migration && currentFood >= Math.max(INTERCEPT_FOOD, migration.food * 0.68)) {
        settleToFeed(grazer, position, currentFood);
        grazer.famineMigration = null;
        opportunisticStops += 1;
        lastMigration = {
          kind: 'opportunistic-forage-stop', id, localFood: round(currentFood),
          energy: round(energy), gutReserve: round(gut), tick: world.tick,
        };
        continue;
      }

      const depleted = energy <= ENTER_ENERGY && gut <= ENTER_GUT;
      const famine = depleted && currentFood < LOCAL_FOOD_FLOOR;
      if (!migration && !famine) {
        if (depleted && currentFood >= LOCAL_FOOD_FLOOR) {
          settleToFeed(grazer, position, currentFood);
          localFeedingDeferrals += 1;
        }
        continue;
      }

      if (!migration) {
        migration = chooseDestination(position, grazer, currentFood, null);
        if (!migration) {
          strandedSteps += 1;
          continue;
        }
        grazer.famineMigration = migration;
        migrationsStarted += 1;
        cumulativeDistanceCommitted += migration.initialDistance;
        peakMigrationDistance = Math.max(peakMigrationDistance, migration.initialDistance);
        lastMigration = {
          kind: 'started', id, destinationFood: round(migration.food),
          distance: round(migration.initialDistance), estimatedTravelCost: round(migration.estimatedTravelCost),
          energy: round(energy), localFood: round(currentFood), tick: world.tick,
        };
      }

      const targetFood = clamp(finite(world.forageField.sample(migration.x, migration.y)?.food), 0, 1);
      const distance = euclideanDistance(position, migration);
      if (targetFood < MIN_DESTINATION_FOOD * 0.78 && distance > ARRIVAL_RADIUS) {
        const replacement = chooseDestination(position, grazer, currentFood, migration);
        if (replacement) {
          grazer.famineMigration = replacement;
          migration = replacement;
          migrationsRetargeted += 1;
          cumulativeDistanceCommitted += replacement.initialDistance;
          peakMigrationDistance = Math.max(peakMigrationDistance, replacement.initialDistance);
          lastMigration = {
            kind: 'retargeted', id, destinationFood: round(replacement.food),
            distance: round(replacement.initialDistance), estimatedTravelCost: round(replacement.estimatedTravelCost),
            energy: round(energy), localFood: round(currentFood), tick: world.tick,
          };
        }
      }

      const remaining = euclideanDistance(position, migration);
      if (remaining <= ARRIVAL_RADIUS) {
        grazer.famineMigrationArrived = true;
        grazer.famineMigration = null;
        settleToFeed(grazer, migration, targetFood);
        destinationsReached += 1;
        lastMigration = {
          kind: 'arrived', id, destinationFood: round(targetFood),
          energy: round(energy), gutReserve: round(gut), tick: world.tick,
        };
        continue;
      }

      migrationSteps += 1;
      grazer.famineMigrationArrived = false;
      const dna = grazer.dna || { speed: 1 };
      const speed = Math.max(18, 40 * clamp(finite(dna.speed, 1), 0.6, 1.4));
      const travelSeconds = remaining / speed;
      grazer.forageTarget = { x: migration.x, y: migration.y, food: targetFood, famineRefuge: true };
      grazer.forageClock = Math.max(finite(grazer.forageClock), clamp(travelSeconds + 1.25, 1.5, 18));
      grazer.committedForageQuality = targetFood;
      grazer.committedForageDistance = remaining;
      grazer.famineMigrationDistance = remaining;
      grazer.famineMigrationEnergy = energy;
      grazer.famineMigrationGut = gut;
      grazer.famineMigrationStep = dt;
    }
  }

  function settleToFeed(grazer, position, food) {
    grazer.grazeClock = Math.max(finite(grazer.grazeClock), 1.15);
    grazer.forageTarget = { x: position.x, y: position.y, food, famineRefuge: true };
    grazer.forageClock = Math.max(finite(grazer.forageClock), 1.7);
  }

  function resolveMigrations() {
    const c = world.ecs.components;
    for (const [id, grazer] of c.agent?.entries?.() || []) {
      const migration = grazer.famineMigration;
      if (!migration) continue;
      const position = c.position?.get(id);
      if (!position) continue;
      migration.lastDistance = euclideanDistance(position, migration);
      migration.lastTick = world.tick;
    }
  }

  function chooseDestination(position, grazer, currentFood, previous) {
    if (!patchCache.length) return null;
    const diagonal = Math.hypot(world.width, world.height) || 1;
    const energy = clamp(finite(grazer.energy), 0, 2);
    const dna = grazer.dna || { speed: 1, metabolism: 1 };
    const speed = Math.max(18, 40 * clamp(finite(dna.speed, 1), 0.6, 1.4));
    const drainPerSecond = 0.03 * finite(world.globals?.metabolism, 1) * clamp(finite(dna.metabolism, 1), 0.4, 2.2);
    const spendableEnergy = Math.max(0, energy - SURVIVAL_ENERGY_RESERVE);
    const affordableSeconds = spendableEnergy / Math.max(0.001, drainPerSecond);
    const affordableDistance = speed * affordableSeconds * 0.78;
    const minimumBetterFood = Math.max(MIN_DESTINATION_FOOD, currentFood + 0.055);
    let best = null;
    let bestScore = -Infinity;

    for (const patch of patchCache) {
      if (patch.food < minimumBetterFood) continue;
      if (previous && Math.abs(previous.x - patch.x) < 1 && Math.abs(previous.y - patch.y) < 1) continue;
      const distance = euclideanDistance(position, patch);
      if (distance < ARRIVAL_RADIUS) continue;
      if (distance > affordableDistance) {
        unaffordablePatchesRejected += 1;
        continue;
      }
      const travelSeconds = distance / speed;
      const estimatedTravelCost = travelSeconds * drainPerSecond;
      const distancePenalty = distance / diagonal * 0.95;
      const survivalMargin = Math.max(0, spendableEnergy - estimatedTravelCost);
      const score = patch.food * 1.16 - distancePenalty + survivalMargin * 0.08;
      if (score > bestScore) {
        bestScore = score;
        best = {
          x: patch.x,
          y: patch.y,
          food: patch.food,
          initialDistance: distance,
          estimatedTravelCost,
          startedTick: world.tick,
          lastDistance: distance,
          lastTick: world.tick,
        };
      }
    }
    return best;
  }

  function getSnapshot() {
    const c = world.ecs.components;
    let activeMigrations = 0;
    let meanRemainingDistance = 0;
    let starvingWithoutTarget = 0;
    for (const grazer of c.agent?.values?.() || []) {
      if (grazer.famineMigration) {
        activeMigrations += 1;
        meanRemainingDistance += Math.max(0, finite(grazer.famineMigration.lastDistance));
      } else if (finite(grazer.energy) <= ENTER_ENERGY && finite(grazer.gutReserve) <= ENTER_GUT) {
        starvingWithoutTarget += 1;
      }
    }
    return {
      version: MODEL_VERSION,
      model: 'energy-budgeted-opportunistic-famine-dispersal',
      activeMigrations,
      migrationsStarted,
      migrationsRetargeted,
      destinationsReached,
      opportunisticStops,
      migrationsRecovered,
      migrationSteps,
      strandedSteps,
      localFeedingDeferrals,
      unaffordablePatchesRejected,
      starvingWithoutTarget,
      meanRemainingDistance: activeMigrations ? round(meanRemainingDistance / activeMigrations) : 0,
      meanCommittedDistance: migrationsStarted + migrationsRetargeted
        ? round(cumulativeDistanceCommitted / (migrationsStarted + migrationsRetargeted))
        : 0,
      peakMigrationDistance: round(peakMigrationDistance),
      cachedProductivePatches: patchCache.length,
      entryCondition: `energy<=${ENTER_ENERGY}, gut<=${ENTER_GUT}, localFood<${LOCAL_FOOD_FLOOR}`,
      exitCondition: `energy>=${EXIT_ENERGY}, gut>=${EXIT_GUT}, or adequate forage encountered en route`,
      travelBudget: 'candidate distance must be affordable from current energy above survival reserve',
      energyGrant: 0,
      populationFloor: null,
      populationCap: null,
      lastMigration,
    };
  }

  world.step = wrappedStep;

  const api = { getSnapshot, destroy };

  function destroy() {
    active = false;
    if (world.step === wrappedStep) world.step = previousStep;
  }

  Object.defineProperty(world, '__grazerFamineMigrationInstalled', {
    configurable: true,
    enumerable: false,
    writable: false,
    value: api,
  });
  return api;
}

function euclideanDistance(a, b) {
  return Math.hypot(finite(b.x) - finite(a.x), finite(b.y) - finite(a.y));
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
    getSnapshot: () => ({ version: MODEL_VERSION, model: 'energy-budgeted-opportunistic-famine-dispersal', disabled: true }),
    destroy() {},
  };
}

if (typeof window !== 'undefined') start();
