const FLORA_BUILD = 'v78-3d-plant-world';

async function waitForRuntime() {
  for (let attempt = 0; attempt < 260; attempt += 1) {
    const ready = window.realitySandboxReady;
    if (ready && typeof ready.then === 'function') {
      try { await ready; } catch { return null; }
    }
    const runtime = window.realitySandboxUnified;
    const planet = window.realitySandboxPlanet;
    if (runtime?.render && planet?.world?.ecs?.components) return { runtime, planet };
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  return null;
}

function install({ runtime, planet }) {
  if (window.realitySandboxFloraWorldV78?.installed) return;

  const components = planet.world.ecs.components;
  const originalRender = runtime.render;

  // The animal ecology remains an internal population/evolution engine, but its
  // animal-shaped overview glyphs are presentation-only. During the Pixi draw,
  // temporarily make those ids look like resources so the overview renders
  // terrain, weather, and vegetation without creature silhouettes. The real ECS
  // maps are restored synchronously before simulation code can observe the shim.
  runtime.render = function floraOnlyOverviewRender(frame) {
    const resources = components.resource;
    if (!resources?.has) return originalRender.call(runtime, frame);
    const hadOwnHas = Object.prototype.hasOwnProperty.call(resources, 'has');
    const previousHas = resources.has;
    resources.has = function floraPresentationResourceHas(id) {
      return previousHas.call(resources, id)
        || components.agent?.has(id)
        || components.predator?.has(id)
        || components.apex?.has(id);
    };
    try {
      return originalRender.call(runtime, frame);
    } finally {
      if (hadOwnHas) resources.has = previousHas;
      else delete resources.has;
    }
  };

  function relabelStat(key, label, definition) {
    const value = document.querySelector(`[data-stat="${key}"]`);
    const card = value?.closest?.('.planet-stat');
    if (!card) return;
    const term = card.querySelector('dt');
    if (term && term.textContent !== label) term.textContent = label;
    if (card.title !== definition) card.title = definition;
    const aria = `${label}. ${definition}`;
    if (card.getAttribute('aria-label') !== aria) card.setAttribute('aria-label', aria);
  }

  function replaceLastText(span, text) {
    if (!span) return;
    const textNode = [...span.childNodes].reverse().find(node => node.nodeType === Node.TEXT_NODE);
    if (textNode) {
      if (textNode.textContent !== text) textNode.textContent = text;
    } else span.append(document.createTextNode(text));
  }

  function applyFloraUi() {
    relabelStat('plants', 'Ground flora', 'Active plant and seed-pod biomass in the ecological resource layer.');
    relabelStat('grazers', 'Rosette flora', 'Mobile-ecology population slots are presented as rooted rosette plant individuals.');
    relabelStat('predators', 'Branching flora', 'Higher-trophic population slots are presented as larger branching and crown-form plant individuals.');
    relabelStat('species', 'Plant lineages', 'Persisting evolved lineages currently presented as distinct plant forms.');
    relabelStat('diversity', 'Morphology spread', 'Normalized inherited trait spread used to vary the visible plant forms.');

    const legend = [...document.querySelectorAll('.planet-legend span')];
    const legendLabels = [' ground flora', ' rosette flora', ' branching flora', ' crown flora', ' rain and rivers', ' cloud'];
    legend.forEach((span, index) => {
      if (legendLabels[index]) replaceLastText(span, legendLabels[index]);
    });

    const help = document.querySelector('.planet-help p');
    if (help) {
      const floraHelp = 'Counts are simulated ecological entities. Surface Mode presents the biota as 3D flora: rooted rosettes, branching plants, crown forms, shrubs, and trees. “Mean soil” and “morphology spread” are normalized model indices.';
      if (help.textContent !== floraHelp) help.textContent = floraHelp;
    }

    // Creature-specific editors do not match the new plant presentation. Keep
    // the underlying lineage engine running but remove those animal-facing tools.
    const foundry = document.querySelector('.planet-foundry');
    if (foundry && foundry.style.display !== 'none') foundry.style.display = 'none';
    const evolution = document.querySelector('.planet-evolution');
    if (evolution && evolution.style.display !== 'none') evolution.style.display = 'none';

    const life = document.querySelector('[data-reading="life"]');
    if (life) {
      const match = life.textContent.match(/(\d+)P\s*·\s*(\d+)G\s*·\s*(\d+)C/);
      if (match) {
        const next = `${match[1]} ground · ${match[2]} rosette · ${match[3]} crown`;
        if (life.textContent !== next) life.textContent = next;
      }
      if (life.title !== life.textContent) life.title = life.textContent;
    }

    document.body.dataset.biotaPresentation = 'flora-only';
    document.documentElement.dataset.floraWorld = FLORA_BUILD;
  }

  applyFloraUi();
  const observer = new MutationObserver(() => applyFloraUi());
  observer.observe(document.getElementById('world') || document.body, { childList: true, subtree: true, characterData: true });

  const api = {
    installed: true,
    build: FLORA_BUILD,
    overviewCreatureGlyphs: false,
    surfaceBiota: '3d-plants',
    applyFloraUi,
    destroy() {
      observer.disconnect();
      runtime.render = originalRender;
      delete document.body.dataset.biotaPresentation;
    },
  };
  window.realitySandboxFloraWorldV78 = api;

  const previousDiagnostics = window.realitySandboxPresentationDiagnostics;
  window.realitySandboxPresentationDiagnostics = () => ({
    ...(typeof previousDiagnostics === 'function' ? previousDiagnostics() : {}),
    floraWorldV78: {
      installed: true,
      overviewCreatureGlyphs: false,
      surfaceBiota: '3d-plants',
    },
  });
}

waitForRuntime().then(state => {
  if (!state) {
    document.documentElement.dataset.floraWorld = 'unavailable';
    return;
  }
  install(state);
});
