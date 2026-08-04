import * as THREE from 'three';

// Keep the proven living-planet boot path independent from the optional
// Three.js/REBOUND universe. A universe rendering failure must never prevent
// Cesium, weather, ecology, civilizations, or orbital climate from starting.
globalThis.THREE = THREE;

const surfaceLoading = document.getElementById('loading');
const universeLoading = document.getElementById('reboundLoading');
const buildStatus = document.getElementById('systemBuildStatus');
const enterButton = document.getElementById('enterSystem');
const ORIGINAL_ENTER_LABEL = enterButton?.textContent || 'Enter 3D universe';

let universeReady = false;
let universePromise;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function showSurfaceError(error) {
  const message = errorMessage(error);
  console.error('[Reality V6.7 surface startup]', error);
  if (surfaceLoading) {
    surfaceLoading.textContent = `Living planet failed to start: ${message}`;
  }
  if (buildStatus) buildStatus.textContent = 'Living planet startup failed';
}

function showUniverseError(error) {
  const message = errorMessage(error);
  console.error('[Reality V6.7 universe startup]', error);
  if (universeLoading) {
    universeLoading.hidden = false;
    universeLoading.textContent = `3D universe failed to load: ${message}`;
  }
  if (buildStatus) buildStatus.textContent = 'Living planet ready · 3D universe unavailable';
  if (enterButton) {
    enterButton.disabled = false;
    enterButton.textContent = 'Retry 3D universe';
  }
}

function timeout(milliseconds, label) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(milliseconds / 1000)} seconds.`)), milliseconds);
  });
}

async function waitForSurface(milliseconds = 45_000) {
  const started = performance.now();
  while (performance.now() - started < milliseconds) {
    if (
      globalThis.realityV6?.viewer &&
      globalThis.realityV6?.simulation &&
      globalThis.realityV65?.coupling
    ) return globalThis.realityV6;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The living-planet runtime did not report ready.');
}

async function startSurface() {
  await Promise.race([
    import('../reality-v6-5/app.js'),
    timeout(45_000, 'Living planet startup'),
  ]);
  await waitForSurface();

  // The V6 runtime normally removes this itself. Remove any stale overlay as a
  // final safeguard once the viewer and simulation are definitely available.
  if (surfaceLoading?.isConnected) surfaceLoading.remove();
  if (buildStatus) buildStatus.textContent = 'Living planet ready · Three.js loads on demand';
}

async function loadUniverse() {
  if (universeReady) return globalThis.realityV67;
  if (universePromise) return universePromise;

  universePromise = (async () => {
    if (universeLoading) {
      universeLoading.hidden = false;
      universeLoading.textContent = 'Loading Three.js, Desktop Ultra, and local REBOUND WebAssembly…';
    }
    if (buildStatus) buildStatus.textContent = 'Loading optional 3D universe…';

    // app.js may still import V6.5, but ES modules are cached, so the living
    // planet is not initialized twice. Its Three.js dependency is now isolated
    // behind this user-triggered boundary.
    await Promise.race([
      import('./app.js'),
      timeout(60_000, 'Three.js universe startup'),
    ]);
    await import('./ultra-quality.js');

    universeReady = true;
    if (buildStatus) buildStatus.textContent = 'Three.js r184 · REBOUND 5.1.1 local WASM';
    return globalThis.realityV67;
  })().catch((error) => {
    universePromise = undefined;
    throw error;
  });

  return universePromise;
}

function installLazyUniverseButton() {
  if (!enterButton) return;

  enterButton.addEventListener('click', async (event) => {
    if (universeReady) return;

    // Intercept V6.4's legacy iframe handler until the local V6.7 universe has
    // registered its own capture-phase handler.
    event.preventDefault();
    event.stopImmediatePropagation();
    enterButton.disabled = true;
    enterButton.textContent = 'Loading 3D universe…';

    try {
      await loadUniverse();
      enterButton.disabled = false;
      enterButton.textContent = ORIGINAL_ENTER_LABEL;
      // Re-dispatch after V6.7's handler exists. This listener now passes the
      // event through because universeReady is true.
      queueMicrotask(() => enterButton.click());
    } catch (error) {
      showUniverseError(error);
    }
  }, true);
}

addEventListener('error', (event) => {
  console.error('[Reality V6.7 window error]', event.error || event.message);
});
addEventListener('unhandledrejection', (event) => {
  console.error('[Reality V6.7 unhandled rejection]', event.reason);
});

try {
  await startSurface();
  installLazyUniverseButton();
} catch (error) {
  showSurfaceError(error);
}
