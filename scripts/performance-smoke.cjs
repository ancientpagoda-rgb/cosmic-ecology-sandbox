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
      return {
        renderQuality: document.documentElement.dataset.renderQuality,
        canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
        deferredPresentation: document.documentElement.dataset.deferredPresentation || 'not-started',
      };
    });
    assert(startup.canvas, 'Startup did not create the Pixi root canvas.');
    assert(startup.canvas.width * startup.canvas.height <= STARTUP_PIXEL_BUDGET, `Startup canvas exceeds its pixel budget: ${startup.canvas.width}x${startup.canvas.height}.`);

    // The interaction smoke uses a real Playwright pointer click. Here we
    // measure the handler itself, excluding test-runner actionability waits.
    await page.evaluate(() => {
      const button = document.getElementById('enterSurfaceMode');
      window.__surfaceEntryStartedAt = performance.now();
      button.click();
    });
    await page.waitForFunction(() => document.documentElement.dataset.surfaceModeFallbackReady === 'true', null, { timeout: SURFACE_FALLBACK_BUDGET_MS });
    const fallbackMs = await page.evaluate(() => Number(document.documentElement.dataset.surfaceModeFallbackPaintedAt) - window.__surfaceEntryStartedAt);
    const fallbackVisible = await page.evaluate(() => {
      const canvas = document.getElementById('surfaceModeCanvas');
      const style = canvas && getComputedStyle(canvas);
      const rect = canvas?.getBoundingClientRect();
      return Boolean(canvas && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0);
    });
    assert(fallbackVisible, 'Surface Mode did not show an immediate fallback canvas.');

    await page.waitForFunction(() => window.realitySandboxPresentationDiagnostics?.().surfaceGpu?.active === true, null, { timeout: SURFACE_GPU_BUDGET_MS });
    const gpuMs = await page.evaluate(() => performance.now() - window.__surfaceEntryStartedAt);

    // Dispatching these cancellable events exercises the same production
    // recovery path deterministically, without depending on a GPU driver.
    await page.evaluate(() => document.getElementById('surfaceGpuCanvas').dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
    await page.waitForFunction(() => {
      const canvas = document.getElementById('surfaceModeCanvas');
      return document.documentElement.dataset.surfaceGpu === 'sphere-v37-context-lost' && Number(getComputedStyle(canvas).opacity) > 0;
    }, null, { timeout: 3000 });
    const fallbackAfterContextLoss = await page.evaluate(() => ({
      surfaceGpu: document.documentElement.dataset.surfaceGpu,
      fallbackOpacity: getComputedStyle(document.getElementById('surfaceModeCanvas')).opacity,
    }));

    await page.evaluate(() => document.getElementById('surfaceGpuCanvas').dispatchEvent(new Event('webglcontextrestored')));
    await page.waitForFunction(() => window.realitySandboxPresentationDiagnostics?.().surfaceGpu?.active === true, null, { timeout: 5000 });

    const metrics = { startupMs, fallbackMs, gpuMs, startup, fallbackAfterContextLoss, pageErrors };
    fs.writeFileSync(path.join(artifactDir, 'performance.json'), JSON.stringify(metrics, null, 2));

    assert(startupMs <= STARTUP_BUDGET_MS, `Interactive startup exceeded ${STARTUP_BUDGET_MS}ms (${startupMs}ms).`);
    assert(fallbackMs <= SURFACE_FALLBACK_BUDGET_MS, `Surface fallback exceeded ${SURFACE_FALLBACK_BUDGET_MS}ms (${fallbackMs.toFixed(1)}ms).`);
    assert(gpuMs <= SURFACE_GPU_BUDGET_MS, `Surface GPU readiness exceeded ${SURFACE_GPU_BUDGET_MS}ms (${gpuMs.toFixed(1)}ms).`);
    assert(fallbackAfterContextLoss.surfaceGpu === 'sphere-v37-context-lost' && Number(fallbackAfterContextLoss.fallbackOpacity) > 0, 'Surface fallback did not return after simulated context loss.');
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
