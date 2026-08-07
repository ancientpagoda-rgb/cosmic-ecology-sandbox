const UI_REPAIR_MS = 300;

async function installVegetationRenderGuard() {
  try {
    await window.realitySandboxReady;
  } catch {
    return;
  }

  // Install after every other DOMContentLoaded renderer wrapper has had a
  // chance to attach. This guard must be outermost so no presentation layer
  // can see plant resources while it is drawing.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const runtime = window.realitySandboxUnified;
  const resources = window.realitySandboxPlanet?.world?.ecs?.components?.resource;
  if (!runtime?.render || !resources || runtime.__vegetationRenderGuardInstalled) return;

  const originalRender = runtime.render.bind(runtime);
  let lastUiRepair = -Infinity;

  runtime.render = frame => {
    const timestamp = frame?.timestamp ?? performance.now();
    const hadOwnHas = Object.prototype.hasOwnProperty.call(resources, 'has');
    const previousHas = resources.has;
    const hadOwnIterator = Object.prototype.hasOwnProperty.call(resources, Symbol.iterator);
    const previousIterator = resources[Symbol.iterator];

    // Keep vegetation fully alive in the ecology, but make it invisible to
    // every renderer for the complete presentation pass. This suppresses both
    // the Pixi plant squares and morphology plant SVG nodes.
    resources.has = () => false;
    resources[Symbol.iterator] = function* hiddenVegetationIterator() {};

    let result;
    try {
      result = originalRender(frame);
    } finally {
      if (hadOwnHas) resources.has = previousHas;
      else delete resources.has;
      if (hadOwnIterator) resources[Symbol.iterator] = previousIterator;
      else delete resources[Symbol.iterator];
    }

    // Presentation wrappers may have refreshed the inspector while resources
    // were hidden. Repair the UI after restoring the true simulation state.
    if (timestamp - lastUiRepair >= UI_REPAIR_MS) {
      lastUiRepair = timestamp;
      runtime.updateInterface?.(true);
    }

    return result;
  };

  runtime.__vegetationRenderGuardInstalled = true;
  document.documentElement.dataset.vegetationRenderGuard = 'active';
}

document.addEventListener('DOMContentLoaded', installVegetationRenderGuard, { once: true });
