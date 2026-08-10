const MODEL_VERSION = 1;
const GUILD_MATURITY = Object.freeze({ grazer: 8, predator: 10, apex: 14 });
const GUILD_BASE_LIFESPAN = Object.freeze({ grazer: 150, predator: 190, apex: 230 });

async function start() {
  try {
    if (window.realitySandboxReady) await window.realitySandboxReady;
    await waitForHybridDynamics();
    const planet = window.realitySandboxPlanet;
    if (!planet?.world?.ecs) return;

    const api = installLifeHistorySelection({ world: planet.world });
    planet.lifeHistorySelection = api;
    planet.world.lifeHistorySelection = api;
    window.realitySandboxLifeHistorySelection = api;
    window.dispatchEvent(new CustomEvent('eidolon-life-history-ready', { detail: api.getSnapshot() }));
    window.addEventListener('pagehide', api.destroy, { once: true });
  } catch (error) {
    console.warn('[life-history-selection] disabled:', error);
  }
}

function waitForHybridDynamics() {
  if (window.realitySandboxHybridDynamics) return Promise.resolve();
  return new Promise(resolve => {
    const timeout = setTimeout(resolve, 3000);
    window.addEventListener('eidolon-hybrid-dynamics-ready', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

export function installLifeHistorySelection({ world }) {
  const previousStep = world.step;
  if (typeof previousStep !== 'function') return emptyApi();

  let deaths = 0;
  let starvationDeaths = 0;
  let senescenceDeaths = 0;
  let diseaseDeaths = 0;
  let juvenileDeaths = 0;
  let recoveries = 0;
  let lastDeath = null;
  let active = true;

  seedLifeHistories();

  function wrappedStep(dt) {
    previousStep.call(world, dt);
    if (!active || !(dt > 0)) return;

    const rows = livingRows(world.ecs.components);
    const dead = [];

    for (const row of rows) {
      const organism = row.organism;
      ensureLifeHistory(organism, row.guild, row.id);

      if (finite(organism.infected) > 0) {
        organism.infected = Math.max(0, finite(organism.infected) - dt);
        if (organism.infected === 0 && !organism._infectionRecoveryCounted) {
          organism._infectionRecoveryCounted = true;
          recoveries += 1;
        }
      } else {
        organism._infectionRecoveryCounted = false;
      }

      const age = Math.max(0, finite(organism.age));
      const lifespan = Math.max(20, finite(organism.expectedLifespan, computeExpectedLifespan(organism, row.guild, row.id)));
      const maturity = GUILD_MATURITY[row.guild] || 10;
      const ageFraction = age / lifespan;
      organism.lifeStage = age < maturity
        ? 'juvenile'
        : ageFraction < 0.72
          ? 'adult'
          : 'senescent';

      const energy = Math.max(0, finite(organism.energy));
      if (energy < 0.14) {
        const deficit = (0.14 - energy) / 0.14;
        const tolerance = 10 + (1.6 - clamp(finite(organism.dna?.metabolism, 1), 0.4, 2.2)) * 5;
        organism.starvationDebt = Math.max(0, finite(organism.starvationDebt) + dt * deficit / Math.max(5, tolerance));
      } else if (energy > 0.28) {
        organism.starvationDebt = Math.max(0, finite(organism.starvationDebt) - dt * 0.055);
      }

      const hazard = mortalityHazard({
        organism,
        guild: row.guild,
        age,
        lifespan,
        maturity,
      });
      organism.mortalityDebt = Math.max(0, finite(organism.mortalityDebt) + hazard.total * dt);

      if (organism.lifeStage === 'senescent' && Number.isFinite(organism.energy)) {
        const senescence = Math.max(0, ageFraction - 0.72) / 0.28;
        organism.energy = Math.max(0, organism.energy - dt * 0.0028 * senescence * clamp(finite(organism.dna?.metabolism, 1), 0.5, 2));
      }

      if (organism.starvationDebt >= 1 || organism.mortalityDebt >= 1) {
        const cause = dominantCause(hazard, organism);
        dead.push({ id: row.id, guild: row.guild, cause, age, lifespan, energy });
      }
    }

    for (const record of dead) {
      if (!world.ecs.entities?.has(record.id)) continue;
      world.ecs.destroyEntity(record.id);
      deaths += 1;
      if (record.cause === 'starvation') starvationDeaths += 1;
      else if (record.cause === 'senescence') senescenceDeaths += 1;
      else if (record.cause === 'disease') diseaseDeaths += 1;
      else if (record.cause === 'juvenile-viability') juvenileDeaths += 1;
      lastDeath = {
        ...record,
        age: round(record.age),
        expectedLifespan: round(record.lifespan),
        energy: round(record.energy),
        tick: world.tick,
      };
    }
  }

  world.step = wrappedStep;

  function seedLifeHistories() {
    for (const row of livingRows(world.ecs.components)) ensureLifeHistory(row.organism, row.guild, row.id);
  }

  function ensureLifeHistory(organism, guild, id) {
    if (!Number.isFinite(organism.expectedLifespan)) {
      organism.expectedLifespan = computeExpectedLifespan(organism, guild, id);
    }
    organism.starvationDebt = Math.max(0, finite(organism.starvationDebt));
    organism.mortalityDebt = Math.max(0, finite(organism.mortalityDebt));
    organism.lifeStage ||= finite(organism.age) < (GUILD_MATURITY[guild] || 10) ? 'juvenile' : 'adult';
  }

  function getSnapshot() {
    const stages = { juvenile: 0, adult: 0, senescent: 0 };
    let meanAgeFraction = 0;
    let n = 0;
    for (const row of livingRows(world.ecs.components)) {
      const organism = row.organism;
      ensureLifeHistory(organism, row.guild, row.id);
      stages[organism.lifeStage] = (stages[organism.lifeStage] || 0) + 1;
      meanAgeFraction += finite(organism.age) / Math.max(1, finite(organism.expectedLifespan, 1));
      n += 1;
    }
    return {
      version: MODEL_VERSION,
      model: 'energy-disease-developmental-senescence-life-history-selection',
      living: n,
      stages,
      meanAgeFraction: n ? round(meanAgeFraction / n) : 0,
      deaths,
      starvationDeaths,
      senescenceDeaths,
      diseaseDeaths,
      juvenileDeaths,
      infectionRecoveries: recoveries,
      lastDeath,
      mortality: 'deterministic-accumulated-hazard',
      populationCap: null,
    };
  }

  function destroy() {
    active = false;
    if (world.step === wrappedStep) world.step = previousStep;
  }

  return { getSnapshot, destroy };
}

export function computeExpectedLifespan(organism, guild, id = 0) {
  const base = GUILD_BASE_LIFESPAN[guild] || 170;
  const metabolism = clamp(finite(organism?.dna?.metabolism, 1), 0.4, 2.2);
  const resistance = clamp(finite(organism?.diseaseResistance, 0.6), 0.05, 0.99);
  const viability = clamp(finite(organism?.developmentalViability, 1), 0.72, 1.04);
  const inherited = 0.92 + hashUnit(`${guild}|${id}|lifespan`) * 0.16;
  return base * (1 / Math.sqrt(metabolism)) * (0.82 + resistance * 0.32) * viability * inherited;
}

export function mortalityHazard({ organism, age, lifespan, maturity }) {
  const energy = Math.max(0, finite(organism?.energy));
  const starvationDebt = Math.max(0, finite(organism?.starvationDebt));
  const infected = finite(organism?.infected) > 0;
  const ageFraction = age / Math.max(1, lifespan);
  const viability = clamp(finite(organism?.developmentalViability, 1), 0.72, 1.04);

  const starvation = energy < 0.08 ? ((0.08 - energy) / 0.08) * 0.018 + starvationDebt * 0.035 : starvationDebt * 0.006;
  const disease = infected ? (0.003 + (1 - clamp(finite(organism?.diseaseResistance, 0.6), 0, 1)) * 0.009) : 0;
  const senescence = ageFraction > 0.72 ? Math.pow((ageFraction - 0.72) / 0.28, 2) * 0.012 : 0;
  const juvenile = age < maturity && viability < 0.94 ? (0.94 - viability) * 0.022 : 0;

  return {
    starvation,
    disease,
    senescence,
    juvenile,
    total: starvation + disease + senescence + juvenile,
  };
}

function dominantCause(hazard, organism) {
  if (finite(organism.starvationDebt) >= 1) return 'starvation';
  const entries = [
    ['starvation', hazard.starvation],
    ['disease', hazard.disease],
    ['senescence', hazard.senescence],
    ['juvenile-viability', hazard.juvenile],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][1] > 0 ? entries[0][0] : 'background';
}

function livingRows(components) {
  const rows = [];
  for (const [id, organism] of components.agent || []) rows.push({ id, organism, guild: 'grazer' });
  for (const [id, organism] of components.predator || []) rows.push({ id, organism, guild: 'predator' });
  for (const [id, organism] of components.apex || []) rows.push({ id, organism, guild: 'apex' });
  return rows;
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
    getSnapshot: () => ({ version: MODEL_VERSION, model: 'energy-disease-developmental-senescence-life-history-selection', disabled: true }),
    destroy() {},
  };
}

if (typeof window !== 'undefined') start();
