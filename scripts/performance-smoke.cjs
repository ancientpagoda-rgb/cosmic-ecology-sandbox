const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.REALITY_BASE_URL || 'http://127.0.0.1:4173/';
const artifactDir = process.env.REALITY_PERFORMANCE_ARTIFACT_DIR || path.join(process.cwd(), 'artifacts', 'performance-smoke');
const STARTUP_BUDGET_MS = 12000;
const SURFACE_FALLBACK_BUDGET_MS = 1500;
const SURFACE_GPU_BUDGET_MS = 15000;
const STARTUP_PIXEL_BUDGET = 1920 * 1080 + 8192;

fs.mkdirSync(artifactDir, { recursive: true });

(async () => {
  const executablePath = process.env.REALITY_CHROMIUM_PATH;
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  try {
    const navigationStartedAt = Date.now();
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Boolean(window.realitySandboxDebug?.ready && window.realitySandboxSurfaceMode), null, { timeout: STARTUP_BUDGET_MS });
    const startupMs = Date.now() - navigationStartedAt;

    const startup = await page.evaluate(() => {
      const canvas = document.getElementById('lofiLivingCanvas');
      const preEntrySurfaceResources = performance.getEntriesByType('resource')
        .map(entry => entry.name)
        .filter(name => /surface-terrain-water-sphere-gpu|surface-visual-layers|three\.module/i.test(name));
      const legacyPresentationResources = performance.getEntriesByType('resource')
        .map(entry => entry.name)
        .filter(name => /world-formation|natural-drag|interaction-pixi|interaction-performance|interaction-cache|interaction-fast-canvas|ui-shell|seed-ui|morphology-genetics|vegetation-terrain|vegetation-render-guard|surface-layer|presentation-layer-fix|presentation-runtime-recovery/i.test(name));
      return {
        renderQuality: document.documentElement.dataset.renderQuality,
        canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
        deferredPresentation: document.documentElement.dataset.deferredPresentation || 'not-started',
        preEntrySurfaceResources,
        legacyPresentationResources,
      };
    });
    assert(startup.canvas, 'Startup did not create the Pixi root canvas.');
    assert(startup.canvas.width * startup.canvas.height <= STARTUP_PIXEL_BUDGET, `Startup canvas exceeds its pixel budget: ${startup.canvas.width}x${startup.canvas.height}.`);
    assert(startup.preEntrySurfaceResources.length === 0, `Heavy Surface resources loaded before entry: ${startup.preEntrySurfaceResources.join(', ')}.`);
    assert(startup.deferredPresentation === 'disabled', `Legacy presentation should be opt-in, got ${startup.deferredPresentation}.`);
    assert(startup.legacyPresentationResources.length === 0, `Legacy presentation resources loaded on the default route: ${startup.legacyPresentationResources.join(', ')}.`);

    // The interaction smoke uses a real Playwright pointer click. Here we
    // measure the handler itself, excluding test-runner actionability waits.
    await page.evaluate(() => {
      const button = document.getElementById('enterSurfaceMode');
      window.__surfaceEntryStartedAt = performance.now();
      button.click();
    });
    await page.waitForFunction(() => document.documentElement.dataset.surfaceModeFallbackReady === 'true', null, { timeout: SURFACE_FALLBACK_BUDGET_MS });
    const fallbackMs = await page.evaluate(() => Number(document.documentElement.dataset.surfaceModeFallbackPaintedAt) - window.__surfaceEntryStartedAt);
    const fallbackPaint = await page.evaluate(() => ({
      active: document.documentElement.dataset.surfaceMode === 'active',
      paintedAt: Number(document.documentElement.dataset.surfaceModeFallbackPaintedAt),
    }));
    assert(fallbackPaint.active && Number.isFinite(fallbackPaint.paintedAt), 'Surface Mode did not paint its immediate fallback.');

    await page.waitForFunction(() => window.realitySandboxPresentationDiagnostics?.().surfaceGpu?.active === true, null, { timeout: SURFACE_GPU_BUDGET_MS });
    const gpuMs = await page.evaluate(() => performance.now() - window.__surfaceEntryStartedAt);
    const gpuHandoff = await page.evaluate(() => ({
      gpuCanvasVisible: getComputedStyle(document.getElementById('surfaceGpuCanvas')).display !== 'none',
      fallbackOpacity: Number(getComputedStyle(document.getElementById('surfaceModeCanvas')).opacity),
    }));

    // This is a synthetic DOM event, so its production listener runs
    // synchronously inside dispatchEvent(). Capture the resulting state in the
    // same browser task instead of polling later and turning a recovery-contract
    // assertion into a scheduler/timing test.
    const fallbackAfterContextLoss = await page.evaluate(() => {
      const gpuCanvas = document.getElementById('surfaceGpuCanvas');
      const fallbackCanvas = document.getElementById('surfaceModeCanvas');
      const dispatched = gpuCanvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
      return {
        dispatched,
        surfaceGpu: document.documentElement.dataset.surfaceGpu,
        fallbackOpacity: Number(getComputedStyle(fallbackCanvas).opacity),
        fallbackInlineOpacity: fallbackCanvas.style.opacity,
        hasShowFallback: typeof window.realitySandboxSurfaceMode?.showFallback === 'function',
        contextLost: Boolean(window.realitySandboxSurfaceSphereV37?.getStats?.().contextLost),
      };
    });

    await page.evaluate(() => document.getElementById('surfaceGpuCanvas').dispatchEvent(new Event('webglcontextrestored')));
    await page.waitForFunction(() => window.realitySandboxPresentationDiagnostics?.().surfaceGpu?.active === true, null, { timeout: 5000 });

    const metrics = { startupMs, fallbackMs, gpuMs, startup, gpuHandoff, fallbackAfterContextLoss, pageErrors };
    fs.writeFileSync(path.join(artifactDir, 'performance.json'), JSON.stringify(metrics, null, 2));

    assert(startupMs <= STARTUP_BUDGET_MS, `Interactive startup exceeded ${STARTUP_BUDGET_MS}ms (${startupMs}ms).`);
    assert(fallbackMs <= SURFACE_FALLBACK_BUDGET_MS, `Surface fallback exceeded ${SURFACE_FALLBACK_BUDGET_MS}ms (${fallbackMs.toFixed(1)}ms).`);
    assert(gpuMs <= SURFACE_GPU_BUDGET_MS, `Surface GPU readiness exceeded ${SURFACE_GPU_BUDGET_MS}ms (${gpuMs.toFixed(1)}ms).`);
    assert(gpuHandoff.gpuCanvasVisible && gpuHandoff.fallbackOpacity === 0, 'Surface GPU did not complete its visible handoff after rendering.');
    assert(
      fallbackAfterContextLoss.surfaceGpu === 'sphere-v37-context-lost' &&
      fallbackAfterContextLoss.fallbackOpacity > 0 &&
      fallbackAfterContextLoss.hasShowFallback &&
      fallbackAfterContextLoss.contextLost,
      `Surface fallback did not return synchronously after simulated context loss: ${JSON.stringify(fallbackAfterContextLoss)}`,
    );
    assert(pageErrors.length === 0, `Performance smoke produced browser errors: ${pageErrors.join(' | ')}`);
  } finally {
    await browser.close();
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }
})().catch(error => {
  fs.writeFileSync(path.join(artifactDir, 'fatal-error.txt'), `${error.stack || error.message}\n`);
  console.error(error);
  process.exitCode = 1;
});