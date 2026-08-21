const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.REALITY_BASE_URL || 'http://127.0.0.1:4173/';
const artifactDir = process.env.REALITY_IPHONE_ARTIFACT_DIR || path.join(process.cwd(), 'artifacts', 'iphone-sphere-smoke');
fs.mkdirSync(artifactDir, { recursive: true });

(async () => {
  const viewport = { width: 393, height: 852 };
  const executablePath = process.env.REALITY_CHROMIUM_PATH;
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const context = await browser.newContext({ viewport, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Boolean(window.realitySandboxDebug?.ready && window.realitySandboxWorldView), null, { timeout: 120000 });
    await page.waitForTimeout(700);
    const before = await page.evaluate(() => window.realitySandboxUnified.getSnapshot().selectedRegion);
    await page.touchscreen.tap(viewport.width * 0.56, viewport.height * 0.48);
    await page.waitForTimeout(120);
    const metrics = await page.evaluate(() => {
      const canvas = document.getElementById('lofiLivingCanvas');
      const canvasRect = canvas.getBoundingClientRect();
      const dashboard = document.querySelector('.planet-dashboard').getBoundingClientRect();
      const inspector = document.querySelector('.planet-inspector').getBoundingClientRect();
      const approvedPresentationCanvases = new Set(['weatherPresentationCanvas', 'surfaceDetailCanvas', 'surfaceModeCanvas']);
      const visibleCanvases = [...document.querySelectorAll('canvas')]
        .filter(node => {
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        })
        .map(node => node.id);
      const visibleSimulationCanvases = visibleCanvases.filter(id => !approvedPresentationCanvases.has(id));
      return {
        canvas: { bitmapWidth: canvas.width, bitmapHeight: canvas.height, cssWidth: canvasRect.width, cssHeight: canvasRect.height },
        dashboard: { left: dashboard.left, right: dashboard.right, top: dashboard.top, bottom: dashboard.bottom },
        inspector: { left: inspector.left, right: inspector.right, top: inspector.top, bottom: inspector.bottom },
        mastheadPresent: Boolean(document.querySelector('.planet-masthead')),
        visibleCanvases,
        visibleSimulationCanvases,
        statDefinitions: document.querySelectorAll('.planet-stat[title][tabindex="0"]').length,
        snapshot: window.realitySandboxUnified.getSnapshot(),
        after: window.realitySandboxUnified.getSnapshot().selectedRegion,
        worldView: window.realitySandboxWorldView.getSnapshot(),
      };
    });
    fs.writeFileSync(path.join(artifactDir, 'iphone-living-planet.json'), JSON.stringify({ ok: null, viewport, metrics, pageErrors }, null, 2));
    const bitmapAspect = metrics.canvas.bitmapWidth / metrics.canvas.bitmapHeight;
    const cssAspect = metrics.canvas.cssWidth / metrics.canvas.cssHeight;
    assert(Math.abs(bitmapAspect - cssAspect) < 0.03, `Canvas aspect mismatch: ${bitmapAspect} vs ${cssAspect}.`);
    assert(metrics.canvas.bitmapWidth >= 170 && metrics.canvas.bitmapHeight >= 340, `Mobile logical resolution is too low: ${metrics.canvas.bitmapWidth}x${metrics.canvas.bitmapHeight}.`);
    assert(metrics.visibleSimulationCanvases.length === 1 && metrics.visibleSimulationCanvases[0] === 'eidolonSingleWorldCanvas' && metrics.snapshot.presentation.renderer === 'three-single-spherical-world-scene', `Mobile must use the single spherical world canvas plus approved presentation layers: ${JSON.stringify(metrics.visibleCanvases)}`);
    assert(metrics.dashboard.left >= 0 && metrics.dashboard.right <= viewport.width && metrics.dashboard.bottom <= viewport.height, 'Dashboard overflows the iPhone viewport.');
    assert(metrics.inspector.left >= 0 && metrics.inspector.right <= viewport.width && metrics.inspector.bottom <= viewport.height, 'Inspector overflows the iPhone viewport.');
    assert(metrics.dashboard.bottom <= metrics.inspector.top || metrics.inspector.bottom <= metrics.dashboard.top, 'Mobile dashboard overlaps the inspector.');
    assert(!metrics.mastheadPresent, 'The planet must not restore a masthead on iPhone.');
    assert(metrics.statDefinitions === 8, 'Mobile statistics lost their definitions.');
    assert(metrics.snapshot.presentation.interactions.regionInspection === true, 'Mobile world view lost region inspection support.');
    assert(metrics.after?.title && Number.isFinite(metrics.after.latitude) && Number.isFinite(metrics.after.longitude), 'Mobile touch inspection did not yield a valid region.');
    assert(metrics.snapshot.presentation.drawnEntities > 0 && pageErrors.length === 0, `Mobile scene is empty or errored: ${pageErrors.join(' | ')}`);
    assert(metrics.worldView.model === 'single-three-scene-single-camera-spherical-lod' && metrics.worldView.oneScene && metrics.worldView.oneCamera, 'iPhone did not use the single spherical world view.');

    // The player no longer taps a separate mode button. This lower-level mobile
    // diagnostic opens the local renderer directly so its touch controls can be
    // tested independently; the continuous zoom handoff is covered elsewhere.
    await page.evaluate(() => {
      const world = window.realitySandboxPlanet.world;
      const camera = window.realitySandboxUnified.getCamera();
      window.realitySandboxSurfaceMode.enterAt(camera.centerX * world.width, camera.centerY * world.height);
    });
    await page.waitForFunction(() => document.documentElement.dataset.surfaceMode === 'active' &&
      window.realitySandboxPresentationDiagnostics?.().surfaceGpu?.active === true &&
      document.documentElement.dataset.surfaceMobileControls === 'active', null, { timeout: 20000 });
    const surfaceBefore = await page.evaluate(() => window.realitySandboxSurfaceMode.getPlayer());
    await page.evaluate(() => {
      const stick = document.querySelector('#surfaceMobileControls [aria-label="Movement joystick"]');
      const rect = stick.getBoundingClientRect();
      stick.setPointerCapture = () => {};
      const event = (type, x, y) => stick.dispatchEvent(new PointerEvent(type, {
        pointerId: 44, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true,
      }));
      const startX = rect.left + rect.width / 2;
      const startY = rect.top + rect.height / 2 - rect.height * 0.28;
      const moveX = rect.left + rect.width / 2 + rect.width * 0.28;
      const moveY = rect.top + rect.height / 2 - rect.height * 0.08;
      event('pointerdown', startX, startY);
      window.setTimeout(() => event('pointermove', moveX, moveY), 120);
      window.setTimeout(() => event('pointerup', moveX, moveY), 460);
    });
    await page.waitForTimeout(620);
    const surfaceAfter = await page.evaluate(() => ({
      player: window.realitySandboxSurfaceMode.getPlayer(),
      controlsVisible: getComputedStyle(document.getElementById('surfaceMobileControls')).display !== 'none',
    }));
    assert(surfaceAfter.controlsVisible, 'Local LOD did not show touch controls on iPhone.');
    assert(Number.isFinite(surfaceAfter.player.x) && Number.isFinite(surfaceAfter.player.y), 'The iPhone local-view player state is invalid.');
    await page.evaluate(() => window.realitySandboxSurfaceMode.exit());
    await page.waitForFunction(() => document.documentElement.dataset.surfaceMode === 'inactive', null, { timeout: 10000 });

    fs.writeFileSync(path.join(artifactDir, 'iphone-living-planet.json'), JSON.stringify({ ok: true, viewport, metrics, pageErrors }, null, 2));
    await page.screenshot({ path: path.join(artifactDir, 'iphone-living-planet.png'), fullPage: true });
  } finally {
    await context.close();
    await browser.close();
  }
  function assert(condition, message) { if (!condition) throw new Error(message); }
})().catch(error => {
  fs.writeFileSync(path.join(artifactDir, 'fatal-error.txt'), `${error.stack || error.message}\n`);
  console.error(error);
  process.exitCode = 1;
});
