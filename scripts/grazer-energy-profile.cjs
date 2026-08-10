const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.REALITY_BASE_URL || 'http://127.0.0.1:4173/';
const artifactRoot = process.env.REALITY_CHECK_ARTIFACT_DIR || path.join(process.cwd(), 'artifacts', 'reality-check');
const outputDir = path.join(artifactRoot, 'grazer-energy');
fs.mkdirSync(outputDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push({ message: error.message, stack: error.stack }));

  try {
    const url = new URL(baseUrl);
    url.searchParams.set('debug', '1');
    url.searchParams.set('profile', 'grazer-energy');
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Boolean(
      window.realitySandboxDebug?.ready &&
      window.realitySandboxPlanet?.world?.forageField?.sample &&
      window.realitySandboxTrophicSatiety &&
      window.realitySandboxReproductiveIsolation
    ), null, { timeout: 120000 });
    await page.waitForTimeout(400);

    const result = await page.evaluate(() => {
      const debug = window.realitySandboxDebug;
      const planet = window.realitySandboxPlanet;
      const c = planet.world.ecs.components;
      debug.pause();
      const initialIds = new Set(c.agent.keys());
      const samples = [];
      let maxObservedEnergy = 0;
      let maxObservedFood = 0;
      let maxThresholdCount = 0;
      const chunks = 24;
      const stepsPerChunk = 50;

      for (let chunk = 0; chunk < chunks; chunk += 1) {
        debug.advance(stepsPerChunk);
        const rows = [];
        for (const [id, grazer] of c.agent) {
          const pos = c.position.get(id);
          if (!pos) continue;
          const food = Number(planet.world.forageField.sample(pos.x, pos.y)?.food) || 0;
          rows.push({
            id,
            energy: Number(grazer.energy) || 0,
            age: Number(grazer.age) || 0,
            food,
            grazing: Number(grazer.grazeClock) > 0,
            assimilated: Number(grazer.assimilatedForage) || 0,
            forageQuality: Number(grazer.lastForageQuality) || 0,
          });
        }
        const energies = rows.map(row => row.energy);
        const foods = rows.map(row => row.food);
        const threshold = Number(planet.world.globals?.reproductionThreshold) || 1.6;
        const thresholdCount = rows.filter(row => row.energy >= threshold).length;
        maxObservedEnergy = Math.max(maxObservedEnergy, ...energies, 0);
        maxObservedFood = Math.max(maxObservedFood, ...foods, 0);
        maxThresholdCount = Math.max(maxThresholdCount, thresholdCount);
        samples.push({
          chunk: chunk + 1,
          tick: planet.world.tick,
          grazers: rows.length,
          newGrazers: rows.filter(row => !initialIds.has(row.id)).length,
          energy: stats(energies),
          food: stats(foods),
          grazingFraction: rows.length ? rows.filter(row => row.grazing).length / rows.length : 0,
          threshold,
          thresholdCount,
          meanAssimilated: mean(rows.map(row => row.assimilated)),
          maxAssimilated: Math.max(...rows.map(row => row.assimilated), 0),
          trophic: window.realitySandboxTrophicSatiety.getSnapshot(),
          reproduction: compactReproduction(window.realitySandboxReproductiveIsolation.getSnapshot()),
        });
      }

      const finalRows = [...c.agent.entries()].map(([id, grazer]) => ({ id, energy: Number(grazer.energy) || 0, age: Number(grazer.age) || 0 }));
      const finalReproduction = window.realitySandboxReproductiveIsolation.getSnapshot();
      return {
        model: 'natural-grazer-energy-profile',
        requestedSteps: chunks * stepsPerChunk,
        initialGrazerCount: initialIds.size,
        finalGrazerCount: finalRows.length,
        maxObservedEnergy,
        maxObservedFood,
        maxThresholdCount,
        naturalBirthsObserved: [...c.agent.keys()].filter(id => !initialIds.has(id)).length,
        finalReproduction,
        trophic: window.realitySandboxTrophicSatiety.getSnapshot(),
        samples,
        diagnostics: debug.diagnostics(),
      };

      function mean(values) {
        return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
      }
      function stats(values) {
        return {
          min: values.length ? Math.min(...values) : 0,
          mean: mean(values),
          max: values.length ? Math.max(...values) : 0,
        };
      }
      function compactReproduction(snapshot) {
        return {
          sexualBirths: snapshot.sexualBirths,
          clonalFallbackBirths: snapshot.clonalFallbackBirths,
          crossSpeciesBirths: snapshot.crossSpeciesBirths,
        };
      }
    });

    fs.writeFileSync(path.join(outputDir, 'profile.json'), JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(outputDir, 'page-errors.json'), JSON.stringify(pageErrors, null, 2));
    if (!result.diagnostics.ok) throw new Error(`Grazer energy diagnostics failed: ${(result.diagnostics.failures || []).join(', ')}`);
    if (pageErrors.length) throw new Error(`Grazer energy browser errors: ${pageErrors.map(item => item.message).join(' | ')}`);
    console.log(JSON.stringify({
      ok: true,
      initialGrazerCount: result.initialGrazerCount,
      finalGrazerCount: result.finalGrazerCount,
      maxObservedEnergy: result.maxObservedEnergy,
      maxObservedFood: result.maxObservedFood,
      maxThresholdCount: result.maxThresholdCount,
      naturalBirthsObserved: result.naturalBirthsObserved,
      trophic: result.trophic,
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
