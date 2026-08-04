const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.REALITY_BASE_URL || 'http://127.0.0.1:4173/';
const artifactDir = process.env.REALITY_ARTIFACT_DIR || path.join(process.cwd(), 'artifacts', 'browser-smoke');
fs.mkdirSync(artifactDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-angle=swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--disable-dev-shm-usage',
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    recordVideo: { dir: path.join(artifactDir, 'video'), size: { width: 1280, height: 800 } },
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  const consoleEntries = [];
  const pageErrors = [];
  const failedRequests = [];

  page.on('console', message => {
    consoleEntries.push({ type: message.type(), text: message.text(), location: message.location() });
  });
  page.on('pageerror', error => {
    pageErrors.push({ message: error.message, stack: error.stack });
  });
  page.on('requestfailed', request => {
    failedRequests.push({ url: request.url(), method: request.method(), failure: request.failure() });
  });

  try {
    const url = new URL(baseUrl);
    url.searchParams.set('debug', '1');
    url.searchParams.set('test', '1');
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction(() => Boolean(window.realitySandboxDebug?.ready), null, { timeout: 120000 });
    await page.waitForTimeout(2500);

    const initial = await page.evaluate(() => ({
      diagnostics: window.realitySandboxDebug.diagnostics(),
      canvases: window.realitySandboxDebug.inspectCanvases(),
      phase8: window.realitySandboxPhase8?.getState?.(),
      modules: window.realitySandboxModules?.list?.().map(module => module.id),
    }));
    writeJson('initial.json', initial);
    if (!initial.diagnostics.ok) throw new Error(`Initial diagnostics failed: ${initial.diagnostics.failures.join(', ')}`);
    if (!initial.modules?.includes('civilization.phase8-institutions-industry-spaceflight')) throw new Error('Phase 8 module was not registered.');
    if (!initial.canvases.some(canvas => canvas.context.startsWith('webgl'))) throw new Error('No WebGL canvas was detected.');

    await page.evaluate(() => window.realitySandboxDebug.pause());
    const stepped = await page.evaluate(() => {
      window.realitySandboxDebug.advance(180);
      return {
        tick: window.realitySandboxDebug.snapshot().tick,
        diagnostics: window.realitySandboxDebug.diagnostics(),
        phase8: window.realitySandboxPhase8.getState(),
      };
    });
    writeJson('stepped.json', stepped);
    if (!stepped.diagnostics.ok) throw new Error(`Post-step diagnostics failed: ${stepped.diagnostics.failures.join(', ')}`);

    const isolatedPhase8 = await page.evaluate(async () => {
      const communities = [
        {
          id: 'test-hearth-a', name: 'Test Hearth A', status: 'flourishing', population: 42,
          stability: 0.82, trade: 0.75, technologies: ['writing', 'agriculture', 'metallurgy', 'transport'],
          knowledge: 1.4, food: 1.1, conflict: 0.05, polityId: 'test-league', x: 180, y: 220,
        },
        {
          id: 'test-hearth-b', name: 'Test Hearth B', status: 'stable', population: 28,
          stability: 0.68, trade: 0.62, technologies: ['writing', 'agriculture', 'metallurgy', 'transport'],
          knowledge: 1.1, food: 0.8, conflict: 0.08, polityId: 'test-league', x: 320, y: 245,
        },
      ];
      const routes = [
        {
          id: 'test-route-a-b', from: 'test-hearth-a', to: 'test-hearth-b', kind: 'trade',
          flow: 0.82, knowledge: 0.72, hostility: 0.04, trust: 0.74,
        },
      ];
      const mockWorld = {
        width: 1200,
        height: 720,
        tick: 0,
        globals: { civilizationPressure: 0.3, anthropogenicImpact: 0 },
      };
      const mockCivilization = {
        getCommunities: () => communities,
        getRoutes: () => routes,
      };
      const mockOrbits = {
        getBodies: () => [
          { id: 'gaia', name: 'Gaia' },
          { id: 'selene', name: 'Selene' },
          { id: 'ember', name: 'Ember' },
          { id: 'sun', name: 'Local Star' },
        ],
      };
      const mockGround = { getState: () => ({ active: false }) };
      const engine = window.realitySandboxFactories.createPhase8Engine(
        mockWorld,
        mockCivilization,
        mockOrbits,
        mockGround,
        { mobile: false, seed: 20260807 },
      );
      await engine.initialize({ provideCapability() {} });
      engine.debugSeedScenario('industrial');
      engine.debugSeedScenario('outbreak');
      for (let index = 0; index < 1200; index++) {
        mockWorld.tick++;
        engine.step(0.06);
      }
      engine.debugSeedScenario('crisis');
      for (let index = 0; index < 400; index++) {
        mockWorld.tick++;
        engine.step(0.06);
      }
      const result = {
        state: engine.getState(),
        diagnostics: engine.runInvariants(),
        institutions: engine.getInstitutions(),
        economies: engine.getEconomies(),
        sciences: engine.getSciences(),
        cities: engine.getCities(),
        outbreaks: engine.getOutbreaks(),
        missions: engine.getMissions(),
      };
      engine.destroy();
      return result;
    });
    writeJson('phase8-isolated.json', isolatedPhase8);
    if (!isolatedPhase8.diagnostics.ok) throw new Error(`Isolated Phase 8 diagnostics failed: ${isolatedPhase8.diagnostics.failures.join(', ')}`);
    if (isolatedPhase8.state.communities !== 2) throw new Error(`Expected two isolated Phase 8 communities, received ${isolatedPhase8.state.communities}.`);
    if (!isolatedPhase8.state.xstate) throw new Error('XState did not initialize inside the isolated Phase 8 test.');
    if (isolatedPhase8.outbreaks.length < 1) throw new Error('The isolated epidemiology scenario did not create an outbreak.');
    if (isolatedPhase8.economies.length !== 2 || isolatedPhase8.sciences.length !== 2) throw new Error('The isolated economic or science systems did not synchronize communities.');

    const scenario = await page.evaluate(() => ({
      industrial: window.realitySandboxDebug.seedScenario('industrial'),
      outbreak: window.realitySandboxDebug.seedScenario('outbreak'),
      crisis: window.realitySandboxDebug.seedScenario('crisis'),
    }));
    writeJson('live-world-scenario-results.json', scenario);

    const spector = await page.evaluate(async () => {
      try {
        await window.realitySandboxDebug.loadSpector(false);
        const result = await window.realitySandboxDebug.captureWebGL(0);
        return { ok: true, commandCount: result.commandCount, width: result.width, height: result.height };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    });
    writeJson('spector-summary.json', spector);
    if (!spector.ok || spector.commandCount < 1) throw new Error(`Spector WebGL capture failed: ${spector.error || 'no draw commands'}`);

    await page.screenshot({ path: path.join(artifactDir, 'reality-sandbox.png'), fullPage: true });
    const snapshot = await page.evaluate(() => window.realitySandboxDebug.snapshot());
    writeJson('snapshot.json', snapshot);
    const finalDiagnostics = await page.evaluate(() => window.realitySandboxDebug.diagnostics());
    writeJson('diagnostics.json', finalDiagnostics);
    if (!finalDiagnostics.ok) throw new Error(`Final diagnostics failed: ${finalDiagnostics.failures.join(', ')}`);
    if (pageErrors.length) throw new Error(`Browser page errors: ${pageErrors.map(error => error.message).join(' | ')}`);
  } finally {
    writeJson('console.json', consoleEntries);
    writeJson('page-errors.json', pageErrors);
    writeJson('request-failures.json', failedRequests);
    await context.tracing.stop({ path: path.join(artifactDir, 'trace.zip') });
    await context.close();
    await browser.close();
  }

  function writeJson(filename, value) {
    fs.writeFileSync(path.join(artifactDir, filename), JSON.stringify(value, null, 2));
  }
})().catch(error => {
  fs.writeFileSync(path.join(artifactDir, 'fatal-error.txt'), `${error.stack || error.message}\n`);
  console.error(error);
  process.exitCode = 1;
});
