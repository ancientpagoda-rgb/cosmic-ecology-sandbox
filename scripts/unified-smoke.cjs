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
      const approvedPresentationCanvases = new Set(['weatherPresentationCanvas', 'surfaceDetailCanvas', 'surfaceModeCanvas']);
      const canvas = document.getElementById('lofiLivingCanvas');
      const visibleCanvasElements = [...document.querySelectorAll('canvas')].filter(visible);
      const visibleCanvases = visibleCanvasElements.map(element => ({ id: element.id, width: element.width, height: element.height }));
      const visibleSimulationCanvases = visibleCanvases.filter(item => !approvedPresentationCanvases.has(item.id));
      return {
        title: document.title,
        diagnostics: window.realitySandboxDebug.diagnostics(),
        snapshot: window.realitySandboxUnified.getSnapshot(),
        modules: window.realitySandboxModules.list().map(module => module.id),
        visibleCanvases,
        visibleSimulationCanvases,
        visiblePrimaryControls: ['[data-planet-pause]', '[data-planet-step]', '[data-planet-speed]']
          .map(selector => document.querySelector(selector))
          .filter(element => element && visible(element)).length,
        statDefinitions: document.querySelectorAll('.planet-stat[title][tabindex="0"]').length,
        statValues: [...document.querySelectorAll('[data-stat]')].map(node => node.textContent.trim()),
        inspector: Boolean(document.querySelector('.planet-inspector')),
        observatory: {
          panel: Boolean(document.querySelector('.planet-evolution')),
          traits: document.querySelectorAll('.planet-trait-card').length,
          journal: document.querySelectorAll('.planet-journal li').length,
        },
        foundry: {
          panel: Boolean(document.querySelector('.planet-foundry')),
          api: Boolean(window.realitySandboxPlanet?.lineageFoundry?.create),
        },
        atlas: {
          panel: Boolean(document.querySelector('.planet-atlas')),
          api: Boolean(window.realitySandboxPlanet?.eidolonAtlas?.survey),
        },
        canvas: canvas ? { width: canvas.width, height: canvas.height, imageRendering: getComputedStyle(canvas).imageRendering } : null,
        retiredGlobals: Boolean(window.realitySandboxHifi || window.realitySandboxLilacClouds || window.realitySandboxRainRunoff),
        universeGlobals: Boolean(window.realitySandboxPhase8 || window.realitySandboxPhase9 || window.realitySandboxPhase10 || window.realitySandboxPhase11),
      };
    });
    writeJson('initial.json', initial);
    assert(initial.title.includes('Procedural Living Planet'), 'The public title does not identify the procedural living planet.');
    assert(initial.diagnostics.ok, `Initial diagnostics failed: ${initial.diagnostics.failures.join(', ')}`);
    assert(initial.modules.join('|') === 'planet.orbit-seasons|planet.interior-tectonics|planet.water-cycle|planet.living-ecology|ecology.seasonal-resource-fields|planet.climate-terrain-feedbacks|runtime.procedural-living-planet', `Unexpected root modules: ${initial.modules.join(', ')}`);
    assert(initial.snapshot.mode === 'procedural-living-planet' && initial.snapshot.planet.fictional && !initial.snapshot.planet.earthData, 'The root is not honestly labeled as a fictional procedural planet.');
    assert(initial.snapshot.presentation.renderer === 'pixi-single-canvas' && !initial.snapshot.presentation.tickerStarted, 'The single-renderer contract failed.');
    assert(initial.visibleSimulationCanvases.length === 1 && initial.visibleSimulationCanvases[0].id === 'lofiLivingCanvas' && initial.canvas, `The root must have one visible simulation canvas plus approved presentation layers: ${JSON.stringify(initial.visibleCanvases)}`);
    assert(initial.observatory.panel && initial.observatory.traits > 0 && initial.observatory.journal > 0, 'The evolution observatory did not render trait cards and field-journal entries.');
    assert(initial.foundry.panel && initial.foundry.api, 'The local Lineage Foundry did not initialize.');
    assert(initial.atlas.panel && initial.atlas.api, 'The local Eidolon Atlas did not initialize.');
    assert(initial.statDefinitions === 8, 'All eight global statistics must expose definitions.');
    assert(initial.statValues.every(value => value && value !== '—'), `A statistic did not initialize: ${initial.statValues.join(', ')}`);
    assert(!initial.retiredGlobals && !initial.universeGlobals, 'A retired renderer or universe phase loaded in the public root.');

    const atlasRegionBefore = await page.evaluate(() => window.realitySandboxUnified.getSnapshot().selectedRegion);
    const atlasCell = page.locator('[data-atlas-lattice] [data-atlas-region]:not(.is-selected)').first();
    await atlasCell.click();
    await page.waitForFunction(before => {
      const after = window.realitySandboxUnified.getSnapshot().selectedRegion;
      return Math.hypot(after.x - before.x, after.y - before.y) > 1;
    }, atlasRegionBefore, { timeout: 5000 });
    const atlasRegionAfter = await page.evaluate(() => window.realitySandboxUnified.getSnapshot().selectedRegion);
    assert(Math.hypot(atlasRegionAfter.x - atlasRegionBefore.x, atlasRegionAfter.y - atlasRegionBefore.y) > 1, 'Clicking an Atlas lattice sector did not navigate to that simulated region.');

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

    const lineage = await page.evaluate(() => ({
      before: window.realitySandboxPlanet.world.ecs.components.agent.size,
      speciesBefore: window.realitySandboxPlanet.biosphere.getSpecies().length,
    }));
    await page.locator('[data-foundry-name]').fill('Test Comet Grazer');
    await page.locator('[data-foundry-forge]').click();
    await page.locator('[data-foundry-release]').click();
    const releasedLineage = await page.evaluate(() => ({
      after: window.realitySandboxPlanet.world.ecs.components.agent.size,
      speciesAfter: window.realitySandboxPlanet.biosphere.getSpecies().length,
      catalog: window.realitySandboxPlanet.lineageFoundry.list(),
      exportText: window.realitySandboxPlanet.lineageFoundry.export(window.realitySandboxPlanet.lineageFoundry.list().at(-1).id),
    }));
    assert(releasedLineage.after >= lineage.before + 3 && releasedLineage.speciesAfter === lineage.speciesBefore + 1, 'Foundry release did not enter the created lineage into the ecosystem.');
    assert(releasedLineage.catalog.some(capsule => capsule.name === 'Test Comet Grazer') && releasedLineage.exportText.includes('eidolon-lineage-1'), 'Foundry export did not retain the portable capsule.');
    const atlas = await page.evaluate(() => ({
      survey: window.realitySandboxPlanet.eidolonAtlas.survey(window.realitySandboxUnified.getState().selectedPoint),
      sightings: window.realitySandboxPlanet.eidolonAtlas.getSightings(),
    }));
    assert(atlas.survey.id && atlas.sightings.some(sighting => sighting.name === 'Test Comet Grazer'), 'Atlas did not place the released lineage in a local sector.');

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
    await page.screenshot({ path: path.join(artifactDir, 'procedural-living-planet.png') });
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
