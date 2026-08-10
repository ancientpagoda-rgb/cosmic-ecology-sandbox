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
      document.getElementById('eidolon-pause-toggle')
    ), null, { timeout: 120000 });
    await page.waitForTimeout(350);

    if (await page.evaluate(() => window.realitySandboxDebug.isPaused())) {
      await page.evaluate(() => window.realitySandboxDebug.resume());
      await page.waitForTimeout(250);
    }

    const initial = await snapshot(page);
    assert(!initial.paused, 'Pause check did not begin in a running state.');

    await page.locator('#eidolon-pause-toggle').click();
    await page.waitForTimeout(120);
    const pausedA = await snapshot(page);
    assert(pausedA.paused, 'Visible Pause button did not pause the master simulation.');
    assert(pausedA.buttonPressed === 'true', 'Pause button aria-pressed state did not become true.');
    assert(/Resume/i.test(pausedA.buttonText), `Paused control did not display Resume: ${pausedA.buttonText}`);

    await page.waitForTimeout(650);
    const pausedB = await snapshot(page);
    assert(pausedB.paused, 'Simulation left paused state without user input.');
    assert(pausedB.masterSteps === pausedA.masterSteps, `Master steps advanced while paused (${pausedA.masterSteps} -> ${pausedB.masterSteps}).`);
    assert(pausedB.worldTick === pausedA.worldTick, `World tick advanced while paused (${pausedA.worldTick} -> ${pausedB.worldTick}).`);
    await page.screenshot({ path: path.join(outputDir, 'paused.png'), fullPage: true });

    await page.locator('#eidolon-pause-toggle').click();
    await page.waitForTimeout(500);
    const resumed = await snapshot(page);
    assert(!resumed.paused, 'Visible Resume button did not resume the simulation.');
    assert(resumed.masterSteps > pausedB.masterSteps, `Master steps did not advance after resume (${pausedB.masterSteps} -> ${resumed.masterSteps}).`);
    assert(resumed.worldTick > pausedB.worldTick, `World tick did not advance after resume (${pausedB.worldTick} -> ${resumed.worldTick}).`);

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
    assert(pageErrors.length === 0, `Browser page errors: ${pageErrors.map(error => error.message).join(' | ')}`);

    const result = {
      ok: true,
      model: 'player-visible-master-pause-control',
      initial,
      pausedA,
      pausedB,
      resumed,
      hotkeyPaused,
      hotkeyFrozen,
      hotkeyResumed,
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
    return {
      paused: Boolean(window.realitySandboxDebug.isPaused()),
      masterSteps: Number(state.masterSteps),
      worldTick: Number(window.realitySandboxPlanet.world.tick),
      buttonText: button?.textContent?.trim() || '',
      buttonPressed: button?.getAttribute('aria-pressed') || '',
      control: window.realitySandboxPauseControl?.getSnapshot?.() || null,
    };
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
