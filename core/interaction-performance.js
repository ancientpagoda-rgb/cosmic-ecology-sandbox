const DESKTOP_INTERACTION_INTERVAL_MS = 20;
const TOUCH_INTERACTION_INTERVAL_MS = 33;
const FORCE_RENDER_ADVANCE_MS = 96;

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

      // Normal simulation frames stay intentionally throttled. While the user
      // manipulates the globe, advance only the presentation timestamp so the
      // cached interaction renderer can respond at a much higher cadence.
      virtualTimestamp += FORCE_RENDER_ADVANCE_MS;
      originalRender({ ...frame, timestamp: virtualTimestamp });
      return;
    }

    if (wasInteracting) {
      // Force one exact redraw immediately after the interaction ends.
      virtualTimestamp += FORCE_RENDER_ADVANCE_MS;
      wasInteracting = false;
    }

    originalRender({ ...frame, timestamp: virtualTimestamp });
  };

  runtime.__interactionPerformanceInstalled = true;
}

document.addEventListener('DOMContentLoaded', installInteractionPerformanceMode, { once: true });
