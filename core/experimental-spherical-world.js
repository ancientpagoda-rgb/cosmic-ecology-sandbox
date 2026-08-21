const params = new URLSearchParams(globalThis.location?.search || '');
const rendererChoice = params.get('renderer');
const explicitEnable = rendererChoice === 'spherical' || params.get('experimentalSpherical') === '1';
const explicitDisable = rendererChoice === 'classic' || rendererChoice === 'lofi' || rendererChoice === 'legacy' || params.get('experimentalSpherical') === '0';

let storedChoice = null;
try {
  storedChoice = globalThis.localStorage?.getItem('eidolon.experimentalSphericalRenderer') ?? null;
} catch {}

// The continuous Three.js spherical renderer is now the production default.
// Keep a URL/localStorage escape hatch so the legacy Pixi globe can still be
// reached for diagnostics without shipping its blocky 10 px terrain overview
// to normal visitors.
const enabled = explicitDisable ? false : explicitEnable ? true : storedChoice === '0' ? false : true;

document.documentElement.dataset.experimentalSphericalRenderer = enabled ? 'enabled' : 'disabled';
document.documentElement.dataset.rootRenderer = enabled ? 'single-spherical-world' : 'legacy-pixi-globe';

window.realitySandboxExperimentalSphericalRenderer = {
  enabled,
  productionDefault: true,
  enablePersistently() {
    try { localStorage.setItem('eidolon.experimentalSphericalRenderer', '1'); } catch {}
    return true;
  },
  disablePersistently() {
    try { localStorage.setItem('eidolon.experimentalSphericalRenderer', '0'); } catch {}
    return true;
  },
  resetToDefault() {
    try { localStorage.removeItem('eidolon.experimentalSphericalRenderer'); } catch {}
    return true;
  },
};

if (enabled) {
  // Keep presentation polish separate from world scale. The retired v90
  // geometry-remap shim mutated terrain/camera state after construction and
  // could leave the local surface frame looking away from the planet.
  const polishReady = import('./spherical-production-polish-v88.js?v=20260821-v88')
    .catch(error => console.warn('[experimental-spherical-world] spherical presentation polish unavailable:', error));

  polishReady
    .then(() => import('./single-spherical-world-renderer.js?v=20260821-v89-restored'))
    .then(() => import('./spherical-pointerlock-gate-v88.js?v=20260821-v88c'))
    .then(() => import('./spherical-input-polish-v88.js?v=20260821-v89-natural-look'))
    .then(() => import('./spherical-drag-controls-v89.js?v=20260821-v89-natural-drag'))
    .catch(error => {
      // Input polish is optional. Only mark the renderer as failed if the
      // production renderer itself never installed.
      if (window.realitySandboxSingleSphericalRenderer?.installed) {
        console.warn('[experimental-spherical-world] input polish unavailable:', error);
        return;
      }
      console.warn('[experimental-spherical-world] renderer failed to load:', error);
      document.documentElement.dataset.experimentalSphericalRenderer = 'error';
      document.documentElement.dataset.rootRenderer = 'legacy-pixi-globe-fallback';
    });
}
