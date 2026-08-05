const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.REALITY_BASE_URL || 'http://127.0.0.1:4173/';
const artifactDir = process.env.REALITY_REBOUND_ARTIFACT_DIR
  || path.join(process.cwd(), 'artifacts', 'rebound-deploy-smoke');
const browserChannel = process.env.REALITY_BROWSER_CHANNEL || 'chrome';
fs.mkdirSync(artifactDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    channel: browserChannel,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 1024, height: 640 }, deviceScaleFactor: 1 });
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
    url.searchParams.set('test', '1');
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(
      () => Boolean(window.realitySandboxDebug?.ready && window.realitySandboxUnified),
      null,
      { timeout: 120000 },
    );

    const rebound = await page.evaluate(() => window.realitySandboxDebug.seedUnifiedScenario('rebound'));
    writeJson('rebound.json', rebound);

    const status = rebound?.status || {};
    assert(rebound?.ok, `Generated REBOUND scenario failed: ${JSON.stringify(status)}`);
    assert(status.mode === 'rebound-wasm', `Generated REBOUND mode was ${status.mode || 'missing'}.`);
    assert(status.count > 0, 'Generated REBOUND body count was not positive.');
    assert(Number.isFinite(status.timeDays), 'Generated REBOUND time was not finite.');
    assert(Number.isFinite(status.energyError), 'Generated REBOUND energy error was not finite.');
    assert(Array.isArray(rebound.sampleBodies) && rebound.sampleBodies.length > 0, 'Generated REBOUND body snapshot was empty.');
    assert(
      rebound.sampleBodies.every(body => [body.x, body.y, body.z, body.vx, body.vy, body.vz, body.mass, body.radius].every(Number.isFinite)),
      'Generated REBOUND body snapshot contained non-finite values.',
    );
    assert(pageErrors.length === 0, `Browser page errors: ${pageErrors.map(error => error.message).join(' | ')}`);
    await page.screenshot({ path: path.join(artifactDir, 'rebound-deploy.png'), fullPage: true });
  } finally {
    writeJson('console.json', consoleEntries);
    writeJson('page-errors.json', pageErrors);
    writeJson('request-failures.json', failedRequests);
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
