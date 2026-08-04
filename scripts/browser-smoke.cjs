const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.REALITY_BASE_URL || 'http://127.0.0.1:4173/';
const artifactDir = process.env.REALITY_ARTIFACT_DIR || path.join(process.cwd(), 'artifacts', 'browser-smoke');
fs.mkdirSync(artifactDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
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

  page.on('console', message => consoleEntries.push({ type: message.type(), text: message.text(), location: message.location() }));
  page.on('pageerror', error => pageErrors.push({ message: error.message, stack: error.stack }));
  page.on('requestfailed', request => failedRequests.push({ url: request.url(), method: request.method(), failure: request.failure() }));

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
      phase9: window.realitySandboxPhase9?.getState?.(),
      phase10: window.realitySandboxPhase10?.getState?.(),
      modules: window.realitySandboxModules?.list?.().map(module => module.id),
    }));
    writeJson('initial.json', initial);
    assert(initial.diagnostics.ok, `Initial diagnostics failed: ${initial.diagnostics.failures.join(', ')}`);
    assert(initial.modules?.includes('civilization.phase8-institutions-industry-spaceflight'), 'Phase 8 module was not registered.');
    assert(initial.modules?.includes('civilization.phase9-multiworld-ai-contact'), 'Phase 9 module was not registered.');
    assert(initial.modules?.includes('civilization.phase10-relativistic-deep-time'), 'Phase 10 module was not registered.');
    assert(initial.canvases.some(canvas => canvas.context.startsWith('webgl')), 'No WebGL canvas was detected.');

    await page.evaluate(() => window.realitySandboxDebug.pause());
    const stepped = await page.evaluate(() => {
      window.realitySandboxDebug.advance(180);
      return {
        tick: window.realitySandboxDebug.snapshot().tick,
        diagnostics: window.realitySandboxDebug.diagnostics(),
        phase10: window.realitySandboxPhase10.getState(),
      };
    });
    writeJson('stepped.json', stepped);
    assert(stepped.diagnostics.ok, `Post-step diagnostics failed: ${stepped.diagnostics.failures.join(', ')}`);

    const isolated = await page.evaluate(() => {
      const mockWorld = { width: 1200, height: 720, tick: 0, globals: { civilizationPressure: 0.6, anthropogenicImpact: 0.3 } };
      const mockPhase9 = {
        getState: () => ({ population: 1200, machines: 180, operationalColonies: 4, firstContacts: 1, activeSignals: 0 }),
        getColonies: () => [],
        getAlienCivilizations: () => [],
      };
      const localStar = { id: 'sol', name: 'Sol', age: 4.57, mass: 1, luminosity: 1, metallicity: 0, spectralClass: 'G2V', position: { x: 0, y: 0, z: 0 } };
      const nearby = [
        localStar,
        { id: 'star-one', name: 'Star One', age: 6.2, mass: 0.88, luminosity: 0.62, metallicity: 0.1, spectralClass: 'K2V', position: { x: 0.01, y: 0, z: 0.002 } },
        { id: 'star-two', name: 'Star Two', age: 1.3, mass: 1.4, luminosity: 3.8, metallicity: -0.1, spectralClass: 'F4V', position: { x: 0.018, y: 0.001, z: 0.006 } },
      ];
      const mockGalaxy = {
        getLocalStar: () => localStar,
        getNearbyStars: () => nearby,
        getStars: () => nearby,
      };
      const mockOrbits = { getBodies: () => [], getStar: () => localStar };
      const engine = window.realitySandboxFactories.createPhase10Engine(
        mockWorld,
        mockPhase9,
        mockGalaxy,
        mockOrbits,
        { mobile: false, seed: 20260809, yearsPerSecond: 1200, lightYearsPerGalaxyUnit: 420 },
      );
      engine.initialize({ provideCapability() {} });
      const scenarios = {
        relativisticProbe: engine.debugSeedScenario('relativistic-probe'),
        generationShipCrisis: engine.debugSeedScenario('generation-ship-crisis'),
        stellarMigration: engine.debugSeedScenario('stellar-migration'),
        dysonWasteHeat: engine.debugSeedScenario('dyson-waste-heat'),
        extinctColonyArchaeology: engine.debugSeedScenario('extinct-colony-archaeology'),
        causalContact: engine.debugSeedScenario('causal-contact'),
      };
      for (let index = 0; index < 2000; index++) {
        mockWorld.tick++;
        engine.step(0.06);
      }
      const result = {
        scenarios,
        state: engine.getState(),
        diagnostics: engine.runInvariants(),
        missions: engine.getMissions(),
        stars: engine.getStarTracks(),
        branches: engine.getBranches(),
        projects: engine.getProjects(),
        ruins: engine.getRuins(),
        signals: engine.getSignals(),
        causalEvents: engine.getCausalEvents(),
        causalEdges: engine.getCausalEdges(),
      };
      engine.destroy();
      return result;
    });
    writeJson('phase10-isolated.json', isolated);
    assert(Object.values(isolated.scenarios).every(result => result.ok), 'One or more required Phase 10 scenarios failed to seed.');
    assert(isolated.diagnostics.ok, `Isolated Phase 10 diagnostics failed: ${isolated.diagnostics.failures.join(', ')}`);

    const probe = isolated.missions.find(mission => mission.id === 'debug-relativistic-probe');
    assert(probe, 'Relativistic probe was not created.');
    assert(probe.beta === 0.8, `Expected beta 0.8, received ${probe.beta}.`);
    assert(probe.gamma > 1.6, `Expected measurable Lorentz factor, received ${probe.gamma}.`);
    assert(probe.properYears < probe.coordinateYears, 'Relativistic proper time was not shorter than coordinate time.');
    assert(probe.beta < 1, 'Relativistic probe exceeded light speed.');

    const generationShip = isolated.missions.find(mission => mission.id === 'debug-generation-ship');
    assert(generationShip && ['failed', 'lost'].includes(generationShip.state), 'Generation-ship crisis did not produce mission failure.');
    assert(isolated.stars.some(star => star.id === 'debug-aging-star' && star.stage !== 'main-sequence'), 'Stellar evolution did not force the test star off the main sequence.');
    assert(isolated.causalEvents.some(event => event.type === 'migration' && event.data?.branchId === 'debug-stellar-branch'), 'Stellar migration event was not recorded.');

    const dyson = isolated.projects.find(project => project.id === 'debug-dyson-swarm');
    assert(dyson && dyson.state === 'heat-limited', `Dyson precursor was not heat-limited: ${dyson?.state}.`);
    assert(dyson.wasteHeat > dyson.heatLimit, 'Dyson waste heat did not exceed its rejection limit.');
    assert(isolated.ruins.some(ruin => ruin.id === 'debug-cosmic-ruin' && ruin.discovered), 'Extinct interstellar colony was not discovered archaeologically.');
    assert(isolated.signals.length >= 2 && isolated.signals.every(signal => signal.state === 'arrived'), 'Causal contact signals did not arrive.');
    assert(isolated.causalEvents.filter(event => event.type === 'contact').length >= 2, 'Multi-system first-contact exchanges were not recorded.');
    assert(isolated.causalEdges.length >= 4, 'Causal history graph did not record parent-child edges.');

    const liveScenarios = await page.evaluate(() => ({
      relativisticProbe: window.realitySandboxDebug.seedPhase10Scenario('relativistic-probe'),
      generationShipCrisis: window.realitySandboxDebug.seedPhase10Scenario('generation-ship-crisis'),
      stellarMigration: window.realitySandboxDebug.seedPhase10Scenario('stellar-migration'),
      dysonWasteHeat: window.realitySandboxDebug.seedPhase10Scenario('dyson-waste-heat'),
      extinctColonyArchaeology: window.realitySandboxDebug.seedPhase10Scenario('extinct-colony-archaeology'),
      causalContact: window.realitySandboxDebug.seedPhase10Scenario('causal-contact'),
    }));
    writeJson('phase10-live-scenarios.json', liveScenarios);
    assert(Object.values(liveScenarios).every(result => result.ok), 'A live Phase 10 debug scenario failed to seed.');

    const liveAfterScenarios = await page.evaluate(() => {
      window.realitySandboxDebug.advance(2000);
      return {
        state: window.realitySandboxPhase10.getState(),
        diagnostics: window.realitySandboxDebug.diagnostics(),
        snapshot: window.realitySandboxPhase10.getSnapshot(),
      };
    });
    writeJson('phase10-live-after-scenarios.json', liveAfterScenarios);
    assert(liveAfterScenarios.diagnostics.ok, `Live Phase 10 diagnostics failed: ${liveAfterScenarios.diagnostics.failures.join(', ')}`);
    assert(liveAfterScenarios.state.missions >= 2, 'Live Phase 10 scenarios did not create interstellar missions.');
    assert(liveAfterScenarios.state.failedMissions >= 1, 'Live generation-ship crisis did not fail.');
    assert(liveAfterScenarios.state.heatLimitedProjects >= 1, 'Live Dyson precursor was not constrained by waste heat.');
    assert(liveAfterScenarios.state.discoveredRuins >= 1, 'Live archaeology scenario did not discover a ruin.');

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
    assert(spector.ok && spector.commandCount >= 1, `Spector WebGL capture failed: ${spector.error || 'no draw commands'}`);

    await page.screenshot({ path: path.join(artifactDir, 'reality-sandbox-phase10.png'), fullPage: true });
    writeJson('snapshot.json', await page.evaluate(() => window.realitySandboxDebug.snapshot()));
    const finalDiagnostics = await page.evaluate(() => window.realitySandboxDebug.diagnostics());
    writeJson('diagnostics.json', finalDiagnostics);
    assert(finalDiagnostics.ok, `Final diagnostics failed: ${finalDiagnostics.failures.join(', ')}`);
    assert(pageErrors.length === 0, `Browser page errors: ${pageErrors.map(error => error.message).join(' | ')}`);
  } finally {
    writeJson('console.json', consoleEntries);
    writeJson('page-errors.json', pageErrors);
    writeJson('request-failures.json', failedRequests);
    await context.tracing.stop({ path: path.join(artifactDir, 'trace.zip') });
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
