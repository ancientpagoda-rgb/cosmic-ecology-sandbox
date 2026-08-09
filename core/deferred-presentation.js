// The simulation and the Surface Mode control are the interactive startup
// path. Decorative and adaptive overview layers can arrive after first paint;
// loading them in a single idle queue avoids competing with Pixi during boot.
const modules = [
  './world-formation-sequence.js',
  './natural-drag-controls.js',
  './interaction-pixi-fastpath.js',
  './interaction-performance.js',
  './interaction-cache.js',
  './interaction-fast-canvas.js',
  './ui-shell.js',
  '../seed-ui.js',
  './morphology-genetics.js',
  './vegetation-terrain-presentation.js',
  './vegetation-render-guard.js',
  './surface-layer-presentation.js',
  './presentation-layer-fix.js',
  './presentation-runtime-recovery.js',
];

const defer = callback => {
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(callback, { timeout: 1200 });
    return;
  }
  window.setTimeout(callback, 180);
};

async function bootDeferredPresentation() {
  let readyPromise = null;
  for (let attempt = 0; attempt < 240; attempt++) {
    if (window.realitySandboxReady?.then) {
      readyPromise = window.realitySandboxReady;
      break;
    }
    await new Promise(resolve => window.setTimeout(resolve, 25));
  }
  if (!readyPromise) {
    document.documentElement.dataset.deferredPresentation = 'runtime-timeout';
    return;
  }
  try {
    await readyPromise;
  } catch {
    document.documentElement.dataset.deferredPresentation = 'runtime-rejected';
    return;
  }

  let index = 0;
  const loadNext = () => {
    if (index >= modules.length) {
      document.documentElement.dataset.deferredPresentation = 'ready';
      return;
    }
    const source = modules[index++];
    defer(async () => {
      try {
        await import(source);
      } catch (error) {
        // Optional overview polish must never make the planet or Surface Mode
        // unavailable. Diagnostics retain the failed module for inspection.
        document.documentElement.dataset.deferredPresentationError = source;
        console.warn('[Presentation] Deferred module unavailable:', source, error);
      }
      loadNext();
    });
  };

  document.documentElement.dataset.deferredPresentation = 'loading';
  loadNext();
}

bootDeferredPresentation();
