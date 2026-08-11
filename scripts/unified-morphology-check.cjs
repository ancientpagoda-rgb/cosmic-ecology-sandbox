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
    url.searchParams.set('morphologyCheck', '76');
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Boolean(
      window.realitySandboxDebug?.ready &&
      window.realitySandboxCreaturePhenotypes?.get &&
      window.realitySandboxWorldView?.model === 'single-three-scene-single-camera-spherical-lod' &&
      window.realitySandboxSingleSphericalRenderer?.installed
    ), null, { timeout: 120000 });
    await page.waitForTimeout(320);

    const target = await page.evaluate(() => {
      const planet = window.realitySandboxPlanet;
      const c = planet.world.ecs.components;
      const first = [...c.position.entries()].find(([id]) => !c.resource?.has(id) && (c.agent?.has(id) || c.predator?.has(id) || c.apex?.has(id)));
      if (!first) return null;
      const [id, position] = first;
      const role = c.apex?.has(id) ? 'apex' : c.predator?.has(id) ? 'predator' : 'grazer';
      return { id, role, x: position.x, y: position.y };
    });
    assert(target && Number.isFinite(target.id), 'No living ECS creature was available for one-scene identity testing.');

    const far = await page.evaluate(({ id, x, y }) => {
      window.realitySandboxWorldView.setLocation(x, y);
      window.realitySandboxWorldView.setAltitude(520);
      return {
        phenotype: window.realitySandboxCreaturePhenotypes.get(id),
        view: window.realitySandboxWorldView.getSnapshot(),
        surfaceActive: Boolean(window.realitySandboxSurfaceMode?.isActive?.()),
      };
    }, target);
    await page.waitForTimeout(180);
    assert(far.phenotype, 'Authoritative phenotype data service is missing in orbital view.');
    assert(far.view.oneScene && far.view.oneCamera, 'Orbital creature view is not using the one-scene renderer.');
    assert(!far.surfaceActive, 'Legacy Surface Mode activated in orbital creature view.');
    await page.screenshot({ path: path.join(outputDir, 'creature-orbit-one-scene.png'), fullPage: true });

    const near = await page.evaluate(({ id, x, y }) => {
      window.realitySandboxWorldView.setLocation(x, y);
      window.realitySandboxWorldView.setAltitude(9);
      return {
        phenotype: window.realitySandboxCreaturePhenotypes.get(id),
        view: window.realitySandboxWorldView.getSnapshot(),
        surfaceActive: Boolean(window.realitySandboxSurfaceMode?.isActive?.()),
      };
    }, target);
    await page.waitForTimeout(240);
    assert(near.phenotype, 'Authoritative phenotype data service is missing near the ground.');
    assert(near.view.oneScene && near.view.oneCamera, 'Ground creature view is not using the one-scene renderer.');
    assert(!near.surfaceActive, 'Legacy Surface Mode activated during ground creature view.');
    assert(near.view.canvasId === far.view.canvasId, 'Creature view changed canvases between orbit and ground.');
    assert(near.view.renderer === far.view.renderer, 'Creature view changed renderers between orbit and ground.');
    assert(near.view.rendererSwaps === 0 && near.view.canvasSwaps === 0, 'Creature scale transition caused a renderer/canvas swap.');

    const farSignature = phenotypeSignature(far.phenotype);
    const nearSignature = phenotypeSignature(near.phenotype);
    assert(farSignature === nearSignature, `Creature phenotype changed with camera altitude (${farSignature} != ${nearSignature}).`);
    assert((far.phenotype.role || target.role) === (near.phenotype.role || target.role), 'Creature role changed with viewing scale.');
    await page.screenshot({ path: path.join(outputDir, 'creature-ground-one-scene.png'), fullPage: true });

    const result = {
      ok: true,
      model: 'single-ecs-creature-identity-across-one-three-scene-ground-to-orbit',
      target,
      phenotypeSignature: farSignature,
      far,
      near,
      pageErrors,
    };
    assert(pageErrors.length === 0, `Browser page errors: ${pageErrors.map(error => error.message).join(' | ')}`);
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

function phenotypeSignature(phenotype) {
  if (!phenotype) return 'missing';
  return String(phenotype.signature || JSON.stringify({
    role: phenotype.role,
    form: phenotype.form,
    primaryColor: phenotype.primaryColor,
    accentColor: phenotype.accentColor,
    bodyScale: phenotype.bodyScale,
    limbCount: phenotype.limbCount,
  }));
}
function assert(condition, message) { if (!condition) throw new Error(message); }
