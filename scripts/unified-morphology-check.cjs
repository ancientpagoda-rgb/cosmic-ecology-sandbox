const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const baseUrl = process.env.REALITY_BASE_URL || 'http://127.0.0.1:4173/';
const artifactDir = process.env.REALITY_CHECK_ARTIFACT_DIR || path.join(process.cwd(), 'artifacts', 'reality-check');
const outputDir = path.join(artifactDir, 'unified-morphology');
fs.mkdirSync(outputDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push({ message: error.message, stack: error.stack }));

  try {
    const url = new URL(baseUrl);
    url.searchParams.set('debug', '1');
    url.searchParams.set('classicCreatureCheck', '1');
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Boolean(
      window.realitySandboxDebug?.ready &&
      window.realitySandboxCreaturePhenotypes?.get &&
      window.realitySandboxGoogridCreatures?.getSnapshot &&
      window.realitySandboxSurfaceMode?.enterAt &&
      document.querySelector('.eidolon-creatures .eidolon-creature[data-entity-id]')
    ), null, { timeout: 120000 });

    const target = await page.evaluate(() => {
      const planet = window.realitySandboxPlanet;
      const c = planet.world.ecs.components;
      const first = [...c.position.entries()].find(([id]) => !c.resource?.has(id) && (c.agent?.has(id) || c.predator?.has(id) || c.apex?.has(id)));
      if (!first) return null;
      const [id, position] = first;
      return { id, x: position.x, y: position.y, width: planet.world.width, height: planet.world.height };
    });
    assert(target && Number.isFinite(target.id), 'No living ECS creature was available for classic presentation testing.');

    await page.evaluate(({ x, y, width, height }) => {
      window.realitySandboxUnified.setCamera({ centerX: x / width, centerY: y / height, zoom: 2.5 });
      window.realitySandboxGoogridCreatures.render();
    }, target);
    await page.waitForTimeout(300);

    const far = await page.evaluate(entityId => {
      const phenotype = window.realitySandboxCreaturePhenotypes.get(entityId);
      const node = document.querySelector(`.eidolon-creatures .eidolon-creature[data-entity-id="${entityId}"]`);
      const style = node ? getComputedStyle(node.closest('.eidolon-creatures')) : null;
      return {
        found: Boolean(node),
        phenotype,
        role: node?.getAttribute('data-role') || null,
        visible: Boolean(node && style && style.display !== 'none' && style.visibility !== 'hidden'),
        classicSnapshot: window.realitySandboxGoogridCreatures.getSnapshot(),
        unifiedRendererLoaded: Boolean(window.realitySandboxUnifiedCreatureLOD),
      };
    }, target.id);

    assert(far.found && far.visible, `Classic GooGrid creature ${target.id} was not visibly rendered.`);
    assert(far.phenotype, 'Authoritative phenotype data service was not retained underneath classic presentation.');
    assert(far.classicSnapshot.style === 'googrid-inspired-lineage-morphology', 'Classic GooGrid morphology renderer was not active.');
    assert(far.classicSnapshot.displayCap == null, 'Classic overview renderer unexpectedly gained a display-count cap.');
    assert(!far.unifiedRendererLoaded, 'v73 replacement creature renderer was still active over the classic visuals.');
    await page.screenshot({ path: path.join(outputDir, 'classic-creature-far.png'), fullPage: true });

    await page.evaluate(({ x, y, width }) => {
      window.realitySandboxSurfaceMode.enterAt((x - 16 + width) % width, y);
    }, target);
    await page.waitForFunction(() => Boolean(
      document.documentElement.dataset.surfaceMode === 'active' &&
      window.realitySandboxPresentationDiagnostics?.().surfaceGpu?.active === true
    ), null, { timeout: 30000 });
    await page.waitForTimeout(900);

    const surface = await page.evaluate(() => ({
      active: document.documentElement.dataset.surfaceMode === 'active',
      visibleClassicFauna: Number(document.documentElement.dataset.surfaceModeVisibleCreatures || 0),
      unifiedSurfaceLayerPresent: Boolean(document.querySelector('.eidolon-surface-creatures')),
      gpu: window.realitySandboxPresentationDiagnostics?.().surfaceGpu || null,
    }));
    assert(surface.active, 'Surface Mode did not activate.');
    assert(surface.gpu?.active === true, 'Original Surface GPU presentation was not active.');
    assert(surface.visibleClassicFauna > 0, 'Original Surface fauna renderer did not show nearby creatures.');
    assert(!surface.unifiedSurfaceLayerPresent, 'v73 Surface replacement creature layer was still present.');
    await page.screenshot({ path: path.join(outputDir, 'classic-creature-surface.png'), fullPage: true });

    await page.evaluate(() => window.realitySandboxSurfaceMode.exit());
    await page.waitForTimeout(180);
    assert(pageErrors.length === 0, `Browser page errors: ${pageErrors.map(error => error.message).join(' | ')}`);

    const result = {
      ok: true,
      model: 'classic-v70-creature-presentation-with-authoritative-phenotype-data-retained',
      target,
      far,
      surface,
      pageErrors,
    };
    fs.writeFileSync(path.join(outputDir, 'unified-morphology.json'), JSON.stringify(result, null, 2));
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
