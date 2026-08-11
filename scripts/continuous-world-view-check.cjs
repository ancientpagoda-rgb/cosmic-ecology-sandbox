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
    url.searchParams.set('continuousViewCheck', '2');
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Boolean(
      window.realitySandboxDebug?.ready &&
      window.realitySandboxWorldView?.getSnapshot &&
      window.realitySandboxWorldView?.model === 'single-three-scene-single-camera-spherical-lod' &&
      document.getElementById('eidolonSingleWorldCanvas')
    ), null, { timeout: 120000 });
    await page.waitForTimeout(450);

    const initial = await snapshot(page);
    assert(initial.view.model === 'single-three-scene-single-camera-spherical-lod', 'The true single-scene renderer is not authoritative.');
    assert(initial.view.oneScene && initial.view.oneCamera, 'The world view is not reporting one scene and one camera.');
    assert(initial.view.rendererSwaps === 0 && initial.view.canvasSwaps === 0, 'Renderer/canvas swaps already occurred at startup.');
    assert(initial.visibleCanvases.length === 1 && initial.visibleCanvases[0] === 'eidolonSingleWorldCanvas', `Expected one visible world canvas, got ${initial.visibleCanvases.join(', ')}`);
    assert(initial.bodyWorldViewSystem === 'single-three-spherical-camera', 'Document is not marked as the single Three.js world-view system.');
    assert(!initial.legacyEnterVisible && !initial.legacyExitVisible, 'Legacy Surface enter/exit controls are still visible.');
    await page.screenshot({ path: path.join(outputDir, 'orbit-start.png'), fullPage: true });

    const canvas = page.locator('#eidolonSingleWorldCanvas');
    const box = await canvas.boundingBox();
    assert(box, 'Unified world canvas bounds were unavailable.');
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);

    // Descend through the same camera. No DOM/canvas/render system may swap.
    for (let i = 0; i < 13; i++) {
      await page.mouse.wheel(0, -430);
      await page.waitForTimeout(35);
      const altitude = await page.evaluate(() => window.realitySandboxWorldView.getSnapshot().altitude);
      if (altitude < 12) break;
    }
    await page.waitForFunction(() => window.realitySandboxWorldView?.getSnapshot?.().altitude < 16, null, { timeout: 30000 });
    await page.waitForTimeout(240);
    const ground = await snapshot(page);
    assert(ground.view.tier === 'ground' || ground.view.tier === 'aerial', `Expected local tier, got ${ground.view.tier}.`);
    assertSameRenderer(initial, ground, 'ground descent');
    assert(ground.view.patchBuilds >= 1, 'High-detail local spherical geometry was not built near the ground.');
    assert(!ground.surfaceActive, 'Legacy Surface Mode activated during true single-scene descent.');
    await page.screenshot({ path: path.join(outputDir, 'ground-same-scene.png'), fullPage: true });

    const tickBefore = ground.worldTick;
    await page.waitForTimeout(900);
    const tickAfter = await page.evaluate(() => window.realitySandboxPlanet.world.tick);
    assert(tickAfter > tickBefore, `Simulation stopped near the ground (${tickBefore} -> ${tickAfter}).`);

    // Move locally in the same spherical camera.
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(260);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(100);
    const moved = await snapshot(page);
    assert(distance2(moved.view.x, moved.view.y, ground.view.x, ground.view.y) > 0.2, 'Ground movement did not change the authoritative spherical camera location.');
    assertSameRenderer(initial, moved, 'ground movement');

    // Now zoom all the way back to a visibly orbital/globe scale. The renderer,
    // scene, camera object and canvas must still be the exact same system.
    for (let i = 0; i < 15; i++) {
      await page.mouse.wheel(0, 520);
      await page.waitForTimeout(35);
      const altitude = await page.evaluate(() => window.realitySandboxWorldView.getSnapshot().altitude);
      if (altitude > 520) break;
    }
    await page.waitForFunction(() => window.realitySandboxWorldView?.getSnapshot?.().altitude > 500, null, { timeout: 30000 });
    await page.waitForTimeout(250);
    const globe = await snapshot(page);
    assert(globe.view.tier === 'cosmic' || globe.view.tier === 'orbit', `Expected orbital/globe tier, got ${globe.view.tier}.`);
    assertSameRenderer(initial, globe, 'zoom back to globe');
    assert(!globe.surfaceActive, 'Legacy Surface Mode activated during outward zoom.');
    assert(globe.view.patchBuilds === moved.view.patchBuilds || globe.view.patchBuilds >= moved.view.patchBuilds, 'Local LOD accounting regressed while zooming out.');
    await page.screenshot({ path: path.join(outputDir, 'globe-same-scene.png'), fullPage: true });

    // Exercise a wide range without ever permitting a renderer/canvas handoff.
    const altitudeSequence = [220, 95, 34, 8, 52, 180, 420, 900, 70, 12, 300];
    const sequence = [];
    for (const altitude of altitudeSequence) {
      await page.evaluate(value => window.realitySandboxWorldView.setAltitude(value), altitude);
      await page.waitForTimeout(55);
      const sample = await snapshot(page);
      assertSameRenderer(initial, sample, `altitude ${altitude}`);
      sequence.push({ altitude: sample.view.altitude, tier: sample.view.tier, canvas: sample.visibleCanvases[0] });
    }

    const invariants = await page.evaluate(() => window.realitySandboxUnified.runInvariants?.());
    assert(invariants?.ok, `Unified runtime invariants failed: ${(invariants?.failures || []).join(' | ')}`);
    assert(pageErrors.length === 0, `Browser page errors: ${pageErrors.map(error => error.message).join(' | ')}`);

    const result = {
      ok: true,
      model: 'one-three-scene-one-perspective-camera-ground-to-globe',
      initial,
      ground,
      moved,
      globe,
      simulationTicks: { before: tickBefore, after: tickAfter },
      altitudeSequence: sequence,
      invariants,
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
  return page.evaluate(() => {
    const visibleCanvases = [...document.querySelectorAll('canvas')].filter(element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
    }).map(element => element.id || '(unnamed)');
    const enter = document.getElementById('enterSurfaceMode');
    const exit = document.querySelector('#surfaceModeHud button');
    return {
      view: window.realitySandboxWorldView?.getSnapshot?.() || null,
      surfaceActive: Boolean(window.realitySandboxSurfaceMode?.isActive?.()),
      bodyWorldViewSystem: document.body.dataset.worldViewSystem || null,
      worldTick: window.realitySandboxPlanet?.world?.tick ?? null,
      visibleCanvases,
      legacyEnterVisible: Boolean(enter && getComputedStyle(enter).display !== 'none' && !enter.hidden),
      legacyExitVisible: Boolean(exit && getComputedStyle(exit).display !== 'none' && !exit.hidden),
    };
  });
}

function assertSameRenderer(initial, next, label) {
  assert(next.view.canvasId === initial.view.canvasId, `${label}: canvas id changed (${initial.view.canvasId} -> ${next.view.canvasId}).`);
  assert(next.view.renderer === initial.view.renderer, `${label}: renderer changed.`);
  assert(next.view.oneScene && next.view.oneCamera, `${label}: one-scene/one-camera invariant was lost.`);
  assert(next.view.rendererSwaps === 0 && next.view.canvasSwaps === 0, `${label}: a renderer/canvas swap occurred.`);
  assert(next.visibleCanvases.length === 1 && next.visibleCanvases[0] === initial.view.canvasId, `${label}: visible canvas set changed (${next.visibleCanvases.join(', ')}).`);
}
function distance2(ax, ay, bx, by) { return Math.hypot(Number(ax) - Number(bx), Number(ay) - Number(by)); }
function assert(condition, message) { if (!condition) throw new Error(message); }
