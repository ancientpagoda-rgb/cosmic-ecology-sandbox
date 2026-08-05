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
    await page.waitForFunction(
      () => Boolean(window.realitySandboxDebug?.ready && window.realitySandboxHifi?.ready),
      null,
      { timeout: 120000 },
    );
    await page.waitForTimeout(300);

    const metrics = await page.evaluate(() => {
      const canvas = document.getElementById('lofiLivingCanvas');
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const style = getComputedStyle(canvas);
      const context = canvas.getContext('2d');
      const center = context?.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
      return {
        bitmapWidth: canvas.width,
        bitmapHeight: canvas.height,
        cssWidth: rect.width,
        cssHeight: rect.height,
        left: rect.left,
        top: rect.top,
        transform: style.transform,
        imageRendering: style.imageRendering,
        visibleCanvasCount: document.querySelectorAll('#lofiLivingCanvas').length,
        hiddenLowResolutionCanvas: Boolean(document.getElementById('lofiLivingCanvasLowRes')),
        hifi: window.realitySandboxHifi?.getState?.(),
        centerPixel: center ? [...center] : null,
      };
    });

    assert(metrics, 'The living-world canvas was not found.');
    const bitmapAspect = metrics.bitmapWidth / metrics.bitmapHeight;
    const cssAspect = metrics.cssWidth / metrics.cssHeight;
    const estimatedSphereDiameter = metrics.cssHeight * 0.86;
    const centerLuminance = metrics.centerPixel
      ? metrics.centerPixel[0] + metrics.centerPixel[1] + metrics.centerPixel[2]
      : 0;

    assert(Math.abs(cssAspect - bitmapAspect) < 0.01,
      `Canvas aspect mismatch: bitmap ${bitmapAspect}, CSS ${cssAspect}.`);
    assert(metrics.bitmapWidth >= 384 && metrics.bitmapHeight >= 216,
      `The iPhone renderer is below the mobile performance floor: ${metrics.bitmapWidth}x${metrics.bitmapHeight}.`);
    assert(metrics.visibleCanvasCount === 1 && !metrics.hiddenLowResolutionCanvas,
      'The iPhone renderer must use one visible canvas without a hidden canvas handoff.');
    assert(metrics.hifi?.ready && metrics.hifi.width === metrics.bitmapWidth,
      `The high-fidelity presentation did not initialize: ${JSON.stringify(metrics.hifi)}.`);
    assert(metrics.cssWidth >= viewport.width * 1.8,
      `Portrait canvas is too narrow to keep the planet large: ${metrics.cssWidth}px.`);
    assert(estimatedSphereDiameter >= viewport.width * 0.9,
      `Estimated planet diameter is too small on iPhone: ${estimatedSphereDiameter}px.`);
    assert(metrics.left < 0 && metrics.left + metrics.cssWidth > viewport.width,
      'The portrait canvas is not centered across the viewport.');
    assert(centerLuminance > 45,
      `The scientific Earth did not render at the canvas center: ${metrics.centerPixel}.`);
    assert(pageErrors.length === 0, `Browser page errors: ${pageErrors.join(' | ')}`);

    const report = {
      ok: true,
      viewport,
      metrics,
      bitmapAspect,
      cssAspect,
      estimatedSphereDiameter,
      centerLuminance,
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
