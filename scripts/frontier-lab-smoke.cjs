const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.REALITY_BASE_URL || 'http://127.0.0.1:4173/';
const artifactDir = process.env.REALITY_FRONTIER_ARTIFACT_DIR || path.join(process.cwd(), 'artifacts', 'frontier-lab-smoke');
fs.mkdirSync(artifactDir, { recursive: true });

(async () => {
  const executablePath = process.env.REALITY_CHROMIUM_PATH;
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  try {
    await page.goto(new URL('./frontier-lab.html', baseUrl).toString(), { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Boolean(document.getElementById('frontier-canvas')), null, { timeout: 120000 });
    await page.waitForFunction(() => document.getElementById('stat-population')?.textContent === '690', null, { timeout: 30000 });
    await page.waitForTimeout(200);

    const before = await page.evaluate(() => ({
      season: document.getElementById('stat-season')?.textContent,
      population: document.getElementById('stat-population')?.textContent,
      trade: document.getElementById('stat-trade')?.textContent,
      runText: document.getElementById('toggle-run')?.textContent,
      links: [...document.querySelectorAll('.frontier-links a')].map(a => a.textContent),
      canvas: (() => {
        const canvas = document.getElementById('frontier-canvas');
        const rect = canvas.getBoundingClientRect();
        return { width: canvas.width, height: canvas.height, cssWidth: rect.width, cssHeight: rect.height };
      })(),
      title: document.getElementById('inspector-title')?.textContent,
      subtitle: document.getElementById('inspector-subtitle')?.textContent,
    }));

    await page.locator('#frontier-canvas').click({ position: { x: 1440 * 0.52, y: 900 * 0.42 } });
    await page.waitForFunction(() => document.getElementById('inspector-title')?.textContent === 'Estuary Town', null, { timeout: 5000 });

    const after = await page.evaluate(() => ({
      title: document.getElementById('inspector-title')?.textContent,
      subtitle: document.getElementById('inspector-subtitle')?.textContent,
      rows: [...document.querySelectorAll('#inspector-grid dt, #inspector-grid dd')].map(node => node.textContent),
    }));

    await page.screenshot({ path: path.join(artifactDir, 'frontier-lab.png'), fullPage: true });
    fs.writeFileSync(path.join(artifactDir, 'frontier-lab.json'), JSON.stringify({ before, after, pageErrors }, null, 2));

    assert(before.season === 'spring · year 0', `Unexpected frontier season readout: ${before.season}.`);
    assert(before.population === '690', `Unexpected frontier population readout: ${before.population}.`);
    assert(Number.isFinite(Number(before.trade)) && Number(before.trade) >= 0, `Unexpected frontier trade readout: ${before.trade}.`);
    assert(before.runText === 'Pause', `Unexpected run button text: ${before.runText}.`);
    assert(before.links.includes('Return to Eidolon') && before.links.includes('Trace origins'), 'Frontier links were not rendered.');
    assert(before.canvas.width >= 1440 && before.canvas.height >= 900, 'Frontier canvas was not sized for the viewport.');
    assert(after.title === 'Estuary Town', `Frontier selection did not inspect the expected settlement: ${after.title}.`);
    assert(after.subtitle?.includes('town'), `Frontier inspector subtitle was not updated: ${after.subtitle}.`);
    assert(after.rows.includes('Population') && after.rows.includes('220'), 'Frontier inspector rows did not render the settlement details.');
    assert(pageErrors.length === 0, `Frontier lab produced browser errors: ${pageErrors.join(' | ')}`);
  } finally {
    await browser.close();
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }
})().catch(error => {
  fs.writeFileSync(path.join(artifactDir, 'fatal-error.txt'), `${error.stack || error.message}\n`);
  console.error(error);
  process.exitCode = 1;
});
