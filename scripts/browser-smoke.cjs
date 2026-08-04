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
      phase11: window.realitySandboxPhase11?.getState?.(),
      modules: window.realitySandboxModules?.list?.().map(module => module.id),
    }));
    writeJson('initial.json', initial);
    assert(initial.diagnostics.ok, `Initial diagnostics failed: ${initial.diagnostics.failures.join(', ')}`);
    for (const id of [
      'civilization.phase8-institutions-industry-spaceflight',
      'civilization.phase9-multiworld-ai-contact',
      'civilization.phase10-relativistic-deep-time',
      'civilization.phase11-cosmological-evolution',
    ]) assert(initial.modules?.includes(id), `${id} was not registered.`);
    assert(initial.canvases.some(canvas => canvas.context.startsWith('webgl')), 'No WebGL canvas was detected.');

    await page.evaluate(() => window.realitySandboxDebug.pause());
    const stepped = await page.evaluate(() => {
      window.realitySandboxDebug.advance(180);
      return { tick: window.realitySandboxDebug.snapshot().tick, diagnostics: window.realitySandboxDebug.diagnostics(), phase11: window.realitySandboxPhase11.getState() };
    });
    writeJson('stepped.json', stepped);
    assert(stepped.diagnostics.ok, `Post-step diagnostics failed: ${stepped.diagnostics.failures.join(', ')}`);

    const isolated = await page.evaluate(() => {
      const mockWorld = { width: 1200, height: 720, tick: 0, globals: { civilizationPressure: 0.6, anthropogenicImpact: 0.3 } };
      const mockPhase10 = {
        getState: () => ({ simulatedYears: 1e6, missions: 2, branches: 1 }),
        getBranches: () => [{ id: 'mock-branch', name: 'Mock Branch', state: 'expanding', population: 1e6, technology: 1.4, machineFraction: 0.6, institutions: 0.8, detectability: 0.4, expansionDrive: 0.6, caution: 0.3 }],
        getRuins: () => [],
      };
      const engine = window.realitySandboxFactories.createPhase11Engine(mockWorld, mockPhase10, {}, {
        mobile: false,
        seed: 20260810,
        yearsPerSecond: 5e6,
        H0KmSPerMpc: 67.4,
        omegaMatter: 0.315,
        omegaRadiation: 0.00009,
        omegaBaryon: 0.049,
        omegaLambda: 0.68491,
      });
      engine.initialize({ provideCapability() {} });
      const scenarios = {
        galaxyMerger: engine.debugSeedScenario('galaxy-merger'),
        redshiftedSignal: engine.debugSeedScenario('redshifted-signal'),
        eventHorizon: engine.debugSeedScenario('event-horizon'),
        gravitationalWave: engine.debugSeedScenario('gravitational-wave'),
        machineColdMigration: engine.debugSeedScenario('machine-cold-migration'),
        unreachableArchaeology: engine.debugSeedScenario('unreachable-archaeology'),
        distanceFrames: engine.debugSeedScenario('distance-frames'),
      };
      for (let index = 0; index < 2000; index++) {
        mockWorld.tick++;
        engine.step(0.06);
      }
      const zHalf = engine.cosmologicalDistances(0.5);
      const result = {
        scenarios,
        state: engine.getState(),
        cosmology: engine.getCosmology(),
        zHalf,
        diagnostics: engine.runInvariants(),
        galaxies: engine.getGalaxies(),
        civilizations: engine.getCivilizations(),
        signals: engine.getSignals(),
        waves: engine.getGravitationalWaves(),
        archaeology: engine.getArchaeology(),
        causalEvents: engine.getCausalEvents(),
        causalEdges: engine.getCausalEdges(),
        distanceSamples: engine.getDistanceSamples(),
      };
      engine.destroy();
      return result;
    });
    writeJson('phase11-isolated.json', isolated);
    assert(Object.values(isolated.scenarios).every(result => result.ok), 'One or more required Phase 11 scenarios failed to seed.');
    assert(isolated.diagnostics.ok, `Isolated Phase 11 diagnostics failed: ${isolated.diagnostics.failures.join(', ')}`);
    assert(isolated.state.scaleFactor > 1, 'Cosmological scale factor did not evolve.');
    assert(isolated.state.particleHorizonGly > isolated.state.eventHorizonGly, 'Particle horizon should exceed the event horizon in the configured accelerated cosmology.');
    assert(isolated.zHalf.comovingDistanceMpc > 0 && isolated.zHalf.lookbackTimeGyr > 0, 'FLRW numerical integration returned invalid distances.');
    assert(close(isolated.zHalf.luminosityDistanceMpc, isolated.zHalf.comovingDistanceMpc * 1.5, 1e-8), 'Luminosity-distance frame relation failed.');
    assert(close(isolated.zHalf.angularDiameterDistanceMpc, isolated.zHalf.comovingDistanceMpc / 1.5, 1e-8), 'Angular-diameter-distance frame relation failed.');

    const eventTypes = isolated.causalEvents.map(event => event.type);
    assert(eventTypes.includes('galaxy-merger'), 'Galaxy merger was not recorded.');
    assert(eventTypes.includes('starburst'), 'Merger-driven starburst was not recorded.');
    assert(eventTypes.includes('agn'), 'Merger-driven AGN feedback was not recorded.');
    assert(isolated.galaxies.some(galaxy => galaxy.id === 'debug-merger-b' && galaxy.vanished), 'Secondary merger galaxy did not become part of the remnant.');

    const signal = isolated.signals.find(item => item.id === 'debug-redshifted-signal');
    assert(signal?.state === 'observed', 'Cosmological signal was not observed.');
    assert(signal.observedWavelengthNm > signal.emittedWavelengthNm, 'Cosmological wavelength redshift was not applied.');
    assert(signal.observedFrequencyHz < signal.emittedFrequencyHz, 'Cosmological frequency redshift was not applied.');
    assert(signal.arrivesAtYear >= signal.emittedAtYear + signal.lightTravelYears, 'Signal arrived before its light-travel time.');

    const horizonGalaxy = isolated.galaxies.find(galaxy => galaxy.id === 'debug-horizon-galaxy');
    const horizonCivilization = isolated.civilizations.find(civ => civ.id === 'debug-horizon-civ');
    assert(horizonGalaxy && !horizonGalaxy.reachable, 'Event-horizon galaxy was not marked permanently unreachable.');
    assert(horizonCivilization?.state === 'unreachable' && !horizonCivilization.reachable, 'Event-horizon civilization remained reachable.');
    assert(!isolated.signals.some(item => item.sourceGalaxyId === 'debug-horizon-galaxy'), 'An unreachable civilization transmitted a new observable signal.');

    const wave = isolated.waves.find(item => item.id === 'debug-gw-event');
    assert(wave?.state === 'detected', 'Compact-object gravitational wave was not detected.');
    assert(wave.observedFrequencyHz < wave.sourceFrequencyHz, 'Gravitational-wave frequency was not redshifted.');
    assert(wave.detectorFrameMassSolar > wave.sourceMassSolar, 'Detector-frame mass was not redshifted.');
    assert(wave.detectorConfirmations >= wave.detectorsRequired, 'The gravitational-wave event lacked multi-detector confirmation.');
    assert(wave.followupEventIds.length >= 2, 'Causal multi-messenger follow-up was not created.');

    const machine = isolated.civilizations.find(civ => civ.id === 'debug-machine-civilization');
    assert(machine?.galaxyId === 'debug-machine-cold', 'Machine civilization did not complete migration to the lower-temperature environment.');
    assert(eventTypes.includes('migration'), 'Machine migration was not written to spacetime history.');

    const artifact = isolated.archaeology.find(item => item.id === 'debug-redshifted-artifact');
    assert(artifact?.discovered && !artifact.sourceReachable && artifact.observedRedshift > 0, 'Unreachable redshifted archaeology scenario failed.');

    const unbound = isolated.distanceSamples.find(item => item.id === 'debug-unbound-distance');
    const bound = isolated.distanceSamples.find(item => item.id === 'debug-bound-distance');
    assert(close(unbound.proper1Mpc / unbound.proper0Mpc, unbound.a1 / unbound.a0, 1e-10), 'Comoving-to-proper distance scaling failed.');
    assert(close(bound.proper0Mpc, bound.proper1Mpc, 1e-10), 'A gravitationally bound distance expanded with the Hubble flow.');
    assert(isolated.causalEdges.length >= 7, 'Spacetime causal graph did not preserve sufficient parent-child edges.');

    const liveScenarios = await page.evaluate(() => ({
      galaxyMerger: window.realitySandboxDebug.seedPhase11Scenario('galaxy-merger'),
      redshiftedSignal: window.realitySandboxDebug.seedPhase11Scenario('redshifted-signal'),
      eventHorizon: window.realitySandboxDebug.seedPhase11Scenario('event-horizon'),
      gravitationalWave: window.realitySandboxDebug.seedPhase11Scenario('gravitational-wave'),
      machineColdMigration: window.realitySandboxDebug.seedPhase11Scenario('machine-cold-migration'),
      unreachableArchaeology: window.realitySandboxDebug.seedPhase11Scenario('unreachable-archaeology'),
      distanceFrames: window.realitySandboxDebug.seedPhase11Scenario('distance-frames'),
    }));
    writeJson('phase11-live-scenarios.json', liveScenarios);
    assert(Object.values(liveScenarios).every(result => result.ok), 'A live Phase 11 debug scenario failed to seed.');

    const liveAfterScenarios = await page.evaluate(() => {
      window.realitySandboxDebug.advance(2000);
      return {
        state: window.realitySandboxPhase11.getState(),
        diagnostics: window.realitySandboxDebug.diagnostics(),
        snapshot: window.realitySandboxPhase11.getSnapshot(),
      };
    });
    writeJson('phase11-live-after-scenarios.json', liveAfterScenarios);
    assert(liveAfterScenarios.diagnostics.ok, `Live Phase 11 diagnostics failed: ${liveAfterScenarios.diagnostics.failures.join(', ')}`);
    assert(liveAfterScenarios.state.galaxyMergers >= 1, 'Live galaxy merger did not complete.');
    assert(liveAfterScenarios.state.observedSignals >= 1, 'Live redshifted signal was not observed.');
    assert(liveAfterScenarios.state.detectedWaves >= 1, 'Live gravitational-wave event was not detected.');
    assert(liveAfterScenarios.state.unreachableCivilizations >= 1, 'Live event-horizon scenario did not make a civilization unreachable.');
    assert(liveAfterScenarios.state.unreachableArtifacts >= 1, 'Live cosmological archaeology scenario did not preserve an unreachable source.');

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

    await page.screenshot({ path: path.join(artifactDir, 'reality-sandbox-phase11.png'), fullPage: true });
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
  function close(a, b, tolerance) {
    return Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
  }
  function writeJson(filename, value) {
    fs.writeFileSync(path.join(artifactDir, filename), JSON.stringify(value, null, 2));
  }
})().catch(error => {
  fs.writeFileSync(path.join(artifactDir, 'fatal-error.txt'), `${error.stack || error.message}\n`);
  console.error(error);
  process.exitCode = 1;
});
