import { createEidolonKernelAdapter } from './eidolon-kernel-adapter.js';
import { installRealityTransactions } from './ecological-transactions.js';
import { installEcologicalEnergyLedger } from './ecological-energy-ledger.js';
import { installEcologicalNutrientCycle } from './ecological-nutrient-cycle.js';
import { installHydrologyErosionContract } from './hydrology-erosion-contract.js';
import { installRealityObserverBridge } from './reality-observer-bridge.js';

function waitForAuthoritativeRuntime(timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    function check() {
      const ready = window.realitySandboxReady;
      if (ready && typeof ready.then === 'function') {
        resolve(ready);
        return;
      }
      if (performance.now() - started >= timeoutMs) {
        reject(new Error('Timed out waiting for the authoritative Eidolon runtime.'));
        return;
      }
      setTimeout(check, 10);
    }
    check();
  });
}

async function installRealityKernel() {
  const ready = await waitForAuthoritativeRuntime();
  await ready;

  const planet = window.realitySandboxPlanet;
  const runtime = window.realitySandboxUnified;
  if (!planet?.world) throw new Error('Authoritative Eidolon world is unavailable after startup.');
  if (!planet?.waterCycle?.sample) throw new Error('Authoritative Eidolon water cycle is unavailable after startup.');
  if (!planet?.seasonalResources?.sample) throw new Error('Authoritative Eidolon resource field is unavailable after startup.');
  if (!runtime?.getCamera) throw new Error('Authoritative Eidolon presentation runtime is unavailable after startup.');

  // Install exactly one mutation/event layer around the authoritative world.
  // Ecological organism capture and non-ecological domain contracts share the
  // same deterministic transaction journal and simulation clock.
  const realityTransactions = installRealityTransactions({ world: planet.world });
  planet.realityTransactions = realityTransactions;
  // Backward-compatible alias for existing ecology tooling.
  planet.ecologicalTransactions = realityTransactions;

  // Hydrology is the first non-ecological contract to reuse the event API. It
  // wraps the existing water-cycle object rather than creating another water
  // solver, and owns only the conserved sediment reservoirs it introduces.
  const hydrologyErosion = installHydrologyErosionContract({
    world: planet.world,
    waterCycle: planet.waterCycle,
    transactions: realityTransactions,
  });
  planet.hydrologyErosion = hydrologyErosion;

  // Nutrients wrap the seasonal field first, then energy wraps that result.
  // Soil availability can therefore constrain the productivity seen by the
  // energy ledger while both still share one transaction stream and clock.
  const ecologicalNutrients = installEcologicalNutrientCycle({
    world: planet.world,
    resourceField: planet.seasonalResources,
    transactions: realityTransactions,
  });
  planet.ecologicalNutrients = ecologicalNutrients;

  const ecologicalEnergy = installEcologicalEnergyLedger({
    world: planet.world,
    resourceField: planet.seasonalResources,
    transactions: realityTransactions,
  });
  planet.ecologicalEnergy = ecologicalEnergy;
  ecologicalNutrients.attachEnergyLedger(ecologicalEnergy);

  const adapter = createEidolonKernelAdapter({
    world: planet.world,
    biosphere: planet.biosphere,
    dynamics: planet.dynamics,
  });

  const api = {
    version: 6,
    mode: 'observer-coupled-kernel-with-cross-domain-transactions',
    kernel: adapter.kernel,
    realityTransactions,
    ecologicalTransactions: realityTransactions,
    hydrologyErosion,
    ecologicalEnergy,
    ecologicalNutrients,
    requestAt(options = {}) {
      const result = adapter.requestAt(options);
      const hasPoint = Number.isFinite(options.x) && Number.isFinite(options.y);
      const hydrology = hasPoint ? hydrologyErosion.sample(options.x, options.y) : null;
      return {
        ...result,
        hydrology: hydrology ? {
          river: hydrology.river,
          lake: hydrology.lake,
          delta: hydrology.delta,
          runoff: hydrology.runoff,
          erosion: hydrology.erosion,
          sediment: hydrology.sediment,
        } : null,
        ecologicalEnergy: hasPoint
          ? ecologicalEnergy.sample(options.x, options.y).ecologicalEnergy
          : null,
        ecologicalNutrients: hasPoint
          ? ecologicalNutrients.sample(options.x, options.y).ecologicalNutrients
          : null,
      };
    },
    releaseObserver: observerId => adapter.releaseObserver(observerId),
    refresh: () => adapter.refresh(),
    locate: (x, y) => adapter.locate(x, y),
    snapshot: () => ({
      ...adapter.snapshot(),
      observation: api.observation?.snapshot?.() || null,
      realityTransactions: realityTransactions.snapshot(),
      ecologicalTransactions: realityTransactions.snapshot(),
      hydrologyErosion: hydrologyErosion.snapshot(),
      ecologicalEnergy: ecologicalEnergy.snapshot(),
      ecologicalNutrients: ecologicalNutrients.snapshot(),
    }),
    getScales: () => adapter.getScales(),
    observation: null,
  };

  api.observation = installRealityObserverBridge({
    runtime,
    world: planet.world,
    kernelApi: api,
  });

  window.realitySandboxRealityKernel = api;
  window.dispatchEvent(new CustomEvent('reality-sandbox-kernel-ready', {
    detail: {
      version: api.version,
      mode: api.mode,
      scales: api.getScales(),
      observation: api.observation.snapshot(),
      realityTransactions: api.realityTransactions.snapshot(),
      hydrologyErosion: api.hydrologyErosion.snapshot(),
      ecologicalEnergy: api.ecologicalEnergy.snapshot(),
      ecologicalNutrients: api.ecologicalNutrients.snapshot(),
    },
  }));
  return api;
}

window.realitySandboxKernelReady = installRealityKernel().catch(error => {
  console.warn('[reality-kernel] adapter failed to initialize', error);
  return null;
});
