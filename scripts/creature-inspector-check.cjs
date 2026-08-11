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
    url.searchParams.set('inspectorCheck', '2');
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Boolean(
      window.realitySandboxDebug?.ready &&
      window.realitySandboxWorldView?.model === 'single-three-scene-single-camera-spherical-lod' &&
      window.realitySandboxCreatureInspector?.select &&
      window.realitySandboxCreatureFollow &&
      window.realitySandboxPauseControl &&
      document.getElementById('eidolonSingleWorldCanvas') &&
      document.getElementById('eidolon-creature-follow')
    ), null, { timeout: 120000 });
    await page.waitForTimeout(300);

    if (!await page.evaluate(() => window.realitySandboxDebug.isPaused())) {
      await page.locator('#eidolon-pause-toggle').click();
      await page.waitForTimeout(120);
    }

    const target = await page.evaluate(() => {
      const planet = window.realitySandboxPlanet;
      const c = planet.world.ecs.components;
      const groups = [
        ['grazer', c.agent],
        ['predator', c.predator],
        ['apex', c.apex],
      ];
      for (const [role, group] of groups) {
        const first = group?.entries?.().next?.();
        if (first && !first.done) return { id: Number(first.value[0]), role };
      }
      return null;
    });
    assert(target && Number.isFinite(target.id), 'No living ECS creature was available for inspection.');

    const selectedByApi = await page.evaluate(entityId => window.realitySandboxCreatureInspector.select(entityId), target.id);
    assert(selectedByApi, `Inspector refused living ECS entity ${target.id}.`);
    await page.waitForTimeout(220);
    const selected = await snapshot(page);
    assert(selected.visible, 'Creature inspector did not become visible after selecting a living ECS creature.');
    assert(selected.selectedEntityId === target.id, `Inspector selected entity ${selected.selectedEntityId} instead of entity ${target.id}.`);
    assert(selected.individual?.entityId === target.id, 'Inspector snapshot is not bound to the selected ECS entity.');
    assert(selected.individual?.role === target.role, `Inspector role ${selected.individual?.role} did not match ECS role ${target.role}.`);
    assert(Number.isFinite(selected.individual?.energy), 'Inspector did not expose finite organism energy.');
    assert(Number.isFinite(selected.individual?.age), 'Inspector did not expose finite organism age.');
    assert(Number.isFinite(selected.individual?.dna?.speed), 'Inspector did not expose DNA speed.');
    assert(Number.isFinite(selected.individual?.dna?.sense), 'Inspector did not expose DNA sense.');
    assert(Number.isFinite(selected.individual?.dna?.metabolism), 'Inspector did not expose DNA metabolism.');
    assert(selected.followButtonVisible, 'Follow control did not become visible for the selected creature.');
    assert(selected.worldView?.oneScene && selected.worldView?.oneCamera, 'Inspector is not operating over the single world renderer.');
    await page.screenshot({ path: path.join(outputDir, 'selected-paused-one-scene.png'), fullPage: true });

    const beforeStepTick = selected.individual.worldTick;
    await page.locator('#eidolon-step-once').click();
    await page.waitForTimeout(240);
    const stepped = await snapshot(page);
    assert(stepped.paused, 'Creature inspection single-step resumed the simulation.');
    assert(stepped.selectedEntityId === target.id, 'Creature selection was lost after one paused simulation step.');
    assert(stepped.individual?.worldTick === beforeStepTick + 1, `Inspector did not track the selected creature across exactly one step (${beforeStepTick} -> ${stepped.individual?.worldTick}).`);

    await page.locator('#eidolon-creature-follow').click();
    await page.waitForTimeout(180);
    const followEnabled = await snapshot(page);
    assert(followEnabled.follow?.following && followEnabled.follow.followedEntityId === target.id, 'Follow button did not bind camera tracking to the selected ECS entity.');

    const relocated = await page.evaluate(entityId => {
      const planet = window.realitySandboxPlanet;
      const position = planet.world.ecs.components.position.get(entityId);
      position.x = planet.world.width * 0.73;
      position.y = planet.world.height * 0.32;
      return { centerX: 0.73, centerY: 0.32 };
    }, target.id);
    await page.waitForTimeout(320);
    const followedMove = await snapshot(page);
    assert(followedMove.follow?.following, 'Follow mode disengaged while the selected creature remained alive.');
    assert(Math.abs(followedMove.camera.centerX - relocated.centerX) < 0.01, 'Follow camera did not track creature longitude.');
    assert(Math.abs(followedMove.camera.centerY - relocated.centerY) < 0.01, 'Follow camera did not track creature latitude.');
    assert(Math.abs(followedMove.worldView.x / 1200 - relocated.centerX) < 0.015, 'Single Three.js world camera did not follow the compatibility camera longitude.');
    assert(Math.abs(followedMove.worldView.y / 720 - relocated.centerY) < 0.015, 'Single Three.js world camera did not follow the compatibility camera latitude.');

    const canvas = await page.locator('#eidolonSingleWorldCanvas').boundingBox();
    assert(canvas, 'Unified world canvas did not have bounds for manual follow override test.');
    const beforeManualCamera = followedMove.camera;
    const grabX = canvas.x + canvas.width * 0.5 + Math.min(canvas.width, canvas.height) * 0.18;
    const grabY = canvas.y + canvas.height * 0.5 + Math.min(canvas.width, canvas.height) * 0.06;
    await page.mouse.move(grabX, grabY);
    await page.mouse.down();
    await page.mouse.move(grabX + 125, grabY + 42, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(240);
    const manualOverride = await snapshot(page);
    const centerMoved = circularDistance(manualOverride.camera.centerX, beforeManualCamera.centerX) > 0.0001
      || Math.abs(manualOverride.camera.centerY - beforeManualCamera.centerY) > 0.0001;
    assert(centerMoved, 'Manual drag on the unified world canvas did not move the camera center.');
    assert(!manualOverride.follow?.following, 'Manual unified-world drag did not disengage creature follow mode.');
    assert(manualOverride.worldView?.rendererSwaps === 0 && manualOverride.worldView?.canvasSwaps === 0, 'Inspect/follow workflow caused a renderer or canvas swap.');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    const cleared = await snapshot(page);
    assert(!cleared.visible && cleared.selectedEntityId == null, 'Escape did not clear the creature inspector.');
    assert(pageErrors.length === 0, `Browser page errors: ${pageErrors.map(error => error.message).join(' | ')}`);

    const result = {
      ok: true,
      model: 'ecs-individual-inspection-and-follow-over-single-spherical-three-scene',
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
    const state = window.realitySandboxCreatureInspector?.getSnapshot?.() || {};
    const followButton = document.getElementById('eidolon-creature-follow');
    return {
      paused: Boolean(window.realitySandboxDebug?.isPaused?.()),
      selectedEntityId: state.selectedEntityId ?? null,
      visible: Boolean(state.visible),
      individual: state.individual || null,
      followButtonVisible: Boolean(followButton && !followButton.hidden),
      follow: window.realitySandboxCreatureFollow?.getSnapshot?.() || null,
      camera: window.realitySandboxUnified?.getCamera?.() || null,
      worldView: window.realitySandboxWorldView?.getSnapshot?.() || null,
    };
  });
}

function circularDistance(a, b) {
  const delta = Math.abs(Number(a) - Number(b)) % 1;
  return Math.min(delta, 1 - delta);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
