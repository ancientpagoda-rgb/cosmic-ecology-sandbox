const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.REALITY_BASE_URL || 'http://127.0.0.1:4173/';
const artifactDir = process.env.REALITY_IPHONE_ARTIFACT_DIR || path.join(process.cwd(), 'artifacts', 'iphone-sphere-smoke');
fs.mkdirSync(artifactDir, { recursive: true });

(async () => {
  const viewport = { width: 393, height: 852 };
  const executablePath = process.env.REALITY_CHROMIUM_PATH;
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const context = await browser.newContext({ viewport, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Boolean(window.realitySandboxDebug?.ready), null, { timeout: 120000 });
    await page.waitForTimeout(700);
    const before = await page.evaluate(() => window.realitySandboxUnified.getSnapshot().selectedRegion);
    await page.touchscreen.tap(viewport.width * 0.56, viewport.height * 0.48);
    await page.waitForTimeout(120);
    const metrics = await page.evaluate(() => {
      const canvas = document.getElementById('lofiLivingCanvas');
      const canvasRect = canvas.getBoundingClientRect();
      const dashboard = document.querySelector('.planet-dashboard').getBoundingClientRect();
      const inspector = document.querySelector('.planet-inspector').getBoundingClientRect();
      const masthead = document.querySelector('.planet-masthead').getBoundingClientRect();
      return {
        canvas: { bitmapWidth: canvas.width, bitmapHeight: canvas.height, cssWidth: canvasRect.width, cssHeight: canvasRect.height },
        dashboard: { left: dashboard.left, right: dashboard.right, top: dashboard.top, bottom: dashboard.bottom },
        inspector: { left: inspector.left, right: inspector.right, top: inspector.top, bottom: inspector.bottom },
        masthead: { left: masthead.left, right: masthead.right, top: masthead.top, bottom: masthead.bottom },
        visibleCanvasCount: [...document.querySelectorAll('canvas')].filter(node => getComputedStyle(node).display !== 'none').length,
        statDefinitions: document.querySelectorAll('.planet-stat[title][tabindex="0"]').length,
        snapshot: window.realitySandboxUnified.getSnapshot(),
        after: window.realitySandboxUnified.getSnapshot().selectedRegion,
      };
    });
    fs.writeFileSync(path.join(artifactDir, 'iphone-living-planet.json'), JSON.stringify({ ok: null, viewport, metrics, pageErrors }, null, 2));
    const bitmapAspect = metrics.canvas.bitmapWidth / metrics.canvas.bitmapHeight;
    const cssAspect = metrics.canvas.cssWidth / metrics.canvas.cssHeight;
    assert(Math.abs(bitmapAspect - cssAspect) < 0.03, `Canvas aspect mismatch: ${bitmapAspect} vs ${cssAspect}.`);
    assert(metrics.canvas.bitmapWidth >= 170 && metrics.canvas.bitmapHeight >= 340, `Mobile logical resolution is too low: ${metrics.canvas.bitmapWidth}x${metrics.canvas.bitmapHeight}.`);
    assert(metrics.visibleCanvasCount === 1 && metrics.snapshot.presentation.renderer === 'pixi-single-canvas', 'Mobile must use one integrated renderer.');
    assert(metrics.dashboard.left >= 0 && metrics.dashboard.right <= viewport.width && metrics.dashboard.bottom <= viewport.height, 'Dashboard overflows the iPhone viewport.');
    assert(metrics.inspector.left >= 0 && metrics.inspector.right <= viewport.width && metrics.inspector.bottom <= viewport.height, 'Inspector overflows the iPhone viewport.');
    assert(metrics.masthead.bottom <= metrics.inspector.top, 'Inspector overlaps the iPhone masthead.');
    assert(metrics.statDefinitions === 8, 'Mobile statistics lost their definitions.');
    assert(Math.abs(metrics.after.longitude - before.longitude) > 0.5 || Math.abs(metrics.after.latitude - before.latitude) > 0.5, 'Touch inspection did not select a region.');
    assert(metrics.snapshot.presentation.drawnEntities > 0 && pageErrors.length === 0, `Mobile scene is empty or errored: ${pageErrors.join(' | ')}`);
    fs.writeFileSync(path.join(artifactDir, 'iphone-living-planet.json'), JSON.stringify({ ok: true, viewport, metrics, pageErrors }, null, 2));
    await page.screenshot({ path: path.join(artifactDir, 'iphone-living-planet.png'), fullPage: true });
  } finally {
    await context.close();
    await browser.close();
  }
  function assert(condition, message) { if (!condition) throw new Error(message); }
})().catch(error => {
  fs.writeFileSync(path.join(artifactDir, 'fatal-error.txt'), `${error.stack || error.message}\n`);
  console.error(error);
  process.exitCode = 1;
});
