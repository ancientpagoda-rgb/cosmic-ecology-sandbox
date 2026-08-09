// The simulation and the Surface Mode control are the interactive startup
// path. Decorative and adaptive overview layers can arrive after first paint;
// loading them in a single idle queue avoids competing with Pixi during boot.
// Keep every import path literal. Vite can then emit the optional presentation
// chunks during a production build; `import(source)` left these as runtime
// paths, which GitHub Pages served as sequential 404s after startup.
const modules = [
  { source: './world-formation-sequence.js', load: () => import('./world-formation-sequence.js') },
  { source: './natural-drag-controls.js', load: () => import('./natural-drag-controls.js') },
  { source: './interaction-pixi-fastpath.js', load: () => import('./interaction-pixi-fastpath.js') },
  { source: './interaction-performance.js', load: () => import('./interaction-performance.js') },
  { source: './interaction-cache.js', load: () => import('./interaction-cache.js') },
  { source: './interaction-fast-canvas.js', load: () => import('./interaction-fast-canvas.js') },
  { source: './ui-shell.js', load: () => import('./ui-shell.js') },
  { source: '../seed-ui.js', load: () => import('../seed-ui.js') },
  { source: './morphology-genetics.js', load: () => import('./morphology-genetics.js') },
  { source: './vegetation-terrain-presentation.js', load: () => import('./vegetation-terrain-presentation.js') },
  { source: './vegetation-render-guard.js', load: () => import('./vegetation-render-guard.js') },
  { source: './surface-layer-presentation.js', load: () => import('./surface-layer-presentation.js') },
  { source: './presentation-layer-fix.js', load: () => import('./presentation-layer-fix.js') },
  { source: './presentation-runtime-recovery.js', load: () => import('./presentation-runtime-recovery.js') },
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

  // These are experimental/legacy presentation layers, not part of the
  // current clean living-planet experience. Loading them all after boot
  // consumed idle time, patched the active renderer, and could reintroduce
  // panels that the current shell deliberately omits. Keep them available for
  // focused review without making every public visitor pay their cost.
  if (!new URLSearchParams(location.search).has('legacy-presentation')) {
    document.documentElement.dataset.deferredPresentation = 'disabled';
    return;
  }

  let index = 0;
  const loadNext = () => {
    if (index >= modules.length) {
      document.documentElement.dataset.deferredPresentation = 'ready';
      return;
    }
    const module = modules[index++];
    defer(async () => {
      try {
        await module.load();
      } catch (error) {
        // Optional overview polish must never make the planet or Surface Mode
        // unavailable. Diagnostics retain the failed module for inspection.
        document.documentElement.dataset.deferredPresentationError = module.source;
        console.warn('[Presentation] Deferred module unavailable:', module.source, error);
      }
      loadNext();
    });
  };

  document.documentElement.dataset.deferredPresentation = 'loading';
  loadNext();
}

bootDeferredPresentation();
