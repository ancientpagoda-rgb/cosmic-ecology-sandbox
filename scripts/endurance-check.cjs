const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.REALITY_BASE_URL || 'http://127.0.0.1:4173/';
const artifactDir = process.env.REALITY_CHECK_ARTIFACT_DIR || path.join(process.cwd(), 'artifacts', 'reality-check');
const outputDir = path.join(artifactDir, 'endurance');
fs.mkdirSync(outputDir, { recursive: true });

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
  const consoleEntries = [];
  page.on('pageerror', error => pageErrors.push({ message: error.message, stack: error.stack }));
  page.on('console', message => consoleEntries.push({ type: message.type(), text: message.text() }));

  try {
    const url = new URL(baseUrl);
    url.searchParams.set('debug', '1');
    url.searchParams.set('endurance', 'fresh-world');
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Boolean(
      window.realitySandboxDebug?.ready &&
      window.realitySandboxPlanet?.world?.ecs &&
      window.realitySandboxMonotonicWorldClock &&
      window.realitySandboxLifeHistorySelection &&
      window.realitySandboxCulturalTraditions
    ), null, { timeout: 120000 });
    await page.waitForTimeout(500);

    const result = await page.evaluate(() => {
      const debug = window.realitySandboxDebug;
      const planet = window.realitySandboxPlanet;
      const c = planet.world.ecs.components;
      debug.pause();

      const beforeState = window.realitySandboxUnified.getState();
      const beforeClock = window.realitySandboxMonotonicWorldClock.getSnapshot();
      const initial = counts();
      const samples = [];
      const chunks = 20;
      const stepsPerChunk = 250;
      const started = performance.now();

      for (let chunk = 0; chunk < chunks; chunk += 1) {
        debug.advance(stepsPerChunk);
        samples.push({
          chunk: chunk + 1,
          ...counts(),
          clock: window.realitySandboxMonotonicWorldClock.getSnapshot(),
          lifeHistory: compactLifeHistory(window.realitySandboxLifeHistorySelection.getSnapshot()),
        });
      }

      const elapsedMs = performance.now() - started;
      const invalid = [];
      for (const [guild, group] of [['grazer', c.agent], ['predator', c.predator], ['apex', c.apex]]) {
        for (const [id, organism] of group) {
          const values = [organism.energy, organism.age, organism.dna?.speed, organism.dna?.sense, organism.dna?.metabolism];
          if (values.some(value => value != null && !Number.isFinite(Number(value)))) invalid.push({ id, guild, values });
        }
      }

      const final = counts();
      const finalClock = window.realitySandboxMonotonicWorldClock.getSnapshot();
      const afterState = window.realitySandboxUnified.getState();
      const occupancy = {
        grazer: fraction(samples, sample => sample.grazers > 0),
        predator: fraction(samples, sample => sample.predators > 0),
        apex: fraction(samples, sample => sample.apex > 0),
        multiSpecies: fraction(samples, sample => sample.species >= 2),
      };
      const warnings = [];
      if (finalClock.ecosystemEpoch > beforeClock.ecosystemEpoch) warnings.push(`The default ecosystem completely collapsed and auto-reseeded ${finalClock.ecosystemEpoch - beforeClock.ecosystemEpoch} time(s).`);
      if (occupancy.grazer < 0.6) warnings.push(`Grazers existed in only ${Math.round(occupancy.grazer * 100)}% of endurance samples.`);
      if (occupancy.predator < 0.4) warnings.push(`Predators existed in only ${Math.round(occupancy.predator * 100)}% of endurance samples.`);
      if (occupancy.apex < 0.15) warnings.push(`Apex predators existed in only ${Math.round(occupancy.apex * 100)}% of endurance samples.`);
      if (occupancy.multiSpecies < 0.6) warnings.push(`Two or more species existed in only ${Math.round(occupancy.multiSpecies * 100)}% of endurance samples.`);
      if (final.grazers === 0) warnings.push('The endurance run ended with no grazers.');
      if (final.species < 2) warnings.push('The endurance run ended with fewer than two living species.');

      return {
        model: 'fresh-world-ecological-endurance',
        requestedSteps: chunks * stepsPerChunk,
        elapsedMs,
        msPerStep: elapsedMs / (chunks * stepsPerChunk),
        beforeState,
        afterState,
        beforeClock,
        finalClock,
        initial,
        final,
        occupancy,
        warnings,
        ecologyStable: warnings.length === 0,
        samples,
        invalid,
        diagnostics: debug.diagnostics(),
        systems: {
          reproductive: window.realitySandboxReproductiveIsolation?.getSnapshot?.() || null,
          hybrid: window.realitySandboxHybridDynamics?.getSnapshot?.() || null,
          lifeHistory: window.realitySandboxLifeHistorySelection?.getSnapshot?.() || null,
          parental: window.realitySandboxParentalInvestment?.getSnapshot?.() || null,
          learning: window.realitySandboxSocialLearning?.getSnapshot?.() || null,
          culture: window.realitySandboxCulturalTraditions?.getSnapshot?.() || null,
        },
      };

      function counts() {
        const grazers = c.agent.size;
        const predators = c.predator.size;
        const apex = c.apex.size;
        return {
          tick: planet.world.tick,
          ecosystemEpoch: planet.world.ecosystemEpoch || 0,
          grazers,
          predators,
          apex,
          living: grazers + predators + apex,
          species: planet.biosphere.getSpecies().filter(item => item.population > 0).length,
        };
      }

      function fraction(values, predicate) {
        return values.length ? values.filter(predicate).length / values.length : 0;
      }

      function compactLifeHistory(snapshot) {
        return {
          deaths: snapshot.deaths,
          starvationDeaths: snapshot.starvationDeaths,
          diseaseDeaths: snapshot.diseaseDeaths,
          senescenceDeaths: snapshot.senescenceDeaths,
          juvenileDeaths: snapshot.juvenileDeaths,
        };
      }
    });

    fs.writeFileSync(path.join(outputDir, 'fresh-world.json'), JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(outputDir, 'console.json'), JSON.stringify(consoleEntries, null, 2));
    fs.writeFileSync(path.join(outputDir, 'page-errors.json'), JSON.stringify(pageErrors, null, 2));
    await page.screenshot({ path: path.join(outputDir, 'fresh-world-after-5000.png'), fullPage: true });

    assert(result.afterState.masterSteps - result.beforeState.masterSteps === result.requestedSteps, 'Endurance master clock did not advance exactly one step per requested step.');
    assert(result.finalClock.tick >= result.beforeClock.tick + result.requestedSteps, 'Planetary clock did not remain monotonic through the endurance run.');
    assert(result.invalid.length === 0, `Non-finite organism state appeared: ${JSON.stringify(result.invalid.slice(0, 5))}`);
    assert(result.final.living > 0, 'No living organisms remain at the end of the fresh-world endurance run.');
    assert(result.diagnostics.ok, `Endurance diagnostics failed: ${(result.diagnostics.failures || []).join(', ')}`);
    assert(pageErrors.length === 0, `Browser page errors: ${pageErrors.map(error => error.message).join(' | ')}`);

    console.log(JSON.stringify({
      ok: true,
      ecologyStable: result.ecologyStable,
      initial: result.initial,
      final: result.final,
      occupancy: result.occupancy,
      ecosystemEpochs: result.finalClock.ecosystemEpoch - result.beforeClock.ecosystemEpoch,
      warnings: result.warnings,
      msPerStep: result.msPerStep,
    }, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
})().catch(error => {
  fs.writeFileSync(path.join(outputDir, 'fatal-error.txt'), `${error.stack || error.message}\n`);
  console.error(error);
  process.exitCode = 1;
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
