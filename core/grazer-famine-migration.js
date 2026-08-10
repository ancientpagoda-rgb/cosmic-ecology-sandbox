const MODEL_VERSION = 1;
const GRID_COLUMNS = 18;
const GRID_ROWS = 10;
const ENTER_ENERGY = 0.46;
const EXIT_ENERGY = 0.82;
const ENTER_GUT = 0.16;
const EXIT_GUT = 0.42;
const MIN_DESTINATION_FOOD = 0.18;
const ARRIVAL_RADIUS = 30;
const RESCAN_TICKS = 75;

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
  let migrationsRecovered = 0;
  let migrationSteps = 0;
  let strandedSteps = 0;
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
      let migration = grazer.famineMigration || null;

      if (migration && (energy >= EXIT_ENERGY || gut >= EXIT_GUT)) {
        grazer.famineMigration = null;
        grazer.famineMigrationRecovered = true;
        migrationsRecovered += 1;
        lastMigration = {
          kind: 'recovered',
          id,
          energy: round(energy),
          gutReserve: round(gut),
          tick: world.tick,
        };
        continue;
      }

      const famine = energy <= ENTER_ENERGY && gut <= ENTER_GUT;
      if (!migration && !famine) continue;

      if (!migration) {
        migration = chooseDestination(position, grazer, null);
        if (!migration) {
          strandedSteps += 1;
          continue;
        }
        grazer.famineMigration = migration;
        migrationsStarted += 1;
        cumulativeDistanceCommitted += migration.initialDistance;
        peakMigrationDistance = Math.max(peakMigrationDistance, migration.initialDistance);
        lastMigration = {
          kind: 'started',
          id,
          destinationFood: round(migration.food),
          distance: round(migration.initialDistance),
          energy: round(energy),
          tick: world.tick,
        };
      }

      const targetFood = clamp(finite(world.forageField.sample(migration.x, migration.y)?.food), 0, 1);
      const distance = euclideanDistance(position, migration);
      if (targetFood < MIN_DESTINATION_FOOD * 0.78 && distance > ARRIVAL_RADIUS) {
        const replacement = chooseDestination(position, grazer, migration);
        if (replacement) {
          grazer.famineMigration = replacement;
          migration = replacement;
          migrationsRetargeted += 1;
          cumulativeDistanceCommitted += replacement.initialDistance;
          peakMigrationDistance = Math.max(peakMigrationDistance, replacement.initialDistance);
          lastMigration = {
            kind: 'retargeted',
            id,
            destinationFood: round(replacement.food),
            distance: round(replacement.initialDistance),
            energy: round(energy),
            tick: world.tick,
          };
        }
      }

      const remaining = euclideanDistance(position, migration);
      if (remaining <= ARRIVAL_RADIUS) {
        grazer.famineMigrationArrived = true;
        grazer.famineMigration = null;
        grazer.grazeClock = Math.max(finite(grazer.grazeClock), 1.1);
        grazer.forageTarget = { x: migration.x, y: migration.y, food: targetFood, famineRefuge: true };
        grazer.forageClock = Math.max(finite(grazer.forageClock), 1.6);
        destinationsReached += 1;
        lastMigration = {
          kind: 'arrived',
          id,
          destinationFood: round(targetFood),
          energy: round(energy),
          tick: world.tick,
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

  function chooseDestination(position, grazer, previous) {
    if (!patchCache.length) return null;
    const diagonal = Math.hypot(world.width, world.height) || 1;
    const energy = clamp(finite(grazer.energy), 0, 2);
    const urgency = clamp(1 - energy / Math.max(0.01, ENTER_ENERGY), 0, 1);
    let best = null;
    let bestScore = -Infinity;

    for (const patch of patchCache) {
      if (previous && Math.abs(previous.x - patch.x) < 1 && Math.abs(previous.y - patch.y) < 1) continue;
      const distance = euclideanDistance(position, patch);
      if (distance < ARRIVAL_RADIUS) continue;
      const distancePenalty = distance / diagonal * (0.38 - urgency * 0.16);
      const score = patch.food * 1.45 - distancePenalty;
      if (score > bestScore) {
        bestScore = score;
        best = {
          x: patch.x,
          y: patch.y,
          food: patch.food,
          initialDistance: distance,
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
      model: 'resource-gradient-long-range-famine-migration',
      activeMigrations,
      migrationsStarted,
      migrationsRetargeted,
      destinationsReached,
      migrationsRecovered,
      migrationSteps,
      strandedSteps,
      starvingWithoutTarget,
      meanRemainingDistance: activeMigrations ? round(meanRemainingDistance / activeMigrations) : 0,
      meanCommittedDistance: migrationsStarted + migrationsRetargeted
        ? round(cumulativeDistanceCommitted / (migrationsStarted + migrationsRetargeted))
        : 0,
      peakMigrationDistance: round(peakMigrationDistance),
      cachedProductivePatches: patchCache.length,
      entryCondition: `energy<=${ENTER_ENERGY} and gut<=${ENTER_GUT}`,
      exitCondition: `energy>=${EXIT_ENERGY} or gut>=${EXIT_GUT}`,
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
    getSnapshot: () => ({ version: MODEL_VERSION, model: 'resource-gradient-long-range-famine-migration', disabled: true }),
    destroy() {},
  };
}

if (typeof window !== 'undefined') start();
