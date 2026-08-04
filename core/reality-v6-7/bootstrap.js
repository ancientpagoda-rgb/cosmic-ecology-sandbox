// V6.7 deliberately boots the proven living planet before touching Three.js.
// The optional GPU universe is imported only after the user requests it.

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

  // The base runtime normally removes this. Remove a stale overlay only after
  // the Cesium viewer, world simulation, and Astronomy coupling are confirmed.
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

    // Import Three.js only now. app.js currently reads THREE.REVISION from the
    // global namespace, so expose the dynamically loaded module before app.js.
    const threeModule = await Promise.race([
      import('three'),
      timeout(30_000, 'Three.js module'),
    ]);
    globalThis.THREE = threeModule;

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

    // Intercept V6.4's legacy iframe listener until V6.7 registers its own
    // capture-phase handler.
    event.preventDefault();
    event.stopImmediatePropagation();
    enterButton.disabled = true;
    enterButton.textContent = 'Loading 3D universe…';

    try {
      await loadUniverse();
      enterButton.disabled = false;
      enterButton.textContent = ORIGINAL_ENTER_LABEL;
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
