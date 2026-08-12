const params = new URLSearchParams(globalThis.location?.search || '');
const queryEnabled = params.get('renderer') === 'spherical' || params.get('experimentalSpherical') === '1';
let storedEnabled = false;
try {
  storedEnabled = globalThis.localStorage?.getItem('eidolon.experimentalSphericalRenderer') === '1';
} catch {}

const enabled = queryEnabled || storedEnabled;
document.documentElement.dataset.experimentalSphericalRenderer = enabled ? 'enabled' : 'disabled';

window.realitySandboxExperimentalSphericalRenderer = {
  enabled,
  enablePersistently() {
    try { localStorage.setItem('eidolon.experimentalSphericalRenderer', '1'); } catch {}
    return true;
  },
  disablePersistently() {
    try { localStorage.removeItem('eidolon.experimentalSphericalRenderer'); } catch {}
    return true;
  },
};

if (enabled) {
  import('./single-spherical-world-renderer.js').catch(error => {
    console.warn('[experimental-spherical-world] renderer failed to load:', error);
    document.documentElement.dataset.experimentalSphericalRenderer = 'error';
  });
}
