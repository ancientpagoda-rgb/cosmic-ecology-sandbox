const DEFAULT_COLUMNS = 18;
const DEFAULT_ROWS = 10;
const DEFAULT_CAPACITY_SCALE = 2.4;
const DEFAULT_RECOVERY_RATE = 0.035;
const DEFAULT_ASSIMILATION_EFFICIENCY = 0.45;
const DEFAULT_PREDATOR_TRANSFER_EFFICIENCY = 0.72;
const DEFAULT_APEX_TRANSFER_EFFICIENCY = 0.68;
const EPSILON = 1e-12;

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

export function installEcologicalEnergyLedger({
  world,
  resourceField,
  transactions = world?.ecologicalTransactions,
  columns = DEFAULT_COLUMNS,
  rows = DEFAULT_ROWS,
  capacityScale = DEFAULT_CAPACITY_SCALE,
  recoveryRate = DEFAULT_RECOVERY_RATE,
  assimilationEfficiency = DEFAULT_ASSIMILATION_EFFICIENCY,
  predatorTransferEfficiency = DEFAULT_PREDATOR_TRANSFER_EFFICIENCY,
  apexTransferEfficiency = DEFAULT_APEX_TRANSFER_EFFICIENCY,
} = {}) {
  if (!world?.ecs?.components?.agent || !world?.ecs?.components?.position) {
    throw new Error('Ecological energy ledger requires the authoritative Eidolon world.');
  }
  if (!resourceField || typeof resourceField.sample !== 'function') {
    throw new Error('Ecological energy ledger requires the authoritative seasonal resource field.');
  }
  if (!transactions?.register || !transactions?.beforeStep || !transactions?.transact) {
    throw new Error('Ecological energy ledger requires the ecological transaction layer.');
  }
  if (!(columns > 0 && rows > 0 && capacityScale > 0 && recoveryRate >= 0 && assimilationEfficiency > 0 && assimilationEfficiency <= 1)) {
    throw new Error('Invalid ecological energy ledger configuration.');
  }
  if (!(predatorTransferEfficiency > 0 && predatorTransferEfficiency <= 1 && apexTransferEfficiency > 0 && apexTransferEfficiency <= 1)) {
    throw new Error('Invalid trophic transfer efficiency.');
  }

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
  const unregister = [];
  let destroyed = false;
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

  function refreshCellCapacity(cell) {
    const point = cellCoordinates(cell.index);
    const base = originalSample(point.x, point.y) || {};
    const productivity = clamp(finite(base.food), 0, 1);
    const nextCapacity = productivity * capacityScale;

    if (!cell.initialized) {
      cell.stock = nextCapacity;
      cell.initialized = true;
    } else if (cell.stock > nextCapacity) {
      const turnover = cell.stock - nextCapacity;
      transactions.transact(transactions.types.DIE, {
        guild: 'vegetation',
        x: point.x,
        y: point.y,
        storedEnergy: turnover,
        cause: 'seasonal-turnover',
      }, {});
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
        physicalUnitClaim: false,
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

  function replenish(dt) {
    if (!(dt > 0)) return 0;
    let added = 0;
    for (const cell of cells) {
      refreshCellCapacity(cell);
      if (cell.capacity <= 0 || cell.stock >= cell.capacity) continue;
      const requested = Math.min(cell.capacity - cell.stock, cell.productivity * recoveryRate * dt);
      if (requested <= EPSILON) continue;
      const point = cellCoordinates(cell.index);
      const uptake = transactions.transact(transactions.types.UPTAKE, {
        x: point.x,
        y: point.y,
        requestedEnergy: requested,
      }, { allowedEnergy: requested });
      const growth = Math.min(requested, Math.max(0, finite(uptake.result.allowedEnergy, requested)));
      if (growth <= EPSILON) continue;
      cell.stock += growth;
      cell.primaryIn += growth;
      totals.primaryProduction += growth;
      added += growth;
    }
    return added;
  }

  unregister.push(transactions.register(transactions.types.GRAZE, event => {
    const requestedGain = Math.max(0, finite(event.payload.requestedGain));
    const requestedWithdrawal = requestedGain / assimilationEfficiency;
    const transfer = withdraw(event.payload.x, event.payload.y, requestedWithdrawal);
    const allowedGain = Math.min(requestedGain, transfer.taken * assimilationEfficiency);
    event.result.allowedGain = Math.min(Math.max(0, finite(event.result.allowedGain, requestedGain)), allowedGain);
    totals.assimilatedToGrazers += event.result.allowedGain;
    totals.unassimilated += Math.max(0, transfer.taken - event.result.allowedGain);
    totals.deniedAssimilation += Math.max(0, requestedGain - event.result.allowedGain);
    event.result.forageWithdrawn = transfer.taken;
    event.result.assimilationEfficiency = assimilationEfficiency;
  }, 100));

  unregister.push(transactions.register(transactions.types.PREDATE, event => {
    const requestedGain = Math.max(0, finite(event.payload.requestedGain));
    const preyEnergy = Math.max(0, finite(event.payload.preyEnergy));
    const isApex = event.payload.consumerGuild === 'apex';
    const efficiency = isApex ? apexTransferEfficiency : predatorTransferEfficiency;
    const available = preyEnergy * efficiency;
    const allowedGain = Math.min(requestedGain, available);
    event.result.allowedGain = Math.min(Math.max(0, finite(event.result.allowedGain, requestedGain)), allowedGain);
    event.result.transferEfficiency = efficiency;
    event.result.preyEnergyAvailable = preyEnergy;
    if (isApex) {
      totals.apexPreyEnergyAvailable += preyEnergy;
      totals.apexEnergyRetained += event.result.allowedGain;
    } else {
      totals.predatorPreyEnergyAvailable += preyEnergy;
      totals.predatorEnergyRetained += event.result.allowedGain;
    }
    totals.trophicRejectedCreation += Math.max(0, requestedGain - event.result.allowedGain);
    totals.trophicWaste += Math.max(0, preyEnergy - event.result.allowedGain);
  }, 100));

  unregister.push(transactions.register(transactions.types.REPRODUCE, event => {
    const transferred = Math.max(0, finite(event.payload.parentEnergyTransferred));
    const requestedChild = Math.max(0, finite(event.payload.childEnergy));
    const allowedChild = Math.min(requestedChild, transferred);
    event.result.childEnergy = Math.min(Math.max(0, finite(event.result.childEnergy, requestedChild)), allowedChild);
    totals.reproductionTransferred += event.result.childEnergy;
    totals.trophicRejectedCreation += Math.max(0, requestedChild - event.result.childEnergy);
  }, 100));

  unregister.push(transactions.beforeStep(({ dt }) => {
    replenish(dt);
    stepCount += 1;
  }, 20));

  initializeCells();
  resourceField.sample = sample;

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
    return {
      version: 3,
      writable: true,
      eventDriven: true,
      populationScanFree: true,
      unit: 'model-ecological-energy',
      physicalUnitClaim: false,
      scope: 'transaction-driven landscape forage <-> grazer <-> predator <-> apex energy accounting',
      stepCount,
      grid: { columns, rows, activeCells: cells.filter(cell => cell.capacity > EPSILON).length },
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
    for (const remove of unregister.splice(0)) remove();
    if (resourceField.sample === sample) resourceField.sample = originalSample;
  }

  return {
    version: 3,
    writable: true,
    eventDriven: true,
    unit: 'model-ecological-energy',
    sample,
    getCell,
    replenish,
    withdraw,
    snapshot,
    destroy,
  };
}
