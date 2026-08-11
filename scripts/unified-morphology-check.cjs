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
    url.searchParams.set('morphologyCheck', '1');
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Boolean(
      window.realitySandboxDebug?.ready &&
      window.realitySandboxCreaturePhenotypes?.get &&
      window.realitySandboxUnifiedCreatureLOD &&
      window.realitySandboxSurfaceMode?.enterAt &&
      document.querySelector('.eidolon-unified-creatures')
    ), null, { timeout: 120000 });

    const target = await page.evaluate(() => {
      const planet = window.realitySandboxPlanet;
      const c = planet.world.ecs.components;
      const first = [...c.position.entries()].find(([id]) => !c.resource?.has(id) && (c.agent?.has(id) || c.predator?.has(id) || c.apex?.has(id)));
      if (!first) return null;
      const [id, position] = first;
      return { id, x: position.x, y: position.y, width: planet.world.width, height: planet.world.height };
    });
    assert(target && Number.isFinite(target.id), 'No living ECS creature was available for morphology parity testing.');

    await page.evaluate(({ x, y, width, height }) => {
      window.realitySandboxUnified.setCamera({ centerX: x / width, centerY: y / height, zoom: 2.5 });
      window.realitySandboxUnifiedCreatureLOD.render();
    }, target);
    await page.waitForTimeout(300);

    const far = await page.evaluate(entityId => {
      const phenotype = window.realitySandboxCreaturePhenotypes.get(entityId);
      const node = document.querySelector(`.eidolon-unified-creatures .eidolon-creature[data-entity-id="${entityId}"]`);
      if (!phenotype || !node) return { phenotype, found: Boolean(node) };
      const fills = [...node.querySelectorAll('[fill]')].map(n => n.getAttribute('fill'));
      return {
        found: true,
        phenotype,
        signature: node.getAttribute('data-phenotype-signature'),
        form: node.getAttribute('data-form'),
        role: node.getAttribute('data-role'),
        fills,
        oldLayerDisplay: getComputedStyle(document.querySelector('.eidolon-creatures')).display,
        lod: window.realitySandboxUnifiedCreatureLOD.getSnapshot(),
      };
    }, target.id);
    assert(far.found, `Unified overview glyph for entity ${target.id} was not rendered.`);
    assert(far.signature === far.phenotype.signature, 'Overview glyph did not use the authoritative phenotype signature.');
    assert(far.form === far.phenotype.form, 'Overview glyph form diverged from authoritative phenotype.');
    assert(far.role === far.phenotype.role, 'Overview glyph role diverged from authoritative phenotype.');
    assert(far.fills.includes(far.phenotype.color) || far.phenotype.sprite, 'Overview glyph did not use phenotype body color.');
    assert(far.oldLayerDisplay === 'none', 'Legacy overview creature layer was still visually active.');
    assert(far.lod.displayCap == null, 'Unified creature LOD introduced a display-count cap.');
    await page.screenshot({ path: path.join(outputDir, 'same-creature-far.png'), fullPage: true });

    await page.evaluate(({ x, y, width }) => {
      const mode = window.realitySandboxSurfaceMode;
      mode.enterAt((x - 16 + width) % width, y);
      const player = mode.getPlayer();
      player.yaw = 0;
      player.pitch = 0.18;
      window.realitySandboxUnifiedCreatureLOD.render();
    }, target);
    await page.waitForFunction(entityId => Boolean(
      document.documentElement.dataset.surfaceMode === 'active' &&
      document.querySelector(`.eidolon-surface-creatures [data-surface-entity-id="${entityId}"] .eidolon-creature[data-entity-id="${entityId}"]`)
    ), target.id, { timeout: 30000 });
    await page.waitForTimeout(800);

    const near = await page.evaluate(entityId => {
      const phenotype = window.realitySandboxCreaturePhenotypes.get(entityId);
      const anchor = document.querySelector(`.eidolon-surface-creatures [data-surface-entity-id="${entityId}"]`);
      const node = anchor?.querySelector(`.eidolon-creature[data-entity-id="${entityId}"]`);
      const fills = node ? [...node.querySelectorAll('[fill]')].map(n => n.getAttribute('fill')) : [];
      return {
        found: Boolean(node),
        phenotype,
        anchorSignature: anchor?.getAttribute('data-phenotype-signature') || null,
        signature: node?.getAttribute('data-phenotype-signature') || null,
        form: node?.getAttribute('data-form') || null,
        role: node?.getAttribute('data-role') || null,
        fills,
        surfaceCount: document.querySelectorAll('.eidolon-surface-creatures [data-surface-entity-id]').length,
        lod: window.realitySandboxUnifiedCreatureLOD.getSnapshot(),
        player: window.realitySandboxSurfaceMode.getPlayer(),
      };
    }, target.id);

    assert(near.found, `Surface glyph for the same ECS entity ${target.id} was not rendered.`);
    assert(near.signature === far.signature, `Far/surface phenotype signatures diverged (${far.signature} vs ${near.signature}).`);
    assert(near.anchorSignature === far.signature, 'Surface projection anchor did not carry the same phenotype signature.');
    assert(near.form === far.form, `Far/surface forms diverged (${far.form} vs ${near.form}).`);
    assert(near.role === far.role, `Far/surface roles diverged (${far.role} vs ${near.role}).`);
    assert(near.fills.includes(far.phenotype.color) || far.phenotype.sprite, 'Surface glyph did not preserve phenotype body color.');
    assert(near.lod.phenotypeMismatches === 0, `Unified LOD reported ${near.lod.phenotypeMismatches} phenotype mismatches.`);
    assert(near.lod.displayCap == null, 'Surface phenotype layer introduced a display-count cap.');
    await page.screenshot({ path: path.join(outputDir, 'same-creature-surface.png'), fullPage: true });

    await page.evaluate(() => window.realitySandboxSurfaceMode.exit());
    await page.waitForTimeout(180);
    assert(pageErrors.length === 0, `Browser page errors: ${pageErrors.map(error => error.message).join(' | ')}`);

    const result = {
      ok: true,
      model: 'one-authoritative-phenotype-two-render-lods',
      target,
      far,
      near,
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
