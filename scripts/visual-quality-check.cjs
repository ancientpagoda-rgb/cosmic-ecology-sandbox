const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.REALITY_BASE_URL || 'http://127.0.0.1:4173/';
const artifactDir = process.env.REALITY_VISUAL_ARTIFACT_DIR || path.join(process.cwd(), 'artifacts', 'visual-regression');
fs.mkdirSync(artifactDir, { recursive: true });

const BASELINES = {
  overview: { minScreenshotBytes: 30000, minColorBuckets: 12, minLumaStdDev: 3.0, minEdgeMean: 0.45 },
  surface: { minScreenshotBytes: 40000, minColorBuckets: 16, minLumaStdDev: 4.0, minEdgeMean: 0.65 },
  experimental: { minScreenshotBytes: 30000, minColorBuckets: 12, minLumaStdDev: 3.0, minEdgeMean: 0.45 },
};

(async () => {
  const executablePath = process.env.REALITY_CHROMIUM_PATH;
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--no-sandbox'],
  });

  const results = { classic: {}, experimental: {}, pageErrors: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    page.on('pageerror', error => results.pageErrors.push(`classic: ${error.message}`));
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Boolean(window.realitySandboxSurfaceMode && window.realitySandboxPlanet && window.realitySandboxUnified), null, { timeout: 120000 });
    await page.waitForTimeout(800);

    results.classic.bootstrap = await page.evaluate(() => ({
      experimentalFlag: document.documentElement.dataset.experimentalSphericalRenderer,
      sphericalInstalled: Boolean(window.realitySandboxSingleSphericalRenderer?.installed),
      classicSurfaceAvailable: Boolean(window.realitySandboxSurfaceMode?.enterAt),
      rootCanvasPresent: Boolean(document.getElementById('lofiLivingCanvas')),
      surfaceEnterVisible: (() => {
        const button = document.getElementById('enterSurfaceMode');
        if (!button) return false;
        const style = getComputedStyle(button);
        const rect = button.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      })(),
    }));
    assert(results.classic.bootstrap.experimentalFlag === 'disabled', `Default route unexpectedly enabled experimental spherical renderer (${results.classic.bootstrap.experimentalFlag}).`);
    assert(!results.classic.bootstrap.sphericalInstalled, 'Default route installed the experimental spherical renderer.');
    assert(results.classic.bootstrap.classicSurfaceAvailable, 'Classic Surface Mode is not the authoritative available renderer.');
    assert(results.classic.bootstrap.rootCanvasPresent, 'Classic root living canvas is missing.');
    assert(results.classic.bootstrap.surfaceEnterVisible, 'Classic Enter Surface control is hidden on the default route.');

    const overview = await captureVisual(page, 'classic-overview.png');
    results.classic.overviewSignature = overview.signature;
    results.classic.overviewScreenshotBytes = overview.buffer.length;
    assertVisual('classic overview', overview.signature, overview.buffer.length, BASELINES.overview);

    await page.evaluate(() => {
      const { position, agent } = window.realitySandboxPlanet.world.ecs.components;
      const firstId = agent.keys().next().value;
      const target = position.get(firstId);
      const world = window.realitySandboxPlanet.world;
      if (target) window.realitySandboxSurfaceMode.enterAt((target.x - 28 + world.width) % world.width, target.y);
      else {
        const camera = window.realitySandboxUnified.getCamera();
        window.realitySandboxSurfaceMode.enterAt(camera.centerX * world.width, camera.centerY * world.height);
      }
    });
    await page.waitForFunction(() => document.documentElement.dataset.surfaceMode === 'active', null, { timeout: 30000 });
    await page.waitForFunction(() => {
      const diagnostics = window.realitySandboxPresentationDiagnostics?.();
      const canvas = document.getElementById('surfaceGpuCanvas');
      if (!canvas || diagnostics?.surfaceGpu?.active !== true) return false;
      const style = getComputedStyle(canvas);
      const rect = canvas.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }, null, { timeout: 30000 });
    await page.waitForFunction(() => window.realitySandboxSurfaceSphereV37?.getStats?.().nearBuildsCompleted >= 1, null, { timeout: 30000 });
    await page.waitForTimeout(500);

    results.classic.surfaceState = await page.evaluate(() => ({
      gpu: window.realitySandboxPresentationDiagnostics?.().surfaceGpu || null,
      sphere: window.realitySandboxSurfaceSphereV37?.getStats?.() || null,
    }));
    results.classic.creatureLayer = await page.evaluate(() => {
      const layer = document.querySelector('.eidolon-creatures');
      if (!layer) return { present: false };
      const style = getComputedStyle(layer);
      return { present: true, display: style.display, visibility: style.visibility, opacity: style.opacity };
    });
    if (results.classic.creatureLayer.present) {
      assert(results.classic.creatureLayer.display !== 'none' && results.classic.creatureLayer.visibility !== 'hidden', 'Established .eidolon-creatures layer is being forcibly hidden.');
    }
    assert(results.classic.surfaceState.gpu?.active === true, 'Classic GPU Surface renderer is not presenting.');
    assert(results.classic.surfaceState.sphere?.nearBuildsCompleted >= 1, 'Classic high-detail near terrain never completed.');

    const surface = await captureVisual(page, 'classic-surface.png');
    results.classic.surfaceSignature = surface.signature;
    results.classic.surfaceScreenshotBytes = surface.buffer.length;
    assertVisual('classic surface', surface.signature, surface.buffer.length, BASELINES.surface);

    const experimental = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    experimental.on('pageerror', error => results.pageErrors.push(`experimental: ${error.message}`));
    const experimentalUrl = new URL(baseUrl);
    experimentalUrl.searchParams.set('renderer', 'spherical');
    await experimental.goto(experimentalUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 120000 });
    await experimental.waitForFunction(() => Boolean(window.realitySandboxSingleSphericalRenderer?.installed), null, { timeout: 120000 });
    await experimental.waitForTimeout(1200);

    results.experimental.state = await experimental.evaluate(() => window.realitySandboxSingleSphericalRenderer.getState());
    assert(results.experimental.state.altitude <= 18, `Experimental spherical renderer starts too far from the surface (${results.experimental.state.altitude}).`);
    assert(results.experimental.state.globalLod === 'ground', `Experimental spherical renderer did not start in ground LOD (${results.experimental.state.globalLod}).`);
    assert(results.experimental.state.globalSegments?.[0] >= 160 && results.experimental.state.globalSegments?.[1] >= 96, `Ground globe LOD is too coarse (${results.experimental.state.globalSegments}).`);
    assert(results.experimental.state.localPatchSegments >= 96, `Local terrain patch is too coarse (${results.experimental.state.localPatchSegments}).`);
    assert(results.experimental.state.localPatchBuildAltitude >= 300, `Local terrain patch activates too late (${results.experimental.state.localPatchBuildAltitude}).`);
    assert(results.experimental.state.patchBuilds >= 1, 'Experimental renderer did not prebuild local terrain before its first close view.');
    assert(results.experimental.state.renderDprCap >= 1.9, `Desktop DPR cap is unexpectedly low (${results.experimental.state.renderDprCap}).`);

    const experimentalShot = await captureVisual(experimental, 'experimental-spherical.png');
    results.experimental.signature = experimentalShot.signature;
    results.experimental.screenshotBytes = experimentalShot.buffer.length;
    assertVisual('experimental spherical', experimentalShot.signature, experimentalShot.buffer.length, BASELINES.experimental);
    await experimental.close();

    assert(results.pageErrors.length === 0, `Browser visual regression emitted errors: ${results.pageErrors.join(' | ')}`);
    fs.writeFileSync(path.join(artifactDir, 'visual-signatures.json'), JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => {
  fs.writeFileSync(path.join(artifactDir, 'fatal-error.txt'), `${error.stack || error.message}\n`);
  console.error(error);
  process.exitCode = 1;
});

async function captureVisual(page, filename) {
  const world = page.locator('#world');
  const buffer = await world.screenshot({ path: path.join(artifactDir, filename) });
  const signature = await screenshotSignature(page, buffer);
  return { buffer, signature };
}

async function screenshotSignature(page, buffer) {
  const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
  return page.evaluate(async url => {
    const image = new Image();
    image.src = url;
    await image.decode();

    const width = 96;
    const height = 60;
    const sample = document.createElement('canvas');
    sample.width = width;
    sample.height = height;
    const ctx = sample.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const buckets = new Set();
    const luma = new Float32Array(width * height);
    let sum = 0;
    let sumSq = 0;
    let opaque = 0;

    for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const a = pixels[i + 3];
      const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
      luma[p] = y;
      sum += y;
      sumSq += y * y;
      if (a > 16) opaque++;
      buckets.add(`${r >> 4}:${g >> 4}:${b >> 4}`);
    }

    const count = width * height;
    const mean = sum / count;
    const variance = Math.max(0, sumSq / count - mean * mean);
    let edge = 0;
    let edgeCount = 0;
    for (let y = 1; y < height; y++) {
      for (let x = 1; x < width; x++) {
        const i = y * width + x;
        edge += Math.abs(luma[i] - luma[i - 1]) + Math.abs(luma[i] - luma[i - width]);
        edgeCount += 2;
      }
    }

    return {
      missing: false,
      sourceWidth: image.naturalWidth,
      sourceHeight: image.naturalHeight,
      colorBuckets: buckets.size,
      lumaMean: mean,
      lumaStdDev: Math.sqrt(variance),
      edgeMean: edgeCount ? edge / edgeCount : 0,
      opaqueRatio: opaque / count,
    };
  }, dataUrl);
}

function assertVisual(label, signature, screenshotBytes, baseline) {
  assert(screenshotBytes >= baseline.minScreenshotBytes, `${label} screenshot is suspiciously small (${screenshotBytes} bytes).`);
  assert(signature.colorBuckets >= baseline.minColorBuckets, `${label} lost color/detail diversity (${signature.colorBuckets} buckets).`);
  assert(signature.lumaStdDev >= baseline.minLumaStdDev, `${label} became visually flat (${signature.lumaStdDev.toFixed(2)} luma stddev).`);
  assert(signature.edgeMean >= baseline.minEdgeMean, `${label} lost too much spatial detail (${signature.edgeMean.toFixed(2)} edge mean).`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
