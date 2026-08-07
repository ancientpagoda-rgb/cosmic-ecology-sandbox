const DESKTOP_INTERACTION_INTERVAL_MS = 33;
const TOUCH_INTERACTION_INTERVAL_MS = 45;
const FORCE_RENDER_ADVANCE_MS = 90;

function isInteracting() {
  return document.getElementById('lofiLivingCanvas')?.dataset.dragging === 'true';
}

async function installInteractionPerformanceMode() {
  try {
    await window.realitySandboxReady;
  } catch {
    return;
  }

  const runtime = window.realitySandboxUnified;
  if (!runtime?.render || runtime.__interactionPerformanceInstalled) return;

  const originalRender = runtime.render.bind(runtime);
  const coarsePointer = matchMedia('(pointer: coarse)').matches;
  const interactionInterval = coarsePointer
    ? TOUCH_INTERACTION_INTERVAL_MS
    : DESKTOP_INTERACTION_INTERVAL_MS;

  let lastActualTimestamp = performance.now();
  let virtualTimestamp = lastActualTimestamp;
  let lastInteractionDraw = -Infinity;
  let wasInteracting = false;

  runtime.render = frame => {
    const actualTimestamp = frame?.timestamp ?? performance.now();
    const elapsed = Math.max(0, Math.min(100, actualTimestamp - lastActualTimestamp));
    lastActualTimestamp = actualTimestamp;
    virtualTimestamp += elapsed;

    const interacting = isInteracting();
    if (interacting) {
      wasInteracting = true;
      if (actualTimestamp - lastInteractionDraw < interactionInterval) return;
      lastInteractionDraw = actualTimestamp;

      // The base renderer intentionally throttles normal simulation redraws.
      // Advance its presentation clock only while the user is manipulating
      // the globe so pointer motion receives a substantially higher cadence.
      virtualTimestamp += FORCE_RENDER_ADVANCE_MS;
      originalRender({ ...frame, timestamp: virtualTimestamp });
      return;
    }

    if (wasInteracting) {
      // Force one final full-quality redraw immediately after release.
      virtualTimestamp += FORCE_RENDER_ADVANCE_MS;
      wasInteracting = false;
    }

    originalRender({ ...frame, timestamp: virtualTimestamp });
  };

  runtime.__interactionPerformanceInstalled = true;
}

document.addEventListener('DOMContentLoaded', installInteractionPerformanceMode, { once: true });
