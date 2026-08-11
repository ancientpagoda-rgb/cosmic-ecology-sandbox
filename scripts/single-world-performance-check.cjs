const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.REALITY_BASE_URL || 'http://127.0.0.1:4173/';
const artifactDir = process.env.REALITY_PERFORMANCE_ARTIFACT_DIR || path.join(process.cwd(), 'artifacts', 'single-world-performance');
fs.mkdirSync(artifactDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  try {
    const started = Date.now();
    await page.goto(`${baseUrl}?debug=1&singleWorldPerformance=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Boolean(
      window.realitySandboxWorldView?.model === 'single-three-scene-single-camera-spherical-lod' &&
      document.getElementById('eidolonSingleWorldCanvas')
    ), null, { timeout: 120000 });
    const readyMs = Date.now() - started;
    await page.waitForTimeout(200);

    const initial = await snap(page);
    assert(initial.visibleCanvases.length === 1 && initial.visibleCanvases[0] === 'eidolonSingleWorldCanvas', `Expected one visible canvas: ${initial.visibleCanvases}`);
    assert(initial.view.rendererSwaps === 0 && initial.view.canvasSwaps === 0, 'Renderer/canvas swapped during startup.');

    const orbitFrames0 = initial.view.frames;
    await page.waitForTimeout(1000);
    const orbit = await snap(page);
    const orbitFrames = orbit.view.frames - orbitFrames0;
    assert(orbitFrames >= 12, `Orbit renderer produced only ${orbitFrames} frames in one second under SwiftShader.`);

    const patchBefore = orbit.view.patchBuilds;
    await page.evaluate(() => window.realitySandboxWorldView.setAltitude(9));
    const localStarted = Date.now();
    await page.waitForFunction(before => window.realitySandboxWorldView.getSnapshot().patchBuilds > before, patchBefore, { timeout: 5000 });
    const firstPatchMs = Date.now() - localStarted;
    const ground0 = await snap(page);
    await page.waitForTimeout(1000);
    const ground = await snap(page);
    const groundFrames = ground.view.frames - ground0.view.frames;
    assert(groundFrames >= 10, `Ground renderer produced only ${groundFrames} frames in one second under SwiftShader.`);
    assert(firstPatchMs < 3000, `Initial local spherical LOD took ${firstPatchMs} ms to become available.`);
    assert(ground.view.rendererSwaps === 0 && ground.view.canvasSwaps === 0, 'Ground LOD caused a renderer/canvas swap.');

    const rebuildBefore = ground.view.patchBuilds;
    const moveStarted = Date.now();
    await page.evaluate(() => {
      const view = window.realitySandboxWorldView;
      const state = view.getSnapshot();
      view.setLocation(state.x + 32, state.y + 8);
    });
    await page.waitForFunction(before => window.realitySandboxWorldView.getSnapshot().patchBuilds > before, rebuildBefore, { timeout: 5000 });
    const movingPatchMs = Date.now() - moveStarted;
    assert(movingPatchMs < 3000, `Moving local spherical LOD took ${movingPatchMs} ms to rebuild.`);

    await page.evaluate(() => window.realitySandboxWorldView.setAltitude(700));
    await page.waitForTimeout(220);
    const returned = await snap(page);
    assert(returned.visibleCanvases.length === 1 && returned.visibleCanvases[0] === 'eidolonSingleWorldCanvas', 'Visible canvas changed after returning to orbit.');
    assert(returned.view.rendererSwaps === 0 && returned.view.canvasSwaps === 0, 'Renderer/canvas swapped during performance sweep.');
    assert(pageErrors.length === 0, `Page errors: ${pageErrors.join(' | ')}`);

    await page.screenshot({ path: path.join(artifactDir, 'single-world-performance.png'), fullPage: true });
    const result = { ok: true, readyMs, orbitFrames, groundFrames, firstPatchMs, movingPatchMs, initial, ground, returned, pageErrors };
    fs.writeFileSync(path.join(artifactDir, 'single-world-performance.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => {
  fs.writeFileSync(path.join(artifactDir, 'fatal-error.txt'), `${error.stack || error.message}\n`);
  console.error(error);
  process.exitCode = 1;
});

async function snap(page) {
  return page.evaluate(() => ({
    view: window.realitySandboxWorldView.getSnapshot(),
    visibleCanvases: [...document.querySelectorAll('canvas')].filter(element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
    }).map(element => element.id),
  }));
}
function assert(condition, message) { if (!condition) throw new Error(message); }
