const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.REALITY_BASE_URL || 'http://127.0.0.1:4173/';
const artifactDir = process.env.REALITY_UNIFIED_ARTIFACT_DIR || path.join(process.cwd(), 'artifacts', 'unified-smoke');
fs.mkdirSync(artifactDir, { recursive: true });

(async () => {
  const executablePath = process.env.REALITY_CHROMIUM_PATH;
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageErrors = [];
  const failedRequests = [];
  const consoleEntries = [];
  page.on('pageerror', error => pageErrors.push({ message: error.message, stack: error.stack }));
  page.on('requestfailed', request => failedRequests.push({ url: request.url(), failure: request.failure() }));
  page.on('console', message => consoleEntries.push({ type: message.type(), text: message.text() }));

  try {
    const url = new URL(baseUrl);
    url.searchParams.set('debug', '1');
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Boolean(window.realitySandboxDebug?.ready && window.realitySandboxUnified), null, { timeout: 120000 });
    await page.waitForTimeout(900);

    const initial = await page.evaluate(() => {
      const visible = element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
      };
      const canvas = document.getElementById('lofiLivingCanvas');
      return {
        title: document.title,
        diagnostics: window.realitySandboxDebug.diagnostics(),
        snapshot: window.realitySandboxUnified.getSnapshot(),
        modules: window.realitySandboxModules.list().map(module => module.id),
        visibleCanvases: [...document.querySelectorAll('canvas')].filter(visible).length,
        visibleControls: [...document.querySelectorAll('.planet-dashboard button, .planet-dashboard select')].filter(visible).length,
        statDefinitions: document.querySelectorAll('.planet-stat[title][tabindex="0"]').length,
        statValues: [...document.querySelectorAll('[data-stat]')].map(node => node.textContent.trim()),
        inspector: Boolean(document.querySelector('.planet-inspector')),
        canvas: canvas ? { width: canvas.width, height: canvas.height, imageRendering: getComputedStyle(canvas).imageRendering } : null,
        retiredGlobals: Boolean(window.realitySandboxHifi || window.realitySandboxLilacClouds || window.realitySandboxRainRunoff),
        universeGlobals: Boolean(window.realitySandboxPhase8 || window.realitySandboxPhase9 || window.realitySandboxPhase10 || window.realitySandboxPhase11),
      };
    });
    writeJson('initial.json', initial);
    assert(initial.title.includes('Procedural Living Planet'), 'The public title does not identify the procedural living planet.');
    assert(initial.diagnostics.ok, `Initial diagnostics failed: ${initial.diagnostics.failures.join(', ')}`);
    assert(initial.modules.join('|') === 'planet.orbit-seasons|planet.water-cycle|planet.living-ecology|planet.climate-terrain-feedbacks|runtime.procedural-living-planet', `Unexpected root modules: ${initial.modules.join(', ')}`);
    assert(initial.snapshot.mode === 'procedural-living-planet' && initial.snapshot.planet.fictional && !initial.snapshot.planet.earthData, 'The root is not honestly labeled as a fictional procedural planet.');
    assert(initial.snapshot.presentation.renderer === 'pixi-single-canvas' && !initial.snapshot.presentation.tickerStarted, 'The single-renderer contract failed.');
    assert(initial.visibleCanvases === 1 && initial.canvas, 'The root must have exactly one visible canvas.');
    assert(initial.visibleControls === 3 && initial.inspector, 'The integrated controls or inspector are missing.');
    assert(initial.statDefinitions === 8, 'All eight global statistics must expose definitions.');
    assert(initial.statValues.every(value => value && value !== '—'), `A statistic did not initialize: ${initial.statValues.join(', ')}`);
    assert(!initial.retiredGlobals && !initial.universeGlobals, 'A retired renderer or universe phase loaded in the public root.');

    const canvasBox = await page.locator('#lofiLivingCanvas').boundingBox();
    assert(canvasBox && canvasBox.width > 0 && canvasBox.height > 0, 'The planet canvas has no interactive bounds.');
    const centerX = canvasBox.x + canvasBox.width * 0.5;
    const centerY = canvasBox.y + canvasBox.height * 0.5;
    const cameraBefore = await page.evaluate(() => window.realitySandboxUnified.getCamera());
    await page.mouse.move(centerX, centerY);
    await page.mouse.wheel(0, -480);
    await page.waitForTimeout(150);
    const cameraZoomed = await page.evaluate(() => window.realitySandboxUnified.getCamera());
    assert(cameraZoomed.zoom > cameraBefore.zoom, 'Mouse-wheel zoom did not change the camera.');
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 100, centerY + 45, { steps: 6 });
    await page.mouse.up();
    const cameraDragged = await page.evaluate(() => window.realitySandboxUnified.getCamera());
    assert(Math.abs(cameraDragged.centerX - cameraZoomed.centerX) > 0.0001 || Math.abs(cameraDragged.centerY - cameraZoomed.centerY) > 0.0001, 'Drag rotation did not move the camera.');
    await page.keyboard.press('0');
    const cameraReset = await page.evaluate(() => window.realitySandboxUnified.getCamera());
    assert(cameraReset.zoom === 1 && cameraReset.centerX === 0.5 && cameraReset.centerY === 0.5, 'Keyboard camera reset failed.');

    const regionBefore = await page.evaluate(() => window.realitySandboxUnified.getSnapshot().selectedRegion);
    await page.mouse.click(canvasBox.x + canvasBox.width * 0.62, canvasBox.y + canvasBox.height * 0.56);
    await page.waitForTimeout(120);
    const regionAfter = await page.evaluate(() => window.realitySandboxUnified.getSnapshot().selectedRegion);
    assert(Math.abs(regionAfter.longitude - regionBefore.longitude) > 0.5 || Math.abs(regionAfter.latitude - regionBefore.latitude) > 0.5, 'Clicking the globe did not select a new simulated region.');
    assert(Number.isFinite(regionAfter.temperature) && Number.isFinite(regionAfter.soilMoisture), 'The selected region lacks climate or water readings.');
    assert(await page.locator('[data-reading="water"]').getAttribute('title'), 'A regional reading is not inspectable in full.');

    await page.evaluate(() => window.realitySandboxDebug.pause());
    const clock = await page.evaluate(() => {
      const before = window.realitySandboxUnified.getState();
      window.realitySandboxDebug.advance(50);
      const after = window.realitySandboxUnified.getState();
      return { before, after, diagnostics: window.realitySandboxDebug.diagnostics() };
    });
    writeJson('clock.json', clock);
    assert(clock.after.masterSteps - clock.before.masterSteps === 50, 'The runtime did not receive one step per master step.');
    assert(clock.after.duplicateClockViolations === 0 && clock.diagnostics.ok, 'Fixed-clock diagnostics failed.');

    const scenarios = await page.evaluate(async () => ({
      sharedClock: await window.realitySandboxDebug.seedScenario('shared-clock'),
      scene: await window.realitySandboxDebug.seedScenario('scene'),
      camera: await window.realitySandboxDebug.seedScenario('camera'),
      coupling: await window.realitySandboxDebug.seedScenario('coupling'),
    }));
    writeJson('scenarios.json', scenarios);
    assert(scenarios.sharedClock.ok && scenarios.sharedClock.privateRafLoops === 0, 'The renderer started a second simulation loop.');
    assert(scenarios.scene.ok && scenarios.scene.renderer === 'pixi-single-canvas' && scenarios.scene.inspector, 'The public scene contract failed.');
    assert(scenarios.camera.ok, 'The deterministic camera scenario failed.');
    assert(scenarios.coupling.ok, 'The terrain-water-inspector coupling scenario failed.');

    const finalDiagnostics = await page.evaluate(() => window.realitySandboxDebug.diagnostics());
    writeJson('diagnostics.json', finalDiagnostics);
    await page.screenshot({ path: path.join(artifactDir, 'procedural-living-planet.png'), fullPage: true });
    assert(finalDiagnostics.ok, `Final diagnostics failed: ${finalDiagnostics.failures.join(', ')}`);
    assert(pageErrors.length === 0, `Browser page errors: ${pageErrors.map(error => error.message).join(' | ')}`);
  } finally {
    writeJson('console.json', consoleEntries);
    writeJson('page-errors.json', pageErrors);
    writeJson('request-failures.json', failedRequests);
    await context.close();
    await browser.close();
  }

  function assert(condition, message) { if (!condition) throw new Error(message); }
  function writeJson(filename, value) { fs.writeFileSync(path.join(artifactDir, filename), JSON.stringify(value, null, 2)); }
})().catch(error => {
  fs.writeFileSync(path.join(artifactDir, 'fatal-error.txt'), `${error.stack || error.message}\n`);
  console.error(error);
  process.exitCode = 1;
});
