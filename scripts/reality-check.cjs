const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.REALITY_BASE_URL || 'http://127.0.0.1:4173/';
const artifactDir = process.env.REALITY_CHECK_ARTIFACT_DIR || path.join(process.cwd(), 'artifacts', 'reality-check');
fs.mkdirSync(artifactDir, { recursive: true });

const approvedPresentationCanvases = new Set(['weatherPresentationCanvas', 'surfaceDetailCanvas', 'surfaceModeCanvas']);
const requiredSystems = [
  ['causalBirthLineage', 'realitySandboxCausalBirthLineage'],
  ['reproductiveIsolation', 'realitySandboxReproductiveIsolation'],
  ['hybridDynamics', 'realitySandboxHybridDynamics'],
  ['lifeHistorySelection', 'realitySandboxLifeHistorySelection'],
  ['parentalInvestment', 'realitySandboxParentalInvestment'],
  ['socialLearning', 'realitySandboxSocialLearning'],
  ['culturalTraditions', 'realitySandboxCulturalTraditions'],
];

(async () => {
  const executablePath = process.env.REALITY_CHROMIUM_PATH;
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--no-sandbox'],
  });

  const summary = { baseUrl, startedAt: new Date().toISOString(), profiles: {} };
  try {
    summary.profiles.desktop = await runProfile(browser, 'desktop', { width: 1440, height: 900 }, true);
    summary.profiles.ultrawide = await runProfile(browser, 'ultrawide', { width: 2560, height: 1080 }, false);
    summary.profiles.mobile = await runProfile(browser, 'mobile', { width: 390, height: 844 }, false, true);
    summary.ok = true;
  } finally {
    summary.finishedAt = new Date().toISOString();
    writeJson('summary.json', summary);
    await browser.close();
  }
})().catch(error => {
  fs.writeFileSync(path.join(artifactDir, 'fatal-error.txt'), `${error.stack || error.message}\n`);
  console.error(error);
  process.exitCode = 1;
});

async function runProfile(browser, name, viewport, exerciseSimulation, isMobile = false) {
  const profileDir = path.join(artifactDir, name);
  fs.mkdirSync(profileDir, { recursive: true });
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile, hasTouch: isMobile });
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
    url.searchParams.set('realityCheck', name);
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Boolean(
      window.realitySandboxDebug?.ready &&
      window.realitySandboxUnified &&
      window.realitySandboxPlanet?.world?.ecs &&
      window.realitySandboxCulturalTraditions
    ), null, { timeout: 120000 });
    await page.waitForTimeout(700);

    const initial = await page.evaluate(({ requiredSystems, approved }) => {
      const visible = element => {
        if (!element) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
      };
      const buildText = [...document.querySelectorAll('#world > span[hidden]')].map(node => node.textContent.trim()).find(text => text.startsWith('build-surface-mode-v')) || '';
      const buildMatch = buildText.match(/build-surface-mode-v(\d+)-/);
      const visibleCanvases = [...document.querySelectorAll('canvas')]
        .filter(visible)
        .map(element => ({ id: element.id, width: element.width, height: element.height }));
      const visibleSimulationCanvases = visibleCanvases.filter(item => !approved.includes(item.id));
      const systems = Object.fromEntries(requiredSystems.map(([planetKey, windowKey]) => {
        const api = window[windowKey] || window.realitySandboxPlanet?.[planetKey];
        let snapshot = null;
        try { snapshot = api?.getSnapshot?.() || null; } catch (error) { snapshot = { error: String(error?.message || error) }; }
        return [planetKey, { present: Boolean(api), snapshot }];
      }));
      const components = window.realitySandboxPlanet.world.ecs.components;
      const livingCount = (components.agent?.size || 0) + (components.predator?.size || 0) + (components.apex?.size || 0);
      return {
        title: document.title,
        buildText,
        buildVersion: buildMatch ? Number(buildMatch[1]) : null,
        diagnostics: window.realitySandboxDebug.diagnostics(),
        camera: window.realitySandboxUnified.getCamera(),
        snapshot: window.realitySandboxUnified.getSnapshot(),
        visibleCanvases,
        visibleSimulationCanvases,
        hiddenUi: {
          foundryHidden: !visible(document.querySelector('.planet-foundry')),
          pulseHidden: !visible(document.querySelector('.planet-pulse')) && !visible(document.querySelector('[data-planet-pulse]')),
        },
        qr: {
          visible: visible(document.querySelector('[data-project-qr]')),
          href: document.querySelector('[data-project-qr]')?.href || '',
        },
        creatureLayers: {
          procedural: Boolean(document.querySelector('.eidolon-googrid-creatures')),
          custom: Boolean(document.querySelector('.eidolon-custom-sprites')),
          individual: Boolean(document.querySelector('.eidolon-individual-heredity')) || Boolean(window.realitySandboxIndividualCreatureHeredity),
        },
        systems,
        livingCount,
      };
    }, { requiredSystems, approved: [...approvedPresentationCanvases] });

    writeJson(path.join(name, 'initial.json'), initial);
    assert(initial.title.includes('Procedural Living Planet'), `${name}: unexpected title ${initial.title}`);
    assert(initial.buildVersion >= 43, `${name}: build marker is stale or missing: ${initial.buildText}`);
    assert(initial.diagnostics?.ok, `${name}: initial diagnostics failed: ${(initial.diagnostics?.failures || []).join(', ')}`);
    assert(initial.visibleSimulationCanvases.length === 1 && initial.visibleSimulationCanvases[0].id === 'lofiLivingCanvas', `${name}: expected one visible simulation canvas: ${JSON.stringify(initial.visibleCanvases)}`);
    assert(initial.hiddenUi.foundryHidden && initial.hiddenUi.pulseHidden, `${name}: intentionally hidden panels became visible`);
    assert(initial.qr.visible && initial.qr.href.includes('cosmic-ecology-sandbox'), `${name}: project QR is missing or points elsewhere`);
    for (const [system, state] of Object.entries(initial.systems)) {
      assert(state.present, `${name}: ${system} did not initialize`);
      assert(!state.snapshot?.disabled && !state.snapshot?.error, `${name}: ${system} is disabled or errored: ${JSON.stringify(state.snapshot)}`);
    }
    assert(initial.livingCount > 0, `${name}: world initialized without living organisms`);

    await page.screenshot({ path: path.join(profileDir, 'initial.png'), fullPage: true });

    if (exerciseSimulation) {
      const interaction = await exerciseDesktopInteraction(page);
      writeJson(path.join(name, 'interaction.json'), interaction);

      const biology = await exerciseBiology(page);
      writeJson(path.join(name, 'biology.json'), biology);

      const longRun = await exerciseLongRun(page);
      writeJson(path.join(name, 'long-run.json'), longRun);

      await page.screenshot({ path: path.join(profileDir, 'after-long-run.png'), fullPage: true });
    }

    const finalDiagnostics = await page.evaluate(() => window.realitySandboxDebug.diagnostics());
    writeJson(path.join(name, 'diagnostics.json'), finalDiagnostics);
    assert(finalDiagnostics.ok, `${name}: final diagnostics failed: ${(finalDiagnostics.failures || []).join(', ')}`);
    assert(pageErrors.length === 0, `${name}: page errors: ${pageErrors.map(item => item.message).join(' | ')}`);

    return {
      ok: true,
      viewport,
      buildVersion: initial.buildVersion,
      livingCount: initial.livingCount,
      pageErrors: pageErrors.length,
      requestFailures: failedRequests.length,
    };
  } finally {
    writeJson(path.join(name, 'console.json'), consoleEntries);
    writeJson(path.join(name, 'page-errors.json'), pageErrors);
    writeJson(path.join(name, 'request-failures.json'), failedRequests);
    await context.close();
  }
}

async function exerciseDesktopInteraction(page) {
  const canvasBox = await page.locator('#lofiLivingCanvas').boundingBox();
  assert(canvasBox && canvasBox.width > 0 && canvasBox.height > 0, 'desktop: canvas has no interactive bounds');
  const centerX = canvasBox.x + canvasBox.width * 0.5;
  const centerY = canvasBox.y + canvasBox.height * 0.5;
  const before = await page.evaluate(() => window.realitySandboxUnified.getCamera());

  await page.mouse.move(centerX, centerY);
  await page.mouse.wheel(0, -420);
  await page.waitForTimeout(120);
  const zoomed = await page.evaluate(() => window.realitySandboxUnified.getCamera());
  assert(zoomed.zoom > before.zoom, 'desktop: wheel zoom did not increase camera zoom');

  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 120, centerY + 55, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  const dragged = await page.evaluate(() => window.realitySandboxUnified.getCamera());
  assert(Math.abs(dragged.centerX - zoomed.centerX) > 0.0001 || Math.abs(dragged.centerY - zoomed.centerY) > 0.0001, 'desktop: drag did not rotate globe');

  const regionBefore = await page.evaluate(() => window.realitySandboxUnified.getSnapshot().selectedRegion);
  await page.mouse.click(canvasBox.x + canvasBox.width * 0.61, canvasBox.y + canvasBox.height * 0.53);
  await page.waitForTimeout(120);
  const regionAfter = await page.evaluate(() => window.realitySandboxUnified.getSnapshot().selectedRegion);
  assert(Number.isFinite(regionAfter?.temperature) && Number.isFinite(regionAfter?.soilMoisture), 'desktop: selected region has non-finite climate readings');

  await page.keyboard.press('0');
  const reset = await page.evaluate(() => window.realitySandboxUnified.getCamera());
  assert(reset.zoom === 1 && reset.centerX === 0.5 && reset.centerY === 0.5, 'desktop: camera reset failed');

  return { before, zoomed, dragged, reset, regionBefore, regionAfter };
}

async function exerciseBiology(page) {
  const before = await page.evaluate(() => ({
    reproductive: window.realitySandboxReproductiveIsolation.getSnapshot(),
    hybrid: window.realitySandboxHybridDynamics.getSnapshot(),
    parentage: window.realitySandboxCausalBirthLineage.getSnapshot(),
  }));

  const setup = await page.evaluate(() => {
    const planet = window.realitySandboxPlanet;
    const c = planet.world.ecs.components;
    const rows = [...c.agent.entries()].map(([id, organism]) => ({ id, organism, species: planet.biosphere.getSpeciesForEntity(id) })).filter(row => row.species);
    let parent = null;
    let mate = null;
    outer: for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        if (rows[i].species.id !== rows[j].species.id) {
          parent = rows[i];
          mate = rows[j];
          break outer;
        }
      }
    }
    if (!parent || !mate) return { ok: false, reason: 'No two grazer species available.' };

    const anchor = { x: planet.world.width * 0.44, y: planet.world.height * 0.48 };
    for (const row of rows) {
      const pos = c.position.get(row.id);
      if (!pos) continue;
      pos.x = (anchor.x + 300 + row.id * 7) % planet.world.width;
      pos.y = Math.min(planet.world.height - 20, anchor.y + 180);
      row.organism.energy = Math.min(Number(row.organism.energy) || 1, 1.2);
    }
    const parentPos = c.position.get(parent.id);
    const matePos = c.position.get(mate.id);
    parentPos.x = anchor.x;
    parentPos.y = anchor.y;
    matePos.x = anchor.x + 3;
    matePos.y = anchor.y + 2;
    parent.organism.age = 24;
    parent.organism.energy = 1.92;
    parent.organism.sociality = 0.82;
    mate.organism.age = 24;
    mate.organism.energy = 1.18;
    mate.organism.sociality = 0.82;
    mate.organism.dna = { ...parent.organism.dna, hueShift: (parent.organism.dna?.hueShift || 0) + 2 };
    mate.organism.preferredTemperature = parent.organism.preferredTemperature;
    return { ok: true, parentId: parent.id, mateId: mate.id, parentSpecies: parent.species.id, mateSpecies: mate.species.id };
  });
  assert(setup.ok, `biology setup failed: ${setup.reason || 'unknown reason'}`);

  await page.evaluate(() => {
    window.realitySandboxDebug.pause();
    window.realitySandboxDebug.advance(4);
  });

  const after = await page.evaluate(({ parentId, mateId }) => {
    const planet = window.realitySandboxPlanet;
    const c = planet.world.ecs.components;
    const children = [...c.agent.entries()]
      .filter(([, organism]) => Array.isArray(organism.parentEntityIds) && organism.parentEntityIds.includes(parentId) && organism.parentEntityIds.includes(mateId))
      .map(([id, organism]) => ({
        id,
        parentEntityIds: organism.parentEntityIds,
        reproductionMode: organism.reproductionMode,
        geneFlowBridge: organism.geneFlowBridge,
        ancestryFractions: organism.ancestryFractions || organism.geneticAncestry || null,
        lifeStage: organism.lifeStage,
        energy: organism.energy,
      }));
    return {
      children,
      reproductive: window.realitySandboxReproductiveIsolation.getSnapshot(),
      hybrid: window.realitySandboxHybridDynamics.getSnapshot(),
      parentage: window.realitySandboxCausalBirthLineage.getSnapshot(),
      lifeHistory: window.realitySandboxLifeHistorySelection.getSnapshot(),
      parental: window.realitySandboxParentalInvestment.getSnapshot(),
    };
  }, setup);

  assert(after.children.length >= 1, `biology: forced compatible parents produced no two-parent offspring: ${JSON.stringify(after)}`);
  assert(after.children.some(child => child.reproductionMode === 'sexual-recombination'), 'biology: offspring did not use sexual recombination');
  assert(after.reproductive.sexualBirths > before.reproductive.sexualBirths, 'biology: sexual birth counter did not increase');
  assert(after.reproductive.crossSpeciesBirths > before.reproductive.crossSpeciesBirths, 'biology: cross-species gene-flow birth did not occur');
  assert(after.parentage.exactParentLinks > before.parentage.exactParentLinks, 'biology: causal parentage counter did not increase');

  return { setup, before, after };
}

async function exerciseLongRun(page) {
  const result = await page.evaluate(() => {
    const debug = window.realitySandboxDebug;
    debug.pause();
    const beforeState = window.realitySandboxUnified.getState();
    const beforeTick = window.realitySandboxPlanet.world.tick;
    const started = performance.now();
    const chunks = 12;
    const stepsPerChunk = 250;
    const samples = [];
    for (let chunk = 0; chunk < chunks; chunk += 1) {
      debug.advance(stepsPerChunk);
      const c = window.realitySandboxPlanet.world.ecs.components;
      samples.push({
        tick: window.realitySandboxPlanet.world.tick,
        grazers: c.agent.size,
        predators: c.predator.size,
        apex: c.apex.size,
        species: window.realitySandboxPlanet.biosphere.getSpecies().filter(item => item.population > 0).length,
      });
    }
    const elapsedMs = performance.now() - started;
    const c = window.realitySandboxPlanet.world.ecs.components;
    const invalid = [];
    for (const [guild, group] of [['grazer', c.agent], ['predator', c.predator], ['apex', c.apex]]) {
      for (const [id, organism] of group) {
        const values = [organism.energy, organism.age, organism.dna?.speed, organism.dna?.sense, organism.dna?.metabolism];
        if (values.some(value => value != null && !Number.isFinite(Number(value)))) invalid.push({ id, guild, values });
      }
    }
    return {
      beforeState,
      afterState: window.realitySandboxUnified.getState(),
      beforeTick,
      afterTick: window.realitySandboxPlanet.world.tick,
      requestedSteps: chunks * stepsPerChunk,
      elapsedMs,
      msPerStep: elapsedMs / (chunks * stepsPerChunk),
      samples,
      invalid,
      living: c.agent.size + c.predator.size + c.apex.size,
      species: window.realitySandboxPlanet.biosphere.getSpecies().filter(item => item.population > 0).length,
      systems: {
        reproductive: window.realitySandboxReproductiveIsolation.getSnapshot(),
        hybrid: window.realitySandboxHybridDynamics.getSnapshot(),
        lifeHistory: window.realitySandboxLifeHistorySelection.getSnapshot(),
        parental: window.realitySandboxParentalInvestment.getSnapshot(),
        learning: window.realitySandboxSocialLearning.getSnapshot(),
        culture: window.realitySandboxCulturalTraditions.getSnapshot(),
      },
      diagnostics: debug.diagnostics(),
    };
  });

  assert(result.afterState.masterSteps - result.beforeState.masterSteps === result.requestedSteps, `long-run: expected ${result.requestedSteps} master steps, got ${result.afterState.masterSteps - result.beforeState.masterSteps}`);
  assert(result.invalid.length === 0, `long-run: non-finite organism state: ${JSON.stringify(result.invalid.slice(0, 5))}`);
  assert(result.living > 0, 'long-run: all life vanished without recovery');
  assert(result.species > 0, 'long-run: no living species remain');
  assert(result.diagnostics.ok, `long-run: diagnostics failed: ${(result.diagnostics.failures || []).join(', ')}`);
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeJson(relativePath, value) {
  const target = path.join(artifactDir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value, null, 2));
}
