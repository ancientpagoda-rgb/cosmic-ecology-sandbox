const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.REALITY_BASE_URL || 'http://127.0.0.1:4173/';
const artifactDir = process.env.REALITY_CHECK_ARTIFACT_DIR || path.join(process.cwd(), 'artifacts', 'reality-check');
const outputDir = path.join(artifactDir, 'continuous-world-view');
fs.mkdirSync(outputDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push({ message: error.message, stack: error.stack }));

  try {
    const url = new URL(baseUrl);
    url.searchParams.set('debug', '1');
    url.searchParams.set('continuousViewCheck', '1');
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Boolean(
      window.realitySandboxDebug?.ready &&
      window.realitySandboxWorldView?.getSnapshot &&
      window.realitySandboxSurfaceMode?.getPlayer &&
      document.getElementById('lofiLivingCanvas') &&
      document.getElementById('surfaceModeCanvas')
    ), null, { timeout: 120000 });

    const initial = await snapshot(page);
    assert(initial.view.model === 'single-authoritative-location-altitude-continuous-lod-view', 'Unified world-view controller was not authoritative.');
    assert(!initial.view.legacyModeControlsVisible, 'Legacy Enter/Exit Surface controls are still visible.');
    assert(initial.bodyWorldViewSystem === 'single-continuous-altitude-lod', 'Document is not marked as one continuous world-view system.');

    await page.evaluate(() => {
      window.realitySandboxUnified.setCamera({ centerX: 0.61, centerY: 0.42, zoom: 10.7 });
    });
    const globeBox = await page.locator('#lofiLivingCanvas').boundingBox();
    assert(globeBox, 'Globe canvas bounds were unavailable.');
    await page.mouse.move(globeBox.x + globeBox.width * 0.5, globeBox.y + globeBox.height * 0.5);
    await page.mouse.wheel(0, -520);

    await page.waitForFunction(() => window.realitySandboxSurfaceMode?.isActive?.(), null, { timeout: 30000 });
    await page.waitForFunction(() => {
      const view = window.realitySandboxWorldView?.getSnapshot?.();
      return view?.localRendererActive && view.altitude > 40;
    }, null, { timeout: 30000 });
    await page.waitForTimeout(500);

    const descended = await snapshot(page);
    assert(descended.view.localRendererActive, 'Zoom-in did not descend into local LOD automatically.');
    assert(descended.view.transitionsToLocal >= 1, 'Continuous view did not record the orbital-to-local transition.');
    assert(circularDistance(descended.view.location.nx, 0.61) < 0.025, `Local longitude drifted during LOD handoff (${descended.view.location.nx}).`);
    assert(Math.abs(descended.view.location.ny - 0.42) < 0.025, `Local latitude drifted during LOD handoff (${descended.view.location.ny}).`);
    assert(!descended.view.legacyModeControlsVisible, 'Mode buttons became visible after descending.');
    await page.screenshot({ path: path.join(outputDir, 'descending-blend.png'), fullPage: true });

    // Surface GPU historically froze the simulation. Under the merged system,
    // the world clock must continue at local scale as soon as the GPU wrapper is installed.
    await page.waitForFunction(() => Boolean(window.realitySandboxSurfaceSphereV37?.installed), null, { timeout: 30000 });
    await page.waitForFunction(() => window.realitySandboxWorldView?.getSnapshot?.().simulationContinuous === true, null, { timeout: 30000 });
    const tickBefore = await page.evaluate(() => window.realitySandboxPlanet.world.tick);
    await page.waitForTimeout(900);
    const tickAfter = await page.evaluate(() => window.realitySandboxPlanet.world.tick);
    assert(tickAfter > tickBefore, `Simulation stopped in local LOD (${tickBefore} -> ${tickAfter}).`);

    // Physically move in local view and prove the underlying globe camera follows
    // the same authoritative location before the outward handoff.
    await page.evaluate(() => {
      const mode = window.realitySandboxSurfaceMode;
      const player = mode.getPlayer();
      // The internal controller still owns walking; use its public location by
      // entering the same continuous view at a nearby point for deterministic CI.
      mode.enterAt(player.x + 22, player.y + 11);
    });
    await page.waitForTimeout(280);
    const moved = await snapshot(page);
    assert(circularDistance(moved.view.location.nx, moved.view.globeCamera.centerX) < 0.0025, 'Globe longitude did not follow local movement.');
    assert(Math.abs(moved.view.location.ny - moved.view.globeCamera.centerY) < 0.0025, 'Globe latitude did not follow local movement.');

    const surfaceBox = await page.locator('#surfaceModeCanvas').boundingBox();
    assert(surfaceBox, 'Local view canvas bounds were unavailable.');
    await page.mouse.move(surfaceBox.x + surfaceBox.width * 0.5, surfaceBox.y + surfaceBox.height * 0.5);
    for (let i = 0; i < 7; i++) {
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(90);
      if (!await page.evaluate(() => window.realitySandboxSurfaceMode?.isActive?.())) break;
    }

    await page.waitForFunction(() => !window.realitySandboxSurfaceMode?.isActive?.(), null, { timeout: 30000 });
    await page.waitForTimeout(220);
    const orbital = await snapshot(page);
    assert(!orbital.view.localRendererActive, 'Zoom-out did not return to globe LOD automatically.');
    assert(orbital.view.transitionsToGlobe >= 1, 'Continuous view did not record the local-to-orbital transition.');
    assert(orbital.view.globeCamera.zoom <= 9.2 && orbital.view.globeCamera.zoom >= 8.3, `Unexpected globe handoff zoom ${orbital.view.globeCamera.zoom}.`);
    assert(circularDistance(orbital.view.location.nx, orbital.view.globeCamera.centerX) < 0.001, 'Location changed during local-to-globe handoff.');
    assert(Math.abs(orbital.view.location.ny - orbital.view.globeCamera.centerY) < 0.001, 'Latitude changed during local-to-globe handoff.');
    assert(!orbital.view.legacyModeControlsVisible, 'Legacy mode controls returned after outward handoff.');
    await page.screenshot({ path: path.join(outputDir, 'orbital-after-zoom-out.png'), fullPage: true });

    assert(pageErrors.length === 0, `Browser page errors: ${pageErrors.map(error => error.message).join(' | ')}`);

    const result = {
      ok: true,
      model: 'single-continuous-camera-location-altitude-lod-chain',
      initial,
      descended,
      simulationTicks: { before: tickBefore, after: tickAfter },
      moved,
      orbital,
      pageErrors,
    };
    fs.writeFileSync(path.join(outputDir, 'continuous-world-view.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
})().catch(error => {
  fs.writeFileSync(path.join(outputDir, 'fatal-error.txt'), `${error.stack || error.message}\n`);
  console.error(error);
  process.exitCode = 1;
});

async function snapshot(page) {
  return page.evaluate(() => ({
    view: window.realitySandboxWorldView?.getSnapshot?.() || null,
    surfaceActive: Boolean(window.realitySandboxSurfaceMode?.isActive?.()),
    bodyWorldViewSystem: document.body.dataset.worldViewSystem || null,
    worldTick: window.realitySandboxPlanet?.world?.tick ?? null,
    surfaceLayerOpacity: document.getElementById('surfaceModeLayer')?.style.opacity || null,
  }));
}

function circularDistance(a, b) {
  const delta = Math.abs(Number(a) - Number(b)) % 1;
  return Math.min(delta, 1 - delta);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
