import '../reality-v6-7/bootstrap.js';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const badge = document.querySelector('.badge');
const loading = document.getElementById('loading');
const buildStatus = document.getElementById('systemBuildStatus');
const canvas = document.getElementById('pixiPresentationCanvas');

async function waitForSurface() {
  for (let attempt = 0; attempt < 450; attempt += 1) {
    if (
      globalThis.realityV6?.viewer &&
      globalThis.realityV6?.simulation &&
      globalThis.realityV61?.weather &&
      globalThis.realityV65?.coupling
    ) return globalThis.realityV6;
    await sleep(100);
  }
  throw new Error('The V6.7 living planet did not become ready for PixiJS.');
}

function showFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[Reality V6.8 PixiJS]', error);
  if (buildStatus) buildStatus.textContent = `PixiJS presentation unavailable · ${message}`;
  const inspect = document.getElementById('inspect');
  if (inspect) inspect.textContent = `Living simulation is running; PixiJS overlay failed: ${message}`;
}

try {
  await waitForSurface();
  if (badge) badge.textContent = 'ENGINE V6.8 · PIXIJS FIXED-STEP PIXEL WORLD';
  if (buildStatus) buildStatus.textContent = 'Living planet ready · starting PixiJS 8.19 presentation…';
  const { createPixiPresentation } = await import('./pixi-presentation.js');
  const presentation = await createPixiPresentation(canvas);
  if (loading?.isConnected) loading.remove();
  if (buildStatus) buildStatus.textContent = 'PixiJS 8.19 · fixed 20 Hz · Three.js and REBOUND load on demand';
  const inspect = document.getElementById('inspect');
  if (inspect) inspect.textContent = 'PixiJS pixel weather, city lights, retro labels, and impact effects are synchronized with the living world.';
  globalThis.realityV68 = {
    presentation,
    setPalette: (name) => {
      if (!presentation.palette || !name) return;
      presentation.paletteName = name;
      presentation.applyPalette();
    },
    setEnabled: (enabled) => presentation.setEnabled(enabled),
    triggerImpact: (event) => presentation.triggerSurfaceImpact(event),
  };
} catch (error) {
  showFailure(error);
}
