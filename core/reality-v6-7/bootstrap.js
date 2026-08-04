import * as THREE from 'three';

// V6.7's runtime status reads THREE.REVISION. Make the module namespace
// available before dynamically evaluating the main application.
globalThis.THREE = THREE;

const surfaceLoading = document.getElementById('loading');
const universeLoading = document.getElementById('reboundLoading');
const buildStatus = document.getElementById('systemBuildStatus');

function showStartupError(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[Reality V6.7 startup]', error);
  if (surfaceLoading?.isConnected) {
    surfaceLoading.textContent = `V6.7 startup failed: ${message}`;
  }
  if (universeLoading) {
    universeLoading.hidden = false;
    universeLoading.textContent = `V6.7 failed to load: ${message}`;
  }
  if (buildStatus) buildStatus.textContent = 'Three.js universe unavailable';
}

try {
  await import('./app.js');
  await import('./ultra-quality.js');
} catch (error) {
  showStartupError(error);
}
