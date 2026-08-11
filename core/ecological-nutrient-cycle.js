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
  transactions = world?.ecologicalTransactions,
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
  if (!transactions?.register || !transactions?.beforeStep || !transactions?.transact) {
    throw new Error('Ecological nutrient cycle requires the ecological transaction layer.');
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
  const unregister = [];
  let destroyed = false;
  let energyLedger = null;
  let vegetationInitialized = false;
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
    reproductionTransferred: 0,
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

  function totalNutrients() {
    return cells.reduce((sum, cell) => sum + cell.soil + cell.vegetation + cell.detritus, 0) + sumMapValues(biota);
  }

  function initializeVegetationFromEnergy() {
    if (vegetationInitialized || !energyLedger?.getCell) return;
    for (const cell of cells) {
      const point = cellCoordinates(cell.index);
      const energyCell = energyLedger.getCell(point.x, point.y);
      const desired = Math.max(0, finite(energyCell.stock)) * nutrientPerForageEnergy;
      const transfer = Math.min(cell.soil, desired);
      cell.soil -= transfer;
      cell.vegetation += transfer;
      totals.initialVegetationNutrients += transfer;
    }
    vegetationInitialized = true;
    baselineTotal = totalNutrients();
  }

  unregister.push(transactions.register(transactions.types.UPTAKE, event => {
    const requestedEnergy = Math.max(0, finite(event.payload.requestedEnergy));
    if (requestedEnergy <= EPSILON) return;
    const cell = locate(event.payload.x, event.payload.y);
    const requestedNutrient = requestedEnergy * nutrientPerForageEnergy;
    const moved = Math.min(cell.soil, requestedNutrient);
    const allowedEnergy = moved / nutrientPerForageEnergy;
    cell.soil -= moved;
    cell.vegetation += moved;
    cell.plantUptake += moved;
    totals.soilToVegetation += moved;
    totals.nutrientLimitedProduction += Math.max(0, requestedEnergy - allowedEnergy);
    event.result.allowedEnergy = Math.min(Math.max(0, finite(event.result.allowedEnergy, requestedEnergy)), allowedEnergy);
    event.result.nutrientTransferred = moved;
  }, 80));

  unregister.push(transactions.register(transactions.types.GRAZE, event => {
    const withdrawnEnergy = Math.max(0, finite(event.result.forageWithdrawn));
    if (withdrawnEnergy <= EPSILON) return;
    const cell = locate(event.payload.x, event.payload.y);
    const moved = Math.min(cell.vegetation, withdrawnEnergy * nutrientPerForageEnergy);
    if (moved <= EPSILON) return;
    const efficiency = clamp(finite(event.result.assimilationEfficiency, 0), 0, 1);
    const assimilated = moved * efficiency;
    const waste = moved - assimilated;
    cell.vegetation -= moved;
    cell.detritus += waste;
    biota.set(event.payload.consumerId, (biota.get(event.payload.consumerId) || 0) + assimilated);
    cell.grazingToBiota += assimilated;
    cell.grazingToDetritus += waste;
    totals.vegetationToBiota += assimilated;
    totals.vegetationToDetritus += waste;
    event.result.nutrientToConsumer = assimilated;
    event.result.nutrientToDetritus = waste;
  }, 50));

  unregister.push(transactions.register(transactions.types.PREDATE, event => {
    const preyAmount = Math.max(0, biota.get(event.payload.preyId) || 0);
    biota.delete(event.payload.preyId);
    if (preyAmount <= EPSILON) return;
    const preyEnergy = Math.max(EPSILON, finite(event.payload.preyEnergy));
    const allowedGain = Math.max(0, finite(event.result.allowedGain));
    const transferEfficiency = clamp(finite(event.result.transferEfficiency, 0), 0, 1);
    const retainedFraction = clamp(Math.min(transferEfficiency, allowedGain / preyEnergy), 0, 1);
    const retained = preyAmount * retainedFraction;
    const waste = preyAmount - retained;
    biota.set(event.payload.consumerId, (biota.get(event.payload.consumerId) || 0) + retained);
    const cell = locate(event.payload.x, event.payload.y);
    cell.detritus += waste;
    totals.biotaToBiota += retained;
    totals.biotaToDetritus += waste;
    event.result.nutrientToConsumer = retained;
    event.result.nutrientToDetritus = waste;
  }, 50));

  unregister.push(transactions.register(transactions.types.REPRODUCE, event => {
    const parentAmount = Math.max(0, biota.get(event.payload.parentId) || 0);
    if (parentAmount <= EPSILON) return;
    const parentEnergyAfter = Math.max(0, finite(event.payload.parentEnergyAfter));
    const childEnergy = Math.max(0, finite(event.result.childEnergy, event.payload.childEnergy));
    const denominator = parentEnergyAfter + childEnergy;
    if (denominator <= EPSILON) return;
    const childShare = clamp(childEnergy / denominator, 0, 1);
    const transferred = parentAmount * childShare;
    biota.set(event.payload.parentId, parentAmount - transferred);
    biota.set(event.payload.childId, (biota.get(event.payload.childId) || 0) + transferred);
    totals.reproductionTransferred += transferred;
    event.result.nutrientToChild = transferred;
  }, 50));

  unregister.push(transactions.register(transactions.types.DIE, event => {
    const cell = locate(event.payload.x, event.payload.y);
    if (event.payload.guild === 'vegetation') {
      const requested = Math.max(0, finite(event.payload.storedEnergy)) * nutrientPerForageEnergy;
      const moved = Math.min(cell.vegetation, requested);
      cell.vegetation -= moved;
      cell.detritus += moved;
      cell.turnoverToDetritus += moved;
      totals.seasonalTurnoverToDetritus += moved;
      event.result.nutrientToDetritus = moved;
      return;
    }
    const amount = Math.max(0, biota.get(event.payload.entityId) || 0);
    biota.delete(event.payload.entityId);
    if (amount <= EPSILON) return;
    cell.detritus += amount;
    totals.biotaToDetritus += amount;
    event.result.nutrientToDetritus = amount;
  }, 50));

  unregister.push(transactions.register(transactions.types.DECOMPOSE, event => {
    const cell = locate(event.payload.x, event.payload.y);
    const requested = Math.max(0, finite(event.payload.requestedNutrient));
    const moved = Math.min(cell.detritus, requested);
    cell.detritus -= moved;
    cell.soil += moved;
    cell.mineralized += moved;
    totals.mineralization += moved;
    event.result.mineralized = moved;
  }, 50));

  function decompose(dt) {
    if (!(dt > 0)) return 0;
    let mineralized = 0;
    for (const cell of cells) {
      if (cell.detritus <= EPSILON) continue;
      refreshEnvironment(cell);
      const thermalFit = clamp(1 - Math.abs(cell.temperature - 0.62) * 1.35, 0.12, 1);
      const environment = clamp(0.18 + cell.moisture * 0.52 + thermalFit * 0.30, 0.08, 1);
      const fraction = 1 - Math.exp(-decompositionRate * environment * dt);
      const requested = Math.min(cell.detritus, cell.detritus * fraction);
      if (requested <= EPSILON) continue;
      const point = cellCoordinates(cell.index);
      const event = transactions.transact(transactions.types.DECOMPOSE, {
        x: point.x,
        y: point.y,
        requestedNutrient: requested,
      }, { mineralized: 0 });
      mineralized += Math.max(0, finite(event.result.mineralized));
    }
    return mineralized;
  }

  unregister.push(transactions.beforeStep(({ dt }) => {
    decompose(dt);
    stepCount += 1;
  }, 40));

  function attachEnergyLedger(ledger) {
    if (!ledger?.getCell || !ledger?.snapshot) throw new Error('Ecological nutrient cycle requires the installed ecological energy ledger.');
    energyLedger = ledger;
    initializeVegetationFromEnergy();
    return api;
  }

  initializeCells();
  seedInitialBiota();
  resourceField.sample = sample;

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
      version: 2,
      writable: true,
      eventDriven: true,
      populationScanFree: true,
      unit: 'model-nutrient',
      physicalUnitClaim: false,
      scope: 'transaction-driven soil minerals <-> vegetation -> mobile biota -> detritus -> soil minerals',
      attachedToEnergyLedger: Boolean(energyLedger),
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
    for (const remove of unregister.splice(0)) remove();
    if (resourceField.sample === sample) resourceField.sample = originalSample;
  }

  const api = {
    version: 2,
    writable: true,
    eventDriven: true,
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
