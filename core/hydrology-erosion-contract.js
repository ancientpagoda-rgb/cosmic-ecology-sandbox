import { getHydrology } from './hydrology.js';
import { samplePlanet } from './planet.js';
import { REALITY_TRANSACTION_TYPES } from './ecological-transactions.js';

const DEFAULT_COLUMNS = 60;
const DEFAULT_ROWS = 30;
const DEFAULT_UPDATE_INTERVAL = 0.48;
const DEFAULT_EROSION_RATE = 0.035;
const DEFAULT_TRANSPORT_RATE = 0.42;
const DEFAULT_DEPOSITION_RATE = 0.16;
const EPSILON = 1e-12;

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

export function installHydrologyErosionContract({
  world,
  waterCycle,
  transactions = world?.realityTransactions || world?.ecologicalTransactions,
  columns = DEFAULT_COLUMNS,
  rows = DEFAULT_ROWS,
  updateInterval = DEFAULT_UPDATE_INTERVAL,
  erosionRate = DEFAULT_EROSION_RATE,
  transportRate = DEFAULT_TRANSPORT_RATE,
  depositionRate = DEFAULT_DEPOSITION_RATE,
} = {}) {
  if (!world?.width || !world?.height) throw new Error('Hydrology contract requires the authoritative Eidolon world.');
  if (!waterCycle?.sample || typeof waterCycle.step !== 'function') throw new Error('Hydrology contract requires the authoritative water cycle.');
  if (!transactions?.transact || !transactions?.types) throw new Error('Hydrology contract requires the shared reality transaction bus.');
  if (!(columns > 0 && rows > 0 && updateInterval > 0 && erosionRate >= 0 && transportRate >= 0 && depositionRate >= 0)) {
    throw new Error('Invalid hydrology erosion contract configuration.');
  }

  const hydro = getHydrology();
  const originalSample = waterCycle.sample.bind(waterCycle);
  const originalStep = waterCycle.step.bind(waterCycle);
  const cells = Array.from({ length: columns * rows }, (_, index) => ({
    index,
    column: index % columns,
    row: Math.floor(index / columns),
    land: false,
    elevation: 0,
    baseErosion: 0,
    downstream: -1,
    erodible: 0,
    suspended: 0,
    deposited: 0,
    erosionActivity: 0,
    depositionActivity: 0,
    lastRain: 0,
    lastRunoff: 0,
    lastSurface: 0,
    lastSoil: 0,
  }));

  let destroyed = false;
  let contractClock = 0;
  let macroSteps = 0;
  let sedimentBaseline = 0;
  let lastFlux = emptyFlux();
  const totals = emptyFlux();

  function emptyFlux() {
    return {
      precipitation: 0,
      evaporationEstimate: 0,
      waterFlow: 0,
      sedimentEroded: 0,
      sedimentTransported: 0,
      sedimentDeposited: 0,
    };
  }

  function cellPoint(cell) {
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

  function hydroIndexAtPoint(point) {
    const hx = ((Math.floor(point.x / world.width * hydro.width) % hydro.width) + hydro.width) % hydro.width;
    const hy = clamp(Math.floor(point.y / world.height * hydro.height), 0, hydro.height - 1);
    return hy * hydro.width + hx;
  }

  function coarseCellForHydroIndex(index) {
    const hx = index % hydro.width;
    const hy = Math.floor(index / hydro.width);
    const x = (hx + 0.5) / hydro.width * world.width;
    const y = (hy + 0.5) / hydro.height * world.height;
    return locate(x, y).index;
  }

  function findCoarseDownstream(cell, hydroIndex) {
    let cursor = hydroIndex;
    for (let hops = 0; hops < 24; hops += 1) {
      const next = hydro.downstream[cursor];
      if (next < 0) return -1;
      const coarse = coarseCellForHydroIndex(next);
      if (coarse !== cell.index) return coarse;
      cursor = next;
    }
    return -1;
  }

  function initialize() {
    for (const cell of cells) {
      const point = cellPoint(cell);
      const planet = samplePlanet(point.x, point.y, world.width, world.height);
      const hi = hydroIndexAtPoint(point);
      cell.land = Boolean(planet.land);
      cell.elevation = clamp(finite(planet.elevation), 0, 1);
      cell.baseErosion = clamp(finite(hydro.erosion[hi]), 0, 1);
      cell.downstream = cell.land ? findCoarseDownstream(cell, hi) : -1;
      cell.erodible = cell.land ? 0.45 + cell.elevation * 1.55 : 0;
      cell.deposited = cell.land ? clamp(finite(hydro.delta[hi]) * 0.16 + finite(hydro.lake[hi]) * 0.05, 0, 0.2) : 0;
      const water = originalSample(point.x, point.y) || {};
      cell.lastRain = Math.max(0, finite(water.rain));
      cell.lastRunoff = Math.max(0, finite(water.runoff));
      cell.lastSurface = Math.max(0, finite(water.surface));
      cell.lastSoil = Math.max(0, finite(water.soil));
    }
    sedimentBaseline = totalSediment();
  }

  function totalSediment() {
    let total = 0;
    for (const cell of cells) total += cell.erodible + cell.suspended + cell.deposited;
    return total;
  }

  function publish(type, payload, result = {}) {
    transactions.transact(type, {
      domain: 'hydrology',
      source: 'planet.water-cycle',
      ...payload,
    }, result);
  }

  function updateFluxTotals(flux) {
    for (const key of Object.keys(totals)) totals[key] += flux[key] || 0;
    lastFlux = { ...flux };
  }

  function advance(dt) {
    if (!(dt > 0)) return lastFlux;
    const flux = emptyFlux();
    const sampled = new Array(cells.length);

    for (const cell of cells) {
      cell.erosionActivity = 0;
      cell.depositionActivity = 0;
      const point = cellPoint(cell);
      const water = originalSample(point.x, point.y) || {};
      sampled[cell.index] = water;

      const rain = Math.max(0, finite(water.rain));
      const runoff = Math.max(0, finite(water.runoff));
      const surface = Math.max(0, finite(water.surface));
      const soil = Math.max(0, finite(water.soil));
      const temperature = clamp(finite(samplePlanet(point.x, point.y, world.width, world.height).temperature, 0.5), 0, 1);

      flux.precipitation += rain * dt;
      flux.waterFlow += runoff * dt;
      // The underlying semi-Lagrangian water solver is intentionally an open
      // reduced-order model, so evaporation here is a diagnostic flux estimate,
      // not a claim of closed global water-mass conservation.
      flux.evaporationEstimate += (surface * (0.004 + temperature * 0.01) + soil * temperature * 0.0008) * dt;

      if (cell.land && cell.erodible > EPSILON) {
        const transportPower = runoff * (0.25 + cell.baseErosion * 0.75) + Math.max(0, finite(water.flood)) * 0.18;
        const eroded = Math.min(cell.erodible, transportPower * erosionRate * dt);
        if (eroded > EPSILON) {
          cell.erodible -= eroded;
          cell.suspended += eroded;
          cell.erosionActivity += eroded;
          flux.sedimentEroded += eroded;
        }
      }

      cell.lastRain = rain;
      cell.lastRunoff = runoff;
      cell.lastSurface = surface;
      cell.lastSoil = soil;
    }

    // Move suspended material through the same deterministic downhill network
    // that underlies the visible rivers. Movement is spatial only: it does not
    // create or destroy sediment matter.
    const incoming = new Float64Array(cells.length);
    for (const cell of cells) {
      if (cell.suspended <= EPSILON || cell.downstream < 0) continue;
      const water = sampled[cell.index] || {};
      const runoff = Math.max(0, finite(water.runoff));
      const fraction = clamp((0.08 + runoff * transportRate) * dt, 0, 0.78);
      const moved = cell.suspended * fraction;
      if (moved <= EPSILON) continue;
      cell.suspended -= moved;
      incoming[cell.downstream] += moved;
      flux.sedimentTransported += moved;
    }
    for (let index = 0; index < cells.length; index += 1) cells[index].suspended += incoming[index];

    // Slow water, lakes, deltas, and terminal basins preferentially deposit
    // suspended material. Deposition becomes a spatial fertility signal but the
    // sediment total remains conserved across erodible/suspended/deposited pools.
    for (const cell of cells) {
      if (cell.suspended <= EPSILON) continue;
      const water = sampled[cell.index] || {};
      const runoff = Math.max(0, finite(water.runoff));
      const river = clamp(finite(water.river), 0, 1);
      const lake = clamp(finite(water.lake), 0, 1);
      const delta = clamp(finite(water.delta), 0, 1);
      const terminal = cell.downstream < 0 ? 1 : 0;
      const settling = clamp(0.05 + terminal * 0.32 + lake * 0.28 + delta * 0.38 + Math.max(0, 0.18 - runoff) * 0.35 - river * 0.04, 0.02, 0.82);
      const deposited = cell.suspended * clamp(depositionRate * settling * dt, 0, 0.8);
      if (deposited <= EPSILON) continue;
      cell.suspended -= deposited;
      cell.deposited += deposited;
      cell.depositionActivity += deposited;
      flux.sedimentDeposited += deposited;
    }

    updateFluxTotals(flux);
    macroSteps += 1;

    publish(REALITY_TRANSACTION_TYPES.PRECIPITATE, {
      amount: flux.precipitation,
      unit: 'model-water-flux',
      physicalUnitClaim: false,
      cells: cells.length,
    });
    publish(REALITY_TRANSACTION_TYPES.FLOW, {
      waterAmount: flux.waterFlow,
      sedimentAmount: flux.sedimentTransported,
      waterUnit: 'model-water-flux',
      sedimentUnit: 'model-sediment',
      physicalUnitClaim: false,
    });
    publish(REALITY_TRANSACTION_TYPES.ERODE, {
      amount: flux.sedimentEroded,
      unit: 'model-sediment',
      physicalUnitClaim: false,
    });
    publish(REALITY_TRANSACTION_TYPES.DEPOSIT, {
      amount: flux.sedimentDeposited,
      unit: 'model-sediment',
      physicalUnitClaim: false,
    });
    publish(REALITY_TRANSACTION_TYPES.EVAPORATE, {
      amount: flux.evaporationEstimate,
      unit: 'model-water-flux',
      physicalUnitClaim: false,
      conservationClaim: false,
    });

    return flux;
  }

  function sample(x, y) {
    const base = originalSample(x, y) || {};
    const cell = locate(x, y);
    const sedimentCapacity = Math.max(EPSILON, cell.erodible + cell.suspended + cell.deposited);
    const depositedFraction = clamp(cell.deposited / sedimentCapacity, 0, 1);
    return {
      ...base,
      erosion: clamp(finite(base.erosion, cell.baseErosion) + cell.erosionActivity * 3.5, 0, 1),
      sediment: {
        unit: 'model-sediment',
        physicalUnitClaim: false,
        erodible: cell.erodible,
        suspended: cell.suspended,
        deposited: cell.deposited,
        depositedFraction,
        erosionActivity: cell.erosionActivity,
        depositionActivity: cell.depositionActivity,
        cell: { column: cell.column, row: cell.row },
      },
    };
  }

  function wrappedStep(dt) {
    const result = originalStep(dt);
    contractClock += Math.max(0, finite(dt));
    if (contractClock >= updateInterval) {
      const solveDt = Math.min(contractClock, updateInterval * 2);
      contractClock %= updateInterval;
      advance(solveDt);
    }
    return result;
  }

  function getCell(x, y) {
    const cell = locate(x, y);
    return {
      column: cell.column,
      row: cell.row,
      downstream: cell.downstream,
      land: cell.land,
      elevation: cell.elevation,
      baseErosion: cell.baseErosion,
      erodible: cell.erodible,
      suspended: cell.suspended,
      deposited: cell.deposited,
      erosionActivity: cell.erosionActivity,
      depositionActivity: cell.depositionActivity,
    };
  }

  function snapshot() {
    const erodible = cells.reduce((sum, cell) => sum + cell.erodible, 0);
    const suspended = cells.reduce((sum, cell) => sum + cell.suspended, 0);
    const deposited = cells.reduce((sum, cell) => sum + cell.deposited, 0);
    const sedimentTotal = erodible + suspended + deposited;
    return {
      version: 1,
      writable: true,
      eventDriven: true,
      scope: 'existing dynamic water cycle -> conserved erosion / sediment transport / deposition',
      grid: { columns, rows, cells: cells.length },
      macroSteps,
      units: {
        waterFlux: 'model-water-flux',
        sediment: 'model-sediment',
        physicalUnitClaim: false,
      },
      waterAccounting: {
        conservationClaim: false,
        reason: 'The existing atmospheric/ocean water solver is an open reduced-order model with numerical damping and implicit ocean source terms.',
        lastFlux: { ...lastFlux },
        totals: {
          precipitation: totals.precipitation,
          evaporationEstimate: totals.evaporationEstimate,
          flow: totals.waterFlow,
        },
      },
      sediment: {
        conservationClaim: true,
        baseline: sedimentBaseline,
        reservoirs: { erodible, suspended, deposited, total: sedimentTotal },
        drift: sedimentTotal - sedimentBaseline,
        totals: {
          eroded: totals.sedimentEroded,
          transported: totals.sedimentTransported,
          deposited: totals.sedimentDeposited,
        },
      },
    };
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (waterCycle.step === wrappedStep) waterCycle.step = originalStep;
    if (waterCycle.sample === sample) waterCycle.sample = originalSample;
  }

  initialize();
  waterCycle.step = wrappedStep;
  waterCycle.sample = sample;

  return {
    version: 1,
    writable: true,
    eventDriven: true,
    sample,
    getCell,
    advance,
    snapshot,
    destroy,
  };
}
