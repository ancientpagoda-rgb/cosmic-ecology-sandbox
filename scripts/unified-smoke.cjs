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
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
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
    await page.waitForTimeout(1800);

    const initial = await page.evaluate(() => ({
      diagnostics: window.realitySandboxDebug.diagnostics(),
      unified: window.realitySandboxUnified.getSnapshot(),
      modules: window.realitySandboxModules.list().map(module => module.id),
      panel: Boolean(document.getElementById('unifiedRuntimePanel')),
      compatibilityLink: document.querySelector('#unifiedRuntimePanel a[href="reality-engine-v6-9.html"]')?.href || null,
    }));
    writeJson('initial.json', initial);
    assert(initial.diagnostics.ok, `Initial diagnostics failed: ${initial.diagnostics.failures.join(', ')}`);
    assert(initial.modules.includes('runtime.unified-v69-phase11'), 'Unified runtime module was not registered.');
    assert(initial.panel && initial.compatibilityLink, 'Unified controls or V6.9 compatibility link are missing.');
    assert(initial.unified.clock.source === 'root-module-host-fixed-step', 'Unified runtime does not use the root master clock.');
    assert(initial.unified.audio.volume > 0, 'Fresh unified settings produced inaudible zero volume.');

    await page.evaluate(() => window.realitySandboxDebug.pause());
    const clock = await page.evaluate(() => {
      const before = window.realitySandboxUnified.getState();
      window.realitySandboxDebug.advance(50);
      const after = window.realitySandboxUnified.getState();
      return { before, after, diagnostics: window.realitySandboxDebug.diagnostics() };
    });
    writeJson('clock.json', clock);
    assert(clock.after.masterSteps - clock.before.masterSteps === 50, 'Unified runtime did not receive exactly one step per root master step.');
    assert(clock.after.duplicateClockViolations === 0, 'A duplicate or reversed simulation clock was detected.');
    assert(clock.diagnostics.ok, `Clock diagnostics failed: ${clock.diagnostics.failures.join(', ')}`);

    const scenarios = await page.evaluate(async () => ({
      sharedClock: await window.realitySandboxDebug.seedUnifiedScenario('shared-clock'),
      viewSwitch: await window.realitySandboxDebug.seedUnifiedScenario('view-switch'),
      audioCoupling: await window.realitySandboxDebug.seedUnifiedScenario('audio-coupling'),
      astronomy: await window.realitySandboxDebug.seedUnifiedScenario('astronomy'),
      rebound: await window.realitySandboxDebug.seedUnifiedScenario('rebound'),
      saveMigration: await window.realitySandboxDebug.seedUnifiedScenario('save-migration'),
      mobileLod: await window.realitySandboxDebug.seedUnifiedScenario('mobile-lod'),
    }));
    writeJson('scenarios.json', scenarios);
    assert(Object.values(scenarios).every(result => result.ok), 'One or more unified runtime scenarios failed.');
    assert(scenarios.sharedClock.privateRafLoops === 0, 'Unified runtime started a private simulation animation loop.');
    assert(scenarios.viewSwitch.beforeTick === scenarios.viewSwitch.afterTick, 'Switching views advanced or reset simulation time.');
    assert(Object.values(scenarios.audioCoupling.mix).some(value => value > 0), 'Root simulation state did not produce an audio mix.');
    assert(['astronomy-engine-earth-reference', 'procedural', 'fallback'].includes(scenarios.astronomy.state.mode), 'Astronomy integration returned an unknown mode.');
    assert(scenarios.saveMigration.legacy.volume !== null && scenarios.saveMigration.legacy.palette, 'Legacy V6.9 preferences were not preserved.');
    if (requireRebound) assert(scenarios.rebound.status.mode === 'rebound-wasm' && scenarios.rebound.status.count > 0, `Live REBOUND WASM was required but unavailable: ${JSON.stringify(scenarios.rebound.status)}`);

    const viewState = await page.evaluate(async () => {
      const before = {
        tick: window.realitySandboxDebug.snapshot().tick,
        phase11Years: window.realitySandboxPhase11.getState().simulatedYears,
      };
      window.realitySandboxDebug.setUnifiedView('pixel');
      await new Promise(resolve => setTimeout(resolve, 350));
      const pixel = window.realitySandboxUnified.getSnapshot();
      window.realitySandboxDebug.setUnifiedView('orbital');
      await new Promise(resolve => setTimeout(resolve, 250));
      const orbital = window.realitySandboxUnified.getSnapshot();
      window.realitySandboxDebug.setUnifiedView('universe');
      await new Promise(resolve => setTimeout(resolve, 250));
      const universe = window.realitySandboxUnified.getSnapshot();
      const after = {
        tick: window.realitySandboxDebug.snapshot().tick,
        phase11Years: window.realitySandboxPhase11.getState().simulatedYears,
      };
      return { before, after, pixel, orbital, universe };
    });
    writeJson('views.json', viewState);
    assert(viewState.pixel.presentation.canvas && !viewState.pixel.presentation.canvas.hidden, 'Pixi presentation did not become visible.');
    assert(viewState.pixel.presentation.tickerStarted === false, 'PixiJS started an independent ticker.');
    assert(viewState.before.tick === viewState.after.tick && viewState.before.phase11Years === viewState.after.phase11Years, 'View changes mutated simulation history while paused.');

    await page.locator('[data-unified-sound]').click();
    await page.waitForFunction(() => window.realitySandboxUnified.getState().audioStarted, null, { timeout: 30000 });
    const audio = await page.evaluate(() => window.realitySandboxUnified.getSnapshot().audio);
    writeJson('audio.json', audio);
    assert(audio.started && audio.prepared, 'Howler.js root soundscape did not start from a user gesture.');
    assert(audio.volume > 0, 'Howler.js root soundscape started at inaudible zero volume.');
    assert(Object.values(audio.mix).every(Number.isFinite), 'Audio mix contains non-finite values.');

    const entry = new URL(baseUrl);
    const v69Url = entry.pathname.includes('/reality-sandbox/')
      ? new URL('reality-engine-v6-9.html', entry)
      : new URL('/reality-sandbox/reality-engine-v6-9.html', entry.origin);
    const v69Response = await page.request.get(v69Url.toString());
    const v69Html = await v69Response.text();
    assert(v69Response.ok(), `Standalone V6.9 compatibility page is unavailable at ${v69Url}.`);
    assert(v69Html.includes('ENGINE V6.9 · HOWLER.JS SOUNDSCAPE'), 'Standalone V6.9 page lost its Howler/Pixi marker.');

    const finalDiagnostics = await page.evaluate(() => window.realitySandboxDebug.diagnostics());
    writeJson('diagnostics.json', finalDiagnostics);
    await page.screenshot({ path: path.join(artifactDir, 'unified-runtime.png'), fullPage: true });
    assert(finalDiagnostics.ok, `Final unified diagnostics failed: ${finalDiagnostics.failures.join(', ')}`);
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
