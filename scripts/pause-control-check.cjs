const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.REALITY_BASE_URL || 'http://127.0.0.1:4173/';
const artifactDir = process.env.REALITY_CHECK_ARTIFACT_DIR || path.join(process.cwd(), 'artifacts', 'reality-check');
const outputDir = path.join(artifactDir, 'pause-control');
fs.mkdirSync(outputDir, { recursive: true });

(async () => {
  const executablePath = process.env.REALITY_CHROMIUM_PATH;
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push({ message: error.message, stack: error.stack }));

  try {
    const url = new URL(baseUrl);
    url.searchParams.set('debug', '1');
    url.searchParams.set('pauseCheck', '1');
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Boolean(
      window.realitySandboxDebug?.ready &&
      window.realitySandboxUnified &&
      window.realitySandboxPauseControl &&
      document.getElementById('eidolon-pause-toggle') &&
      document.getElementById('eidolon-step-once') &&
      document.getElementById('eidolon-playback-speed')
    ), null, { timeout: 120000 });
    await page.waitForTimeout(350);

    await page.evaluate(() => {
      if (window.realitySandboxDebug.isPaused()) window.realitySandboxDebug.resume();
      window.realitySandboxPauseControl.setSpeed(1);
    });
    await page.waitForTimeout(250);

    const initial = await snapshot(page);
    assert(!initial.paused, 'Pause check did not begin in a running state.');
    assert(initial.stepHidden, 'Single-step control should be hidden while the simulation is running.');
    assert(initial.timeScale === 1, `Playback speed did not begin at 1x (${initial.timeScale}).`);
    assert(/1×/.test(initial.speedText), `Playback speed control did not display 1×: ${initial.speedText}`);

    await page.locator('#eidolon-pause-toggle').click();
    await page.waitForTimeout(120);
    const pausedA = await snapshot(page);
    assert(pausedA.paused, 'Visible Pause button did not pause the master simulation.');
    assert(pausedA.buttonPressed === 'true', 'Pause button aria-pressed state did not become true.');
    assert(/Resume/i.test(pausedA.buttonText), `Paused control did not display Resume: ${pausedA.buttonText}`);
    assert(!pausedA.stepHidden, 'Single-step control did not appear while paused.');

    await page.waitForTimeout(650);
    const pausedB = await snapshot(page);
    assert(pausedB.paused, 'Simulation left paused state without user input.');
    assert(pausedB.masterSteps === pausedA.masterSteps, `Master steps advanced while paused (${pausedA.masterSteps} -> ${pausedB.masterSteps}).`);
    assert(pausedB.worldTick === pausedA.worldTick, `World tick advanced while paused (${pausedA.worldTick} -> ${pausedB.worldTick}).`);
    await page.screenshot({ path: path.join(outputDir, 'paused.png'), fullPage: true });

    await page.locator('#eidolon-step-once').click();
    await page.waitForTimeout(80);
    const steppedByButton = await snapshot(page);
    assert(steppedByButton.paused, 'Single-step button resumed the simulation instead of keeping it paused.');
    assert(steppedByButton.masterSteps === pausedB.masterSteps + 1, `Single-step button advanced ${steppedByButton.masterSteps - pausedB.masterSteps} master steps instead of 1.`);
    assert(steppedByButton.worldTick === pausedB.worldTick + 1, `Single-step button advanced world tick ${steppedByButton.worldTick - pausedB.worldTick} instead of 1.`);

    await page.waitForTimeout(300);
    const steppedFrozen = await snapshot(page);
    assert(steppedFrozen.masterSteps === steppedByButton.masterSteps, 'Simulation continued advancing after a single-step button press.');
    assert(steppedFrozen.worldTick === steppedByButton.worldTick, 'World tick continued advancing after a single-step button press.');

    await page.keyboard.press('.');
    await page.waitForTimeout(80);
    const steppedByHotkey = await snapshot(page);
    assert(steppedByHotkey.paused, 'Single-step hotkey resumed the simulation instead of keeping it paused.');
    assert(steppedByHotkey.masterSteps === steppedFrozen.masterSteps + 1, `Single-step hotkey advanced ${steppedByHotkey.masterSteps - steppedFrozen.masterSteps} master steps instead of 1.`);
    assert(steppedByHotkey.worldTick === steppedFrozen.worldTick + 1, `Single-step hotkey advanced world tick ${steppedByHotkey.worldTick - steppedFrozen.worldTick} instead of 1.`);

    await page.locator('#eidolon-pause-toggle').click();
    await page.waitForTimeout(500);
    const resumed = await snapshot(page);
    assert(!resumed.paused, 'Visible Resume button did not resume the simulation.');
    assert(resumed.masterSteps > steppedByHotkey.masterSteps, `Master steps did not advance after resume (${steppedByHotkey.masterSteps} -> ${resumed.masterSteps}).`);
    assert(resumed.worldTick > steppedByHotkey.worldTick, `World tick did not advance after resume (${steppedByHotkey.worldTick} -> ${resumed.worldTick}).`);
    assert(resumed.stepHidden, 'Single-step control remained visible after resume.');

    await page.keyboard.press('p');
    await page.waitForTimeout(120);
    const hotkeyPaused = await snapshot(page);
    assert(hotkeyPaused.paused, 'P hotkey did not pause the simulation.');

    await page.waitForTimeout(350);
    const hotkeyFrozen = await snapshot(page);
    assert(hotkeyFrozen.masterSteps === hotkeyPaused.masterSteps, 'Master steps advanced while hotkey-paused.');
    assert(hotkeyFrozen.worldTick === hotkeyPaused.worldTick, 'World tick advanced while hotkey-paused.');

    await page.keyboard.press('p');
    await page.waitForTimeout(350);
    const hotkeyResumed = await snapshot(page);
    assert(!hotkeyResumed.paused, 'Second P hotkey did not resume the simulation.');
    assert(hotkeyResumed.masterSteps > hotkeyFrozen.masterSteps, 'Master steps did not resume after P hotkey.');
    assert(hotkeyResumed.worldTick > hotkeyFrozen.worldTick, 'World tick did not resume after P hotkey.');

    await page.evaluate(() => window.realitySandboxPauseControl.setSpeed(1));
    await page.waitForTimeout(100);
    await page.locator('#eidolon-playback-speed').click();
    await page.waitForTimeout(120);
    const fastStart = await snapshot(page);
    assert(fastStart.timeScale === 4, `Speed button did not cycle 1× -> 4× (${fastStart.timeScale}).`);
    assert(/4×/.test(fastStart.speedText), `Speed button did not display 4×: ${fastStart.speedText}`);
    await page.waitForTimeout(800);
    const fastEnd = await snapshot(page);
    const fastSteps = fastEnd.masterSteps - fastStart.masterSteps;
    assert(fastSteps > 0, '4× playback produced no simulation steps.');

    await page.keyboard.press('[');
    await page.waitForTimeout(100);
    const normalFromHotkey = await snapshot(page);
    assert(normalFromHotkey.timeScale === 1, `[ hotkey did not reduce 4× -> 1× (${normalFromHotkey.timeScale}).`);
    await page.keyboard.press('[');
    await page.waitForTimeout(120);
    const slowStart = await snapshot(page);
    assert(slowStart.timeScale === 0.25, `[ hotkey did not reduce 1× -> 0.25× (${slowStart.timeScale}).`);
    assert(/0\.25×/.test(slowStart.speedText), `Speed button did not display 0.25×: ${slowStart.speedText}`);
    await page.waitForTimeout(800);
    const slowEnd = await snapshot(page);
    const slowSteps = slowEnd.masterSteps - slowStart.masterSteps;
    assert(fastSteps > Math.max(2, slowSteps * 2), `4× playback was not materially faster than 0.25× (${fastSteps} vs ${slowSteps} steps).`);

    await page.keyboard.press(']');
    await page.waitForTimeout(120);
    const restoredSpeed = await snapshot(page);
    assert(restoredSpeed.timeScale === 1, `] hotkey did not restore 0.25× -> 1× (${restoredSpeed.timeScale}).`);
    assert(/1×/.test(restoredSpeed.speedText), `Speed button did not return to 1×: ${restoredSpeed.speedText}`);
    assert(pageErrors.length === 0, `Browser page errors: ${pageErrors.map(error => error.message).join(' | ')}`);

    const result = {
      ok: true,
      model: 'player-visible-pause-step-and-playback-speed-control',
      initial,
      pausedA,
      pausedB,
      steppedByButton,
      steppedFrozen,
      steppedByHotkey,
      resumed,
      hotkeyPaused,
      hotkeyFrozen,
      hotkeyResumed,
      fastStart,
      fastEnd,
      fastSteps,
      normalFromHotkey,
      slowStart,
      slowEnd,
      slowSteps,
      restoredSpeed,
      pageErrors,
    };
    fs.writeFileSync(path.join(outputDir, 'pause-control.json'), JSON.stringify(result, null, 2));
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
    const state = window.realitySandboxUnified.getState();
    const button = document.getElementById('eidolon-pause-toggle');
    const stepButton = document.getElementById('eidolon-step-once');
    const speedButton = document.getElementById('eidolon-playback-speed');
    const debugSnapshot = window.realitySandboxDebug.snapshot();
    return {
      paused: Boolean(window.realitySandboxDebug.isPaused()),
      masterSteps: Number(state.masterSteps),
      worldTick: Number(window.realitySandboxPlanet.world.tick),
      timeScale: Number(debugSnapshot.timeScale),
      buttonText: button?.textContent?.trim() || '',
      buttonPressed: button?.getAttribute('aria-pressed') || '',
      stepHidden: Boolean(stepButton?.hidden),
      stepText: stepButton?.textContent?.trim() || '',
      speedText: speedButton?.textContent?.trim() || '',
      control: window.realitySandboxPauseControl?.getSnapshot?.() || null,
    };
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
