const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.REALITY_BASE_URL || 'http://127.0.0.1:4173/';
const artifactDir = process.env.REALITY_ROOT_RENDERER_ARTIFACT_DIR || path.join(process.cwd(), 'artifacts', 'root-renderer-smoke');
fs.mkdirSync(artifactDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  const failedRequests = [];
  page.on('pageerror', error => pageErrors.push({ message: error.message, stack: error.stack }));
  page.on('requestfailed', request => failedRequests.push({ url: request.url(), failure: request.failure() }));

  try {
    const url = new URL(baseUrl);
    url.searchParams.set('debug', '1');
    url.searchParams.set('rendererAudit', '1');
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Boolean(window.realitySandboxDebug?.ready && window.realitySandboxUnified), null, { timeout: 120000 });
    await page.waitForTimeout(1200);

    const result = await page.evaluate(() => {
      const visible = element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
      };
      const resources = performance.getEntriesByType('resource').map(entry => entry.name);
      const forbiddenResources = resources.filter(name => /(?:three\.module|globe-render|galaxy-render-layer|ground-level-phase|origin-surface-visuals|embodied-evolution|creature-body-3d|civilization-visuals|surface-character|closeup-polish)/i.test(name));
      const visibleCanvases = [...document.querySelectorAll('canvas')]
        .filter(visible)
        .map(canvas => ({ id: canvas.id, className: canvas.className, width: canvas.width, height: canvas.height }));
      return {
        modules: window.realitySandboxModules.list().map(module => module.id),
        visibleCanvases,
        forbiddenResources,
        diagnostics: window.realitySandboxDebug.diagnostics(),
        snapshot: window.realitySandboxUnified.getSnapshot(),
      };
    });
    fs.writeFileSync(path.join(artifactDir, 'root-renderer.json'), JSON.stringify(result, null, 2));
    await page.screenshot({ path: path.join(artifactDir, 'pixi-only-root.png'), fullPage: true });

    assert(result.diagnostics.ok, `Root diagnostics failed: ${result.diagnostics.failures.join(', ')}`);
    assert(!result.modules.includes('render.three'), 'The live root registered render.three.');
    assert(result.modules.includes('terrain.headless-surface'), 'The headless surface module is missing.');
    assert(result.modules.includes('evolution.headless-lineages'), 'The headless evolution module is missing.');
    assert(result.forbiddenResources.length === 0, `Retired Three.js resources loaded: ${result.forbiddenResources.join(', ')}`);
    assert(result.visibleCanvases.length === 1, `Expected one visible canvas, found ${JSON.stringify(result.visibleCanvases)}`);
    assert(result.visibleCanvases[0].id === 'lofiLivingCanvas', 'The visible root canvas is not the lo-fi Pixi canvas.');
    assert(result.snapshot.presentation.logicalWidth <= 256 && result.snapshot.presentation.logicalHeight <= 144, 'The root presentation is not low resolution.');
    assert(
      result.snapshot.presentation.spherical === true
        && result.snapshot.presentation.geometry === 'sphere'
        && result.snapshot.presentation.projection === 'orthographic',
      `The live root is not the spherical Pixi world: ${JSON.stringify(result.snapshot.presentation)}`,
    );
    assert(pageErrors.length === 0, `Browser page errors: ${pageErrors.map(error => error.message).join(' | ')}`);
  } finally {
    fs.writeFileSync(path.join(artifactDir, 'page-errors.json'), JSON.stringify(pageErrors, null, 2));
    fs.writeFileSync(path.join(artifactDir, 'request-failures.json'), JSON.stringify(failedRequests, null, 2));
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