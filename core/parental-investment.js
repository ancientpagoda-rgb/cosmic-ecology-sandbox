const MODEL_VERSION = 1;
const CARE_RADIUS = 58;
const CARE_ENERGY_FLOOR = 0.42;

async function start() {
  try {
    if (window.realitySandboxReady) await window.realitySandboxReady;
    await waitForLifeHistory();
    const planet = window.realitySandboxPlanet;
    if (!planet?.world?.ecs) return;

    const api = installParentalInvestment({ world: planet.world });
    planet.parentalInvestment = api;
    planet.world.parentalInvestment = api;
    window.realitySandboxParentalInvestment = api;
    window.dispatchEvent(new CustomEvent('eidolon-parental-investment-ready', { detail: api.getSnapshot() }));
    window.addEventListener('pagehide', api.destroy, { once: true });
  } catch (error) {
    console.warn('[parental-investment] disabled:', error);
  }
}

function waitForLifeHistory() {
  if (window.realitySandboxLifeHistorySelection) return Promise.resolve();
  return new Promise(resolve => {
    const timeout = setTimeout(resolve, 3200);
    window.addEventListener('eidolon-life-history-ready', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

export function installParentalInvestment({ world }) {
  const previousStep = world.step;
  if (typeof previousStep !== 'function') return emptyApi();

  const known = new Set(livingRows(world.ecs.components).map(row => row.id));
  let biparentalBirths = 0;
  let secondParentInvestments = 0;
  let underfundedBirths = 0;
  let careTransfers = 0;
  let totalBirthEnergyTransferred = 0;
  let totalCareEnergyTransferred = 0;
  let lastInvestment = null;
  let active = true;

  function wrappedStep(dt) {
    previousStep.call(world, dt);
    if (!active || !(dt > 0)) return;

    const rows = livingRows(world.ecs.components);
    for (const row of rows) {
      if (!known.has(row.id)) processNewborn(row);
    }

    applyParentalCare(rows, dt);

    known.clear();
    for (const row of rows) known.add(row.id);
  }

  world.step = wrappedStep;

  function processNewborn(row) {
    const child = row.organism;
    const parentIds = Array.isArray(child.parentEntityIds) ? child.parentEntityIds.filter(id => id != null) : [];
    if (child.reproductionMode !== 'sexual-recombination' || parentIds.length < 2) return;

    biparentalBirths += 1;
    const secondParent = findOrganism(world.ecs.components, parentIds[1]);
    if (!secondParent || !Number.isFinite(secondParent.energy)) {
      underfundedBirths += 1;
      child.parentalInvestmentQuality = clamp(finite(child.parentalInvestmentQuality, 1) * 0.92, 0.6, 1.08);
      return;
    }

    const investment = investmentAmount(secondParent);
    if (investment <= 0.015) {
      underfundedBirths += 1;
      child.parentalInvestmentQuality = clamp(finite(child.parentalInvestmentQuality, 1) * 0.94, 0.6, 1.08);
      return;
    }

    secondParent.energy = Math.max(0, secondParent.energy - investment);
    secondParent.parentalInvestmentSpent = finite(secondParent.parentalInvestmentSpent) + investment;
    secondParent.offspringInvested = finite(secondParent.offspringInvested) + 1;
    child.energy = Math.max(0.04, finite(child.energy) + investment * 0.58);
    child.parentalInvestmentQuality = clamp(
      finite(child.parentalInvestmentQuality, 1) + investment * 0.16,
      0.6,
      1.08,
    );
    child.secondParentInvestment = investment;

    secondParentInvestments += 1;
    totalBirthEnergyTransferred += investment;
    lastInvestment = {
      kind: 'birth-investment',
      childId: row.id,
      parentId: parentIds[1],
      energy: round(investment),
      tick: world.tick,
    };
  }

  function applyParentalCare(rows, dt) {
    const c = world.ecs.components;
    for (const row of rows) {
      const child = row.organism;
      if (child.lifeStage !== 'juvenile') continue;
      if (finite(child.energy) >= 0.78) continue;
      const childPos = c.position.get(row.id);
      if (!childPos) continue;
      const parentIds = Array.isArray(child.parentEntityIds)
        ? child.parentEntityIds
        : child.parentEntityId == null ? [] : [child.parentEntityId];
      if (!parentIds.length) continue;

      for (const parentId of parentIds) {
        const parent = findOrganism(c, parentId);
        const parentPos = c.position.get(parentId);
        if (!parent || !parentPos || !Number.isFinite(parent.energy)) continue;
        if (sphericalDistance(childPos, parentPos, world.width) > CARE_RADIUS) continue;

        const sociality = clamp(finite(parent.sociality, 0.5), 0, 1);
        const surplus = Math.max(0, parent.energy - 0.72);
        if (surplus <= 0 || sociality < 0.28) continue;

        const need = Math.max(0, 0.82 - child.energy);
        const transfer = Math.min(
          surplus,
          need,
          dt * (0.004 + sociality * 0.018),
        );
        if (transfer <= 0.0001) continue;

        parent.energy -= transfer;
        child.energy += transfer * 0.92;
        parent.parentalCareSpent = finite(parent.parentalCareSpent) + transfer;
        child.parentalCareReceived = finite(child.parentalCareReceived) + transfer * 0.92;
        child.careEvents = finite(child.careEvents) + 1;
        careTransfers += 1;
        totalCareEnergyTransferred += transfer;
        lastInvestment = {
          kind: 'juvenile-care',
          childId: row.id,
          parentId,
          energy: round(transfer),
          tick: world.tick,
        };
      }
    }
  }

  function getSnapshot() {
    let caredJuveniles = 0;
    let investingParents = 0;
    for (const row of livingRows(world.ecs.components)) {
      if (finite(row.organism.parentalCareReceived) > 0) caredJuveniles += 1;
      if (finite(row.organism.parentalInvestmentSpent) + finite(row.organism.parentalCareSpent) > 0) investingParents += 1;
    }
    return {
      version: MODEL_VERSION,
      model: 'biparental-energy-investment-and-social-juvenile-care',
      biparentalBirths,
      secondParentInvestments,
      underfundedBirths,
      careTransfers,
      totalBirthEnergyTransferred: round(totalBirthEnergyTransferred),
      totalCareEnergyTransferred: round(totalCareEnergyTransferred),
      livingCaredJuveniles: caredJuveniles,
      livingInvestingParents: investingParents,
      lastInvestment,
      populationCap: null,
    };
  }

  function destroy() {
    active = false;
    if (world.step === wrappedStep) world.step = previousStep;
  }

  return { getSnapshot, destroy };
}

export function investmentAmount(parent) {
  const metabolism = clamp(finite(parent?.dna?.metabolism, 1), 0.4, 2.2);
  const sociality = clamp(finite(parent?.sociality, 0.5), 0, 1);
  const available = Math.max(0, finite(parent?.energy) - CARE_ENERGY_FLOOR);
  const desired = 0.08 + sociality * 0.10 + Math.max(0, 1.15 - metabolism) * 0.06;
  return Math.min(available, desired);
}

function livingRows(components) {
  const rows = [];
  for (const [id, organism] of components.agent || []) rows.push({ id, organism, guild: 'grazer' });
  for (const [id, organism] of components.predator || []) rows.push({ id, organism, guild: 'predator' });
  for (const [id, organism] of components.apex || []) rows.push({ id, organism, guild: 'apex' });
  return rows;
}

function findOrganism(components, id) {
  if (id == null) return null;
  return components.agent?.get(id) || components.predator?.get(id) || components.apex?.get(id) || null;
}

function sphericalDistance(a, b, width) {
  const raw = Math.abs(a.x - b.x);
  const dx = Math.min(raw, Math.max(0, width - raw));
  return Math.hypot(dx, a.y - b.y);
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
    getSnapshot: () => ({ version: MODEL_VERSION, model: 'biparental-energy-investment-and-social-juvenile-care', disabled: true }),
    destroy() {},
  };
}

if (typeof window !== 'undefined') start();
