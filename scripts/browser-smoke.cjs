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
      modules: window.realitySandboxModules?.list?.().map(module => module.id),
    }));
    writeJson('initial.json', initial);
    assert(initial.diagnostics.ok, `Initial diagnostics failed: ${initial.diagnostics.failures.join(', ')}`);
    assert(initial.modules?.includes('civilization.phase8-institutions-industry-spaceflight'), 'Phase 8 module was not registered.');
    assert(initial.modules?.includes('civilization.phase9-multiworld-ai-contact'), 'Phase 9 module was not registered.');
    assert(initial.canvases.some(canvas => canvas.context.startsWith('webgl')), 'No WebGL canvas was detected.');

    await page.evaluate(() => window.realitySandboxDebug.pause());
    const stepped = await page.evaluate(() => {
      window.realitySandboxDebug.advance(180);
      return {
        tick: window.realitySandboxDebug.snapshot().tick,
        diagnostics: window.realitySandboxDebug.diagnostics(),
        phase8: window.realitySandboxPhase8.getState(),
        phase9: window.realitySandboxPhase9.getState(),
      };
    });
    writeJson('stepped.json', stepped);
    assert(stepped.diagnostics.ok, `Post-step diagnostics failed: ${stepped.diagnostics.failures.join(', ')}`);

    const isolatedPhase9 = await page.evaluate(async () => {
      const mockWorld = { width: 1200, height: 720, tick: 0, globals: { civilizationPressure: 0.4, anthropogenicImpact: 0.2 } };
      const sciences = [{
        id: 'debug-home', knowledge: 6, literacy: 0.94,
        discoveries: ['measurement', 'mathematics', 'medicine', 'navigation', 'mechanics', 'steam-engines', 'electricity', 'communications', 'computation', 'automation', 'astronomy', 'rocketry', 'orbital-flight', 'satellites', 'space-stations', 'interplanetary-probes', 'offworld-colonies', 'interstellar-attempts'],
      }];
      const economies = [{
        id: 'debug-home', wealth: 180, capital: 80, output: 16,
        inventory: { food: 12, timber: 4, ore: 8, metal: 7, tools: 6, medicine: 5, energy: 25, machines: 12 },
      }];
      const institutions = [{ id: 'debug-home', legitimacy: 0.78, trust: 0.72, researchSupport: 0.8 }];
      const mockPhase8 = {
        getMissions: () => [],
        getSciences: () => sciences,
        getEconomies: () => economies,
        getInstitutions: () => institutions,
        getCities: () => [{ id: 'debug-home', infrastructure: 0.9, powerGrid: 0.9 }],
      };
      const bodies = [
        { id: 'gaia', name: 'Gaia', type: 'planet', semiMajorAxis: 1, massEarth: 1, radiusEarth: 1, equilibriumTemperature: 286, atmosphereRetention: 0.92, position: { x: 0, y: 0, z: 0 } },
        { id: 'selene', name: 'Selene', type: 'moon', parentId: 'gaia', semiMajorAxis: 1.0026, massEarth: 0.0123, radiusEarth: 0.273, position: { x: 0.0026, y: 0, z: 0 } },
        { id: 'ember', name: 'Ember', type: 'planet', semiMajorAxis: 1.52, massEarth: 0.7, radiusEarth: 0.86, equilibriumTemperature: 228, atmosphereRetention: 0.18, position: { x: 0.8, y: 0.01, z: 1.1 } },
        { id: 'sun', name: 'Local Star', type: 'star', position: { x: -1, y: 0, z: 0 } },
      ];
      const mockOrbits = { getBodies: () => bodies, getStar: () => ({ mass: 1 }), getDay: () => mockWorld.tick * 0.144 };
      const localStar = { id: 'sol', age: 4.57, metallicity: 0, spectralClass: 'G2V', position: { x: 0, y: 0, z: 0 } };
      const nearby = [
        localStar,
        { id: 'star-contact', age: 7.1, metallicity: 0.18, spectralClass: 'K3V', position: { x: 0.01, y: 0, z: 0.004 } },
        { id: 'star-quiet', age: 2.4, metallicity: -0.2, spectralClass: 'M4V', position: { x: 0.03, y: 0.002, z: 0.01 } },
      ];
      const mockGalaxy = {
        getLocalStar: () => localStar,
        getNearbyStars: () => nearby,
        getStars: () => nearby,
      };
      const engine = window.realitySandboxFactories.createPhase9Engine(
        mockWorld,
        mockPhase8,
        mockOrbits,
        mockGalaxy,
        { mobile: false, seed: 20260808, yearsPerSecond: 1, lightYearsPerGalaxyUnit: 10 },
      );
      await engine.initialize({ provideCapability() {} });
      const scenarios = {
        orbitalColony: engine.debugSeedScenario('orbital-colony'),
        machineEconomy: engine.debugSeedScenario('machine-economy'),
        supplyFailure: engine.debugSeedScenario('supply-failure'),
        habitatCollapse: engine.debugSeedScenario('habitat-collapse'),
        firstContact: engine.debugSeedScenario('first-contact'),
      };
      for (let index = 0; index < 1800; index++) {
        mockWorld.tick++;
        engine.step(0.06);
      }
      const result = {
        scenarios,
        state: engine.getState(),
        diagnostics: engine.runInvariants(),
        colonies: engine.getColonies(),
        transfers: engine.getTransfers(),
        shipments: engine.getShipments(),
        machines: engine.getMachines(),
        machineLineages: engine.getMachineLineages(),
        roboticAssets: engine.getRoboticAssets(),
        alienCivilizations: engine.getAlienCivilizations(),
        signals: engine.getSignals(),
        contacts: engine.getContacts(),
        history: engine.getHistory().slice(0, 120),
      };
      engine.destroy();
      return result;
    });
    writeJson('phase9-isolated.json', isolatedPhase9);
    assert(Object.values(isolatedPhase9.scenarios).every(result => result.ok), 'One or more required Phase 9 scenarios failed to seed.');
    assert(isolatedPhase9.diagnostics.ok, `Isolated Phase 9 diagnostics failed: ${isolatedPhase9.diagnostics.failures.join(', ')}`);
    assert(isolatedPhase9.state.colonies >= 4, `Expected at least four Phase 9 colonies, received ${isolatedPhase9.state.colonies}.`);
    assert(isolatedPhase9.state.machines >= 6, `Expected autonomous machines, received ${isolatedPhase9.state.machines}.`);
    assert(isolatedPhase9.state.collapsedColonies >= 1, 'The habitat-collapse scenario did not collapse a habitat.');
    assert(isolatedPhase9.shipments.some(item => item.status === 'lost'), 'The supply-failure scenario did not record a lost shipment.');
    assert(isolatedPhase9.signals.length >= 1, 'The first-contact scenario did not create a light-delay signal.');
    assert(isolatedPhase9.contacts.some(item => !['unknown', 'candidate', 'detected', 'signal-inbound'].includes(item.state)), 'The first-contact signal never arrived or entered decoding.');
    assert(isolatedPhase9.machineLineages.length >= 1, 'No machine lineage was created.');

    const liveScenarios = await page.evaluate(() => ({
      orbitalColony: window.realitySandboxDebug.seedPhase9Scenario('orbital-colony'),
      machineEconomy: window.realitySandboxDebug.seedPhase9Scenario('machine-economy'),
      supplyFailure: window.realitySandboxDebug.seedPhase9Scenario('supply-failure'),
      habitatCollapse: window.realitySandboxDebug.seedPhase9Scenario('habitat-collapse'),
      firstContact: window.realitySandboxDebug.seedPhase9Scenario('first-contact'),
    }));
    writeJson('phase9-live-scenarios.json', liveScenarios);
    assert(Object.values(liveScenarios).every(result => result.ok), 'A live Phase 9 debug scenario failed to seed.');

    const liveAfterScenarios = await page.evaluate(() => {
      window.realitySandboxDebug.advance(900);
      return {
        state: window.realitySandboxPhase9.getState(),
        diagnostics: window.realitySandboxDebug.diagnostics(),
        snapshot: window.realitySandboxPhase9.getSnapshot(),
      };
    });
    writeJson('phase9-live-after-scenarios.json', liveAfterScenarios);
    assert(liveAfterScenarios.diagnostics.ok, `Live Phase 9 scenario diagnostics failed: ${liveAfterScenarios.diagnostics.failures.join(', ')}`);
    assert(liveAfterScenarios.state.colonies >= 4, 'Live Phase 9 debug scenarios did not create colonies.');

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

    await page.screenshot({ path: path.join(artifactDir, 'reality-sandbox-phase9.png'), fullPage: true });
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
