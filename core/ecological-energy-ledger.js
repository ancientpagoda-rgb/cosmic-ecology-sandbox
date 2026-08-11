const DEFAULT_COLUMNS = 18;
const DEFAULT_ROWS = 10;
const DEFAULT_CAPACITY_SCALE = 2.4;
const DEFAULT_RECOVERY_RATE = 0.035;
const DEFAULT_ASSIMILATION_EFFICIENCY = 0.45;
const DEFAULT_PREDATOR_TRANSFER_EFFICIENCY = 0.72;
const DEFAULT_APEX_TRANSFER_EFFICIENCY = 0.68;
const EPSILON = 1e-12;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function sumEnergy(map) {
  let total = 0;
  for (const entity of map?.values?.() || []) total += Math.max(0, finite(entity?.energy));
  return total;
}

function snapshotEnergyMap(map) {
  const snapshot = new Map();
  for (const [id, entity] of map?.entries?.() || []) snapshot.set(id, Math.max(0, finite(entity?.energy)));
  return snapshot;
}

export function installEcologicalEnergyLedger({
  world,
  resourceField,
  columns = DEFAULT_COLUMNS,
  rows = DEFAULT_ROWS,
  capacityScale = DEFAULT_CAPACITY_SCALE,
  recoveryRate = DEFAULT_RECOVERY_RATE,
  assimilationEfficiency = DEFAULT_ASSIMILATION_EFFICIENCY,
  predatorTransferEfficiency = DEFAULT_PREDATOR_TRANSFER_EFFICIENCY,
  apexTransferEfficiency = DEFAULT_APEX_TRANSFER_EFFICIENCY,
} = {}) {
  if (!world?.ecs?.components?.agent || !world?.ecs?.components?.position || typeof world.step !== 'function') {
    throw new Error('Ecological energy ledger requires the authoritative Eidolon world.');
  }
  if (!resourceField || typeof resourceField.sample !== 'function') {
    throw new Error('Ecological energy ledger requires the authoritative seasonal resource field.');
  }
  if (!(columns > 0 && rows > 0 && capacityScale > 0 && recoveryRate >= 0 && assimilationEfficiency > 0 && assimilationEfficiency <= 1)) {
    throw new Error('Invalid ecological energy ledger configuration.');
  }
  if (!(predatorTransferEfficiency > 0 && predatorTransferEfficiency <= 1 && apexTransferEfficiency > 0 && apexTransferEfficiency <= 1)) {
    throw new Error('Invalid trophic transfer efficiency.');
  }

  const originalStep = world.step;
  const originalSample = resourceField.sample.bind(resourceField);
  const cells = Array.from({ length: columns * rows }, (_, index) => ({
    index,
    column: index % columns,
    row: Math.floor(index / columns),
    initialized: false,
    stock: 0,
    capacity: 0,
    productivity: 0,
    grazingOut: 0,
    primaryIn: 0,
    seasonalTurnover: 0,
  }));

  let destroyed = false;
  let wrappedStepActive = false;
  let stepCount = 0;
  const totals = {
    primaryProduction: 0,
    grazingWithdrawal: 0,
    assimilatedToGrazers: 0,
    unassimilated: 0,
    deniedAssimilation: 0,
    predatorPreyEnergyAvailable: 0,
    predatorEnergyRetained: 0,
    apexPreyEnergyAvailable: 0,
    apexEnergyRetained: 0,
    trophicRejectedCreation: 0,
    trophicWaste: 0,
    seasonalTurnover: 0,
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

  function refreshCellCapacity(cell) {
    const point = cellCoordinates(cell.index);
    const base = originalSample(point.x, point.y);
    const productivity = clamp(finite(base?.food), 0, 1);
    const nextCapacity = productivity * capacityScale;

    if (!cell.initialized) {
      cell.stock = nextCapacity;
      cell.initialized = true;
    } else if (cell.stock > nextCapacity) {
      const turnover = cell.stock - nextCapacity;
      cell.stock = nextCapacity;
      cell.seasonalTurnover += turnover;
      totals.seasonalTurnover += turnover;
    }

    cell.capacity = nextCapacity;
    cell.productivity = productivity;
    return cell;
  }

  function initializeCells() {
    for (const cell of cells) refreshCellCapacity(cell);
  }

  function replenish(dt) {
    if (!(dt > 0)) return 0;
    let added = 0;
    for (const cell of cells) {
      refreshCellCapacity(cell);
      if (cell.capacity <= 0 || cell.stock >= cell.capacity) continue;
      const growth = Math.min(
        cell.capacity - cell.stock,
        cell.productivity * recoveryRate * dt,
      );
      if (growth <= 0) continue;
      cell.stock += growth;
      cell.primaryIn += growth;
      totals.primaryProduction += growth;
      added += growth;
    }
    return added;
  }

  function availability(cell) {
    if (!cell || cell.capacity <= EPSILON) return 0;
    return clamp(cell.stock / cell.capacity, 0, 1);
  }

  function sample(x, y) {
    const base = originalSample(x, y) || {};
    const cell = locate(x, y);
    const fraction = availability(cell);
    return {
      ...base,
      food: clamp(finite(base.food) * fraction, 0, 1),
      ecologicalEnergy: {
        unit: 'model-ecological-energy',
        stock: cell.stock,
        capacity: cell.capacity,
        availability: fraction,
        productivity: cell.productivity,
        cell: { column: cell.column, row: cell.row },
      },
    };
  }

  function withdraw(x, y, requested) {
    const cell = locate(x, y);
    const amount = Math.max(0, finite(requested));
    const taken = Math.min(cell.stock, amount);
    cell.stock -= taken;
    cell.grazingOut += taken;
    totals.grazingWithdrawal += taken;
    return { requested: amount, taken, cell };
  }

  function snapshotBeforeStep() {
    const { agent, predator, apex, position } = world.ecs.components;
    const grazers = new Map();
    for (const [id, grazer] of agent.entries()) {
      const pos = position.get(id);
      if (!pos) continue;
      grazers.set(id, { energy: Math.max(0, finite(grazer.energy)), x: pos.x, y: pos.y });
    }
    return {
      tick: world.tick,
      grazers,
      predator: snapshotEnergyMap(predator),
      apex: snapshotEnergyMap(apex),
    };
  }

  function reconcileGrazing(before) {
    const { agent, position } = world.ecs.components;
    for (const [id, previous] of before.grazers.entries()) {
      const grazer = agent.get(id);
      const pos = position.get(id);
      if (!grazer || !pos) continue;

      const gain = finite(grazer.energy) - previous.energy;
      if (gain <= EPSILON) continue;

      const requestedWithdrawal = gain / assimilationEfficiency;
      const transfer = withdraw(pos.x, pos.y, requestedWithdrawal);
      const allowedGain = transfer.taken * assimilationEfficiency;
      const deniedGain = Math.max(0, gain - allowedGain);

      if (deniedGain > EPSILON) {
        grazer.energy = Math.max(0, finite(grazer.energy) - deniedGain);
        totals.deniedAssimilation += deniedGain;
      }
      totals.assimilatedToGrazers += allowedGain;
      totals.unassimilated += Math.max(0, transfer.taken - allowedGain);
    }
  }

  function removedEnergy(beforeMap, currentMap) {
    let total = 0;
    for (const [id, energy] of beforeMap.entries()) {
      if (!currentMap?.has?.(id)) total += energy;
    }
    return total;
  }

  function trimExcessEnergy(currentMap, beforeMap, excess) {
    let remaining = Math.max(0, excess);
    if (remaining <= EPSILON || !currentMap) return 0;

    const newIds = [];
    const existingIds = [];
    for (const id of currentMap.keys()) {
      if (beforeMap.has(id)) existingIds.push(id);
      else newIds.push(id);
    }

    let removed = 0;
    for (const id of [...newIds, ...existingIds]) {
      if (remaining <= EPSILON) break;
      const entity = currentMap.get(id);
      if (!entity) continue;
      const energy = Math.max(0, finite(entity.energy));
      const reduction = Math.min(energy, remaining);
      entity.energy = energy - reduction;
      remaining -= reduction;
      removed += reduction;
    }
    return removed;
  }

  function reconcileTrophicLevels(before) {
    const { agent, predator, apex } = world.ecs.components;
    const predatorMap = predator || new Map();
    const apexMap = apex || new Map();

    const grazerEnergyRemoved = removedEnergy(
      new Map([...before.grazers].map(([id, state]) => [id, state.energy])),
      agent,
    );
    const predatorBeforeTotal = [...before.predator.values()].reduce((sum, energy) => sum + energy, 0);
    const predatorAfterTotal = sumEnergy(predatorMap);
    const predatorAvailable = grazerEnergyRemoved * predatorTransferEfficiency;
    const predatorCeiling = predatorBeforeTotal + predatorAvailable;
    const predatorExcess = Math.max(0, predatorAfterTotal - predatorCeiling);
    const predatorRejected = trimExcessEnergy(predatorMap, before.predator, predatorExcess);
    const predatorRetained = Math.max(0, Math.min(predatorAvailable, sumEnergy(predatorMap) - predatorBeforeTotal));

    totals.predatorPreyEnergyAvailable += grazerEnergyRemoved;
    totals.predatorEnergyRetained += predatorRetained;
    totals.trophicRejectedCreation += predatorRejected;
    totals.trophicWaste += Math.max(0, grazerEnergyRemoved - predatorRetained);

    const predatorEnergyRemoved = removedEnergy(before.predator, predatorMap);
    const apexBeforeTotal = [...before.apex.values()].reduce((sum, energy) => sum + energy, 0);
    const apexAfterTotal = sumEnergy(apexMap);
    const apexAvailable = predatorEnergyRemoved * apexTransferEfficiency;
    const apexCeiling = apexBeforeTotal + apexAvailable;
    const apexExcess = Math.max(0, apexAfterTotal - apexCeiling);
    const apexRejected = trimExcessEnergy(apexMap, before.apex, apexExcess);
    const apexRetained = Math.max(0, Math.min(apexAvailable, sumEnergy(apexMap) - apexBeforeTotal));

    totals.apexPreyEnergyAvailable += predatorEnergyRemoved;
    totals.apexEnergyRetained += apexRetained;
    totals.trophicRejectedCreation += apexRejected;
    totals.trophicWaste += Math.max(0, predatorEnergyRemoved - apexRetained);
  }

  function wrappedStep(dt) {
    if (destroyed || wrappedStepActive) return originalStep.call(world, dt);
    wrappedStepActive = true;
    try {
      replenish(dt);
      const before = snapshotBeforeStep();
      const result = originalStep.call(world, dt);
      if (!(world.tick === 0 && before.tick > 0)) {
        reconcileGrazing(before);
        reconcileTrophicLevels(before);
      }
      stepCount += 1;
      return result;
    } finally {
      wrappedStepActive = false;
    }
  }

  function getCell(x, y) {
    const cell = locate(x, y);
    return {
      column: cell.column,
      row: cell.row,
      stock: cell.stock,
      capacity: cell.capacity,
      availability: availability(cell),
      productivity: cell.productivity,
      grazingOut: cell.grazingOut,
      primaryIn: cell.primaryIn,
      seasonalTurnover: cell.seasonalTurnover,
    };
  }

  function snapshot() {
    const totalStock = cells.reduce((sum, cell) => sum + cell.stock, 0);
    const totalCapacity = cells.reduce((sum, cell) => sum + cell.capacity, 0);
    const activeCells = cells.filter(cell => cell.capacity > EPSILON).length;
    return {
      version: 2,
      writable: true,
      unit: 'model-ecological-energy',
      physicalUnitClaim: false,
      scope: 'coarse forage stock <-> individual grazer energy plus trophic anti-creation reconciliation',
      stepCount,
      grid: { columns, rows, activeCells },
      stock: {
        total: totalStock,
        capacity: totalCapacity,
        availability: totalCapacity > EPSILON ? totalStock / totalCapacity : 0,
      },
      flowTotals: { ...totals },
      efficiencies: {
        grazerAssimilation: assimilationEfficiency,
        predatorTransfer: predatorTransferEfficiency,
        apexTransfer: apexTransferEfficiency,
      },
      recoveryRate,
      capacityScale,
    };
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (world.step === wrappedStep) world.step = originalStep;
    if (resourceField.sample === sample) resourceField.sample = originalSample;
  }

  initializeCells();
  resourceField.sample = sample;
  world.step = wrappedStep;

  return {
    version: 2,
    writable: true,
    unit: 'model-ecological-energy',
    sample,
    getCell,
    replenish,
    withdraw,
    snapshot,
    destroy,
  };
}
