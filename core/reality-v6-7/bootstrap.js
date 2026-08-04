import '../reality-v6-5/app.js';

// The living planet uses the proven V6.5 startup chain. The low-fi surface
// patch is applied only after that runtime reports ready. Three.js, REBOUND,
// and post-processing remain unloaded until the user enters the universe.

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
  if (buildStatus) buildStatus.textContent = 'Living planet ready · pixel universe unavailable';
  if (enterButton) {
    enterButton.disabled = false;
    enterButton.textContent = 'Retry pixel universe';
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
      universeLoading.textContent = 'Loading Three.js pixel mode and local REBOUND WebAssembly…';
    }
    if (buildStatus) buildStatus.textContent = 'Loading optional pixel universe…';

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
    if (buildStatus) buildStatus.textContent = 'Three.js r184 · Pixel default · REBOUND 5.1.1 local WASM';
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

    event.preventDefault();
    event.stopImmediatePropagation();
    enterButton.disabled = true;
    enterButton.textContent = 'Loading pixel universe…';

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
  .then(async () => {
    await import('./lofi-surface.js');
    if (buildStatus) buildStatus.textContent = 'Living planet ready · pixel universe loads on demand';
    installLazyUniverseButton();
  })
  .catch((error) => {
    console.error('[Reality V6.7 surface readiness]', error);
    const loading = document.getElementById('loading');
    if (loading?.isConnected) loading.textContent = `Living planet failed to start: ${errorMessage(error)}`;
  });
