const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.REALITY_BASE_URL || 'http://127.0.0.1:4173/';
const artifactDir = process.env.REALITY_SURFACE_MODE_ARTIFACT_DIR || path.join(process.cwd(), 'artifacts', 'surface-mode-smoke');
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
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Boolean(window.realitySandboxSurfaceMode && window.realitySandboxPlanet && window.realitySandboxUnified && document.getElementById('enterSurfaceMode')), null, { timeout: 120000 });
    await page.click('#enterSurfaceMode');
    await page.waitForFunction(() => document.documentElement.dataset.surfaceMode === 'active', null, { timeout: 30000 });
    await page.waitForFunction(() => {
      const diagnostics = window.realitySandboxPresentationDiagnostics?.();
      return diagnostics?.surfaceModeRenderer === 'gpu-controller-spherical-topology' &&
        diagnostics?.surfaceGpu?.renderer === 'WebGLRenderer' &&
        diagnostics?.surfaceGpu?.active === true &&
        diagnostics?.surfaceFloraV78?.installed === true &&
        diagnostics?.surfaceFloraV78?.presentation === 'procedural-3d-plants' &&
        window.realitySandboxSurfaceInputV87?.installed === true &&
        typeof window.realitySandboxSurfaceExpedition?.scan === 'function' &&
        typeof window.realitySandboxSurfaceExpedition?.getVisibleFlora === 'function';
    }, null, { timeout: 30000 });
    await page.waitForFunction(
      () => window.realitySandboxSurfaceSphereV37?.getStats?.().nearBuildsCompleted >= 1,
      null,
      { timeout: 30000 },
    );
    await page.waitForTimeout(220);

    const before = await page.evaluate(() => ({
      player: window.realitySandboxSurfaceMode.getPlayer(),
      diagnostics: window.realitySandboxPresentationDiagnostics(),
    }));

    await page.keyboard.down('w');
    await page.waitForTimeout(420);
    await page.keyboard.up('w');
    await page.waitForTimeout(120);
    await page.keyboard.press('e');
    await page.waitForFunction(() => document.getElementById('surfaceFieldNote')?.style.opacity === '1', null, { timeout: 5000 });

    const after = await page.evaluate(() => ({
      player: window.realitySandboxSurfaceMode.getPlayer(),
      diagnostics: window.realitySandboxPresentationDiagnostics(),
      flora: window.realitySandboxSurfaceFloraV78?.getStats?.() || null,
      input: window.realitySandboxSurfaceInputV87 || null,
      active: window.realitySandboxSurfaceMode.isActive(),
      globePresentation: document.documentElement.dataset.globePresentation,
      canvasVisible: (() => {
        const canvas = document.getElementById('surfaceModeCanvas');
        if (!canvas) return false;
        const style = getComputedStyle(canvas);
        const rect = canvas.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      })(),
      classicRootPresent: Boolean(document.getElementById('lofiLivingCanvas')),
      experimentalSphericalInstalled: Boolean(window.realitySandboxSingleSphericalRenderer?.installed),
      sphereStats: window.realitySandboxSurfaceSphereV37?.getStats?.() || null,
      visibleCreatureDataset: document.documentElement.dataset.surfaceModeVisibleCreatures,
      visiblePlantDataset: document.documentElement.dataset.surfaceModeVisiblePlants,
    }));

    await page.screenshot({ path: path.join(artifactDir, 'surface-mode.png'), fullPage: true });
    fs.writeFileSync(path.join(artifactDir, 'surface-mode.json'), JSON.stringify({ before, after, pageErrors }, null, 2));

    const moved = Math.hypot(after.player.x - before.player.x, after.player.y - before.player.y);
    assert(before.diagnostics.surfaceModeReady === true, 'Surface mode diagnostics never became ready.');
    assert(after.active && after.canvasVisible, 'Surface mode did not remain active with a visible surface canvas.');
    assert(after.diagnostics.surfaceMode === 'active' && after.diagnostics.surfaceModeCanvasPresent, 'Surface mode diagnostics do not report an active presentation.');
    assert(after.diagnostics.surfaceModeRenderer === 'gpu-controller-spherical-topology', `Unexpected Surface controller (${after.diagnostics.surfaceModeRenderer}).`);
    assert(after.diagnostics.surfaceGpu?.renderer === 'WebGLRenderer' && after.diagnostics.surfaceGpu?.gpuPrimary === true, 'Surface mode did not select the cached WebGL GPU renderer.');
    assert(before.player.pitch >= 0.18, `Surface mode should start terrain-facing, not at the empty horizon (pitch ${before.player.pitch}).`);
    assert(after.diagnostics.surfaceGpu?.fauna?.renderLoopProceduralSamples === 0, 'Surface ecology performs procedural sampling in the render loop.');
    assert(after.diagnostics.surfaceGpu?.fauna?.visible >= 1, 'Surface ecology did not present nearby living instances.');
    assert(after.flora?.installed === true && after.flora?.presentation === 'procedural-3d-plants', 'The grounded 3D flora presentation did not install.');
    assert(after.flora?.gpuInstancing === true && after.flora?.rootedToTerrain === true, 'The Surface flora presentation lost GPU instancing or terrain rooting.');
    assert(after.flora?.legacyFaunaVisible === false && after.flora?.hiddenLegacyFauna >= 1, 'Legacy animal geometry remained visible in the classic plant presentation.');
    assert(after.input?.installed === true && after.input?.gamepad === 'standard-mapping-dual-stick', 'The v87 mouse/gamepad input layer did not install.');
    assert(after.visibleCreatureDataset === '0', `Visible creature dataset should be zero in classic flora mode (${after.visibleCreatureDataset}).`);
    const visiblePlantDataset = Number(after.visiblePlantDataset);
    assert(Number.isFinite(visiblePlantDataset) && visiblePlantDataset >= 0, `Visible plant dataset is invalid (${after.visiblePlantDataset}).`);
    assert(moved > 0.5, `WASD movement did not move the player enough (${moved}).`);
    assert(after.classicRootPresent, 'Classic root living canvas disappeared while Surface Mode was active.');
    assert(!after.experimentalSphericalInstalled, 'Smooth spherical renderer installed on the explicit classic fallback route.');
    assert(after.sphereStats?.simulationRunning === false, 'Classic Surface presentation no longer applies its intended simulation-relief budget.');
    assert(pageErrors.length === 0, `Surface mode produced browser errors: ${pageErrors.join(' | ')}`);

    await page.evaluate(() => window.realitySandboxSurfaceMode.exit());
    await page.waitForFunction(() => document.documentElement.dataset.surfaceMode === 'inactive', null, { timeout: 10000 });

    await page.evaluate(() => {
      const camera = window.realitySandboxUnified.getCamera();
      const world = window.realitySandboxPlanet.world;
      window.realitySandboxSurfaceMode.enterAt(camera.centerX * world.width, camera.centerY * world.height);
    });
    await page.waitForFunction(() => {
      const diagnostics = window.realitySandboxPresentationDiagnostics?.();
      return document.documentElement.dataset.surfaceMode === 'active' &&
        diagnostics?.surfaceGpu?.active === true &&
        diagnostics?.surfaceFloraV78?.active === true &&
        window.realitySandboxSurfaceInputV87?.installed === true;
    }, null, { timeout: 15000 });
    await page.evaluate(() => window.realitySandboxSurfaceMode.exit());
    await page.waitForFunction(() => document.documentElement.dataset.surfaceMode === 'inactive', null, { timeout: 10000 });
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
