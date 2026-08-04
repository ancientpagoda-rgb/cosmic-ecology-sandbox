const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForSurface() {
  for (let attempt = 0; attempt < 450; attempt += 1) {
    if (globalThis.realityV6?.viewer && globalThis.realityV6?.simulation) {
      return globalThis.realityV6;
    }
    await sleep(100);
  }
  throw new Error('The living planet was not ready for the low-fi surface patch.');
}

function installStyle() {
  if (document.getElementById('reality-v6-7-lofi-style')) return;
  const style = document.createElement('style');
  style.id = 'reality-v6-7-lofi-style';
  style.textContent = `
    body.reality-lofi .glass {
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
      background: #07131df2 !important;
    }
    body.reality-lofi #cesium canvas,
    body.reality-lofi .universe-canvas {
      image-rendering: pixelated;
      image-rendering: crisp-edges;
    }
    body.reality-lofi .badge,
    body.reality-lofi button,
    body.reality-lofi select,
    body.reality-lofi input {
      border-radius: 3px !important;
    }
  `;
  document.head.append(style);
}

function throttleRefresh(runtime, minimumDelay = 2600) {
  const original = runtime.refreshVisuals?.bind(runtime);
  if (!original || original.__realityLofiThrottle) return;

  let lastRun = 0;
  let pending;
  const throttled = (options = {}) => {
    const now = performance.now();
    const immediate = Boolean(options.announce || options.force);
    if (immediate || now - lastRun >= minimumDelay) {
      lastRun = now;
      return original(options);
    }
    if (!pending) {
      pending = new Promise((resolve, reject) => {
        setTimeout(() => {
          lastRun = performance.now();
          Promise.resolve(original(options)).then(resolve, reject).finally(() => {
            pending = undefined;
          });
        }, Math.max(0, minimumDelay - (now - lastRun)));
      });
    }
    return pending;
  };
  throttled.__realityLofiThrottle = true;
  runtime.refreshVisuals = throttled;
}

try {
  const runtime = await waitForSurface();
  const { viewer, simulation } = runtime;
  document.body.classList.add('reality-lofi');
  installStyle();

  viewer.resolutionScale = Math.min(0.72, 1 / Math.max(1, (devicePixelRatio || 1) * 0.82));
  viewer.targetFrameRate = 30;
  viewer.scene.requestRenderMode = true;
  viewer.scene.maximumRenderTimeChange = 1.25;
  viewer.scene.globe.maximumScreenSpaceError = 5.4;
  viewer.scene.globe.tileCacheSize = 180;
  if (viewer.scene.postProcessStages?.fxaa) viewer.scene.postProcessStages.fxaa.enabled = false;
  viewer.scene.canvas.style.imageRendering = 'pixelated';

  if (!simulation.__realityLofiTexture) {
    const originalCreateTexture = simulation.createTexture.bind(simulation);
    simulation.createTexture = (width = 768, height = 384) => originalCreateTexture(
      Math.min(width, 384),
      Math.min(height, 192),
    );
    simulation.__realityLofiTexture = true;
  }

  throttleRefresh(runtime);

  const badge = document.querySelector('.badge');
  if (badge) badge.textContent = 'ENGINE V6.7 · LOW-FI PIXEL UNIVERSE';
  const inspect = document.getElementById('inspect');
  if (inspect) inspect.textContent = 'Low-fi planet mode · reduced redraws · enter the pixel REBOUND universe when ready.';
  const buildStatus = document.getElementById('systemBuildStatus');
  if (buildStatus) buildStatus.textContent = 'Living planet ready · pixel universe loads on demand';
  const hint = document.querySelector('.system-hint');
  if (hint) hint.textContent = 'Drag to orbit · pinch/wheel to zoom · GPU mode cycles Pixel, Adaptive, High, Ultra, and Cinematic';

  globalThis.realityV67Lofi = {
    surfaceResolutionScale: viewer.resolutionScale,
    targetFrameRate: viewer.targetFrameRate,
  };
  viewer.scene.requestRender();
} catch (error) {
  console.error('[Reality V6.7 low-fi surface]', error);
}
