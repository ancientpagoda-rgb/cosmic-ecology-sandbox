import '../reality-v6-5/app.js';

// The living planet above uses the exact proven V6.5 startup chain.
// Three.js, Desktop Ultra, and REBOUND remain completely unloaded until the
// user explicitly enters the 3D universe.

const universeLoading = document.getElementById('reboundLoading');
const buildStatus = document.getElementById('systemBuildStatus');
const enterButton = document.getElementById('enterSystem');
const ORIGINAL_ENTER_LABEL = enterButton?.textContent || 'Enter 3D universe';

let universeReady = false;
let universePromise;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
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

async function loadUniverse() {
  if (universeReady) return globalThis.realityV67;
  if (universePromise) return universePromise;

  universePromise = (async () => {
    await waitForSurface();
    if (universeLoading) {
      universeLoading.hidden = false;
      universeLoading.textContent = 'Loading Three.js, Desktop Ultra, and local REBOUND WebAssembly…';
    }
    if (buildStatus) buildStatus.textContent = 'Loading optional 3D universe…';

    // app.js imports Three.js through three-universe.js. The namespace is also
    // exposed for its revision label, without making Three.js part of surface boot.
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

    // This capture listener blocks V6.4's legacy iframe action until V6.7's
    // Three.js runtime has registered its own system-view handler.
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

waitForSurface()
  .then(() => {
    if (buildStatus) buildStatus.textContent = 'Living planet ready · Three.js loads on demand';
    installLazyUniverseButton();
  })
  .catch((error) => {
    console.error('[Reality V6.7 surface readiness]', error);
    const loading = document.getElementById('loading');
    if (loading?.isConnected) loading.textContent = `Living planet failed to start: ${errorMessage(error)}`;
  });
