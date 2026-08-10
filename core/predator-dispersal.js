const MODEL_VERSION = 1;
const GRID_COLUMNS = 12;
const GRID_ROWS = 7;
const PREDATOR_DISPERSAL_DELAY = 2.1;
const MIN_PREY_PER_PREDATOR_FOR_TRACKING = 4.0;
const ARRIVAL_RADIUS = 58;
const TARGET_REFRESH_TICKS = 90;

async function start() {
  try {
    await waitForSandboxReady();
    await waitForEcologyStack();
    const planet = window.realitySandboxPlanet;
    if (!planet?.world?.ecs) throw new Error('Living world did not become available.');

    const api = installPredatorDispersal(planet.world);
    planet.predatorDispersal = api;
    window.realitySandboxPredatorDispersal = api;
    window.dispatchEvent(new CustomEvent('eidolon-predator-dispersal-ready', {
      detail: api.getSnapshot(),
    }));
    window.addEventListener('pagehide', api.destroy, { once: true });
  } catch (error) {
    console.warn('[predator-dispersal] disabled:', error);
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
  if (window.realitySandboxPredatorEncounterEcology && window.realitySandboxPredatorRecruitment) {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    const started = performance.now();
    const poll = () => {
      if (window.realitySandboxPredatorEncounterEcology && window.realitySandboxPredatorRecruitment) return resolve();
      if (performance.now() - started > 10000) return resolve();
      setTimeout(poll, 25);
    };
    poll();
  });
}

export function installPredatorDispersal(world) {
  const previousStep = world.step;
  if (typeof previousStep !== 'function') return emptyApi();
  if (world.__predatorDispersalInstalled) return world.__predatorDispersalInstalled;

  let active = true;
  let dispersalStarts = 0;
  let dispersalSteps = 0;
  let targetRefreshes = 0;
  let targetArrivals = 0;
  let localEncounterCancellations = 0;
  let scarcitySuppressions = 0;
  let noGradientSteps = 0;
  let cumulativeCommittedDistance = 0;
  let peakCommittedDistance = 0;
  let lastPreyPerPredator = 0;
  let lastDispersal = null;

  function wrappedStep(dt) {
    if (!active || !Number.isFinite(dt) || dt <= 0) {
      previousStep.call(world, dt);
      return;
    }

    const c = world.ecs.components;
    const field = buildPreyField(c);
    prepareDispersal(c, field, dt);
    previousStep.call(world, dt);
    applyDispersalVelocity(c, dt);
  }

  function buildPreyField(c) {
    const cells = Array.from({ length: GRID_COLUMNS * GRID_ROWS }, (_, index) => ({
      count: 0,
      column: index % GRID_COLUMNS,
      row: Math.floor(index / GRID_COLUMNS),
    }));

    for (const [id] of c.agent?.entries?.() || []) {
      const position = c.position?.get(id);
      if (!position) continue;
      const column = clamp(Math.floor(position.x / world.width * GRID_COLUMNS), 0, GRID_COLUMNS - 1);
      const row = clamp(Math.floor(position.y / world.height * GRID_ROWS), 0, GRID_ROWS - 1);
      cells[row * GRID_COLUMNS + column].count += 1;
    }
    return cells;
  }

  function prepareDispersal(c, field, dt) {
    const grazers = c.agent?.size || 0;
    const predators = c.predator?.size || 0;
    const preyPerPredator = predators > 0 ? grazers / predators : grazers;
    lastPreyPerPredator = preyPerPredator;

    for (const [id, predator] of c.predator?.entries?.() || []) {
      const position = c.position?.get(id);
      if (!position) continue;

      if (!shouldSeek(predator) || predator.lastEncounterPreyId != null) {
        if (predator.preyGradientTarget) localEncounterCancellations += 1;
        predator.preyGradientTarget = null;
        predator.preyGradientSearchClock = 0;
        continue;
      }

      if (preyPerPredator < MIN_PREY_PER_PREDATOR_FOR_TRACKING) {
        predator.preyGradientTarget = null;
        predator.preyGradientSearchClock = 0;
        scarcitySuppressions += 1;
        continue;
      }

      predator.preyGradientSearchClock = finite(predator.preyGradientSearchClock) + dt;
      if (predator.preyGradientSearchClock < PREDATOR_DISPERSAL_DELAY) continue;

      let target = predator.preyGradientTarget || null;
      const needsRefresh = !target
        || world.tick - finite(target.selectedTick, -Infinity) >= TARGET_REFRESH_TICKS
        || coarseDistance(position, target) <= ARRIVAL_RADIUS;

      if (needsRefresh) {
        if (target && coarseDistance(position, target) <= ARRIVAL_RADIUS) targetArrivals += 1;
        const next = choosePreyGradientTarget(id, position, predator, field);
        if (!next) {
          predator.preyGradientTarget = null;
          noGradientSteps += 1;
          continue;
        }
        if (!target) dispersalStarts += 1;
        else targetRefreshes += 1;
        predator.preyGradientTarget = next;
        target = next;
        cumulativeCommittedDistance += next.initialDistance;
        peakCommittedDistance = Math.max(peakCommittedDistance, next.initialDistance);
        lastDispersal = {
          predatorId: id,
          tick: world.tick,
          preyPerPredator: round(preyPerPredator),
          coarsePreyCount: next.preyCount,
          distance: round(next.initialDistance),
          targetColumn: next.column,
          targetRow: next.row,
        };
      }

      dispersalSteps += 1;
      predator.preyGradientDistance = coarseDistance(position, target);
    }
  }

  function choosePreyGradientTarget(id, position, predator, field) {
    const sense = clamp(finite(predator.dna?.sense, 1), 0.35, 2.1);
    const diagonal = Math.hypot(world.width, world.height) || 1;
    let best = null;
    let bestScore = -Infinity;

    for (const cell of field) {
      if (cell.count <= 0) continue;
      const x = (cell.column + 0.5) / GRID_COLUMNS * world.width;
      const y = (cell.row + 0.5) / GRID_ROWS * world.height;
      const distance = wrappedDistance(position, { x, y });
      if (distance <= ARRIVAL_RADIUS) continue;
      const abundance = Math.log2(1 + cell.count);
      const distancePenalty = distance / diagonal * (0.52 / Math.max(0.7, sense));
      const deterministicBias = hashUnit(`${world.seed || 'eidolon'}|${id}|${cell.column}|${cell.row}`) * 0.025;
      const score = abundance * 0.86 - distancePenalty + deterministicBias;
      if (score <= bestScore) continue;
      bestScore = score;
      best = {
        x,
        y,
        column: cell.column,
        row: cell.row,
        preyCount: cell.count,
        initialDistance: distance,
        selectedTick: world.tick,
      };
    }
    return best;
  }

  function applyDispersalVelocity(c, dt) {
    for (const [id, predator] of c.predator?.entries?.() || []) {
      const target = predator.preyGradientTarget;
      if (!target || predator.lastEncounterPreyId != null || !shouldSeek(predator)) continue;
      const position = c.position?.get(id);
      const velocity = c.velocity?.get(id);
      if (!position || !velocity) continue;

      const dx = wrappedDelta(position.x, target.x, world.width);
      const dy = target.y - position.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= ARRIVAL_RADIUS) continue;

      const dna = predator.dna || { speed: 1, sense: 1 };
      const travelSpeed = 34 * clamp(finite(dna.speed, 1), 0.45, 2);
      const response = 1 - Math.exp(-dt * (2.8 + finite(dna.sense, 1) * 0.8));
      const angle = Math.atan2(dy, dx);
      const targetVx = Math.cos(angle) * travelSpeed;
      const targetVy = Math.sin(angle) * travelSpeed;
      velocity.vx += (targetVx - velocity.vx) * response;
      velocity.vy += (targetVy - velocity.vy) * response;
      predator.preyGradientDistance = distance;
    }
  }

  function getSnapshot() {
    const c = world.ecs.components;
    let activeDispersers = 0;
    let meanRemainingDistance = 0;
    for (const predator of c.predator?.values?.() || []) {
      if (!predator.preyGradientTarget) continue;
      activeDispersers += 1;
      meanRemainingDistance += Math.max(0, finite(predator.preyGradientDistance));
    }
    return {
      version: MODEL_VERSION,
      model: 'coarse-prey-density-gradient-predator-dispersal',
      grid: `${GRID_COLUMNS}x${GRID_ROWS}`,
      activeDispersers,
      dispersalStarts,
      dispersalSteps,
      targetRefreshes,
      targetArrivals,
      localEncounterCancellations,
      scarcitySuppressions,
      noGradientSteps,
      preyPerPredator: round(lastPreyPerPredator),
      meanRemainingDistance: activeDispersers ? round(meanRemainingDistance / activeDispersers) : 0,
      meanCommittedDistance: dispersalStarts + targetRefreshes
        ? round(cumulativeCommittedDistance / (dispersalStarts + targetRefreshes))
        : 0,
      peakCommittedDistance: round(peakCommittedDistance),
      minimumPreyPerPredatorForTracking: MIN_PREY_PER_PREDATOR_FOR_TRACKING,
      mechanism: 'prolonged failed local search can bias travel toward a coarse prey-density cell; exact prey still require local detection and pursuit',
      teleportation: false,
      exactPreyKnowledge: false,
      energyGrant: 0,
      populationFloor: null,
      populationCap: null,
      lastDispersal,
    };
  }

  world.step = wrappedStep;

  const api = { getSnapshot, destroy };

  function destroy() {
    active = false;
    if (world.step === wrappedStep) world.step = previousStep;
  }

  Object.defineProperty(world, '__predatorDispersalInstalled', {
    configurable: true,
    enumerable: false,
    writable: false,
    value: api,
  });
  return api;
}

function shouldSeek(predator) {
  if (predator.hungry === true) return true;
  const threshold = finite(predator.hungerThreshold, NaN);
  return Number.isFinite(threshold) && finite(predator.energy) <= threshold;
}

function coarseDistance(a, b) {
  return Math.hypot(finite(b.x) - finite(a.x), finite(b.y) - finite(a.y));
}

function wrappedDistance(a, b) {
  return Math.hypot(wrappedDelta(a.x, b.x, 1200), finite(b.y) - finite(a.y));
}

function wrappedDelta(a, b, width) {
  let delta = finite(b) - finite(a);
  if (delta > width / 2) delta -= width;
  if (delta < -width / 2) delta += width;
  return delta;
}

function hashUnit(value) {
  let hash = 2166136261;
  const text = String(value ?? '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
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
    getSnapshot: () => ({ version: MODEL_VERSION, model: 'coarse-prey-density-gradient-predator-dispersal', disabled: true }),
    destroy() {},
  };
}

if (typeof window !== 'undefined') start();
