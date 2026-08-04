const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.REALITY_BASE_URL || 'http://127.0.0.1:4173/';
const artifactDir = process.env.REALITY_UNIFIED_ARTIFACT_DIR || path.join(process.cwd(), 'artifacts', 'unified-smoke');
const requireRebound = process.env.REALITY_REQUIRE_REBOUND === '1';
fs.mkdirSync(artifactDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
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
    url.searchParams.set('test', '1');
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Boolean(window.realitySandboxDebug?.ready && window.realitySandboxUnified), null, { timeout: 120000 });
    await page.waitForTimeout(1200);

    const initial = await page.evaluate(() => ({
      diagnostics: window.realitySandboxDebug.diagnostics(),
      unified: window.realitySandboxUnified.getSnapshot(),
      modules: window.realitySandboxModules.list().map(module => module.id),
      panel: Boolean(document.getElementById('unifiedRuntimePanel')),
      controls: document.querySelectorAll('button, select, input, output, [data-unified-view], [data-unified-sound]').length,
      canvas: document.getElementById('lofiLivingCanvas') ? {
        connected: document.getElementById('lofiLivingCanvas').isConnected,
        imageRendering: getComputedStyle(document.getElementById('lofiLivingCanvas')).imageRendering,
      } : null,
    }));
    writeJson('initial.json', initial);
    assert(initial.diagnostics.ok, `Initial diagnostics failed: ${initial.diagnostics.failures.join(', ')}`);
    assert(initial.modules.includes('runtime.lofi-living-world'), 'The lo-fi living-world runtime was not registered.');
    assert(initial.unified.mode === 'lofi-living-world', 'The root did not use the distilled living-world mode.');
    assert(initial.unified.view === 'living' && initial.unified.availableViews.length === 1, 'The root exposed more than one view.');
    assert(initial.unified.audio.enabled === false && initial.unified.audio.started === false, 'Audio remained enabled in the simplified root.');
    assert(initial.unified.interface.controls === 0 && !initial.panel && initial.controls === 0, 'Runtime controls or informational panels remained visible.');
    assert(initial.canvas?.connected, 'The lo-fi living-world canvas is missing.');
    assert(initial.canvas.imageRendering === 'pixelated' || initial.canvas.imageRendering === 'crisp-edges', 'The root canvas is not pixelated.');
    assert(initial.unified.presentation.logicalWidth <= 256 && initial.unified.presentation.logicalHeight <= 144, 'The presentation is not low resolution.');
    assert(initial.unified.presentation.tickerStarted === false, 'PixiJS started an independent ticker.');

    await page.evaluate(() => window.realitySandboxDebug.pause());
    const clock = await page.evaluate(() => {
      const before = window.realitySandboxUnified.getState();
      window.realitySandboxDebug.advance(50);
      const after = window.realitySandboxUnified.getState();
      return { before, after, diagnostics: window.realitySandboxDebug.diagnostics() };
    });
    writeJson('clock.json', clock);
    assert(clock.after.masterSteps - clock.before.masterSteps === 50, 'The presentation did not receive exactly one step per root master step.');
    assert(clock.after.duplicateClockViolations === 0, 'A reversed presentation clock was detected.');
    assert(clock.diagnostics.ok, `Clock diagnostics failed: ${clock.diagnostics.failures.join(', ')}`);

    const scenarios = await page.evaluate(async () => ({
      sharedClock: await window.realitySandboxDebug.seedUnifiedScenario('shared-clock'),
      viewSwitch: await window.realitySandboxDebug.seedUnifiedScenario('view-switch'),
      scene: await window.realitySandboxDebug.seedUnifiedScenario('scene'),
      rebound: await window.realitySandboxDebug.seedUnifiedScenario('rebound'),
      mobileLod: await window.realitySandboxDebug.seedUnifiedScenario('mobile-lod'),
    }));
    writeJson('scenarios.json', scenarios);
    assert(scenarios.sharedClock.ok && scenarios.sharedClock.privateRafLoops === 0, 'The presentation started a private simulation loop.');
    assert(scenarios.viewSwitch.ok && scenarios.viewSwitch.selected === 'living', 'A second visible view remained selectable.');
    assert(scenarios.scene.ok && scenarios.scene.controls === 0 && scenarios.scene.audio === false, 'The simplified scene contract failed.');
    assert(scenarios.mobileLod.ok, 'The low-resolution presentation limit failed.');
    if (requireRebound) {
      const status = scenarios.rebound.status;
      assert(
        status.mode === 'rebound-wasm'
          && status.count > 0
          && Number.isFinite(status.timeDays)
          && Number.isFinite(status.energyError),
        `Live REBOUND WASM was required but unavailable: ${JSON.stringify(status)}`,
      );
    }

    const lockedView = await page.evaluate(() => {
      const before = {
        tick: window.realitySandboxDebug.snapshot().tick,
        phase11Years: window.realitySandboxPhase11.getState().simulatedYears,
      };
      const selected = window.realitySandboxDebug.setUnifiedView('universe');
      const after = {
        tick: window.realitySandboxDebug.snapshot().tick,
        phase11Years: window.realitySandboxPhase11.getState().simulatedYears,
        snapshot: window.realitySandboxUnified.getSnapshot(),
      };
      return { before, selected, after };
    });
    writeJson('locked-view.json', lockedView);
    assert(lockedView.selected === 'living' && lockedView.after.snapshot.view === 'living', 'The root escaped the living-world view.');
    assert(lockedView.before.tick === lockedView.after.tick && lockedView.before.phase11Years === lockedView.after.phase11Years, 'A rejected view change mutated simulation history.');

    const entry = new URL(baseUrl);
    const v69Url = entry.pathname.includes('/reality-sandbox/')
      ? new URL('reality-engine-v6-9.html', entry)
      : new URL('/reality-sandbox/reality-engine-v6-9.html', entry.origin);
    const v69Response = await page.request.get(v69Url.toString());
    const v69Html = await v69Response.text();
    assert(v69Response.ok(), `Standalone V6.9 compatibility page is unavailable at ${v69Url}.`);
    assert(v69Html.includes('ENGINE V6.9 · HOWLER.JS SOUNDSCAPE'), 'The preserved standalone V6.9 page lost its marker.');

    const finalDiagnostics = await page.evaluate(() => window.realitySandboxDebug.diagnostics());
    writeJson('diagnostics.json', finalDiagnostics);
    await page.screenshot({ path: path.join(artifactDir, 'lofi-living-world.png'), fullPage: true });
    assert(finalDiagnostics.ok, `Final simplified-runtime diagnostics failed: ${finalDiagnostics.failures.join(', ')}`);
    assert(pageErrors.length === 0, `Browser page errors: ${pageErrors.map(error => error.message).join(' | ')}`);
  } finally {
    writeJson('console.json', consoleEntries);
    writeJson('page-errors.json', pageErrors);
    writeJson('request-failures.json', failedRequests);
    await context.close();
    await browser.close();
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }
  function writeJson(filename, value) {
    fs.writeFileSync(path.join(artifactDir, filename), JSON.stringify(value, null, 2));
  }
})().catch(error => {
  fs.writeFileSync(path.join(artifactDir, 'fatal-error.txt'), `${error.stack || error.message}\n`);
  console.error(error);
  process.exitCode = 1;
});
