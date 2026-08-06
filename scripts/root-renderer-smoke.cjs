const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.REALITY_BASE_URL || 'http://127.0.0.1:4173/';
const artifactDir = process.env.REALITY_ROOT_RENDERER_ARTIFACT_DIR || path.join(process.cwd(), 'artifacts', 'root-renderer-smoke');
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
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Boolean(window.realitySandboxDebug?.ready), null, { timeout: 120000 });
    await page.waitForTimeout(700);
    const result = await page.evaluate(() => {
      const visible = element => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const resources = performance.getEntriesByType('resource').map(entry => entry.name);
      const forbiddenResources = resources.filter(name => /(?:three\.module|scientific-earth|earth-observation|lilac-cloud|rain-runoff|iphone-performance|phase8|phase9|phase10|phase11|galaxy-render|civilization)/i.test(name));
      const visibleCanvases = [...document.querySelectorAll('canvas')].filter(visible).map(canvas => ({ id: canvas.id, width: canvas.width, height: canvas.height }));
      return {
        modules: window.realitySandboxModules.list().map(module => module.id),
        visibleCanvases,
        forbiddenResources,
        snapshot: window.realitySandboxUnified.getSnapshot(),
        diagnostics: window.realitySandboxDebug.diagnostics(),
        inspector: Boolean(document.querySelector('.planet-inspector')),
      };
    });
    fs.writeFileSync(path.join(artifactDir, 'root-renderer.json'), JSON.stringify(result, null, 2));
    await page.evaluate(() => window.realitySandboxDebug.pause());
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(artifactDir, 'single-pixi-root.png'), fullPage: true });
    assert(result.diagnostics.ok, `Root diagnostics failed: ${result.diagnostics.failures.join(', ')}`);
    assert(result.visibleCanvases.length === 1 && result.visibleCanvases[0].id === 'lofiLivingCanvas', `Expected one visible root canvas: ${JSON.stringify(result.visibleCanvases)}`);
    assert(result.forbiddenResources.length === 0, `Frozen or retired root resources loaded: ${result.forbiddenResources.join(', ')}`);
    assert(result.modules.length === 5 && result.modules.at(-1) === 'runtime.procedural-living-planet', `Unexpected root module graph: ${result.modules.join(', ')}`);
    assert(result.snapshot.presentation.renderer === 'pixi-single-canvas' && result.snapshot.coupling.waterSource === 'core/water-cycle.js', 'The renderer is not coupled to the living-planet state.');
    assert(result.inspector && pageErrors.length === 0, `Inspector missing or browser error: ${pageErrors.join(' | ')}`);
  } finally {
    await browser.close();
  }
  function assert(condition, message) { if (!condition) throw new Error(message); }
})().catch(error => {
  fs.writeFileSync(path.join(artifactDir, 'fatal-error.txt'), `${error.stack || error.message}\n`);
  console.error(error);
  process.exitCode = 1;
});
