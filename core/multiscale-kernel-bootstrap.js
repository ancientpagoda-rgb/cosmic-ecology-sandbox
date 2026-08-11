import { createEidolonKernelAdapter } from './eidolon-kernel-adapter.js';

async function installRealityKernel() {
  const ready = window.realitySandboxReady;
  if (!ready || typeof ready.then !== 'function') return null;
  await ready;

  const planet = window.realitySandboxPlanet;
  if (!planet?.world) return null;

  const adapter = createEidolonKernelAdapter({
    world: planet.world,
    biosphere: planet.biosphere,
    dynamics: planet.dynamics,
  });

  const api = {
    version: 1,
    mode: 'read-only-adapter',
    kernel: adapter.kernel,
    requestAt: options => adapter.requestAt(options),
    releaseObserver: observerId => adapter.releaseObserver(observerId),
    refresh: () => adapter.refresh(),
    locate: (x, y) => adapter.locate(x, y),
    snapshot: () => adapter.snapshot(),
    getScales: () => adapter.getScales(),
  };

  window.realitySandboxRealityKernel = api;
  window.dispatchEvent(new CustomEvent('reality-sandbox-kernel-ready', {
    detail: {
      version: api.version,
      mode: api.mode,
      scales: api.getScales(),
    },
  }));
  return api;
}

function start() {
  window.realitySandboxKernelReady = installRealityKernel().catch(error => {
    console.warn('[reality-kernel] adapter failed to initialize', error);
    return null;
  });
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
