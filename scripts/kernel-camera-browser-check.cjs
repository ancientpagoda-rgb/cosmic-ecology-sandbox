const { chromium } = require('playwright');

const baseUrl = process.env.REALITY_BASE_URL || 'http://127.0.0.1:4173/';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Boolean(
      window.realitySandboxReady &&
      window.realitySandboxUnified &&
      window.realitySandboxPlanet?.world?.ecs &&
      window.realitySandboxKernelReady
    ), null, { timeout: 120000 });
    await page.evaluate(() => Promise.all([window.realitySandboxReady, window.realitySandboxKernelReady]));

    const initial = await page.evaluate(() => window.realitySandboxRealityKernel.snapshot());
    assert(initial.observation?.camera?.level === 'planet', `initial camera should be planet-only: ${JSON.stringify(initial.observation)}`);
    assert(initial.observation?.inspector?.active === false, 'default inspector must not refine reality before selection');
    assert(initial.observers.length === 0, `initial kernel should have no active observers: ${JSON.stringify(initial.observers)}`);
    assert(initial.kernel.nodes.length === 1, `initial kernel should contain only the planet node, got ${initial.kernel.nodes.length}`);
    assert(initial.ecologicalEnergy?.writable === true, 'writable ecological energy contract was not installed');
    assert(initial.ecologicalEnergy?.physicalUnitClaim === false, 'model ecological-energy units must not be presented as physical SI energy');
    assert(initial.ecologicalEnergy?.stock?.capacity > 0, 'ecological energy ledger has no productive landscape capacity');

    // Freeze the authoritative world while selecting and traversing one entity's
    // scale hierarchy. Otherwise a live organism can cross a patch boundary
    // between the 2x/4x/9x assertions, which is valid simulation behavior but
    // makes this observer-coupling test nondeterministic.
    const target = await page.evaluate(() => {
      window.realitySandboxDebug.pause();
      if (!window.realitySandboxDebug.isPaused()) throw new Error('Unable to pause Eidolon for kernel camera test.');
      const world = window.realitySandboxPlanet.world;
      const c = world.ecs.components;
      const candidates = [c.agent, c.predator, c.apex];
      for (const collection of candidates) {
        for (const [id] of collection.entries()) {
          const position = c.position.get(id);
          if (position) return { id, x: position.x, y: position.y, width: world.width, height: world.height };
        }
      }
      throw new Error('No living entity available for camera refinement test.');
    });

    async function setZoom(zoom) {
      return page.evaluate(({ zoom, target }) => {
        window.realitySandboxUnified.setCamera({
          zoom,
          centerX: target.x / target.width,
          centerY: target.y / target.height,
        });
        return window.realitySandboxRealityKernel.snapshot();
      }, { zoom, target });
    }

    const regional = await setZoom(2);
    assert(regional.observation.camera.level === 'region', `2x should request region detail: ${JSON.stringify(regional.observation.camera)}`);
    assert(regional.observation.observers['eidolon:camera']?.resolvedNodeId?.startsWith('eidolon:region:'), '2x camera did not resolve a region node');

    const patch = await setZoom(4);
    assert(patch.observation.camera.level === 'patch', `4x should request patch detail: ${JSON.stringify(patch.observation.camera)}`);
    assert(patch.observation.observers['eidolon:camera']?.resolvedNodeId?.startsWith('eidolon:patch:'), '4x camera did not resolve a patch node');

    const entity = await setZoom(9);
    assert(entity.observation.camera.level === 'entity', `9x should request entity detail: ${JSON.stringify(entity.observation.camera)}`);
    assert(entity.observation.observers['eidolon:camera']?.resolvedNodeId?.startsWith('eidolon:entity:'), `9x camera did not resolve an actual ECS entity: ${JSON.stringify(entity.observation.observers['eidolon:camera'])}`);

    const selected = await page.evaluate(() => {
      window.realitySandboxUnified.setCamera({ zoom: 4 });
      const canvas = document.getElementById('lofiLivingCanvas');
      const rect = canvas.getBoundingClientRect();
      window.realitySandboxUnified.selectAtClientPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return window.realitySandboxRealityKernel.snapshot();
    });
    assert(selected.observation.inspector.active === true, 'programmatic selection did not activate the inspector observer');
    assert(selected.observation.inspector.level === 'patch', `4x inspector should request patch detail: ${JSON.stringify(selected.observation.inspector)}`);
    assert(selected.observation.observers['eidolon:inspector']?.resolvedNodeId?.startsWith('eidolon:patch:'), 'inspector did not resolve selected patch');

    const zoomedOut = await page.evaluate(() => {
      window.realitySandboxUnified.resetCamera();
      return window.realitySandboxRealityKernel.snapshot();
    });
    assert(zoomedOut.observation.camera.level === 'planet', 'reset camera should return to planet resolution');
    assert(!zoomedOut.observation.observers['eidolon:camera'], 'camera observer should be released at overview zoom');
    assert(zoomedOut.observation.inspector.level === 'region', 'active inspector should coarsen to region detail at overview zoom');
    assert(zoomedOut.observation.observers['eidolon:inspector']?.resolvedNodeId?.startsWith('eidolon:region:'), 'inspector did not coarsen back to region node');

    const finalDiagnostics = await page.evaluate(() => window.realitySandboxDebug.diagnostics());
    assert(finalDiagnostics.ok, `existing runtime diagnostics failed: ${(finalDiagnostics.failures || []).join(', ')}`);
    assert(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`);

    console.log(JSON.stringify({
      ok: true,
      pausedDuringTraversal: true,
      initialNodes: initial.kernel.nodes.length,
      ecologicalEnergy: {
        writable: initial.ecologicalEnergy.writable,
        unit: initial.ecologicalEnergy.unit,
        stockAvailability: initial.ecologicalEnergy.stock.availability,
      },
      targetEntity: target.id,
      transitions: {
        overview: initial.observation.camera.level,
        regional: regional.observation.observers['eidolon:camera'].resolvedNodeId,
        patch: patch.observation.observers['eidolon:camera'].resolvedNodeId,
        entity: entity.observation.observers['eidolon:camera'].resolvedNodeId,
        inspector: selected.observation.observers['eidolon:inspector'].resolvedNodeId,
        zoomedOutInspector: zoomedOut.observation.observers['eidolon:inspector'].resolvedNodeId,
      },
    }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
