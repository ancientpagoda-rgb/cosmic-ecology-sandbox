import { createEidolonKernelAdapter } from './eidolon-kernel-adapter.js';
import { installEcologicalEnergyLedger } from './ecological-energy-ledger.js';
import { installEcologicalNutrientCycle } from './ecological-nutrient-cycle.js';
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
  if (!planet?.seasonalResources?.sample) throw new Error('Authoritative Eidolon resource field is unavailable after startup.');
  if (!runtime?.getCamera) throw new Error('Authoritative Eidolon presentation runtime is unavailable after startup.');

  // Nutrients wrap the seasonal field first so soil availability can constrain
  // the landscape productivity seen by the energy ledger. The nutrient cycle
  // then attaches outside the energy wrapper, preserving one authoritative
  // world.step while observing the energy ledger's spatial flow counters.
  const ecologicalNutrients = installEcologicalNutrientCycle({
    world: planet.world,
    resourceField: planet.seasonalResources,
  });
  planet.ecologicalNutrients = ecologicalNutrients;

  const ecologicalEnergy = installEcologicalEnergyLedger({
    world: planet.world,
    resourceField: planet.seasonalResources,
  });
  planet.ecologicalEnergy = ecologicalEnergy;
  ecologicalNutrients.attachEnergyLedger(ecologicalEnergy);

  const adapter = createEidolonKernelAdapter({
    world: planet.world,
    biosphere: planet.biosphere,
    dynamics: planet.dynamics,
  });

  const api = {
    version: 4,
    mode: 'observer-coupled-kernel-with-writable-energy-and-nutrients',
    kernel: adapter.kernel,
    ecologicalEnergy,
    ecologicalNutrients,
    requestAt(options = {}) {
      const result = adapter.requestAt(options);
      const hasPoint = Number.isFinite(options.x) && Number.isFinite(options.y);
      return {
        ...result,
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
