const DEFAULT_COLUMNS = 18;
const DEFAULT_ROWS = 10;
const DEFAULT_SOIL_CAPACITY_SCALE = 2.0;
const DEFAULT_NUTRIENT_PER_FORAGE_ENERGY = 0.08;
const DEFAULT_DECOMPOSITION_RATE = 0.06;
const DEFAULT_MIN_PRODUCTIVITY_FACTOR = 0.28;
const EPSILON = 1e-12;

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

function sumMapValues(map) {
  let total = 0;
  for (const value of map.values()) total += Math.max(0, finite(value));
  return total;
}

export function installEcologicalNutrientCycle({
  world,
  resourceField,
  columns = DEFAULT_COLUMNS,
  rows = DEFAULT_ROWS,
  soilCapacityScale = DEFAULT_SOIL_CAPACITY_SCALE,
  nutrientPerForageEnergy = DEFAULT_NUTRIENT_PER_FORAGE_ENERGY,
  decompositionRate = DEFAULT_DECOMPOSITION_RATE,
  minimumProductivityFactor = DEFAULT_MIN_PRODUCTIVITY_FACTOR,
} = {}) {
  if (!world?.ecs?.components?.position || !world?.ecs?.components?.agent) {
    throw new Error('Ecological nutrient cycle requires the authoritative Eidolon world.');
  }
  if (!resourceField || typeof resourceField.sample !== 'function') {
    throw new Error('Ecological nutrient cycle requires the authoritative seasonal resource field.');
  }
  if (!(columns > 0 && rows > 0 && soilCapacityScale > 0 && nutrientPerForageEnergy > 0 && decompositionRate >= 0)) {
    throw new Error('Invalid ecological nutrient-cycle configuration.');
  }
  if (!(minimumProductivityFactor >= 0 && minimumProductivityFactor <= 1)) {
    throw new Error('Invalid ecological nutrient productivity floor.');
  }

  const originalSample = resourceField.sample.bind(resourceField);
  const cells = Array.from({ length: columns * rows }, (_, index) => ({
    index,
    column: index % columns,
    row: Math.floor(index / columns),
    soil: 0,
    soilCapacity: 0,
    vegetation: 0,
    detritus: 0,
    moisture: 0,
    temperature: 0.5,
    mineralized: 0,
    plantUptake: 0,
    grazingToBiota: 0,
    grazingToDetritus: 0,
    turnoverToDetritus: 0,
  }));
  const biota = new Map();

  let attached = false;
  let destroyed = false;
  let wrappedStepActive = false;
  let originalStep = null;
  let energyLedger = null;
  let baselineTotal = null;
  let stepCount = 0;

  const totals = {
    mineralization: 0,
    soilToVegetation: 0,
    vegetationToBiota: 0,
    vegetationToDetritus: 0,
    biotaToBiota: 0,
    biotaToDetritus: 0,
    seasonalTurnoverToDetritus: 0,
    initialVegetationNutrients: 0,
    initialBiotaNutrients: 0,
    nutrientLimitedProduction: 0,
  };

  function cellCoordinates(index) {
    const cell = cells[index];
    return {
      x: (cell.column + 0.5) / columns * world.width,
      y: (cell.row + 0.5) / rows * world.height,
    };
  }

  function locate(x, y) {
    const wrappedX = ((finite(x) % world.width) + world.width) % world.width;
    const clampedY = clamp(finite(y), 0, Math.max(0, world.height - Number.EPSILON));
    const column = clamp(Math.floor(wrappedX / world.width * columns), 0, columns - 1);
    const row = clamp(Math.floor(clampedY / world.height * rows), 0, rows - 1);
    return cells[row * columns + column];
  }

  function refreshEnvironment(cell) {
    const point = cellCoordinates(cell.index);
    const base = originalSample(point.x, point.y) || {};
    const fertility = clamp(finite(base.fertility, finite(base.food)), 0, 1);
    cell.soilCapacity = Math.max(0.25, 0.45 + fertility * soilCapacityScale);
    cell.moisture = clamp(finite(base.moisture, fertility), 0, 1);
    cell.temperature = clamp(finite(base.temperature, 0.5), 0, 1);
    return base;
  }

  function initializeCells() {
    for (const cell of cells) {
      refreshEnvironment(cell);
      cell.soil = cell.soilCapacity;
    }
  }

  function bodyNutrient(guild, entity) {
    const energy = Math.max(0, finite(entity?.energy));
    const base = guild === 'apex' ? 0.30 : guild === 'predator' ? 0.20 : 0.12;
    return base + energy * 0.035;
  }

  function seedInitialBiota() {
    const groups = [
      ['grazer', world.ecs.components.agent],
      ['predator', world.ecs.components.predator],
      ['apex', world.ecs.components.apex],
    ];
    for (const [guild, collection] of groups) {
      for (const [id, entity] of collection?.entries?.() || []) {
        const amount = bodyNutrient(guild, entity);
        biota.set(id, amount);
        totals.initialBiotaNutrients += amount;
      }
    }
  }

  function nutrientAvailability(cell) {
    if (!cell || cell.soilCapacity <= EPSILON) return 0;
    return clamp(cell.soil / cell.soilCapacity, 0, 1);
  }

  function sample(x, y) {
    const base = originalSample(x, y) || {};
    const cell = locate(x, y);
    refreshEnvironment(cell);
    const availability = nutrientAvailability(cell);
    const productivityFactor = minimumProductivityFactor + (1 - minimumProductivityFactor) * availability;
    return {
      ...base,
      food: clamp(finite(base.food) * productivityFactor, 0, 1),
      fertility: clamp(finite(base.fertility, finite(base.food)) * productivityFactor, 0, 1),
      ecologicalNutrients: {
        unit: 'model-nutrient',
        physicalUnitClaim: false,
        soil: cell.soil,
        soilCapacity: cell.soilCapacity,
        vegetation: cell.vegetation,
        detritus: cell.detritus,
        availability,
        productivityFactor,
        cell: { column: cell.column, row: cell.row },
      },
    };
  }

  function depositDetritus(x, y, amount) {
    const cell = locate(x, y);
    const added = Math.max(0, finite(amount));
    if (added <= EPSILON) return 0;
    cell.detritus += added;
    totals.biotaToDetritus += added;
    return added;
  }

  function decompose(dt) {
    if (!(dt > 0)) return 0;
    let mineralized = 0;
    for (const cell of cells) {
      if (cell.detritus <= EPSILON) continue;
      refreshEnvironment(cell);
      const thermalFit = clamp(1 - Math.abs(cell.temperature - 0.62) * 1.35, 0.12, 1);
      const environment = clamp(0.18 + cell.moisture * 0.52 + thermalFit * 0.30, 0.08, 1);
      const fraction = 1 - Math.exp(-decompositionRate * environment * dt);
      const amount = Math.min(cell.detritus, cell.detritus * fraction);
      if (amount <= EPSILON) continue;
      cell.detritus -= amount;
      cell.soil += amount;
      cell.mineralized += amount;
      totals.mineralization += amount;
      mineralized += amount;
    }
    return mineralized;
  }

  function snapshotEntityGroup(collection) {
    const position = world.ecs.components.position;
    const result = new Map();
    for (const [id, entity] of collection?.entries?.() || []) {
      const pos = position.get(id);
      if (!pos) continue;
      result.set(id, { id, x: pos.x, y: pos.y, energy: Math.max(0, finite(entity?.energy)) });
    }
    return result;
  }

  function snapshotEntities() {
    const { agent, predator, apex } = world.ecs.components;
    return {
      grazer: snapshotEntityGroup(agent),
      predator: snapshotEntityGroup(predator),
      apex: snapshotEntityGroup(apex),
    };
  }

  function currentCollection(guild) {
    if (guild === 'grazer') return world.ecs.components.agent;
    return world.ecs.components[guild];
  }

  function positiveEnergyGains(before, guild) {
    const collection = currentCollection(guild);
    const position = world.ecs.components.position;
    const gains = [];
    for (const [id, entity] of collection?.entries?.() || []) {
      const previous = before.get(id)?.energy || 0;
      const gain = Math.max(0, finite(entity?.energy) - previous);
      if (gain <= EPSILON) continue;
      const pos = position.get(id);
      if (!pos) continue;
      gains.push({ id, gain, x: pos.x, y: pos.y });
    }
    return gains;
  }

  function removedStates(before, guild) {
    const collection = currentCollection(guild);
    const removed = [];
    for (const [id, state] of before.entries()) {
      if (!collection?.has?.(id)) removed.push(state);
    }
    return removed;
  }

  function snapshotEnergyCells() {
    return cells.map(cell => {
      const point = cellCoordinates(cell.index);
      const energyCell = energyLedger.getCell(point.x, point.y);
      return {
        primaryIn: finite(energyCell.primaryIn),
        grazingOut: finite(energyCell.grazingOut),
        seasonalTurnover: finite(energyCell.seasonalTurnover),
        stock: finite(energyCell.stock),
      };
    });
  }

  function initializeVegetationFromEnergy() {
    const energyCells = snapshotEnergyCells();
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      const desired = Math.max(0, energyCells[index].stock) * nutrientPerForageEnergy;
      const transfer = Math.min(cell.soil, desired);
      cell.soil -= transfer;
      cell.vegetation += transfer;
      totals.initialVegetationNutrients += transfer;
    }
  }

  function reconcilePrimaryAndTurnover(beforeCells, afterCells) {
    for (let index = 0; index < cells.length; index += 1) {
      const cell = cells[index];
      const primaryEnergy = Math.max(0, afterCells[index].primaryIn - beforeCells[index].primaryIn);
      if (primaryEnergy > EPSILON) {
        const required = primaryEnergy * nutrientPerForageEnergy;
        const transferred = Math.min(cell.soil, required);
        cell.soil -= transferred;
        cell.vegetation += transferred;
        cell.plantUptake += transferred;
        totals.soilToVegetation += transferred;
        if (transferred + EPSILON < required) {
          totals.nutrientLimitedProduction += (required - transferred) / nutrientPerForageEnergy;
        }
      }

      const turnoverEnergy = Math.max(0, afterCells[index].seasonalTurnover - beforeCells[index].seasonalTurnover);
      if (turnoverEnergy > EPSILON) {
        const requested = turnoverEnergy * nutrientPerForageEnergy;
        const moved = Math.min(cell.vegetation, requested);
        cell.vegetation -= moved;
        cell.detritus += moved;
        cell.turnoverToDetritus += moved;
        totals.seasonalTurnoverToDetritus += moved;
      }
    }
  }

  function allocateToConsumers(consumers, amount) {
    const totalGain = consumers.reduce((sum, consumer) => sum + consumer.gain, 0);
    if (amount <= EPSILON || totalGain <= EPSILON) return 0;
    let allocated = 0;
    for (let index = 0; index < consumers.length; index += 1) {
      const consumer = consumers[index];
      const share = index === consumers.length - 1 ? amount - allocated : amount * (consumer.gain / totalGain);
      if (share <= EPSILON) continue;
      biota.set(consumer.id, (biota.get(consumer.id) || 0) + share);
      allocated += share;
    }
    return allocated;
  }

  function reconcileGrazing(beforeEntities, beforeCells, afterCells, assimilationEfficiency) {
    const gains = positiveEnergyGains(beforeEntities.grazer, 'grazer');
    const gainsByCell = new Map();
    for (const gain of gains) {
      const cell = locate(gain.x, gain.y);
      const list = gainsByCell.get(cell.index) || [];
      list.push(gain);
      gainsByCell.set(cell.index, list);
    }

    for (let index = 0; index < cells.length; index += 1) {
      const grazingEnergy = Math.max(0, afterCells[index].grazingOut - beforeCells[index].grazingOut);
      if (grazingEnergy <= EPSILON) continue;
      const cell = cells[index];
      const moved = Math.min(cell.vegetation, grazingEnergy * nutrientPerForageEnergy);
      if (moved <= EPSILON) continue;
      cell.vegetation -= moved;

      const consumers = gainsByCell.get(index) || [];
      const assimilable = consumers.length ? moved * clamp(assimilationEfficiency, 0, 1) : 0;
      const assimilated = allocateToConsumers(consumers, assimilable);
      const waste = moved - assimilated;
      cell.detritus += waste;
      cell.grazingToBiota += assimilated;
      cell.grazingToDetritus += waste;
      totals.vegetationToBiota += assimilated;
      totals.vegetationToDetritus += waste;
    }
  }

  function transferRemoved(preyStates, consumers, efficiency) {
    if (!preyStates.length) return;
    let totalNutrient = 0;
    const preyNutrients = [];
    for (const prey of preyStates) {
      const amount = Math.max(0, biota.get(prey.id) || 0);
      biota.delete(prey.id);
      totalNutrient += amount;
      preyNutrients.push({ prey, amount });
    }
    if (totalNutrient <= EPSILON) return;

    const retainedTarget = totalNutrient * clamp(finite(efficiency), 0, 1);
    const retained = allocateToConsumers(consumers, retainedTarget);
    const retainedFraction = totalNutrient > EPSILON ? retained / totalNutrient : 0;
    totals.biotaToBiota += retained;

    for (const { prey, amount } of preyNutrients) {
      const waste = amount * (1 - retainedFraction);
      if (waste <= EPSILON) continue;
      const cell = locate(prey.x, prey.y);
      cell.detritus += waste;
      totals.biotaToDetritus += waste;
    }
  }

  function releaseRemoved(preyStates) {
    for (const prey of preyStates) {
      const amount = Math.max(0, biota.get(prey.id) || 0);
      biota.delete(prey.id);
      if (amount <= EPSILON) continue;
      const cell = locate(prey.x, prey.y);
      cell.detritus += amount;
      totals.biotaToDetritus += amount;
    }
  }

  function reconcileTrophicFlows(beforeEntities, efficiencies) {
    transferRemoved(
      removedStates(beforeEntities.grazer, 'grazer'),
      positiveEnergyGains(beforeEntities.predator, 'predator'),
      efficiencies.predatorTransfer,
    );
    transferRemoved(
      removedStates(beforeEntities.predator, 'predator'),
      positiveEnergyGains(beforeEntities.apex, 'apex'),
      efficiencies.apexTransfer,
    );
    releaseRemoved(removedStates(beforeEntities.apex, 'apex'));
  }

  function reconcileAfterStep(beforeEntities, beforeCells) {
    const afterCells = snapshotEnergyCells();
    const energySnapshot = energyLedger.snapshot();
    const efficiencies = energySnapshot.efficiencies || {};
    reconcilePrimaryAndTurnover(beforeCells, afterCells);
    reconcileGrazing(beforeEntities, beforeCells, afterCells, efficiencies.grazerAssimilation);
    reconcileTrophicFlows(beforeEntities, efficiencies);
  }

  function wrappedStep(dt) {
    if (destroyed || wrappedStepActive) return originalStep.call(world, dt);
    wrappedStepActive = true;
    try {
      const beforeEntities = snapshotEntities();
      const beforeCells = snapshotEnergyCells();
      decompose(dt);
      const result = originalStep.call(world, dt);
      reconcileAfterStep(beforeEntities, beforeCells);
      stepCount += 1;
      return result;
    } finally {
      wrappedStepActive = false;
    }
  }

  function attachEnergyLedger(ledger) {
    if (attached) return api;
    if (!ledger?.getCell || !ledger?.snapshot || typeof world.step !== 'function') {
      throw new Error('Ecological nutrient cycle requires the installed ecological energy ledger.');
    }
    energyLedger = ledger;
    originalStep = world.step;
    initializeVegetationFromEnergy();
    baselineTotal = totalNutrients();
    world.step = wrappedStep;
    attached = true;
    return api;
  }

  function totalNutrients() {
    return cells.reduce((sum, cell) => sum + cell.soil + cell.vegetation + cell.detritus, 0) + sumMapValues(biota);
  }

  function getCell(x, y) {
    const cell = locate(x, y);
    return {
      column: cell.column,
      row: cell.row,
      soil: cell.soil,
      soilCapacity: cell.soilCapacity,
      soilAvailability: nutrientAvailability(cell),
      vegetation: cell.vegetation,
      detritus: cell.detritus,
      mineralized: cell.mineralized,
      plantUptake: cell.plantUptake,
      grazingToBiota: cell.grazingToBiota,
      grazingToDetritus: cell.grazingToDetritus,
      turnoverToDetritus: cell.turnoverToDetritus,
    };
  }

  function snapshot() {
    const soil = cells.reduce((sum, cell) => sum + cell.soil, 0);
    const vegetation = cells.reduce((sum, cell) => sum + cell.vegetation, 0);
    const detritus = cells.reduce((sum, cell) => sum + cell.detritus, 0);
    const mobileBiota = sumMapValues(biota);
    const total = soil + vegetation + detritus + mobileBiota;
    return {
      version: 1,
      writable: true,
      unit: 'model-nutrient',
      physicalUnitClaim: false,
      scope: 'soil minerals <-> vegetation nutrients -> mobile biota -> detritus -> soil minerals',
      attachedToEnergyLedger: attached,
      stepCount,
      grid: { columns, rows, activeCells: cells.filter(cell => cell.soilCapacity > EPSILON).length },
      reservoirs: { soil, vegetation, mobileBiota, detritus, total },
      conservation: { baseline: baselineTotal, drift: baselineTotal == null ? 0 : total - baselineTotal },
      flowTotals: { ...totals },
      parameters: { soilCapacityScale, nutrientPerForageEnergy, decompositionRate, minimumProductivityFactor },
    };
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (attached && world.step === wrappedStep) world.step = originalStep;
    if (resourceField.sample === sample) resourceField.sample = originalSample;
  }

  initializeCells();
  seedInitialBiota();
  resourceField.sample = sample;

  const api = {
    version: 1,
    writable: true,
    unit: 'model-nutrient',
    sample,
    getCell,
    snapshot,
    decompose,
    depositDetritus,
    attachEnergyLedger,
    destroy,
  };
  return api;
}
