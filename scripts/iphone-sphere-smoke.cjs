const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.REALITY_BASE_URL || 'http://127.0.0.1:4173/';
const artifactDir = process.env.REALITY_IPHONE_ARTIFACT_DIR
  || path.join(process.cwd(), 'artifacts', 'iphone-sphere-smoke');
fs.mkdirSync(artifactDir, { recursive: true });

(async () => {
  const viewport = { width: 393, height: 852 };
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  try {
    const url = new URL(baseUrl);
    url.searchParams.set('debug', '1');
    url.searchParams.set('test', '1');
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForFunction(() => Boolean(window.realitySandboxDebug?.ready), null, { timeout: 120000 });
    await page.waitForTimeout(1500);

    const metrics = await page.evaluate(() => {
      const canvas = document.getElementById('lofiLivingCanvas');
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const style = getComputedStyle(canvas);
      return {
        bitmapWidth: canvas.width,
        bitmapHeight: canvas.height,
        cssWidth: rect.width,
        cssHeight: rect.height,
        left: rect.left,
        top: rect.top,
        transform: style.transform,
        imageRendering: style.imageRendering,
      };
    });

    assert(metrics, 'The lo-fi living canvas was not found.');
    const bitmapAspect = metrics.bitmapWidth / metrics.bitmapHeight;
    const cssAspect = metrics.cssWidth / metrics.cssHeight;
    const estimatedSphereDiameter = metrics.cssHeight * 0.86;

    assert(Math.abs(cssAspect - bitmapAspect) < 0.01,
      `Canvas aspect mismatch: bitmap ${bitmapAspect}, CSS ${cssAspect}.`);
    assert(metrics.cssWidth >= viewport.width * 1.8,
      `Portrait canvas is too narrow to keep the planet large: ${metrics.cssWidth}px.`);
    assert(estimatedSphereDiameter >= viewport.width * 0.9,
      `Estimated planet diameter is too small on iPhone: ${estimatedSphereDiameter}px.`);
    assert(metrics.left < 0 && metrics.left + metrics.cssWidth > viewport.width,
      'The portrait canvas is not centered across the viewport.');
    assert(pageErrors.length === 0, `Browser page errors: ${pageErrors.join(' | ')}`);

    const report = {
      ok: true,
      viewport,
      metrics,
      bitmapAspect,
      cssAspect,
      estimatedSphereDiameter,
      pageErrors,
    };
    fs.writeFileSync(path.join(artifactDir, 'iphone-sphere.json'), JSON.stringify(report, null, 2));
    await page.screenshot({ path: path.join(artifactDir, 'iphone-sphere.png'), fullPage: true });
  } finally {
    await context.close();
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
