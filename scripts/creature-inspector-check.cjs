const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.REALITY_BASE_URL || 'http://127.0.0.1:4173/';
const artifactDir = process.env.REALITY_CHECK_ARTIFACT_DIR || path.join(process.cwd(), 'artifacts', 'reality-check');
const outputDir = path.join(artifactDir, 'creature-inspector');
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
  page.on('pageerror', error => pageErrors.push({ message: error.message, stack: error.stack }));

  try {
    const url = new URL(baseUrl);
    url.searchParams.set('debug', '1');
    url.searchParams.set('inspectorCheck', '1');
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Boolean(
      window.realitySandboxDebug?.ready &&
      window.realitySandboxGoogridCreatures?.getSnapshot?.().interactiveEntityIds &&
      window.realitySandboxCreatureInspector &&
      window.realitySandboxCreatureFollow &&
      window.realitySandboxPauseControl &&
      document.querySelector('.eidolon-creature[data-entity-id]') &&
      document.getElementById('eidolon-creature-follow')
    ), null, { timeout: 120000 });
    await page.waitForTimeout(300);

    if (!await page.evaluate(() => window.realitySandboxDebug.isPaused())) {
      await page.locator('#eidolon-pause-toggle').click();
      await page.waitForTimeout(120);
    }

    const target = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.eidolon-creature[data-entity-id]')];
      const grazer = nodes.find(node => node.getAttribute('data-role') === 'grazer') || nodes[0];
      return { id: Number(grazer?.getAttribute('data-entity-id')), role: grazer?.getAttribute('data-role') || null };
    });
    assert(Number.isFinite(target.id), 'No inspectable creature entity ID was rendered.');

    await page.locator(`.eidolon-creature[data-entity-id="${target.id}"]`).click({ force: true });
    await page.waitForTimeout(220);
    const selected = await snapshot(page);
    assert(selected.visible, 'Creature inspector did not become visible after clicking a creature.');
    assert(selected.selectedEntityId === target.id, `Inspector selected entity ${selected.selectedEntityId} instead of clicked entity ${target.id}.`);
    assert(selected.individual?.entityId === target.id, 'Inspector snapshot is not bound to the clicked ECS entity.');
    assert(selected.individual?.role === target.role, `Inspector role ${selected.individual?.role} did not match rendered role ${target.role}.`);
    assert(Number.isFinite(selected.individual?.energy), 'Inspector did not expose finite organism energy.');
    assert(Number.isFinite(selected.individual?.age), 'Inspector did not expose finite organism age.');
    assert(Number.isFinite(selected.individual?.dna?.speed), 'Inspector did not expose DNA speed.');
    assert(Number.isFinite(selected.individual?.dna?.sense), 'Inspector did not expose DNA sense.');
    assert(Number.isFinite(selected.individual?.dna?.metabolism), 'Inspector did not expose DNA metabolism.');
    assert(selected.panelText.includes(`entity ${target.id}`), `Inspector panel text does not identify entity ${target.id}.`);
    assert(selected.followButtonVisible, 'Follow control did not become visible for the selected creature.');
    await page.screenshot({ path: path.join(outputDir, 'selected-paused.png'), fullPage: true });

    const beforeStepTick = selected.individual.worldTick;
    await page.locator('#eidolon-step-once').click();
    await page.waitForTimeout(240);
    const stepped = await snapshot(page);
    assert(stepped.paused, 'Creature inspection single-step resumed the simulation.');
    assert(stepped.selectedEntityId === target.id, 'Creature selection was lost after one paused simulation step.');
    assert(stepped.individual?.worldTick === beforeStepTick + 1, `Inspector did not track the selected creature across exactly one step (${beforeStepTick} -> ${stepped.individual?.worldTick}).`);

    await page.locator('#eidolon-creature-follow').click();
    await page.waitForTimeout(160);
    const followEnabled = await snapshot(page);
    assert(followEnabled.follow?.following && followEnabled.follow.followedEntityId === target.id, 'Follow button did not bind camera tracking to the selected ECS entity.');
    assert(followEnabled.camera.zoom >= 2.15, `Follow mode did not bring the creature into a visible zoom (${followEnabled.camera.zoom}).`);

    const relocated = await page.evaluate(entityId => {
      const planet = window.realitySandboxPlanet;
      const position = planet.world.ecs.components.position.get(entityId);
      position.x = planet.world.width * 0.73;
      position.y = planet.world.height * 0.32;
      return { x: position.x, y: position.y, centerX: 0.73, centerY: 0.32 };
    }, target.id);
    await page.waitForTimeout(260);
    const followedMove = await snapshot(page);
    assert(followedMove.follow?.following, 'Follow mode disengaged while the selected creature remained alive.');
    assert(Math.abs(followedMove.camera.centerX - relocated.centerX) < 0.01, `Follow camera did not track creature longitude (${followedMove.camera.centerX} vs ${relocated.centerX}).`);
    assert(Math.abs(followedMove.camera.centerY - relocated.centerY) < 0.01, `Follow camera did not track creature latitude (${followedMove.camera.centerY} vs ${relocated.centerY}).`);
    await page.screenshot({ path: path.join(outputDir, 'following-relocated-creature.png'), fullPage: true });

    const canvas = await page.locator('#lofiLivingCanvas').boundingBox();
    assert(canvas, 'Living canvas did not have bounds for manual follow override test.');
    await page.mouse.move(canvas.x + canvas.width * 0.5, canvas.y + canvas.height * 0.5);
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(160);
    const manualOverride = await snapshot(page);
    assert(!manualOverride.follow?.following, 'Manual globe zoom did not disengage creature follow mode.');
    assert((manualOverride.follow?.manualCancellations || 0) >= 1, 'Follow controller did not record the manual camera override.');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    const cleared = await snapshot(page);
    assert(!cleared.visible && cleared.selectedEntityId == null, 'Escape did not clear the creature inspector.');
    assert(pageErrors.length === 0, `Browser page errors: ${pageErrors.map(error => error.message).join(' | ')}`);

    const result = {
      ok: true,
      model: 'exact-rendered-glyph-to-ecs-individual-inspection-and-camera-follow',
      target,
      selected,
      stepped,
      followEnabled,
      relocated,
      followedMove,
      manualOverride,
      cleared,
      pageErrors,
    };
    fs.writeFileSync(path.join(outputDir, 'creature-inspector.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await context.close();
    await browser.close();
  }
})().catch(error => {
  fs.writeFileSync(path.join(outputDir, 'fatal-error.txt'), `${error.stack || error.message}\n`);
  console.error(error);
  process.exitCode = 1;
});

async function snapshot(page) {
  return page.evaluate(() => {
    const inspector = window.realitySandboxCreatureInspector;
    const panel = document.getElementById('eidolon-creature-inspector');
    const state = inspector?.getSnapshot?.() || {};
    const followButton = document.getElementById('eidolon-creature-follow');
    return {
      paused: Boolean(window.realitySandboxDebug?.isPaused?.()),
      selectedEntityId: state.selectedEntityId ?? null,
      visible: Boolean(state.visible),
      individual: state.individual || null,
      panelText: panel?.textContent?.replace(/\s+/g, ' ').trim() || '',
      followButtonVisible: Boolean(followButton && !followButton.hidden),
      follow: window.realitySandboxCreatureFollow?.getSnapshot?.() || null,
      camera: window.realitySandboxUnified?.getCamera?.() || null,
    };
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
