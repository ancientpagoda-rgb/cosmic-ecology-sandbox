import { createEidolonKernelAdapter } from './eidolon-kernel-adapter.js';
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
  if (!runtime?.getCamera) throw new Error('Authoritative Eidolon presentation runtime is unavailable after startup.');

  const adapter = createEidolonKernelAdapter({
    world: planet.world,
    biosphere: planet.biosphere,
    dynamics: planet.dynamics,
  });

  const api = {
    version: 2,
    mode: 'read-only-observer-coupled-adapter',
    kernel: adapter.kernel,
    requestAt: options => adapter.requestAt(options),
    releaseObserver: observerId => adapter.releaseObserver(observerId),
    refresh: () => adapter.refresh(),
    locate: (x, y) => adapter.locate(x, y),
    snapshot: () => ({ ...adapter.snapshot(), observation: api.observation?.snapshot?.() || null }),
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
    },
  }));
  return api;
}

window.realitySandboxKernelReady = installRealityKernel().catch(error => {
  console.warn('[reality-kernel] adapter failed to initialize', error);
  return null;
});
