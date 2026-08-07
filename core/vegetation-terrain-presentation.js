const FIELD_WIDTH = 64;
const FIELD_HEIGHT = 32;
const FIELD_REFRESH_MS = 600;
const UI_REPAIR_MS = 300;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrap = (value, max) => ((value % max) + max) % max;

function chooseVisualBiome(terrain, biomass) {
  if (!terrain?.land) return terrain?.biome;
  const biome = terrain.biome;
  const rain = terrain.rainfall ?? 0;
  const temperature = terrain.temperature ?? 0.5;

  if (biome === 'rainforest') {
    if (biomass < 0.14) return 'forest';
    return 'rainforest';
  }
  if (biome === 'forest') {
    if (biomass < 0.09) return 'grassland';
    if (biomass > 0.78 && rain > 0.68 && temperature > 0.58) return 'rainforest';
    return 'forest';
  }
  if (biome === 'grassland') {
    if (biomass < 0.045 && rain < 0.42) return 'steppe';
    if (biomass > 0.56 && rain > 0.5) return 'forest';
    return 'grassland';
  }
  if (biome === 'steppe') {
    if (biomass > 0.42 && rain > 0.32) return 'grassland';
    return 'steppe';
  }
  if (biome === 'desert' && biomass > 0.68 && rain > 0.2) return 'steppe';
  return biome;
}

async function installVegetationTerrainPresentation() {
  try {
    await window.realitySandboxReady;
  } catch {
    return;
  }

  const runtime = window.realitySandboxUnified;
  const planet = window.realitySandboxPlanet;
  const world = planet?.world;
  const living = planet?.living;
  const components = world?.ecs?.components;
  const resources = components?.resource;
  const positions = components?.position;
  if (!runtime?.render || !runtime?.updateInterface || !world || !living?.sampleDynamicPlanet || !resources || !positions) return;
  if (runtime.__vegetationTerrainPresentationInstalled) return;

  const field = new Float32Array(FIELD_WIDTH * FIELD_HEIGHT);
  const originalSampleDynamicPlanet = living.sampleDynamicPlanet.bind(living);
  const originalRender = runtime.render.bind(runtime);
  let lastFieldBuild = -Infinity;
  let lastUiRepair = -Infinity;

  function fieldIndex(column, row) {
    return row * FIELD_WIDTH + wrap(column, FIELD_WIDTH);
  }

  function rebuildField(timestamp = performance.now(), force = false) {
    if (!force && timestamp - lastFieldBuild < FIELD_REFRESH_MS) return;
    lastFieldBuild = timestamp;
    field.fill(0);

    for (const [id, resource] of resources.entries()) {
      const amount = clamp(resource?.amount || 0, 0, 1);
      if (amount <= 0.01) continue;
      const position = positions.get(id);
      if (!position) continue;
      const centerColumn = Math.floor(wrap(position.x, world.width) / world.width * FIELD_WIDTH);
      const centerRow = clamp(Math.floor(position.y / world.height * FIELD_HEIGHT), 0, FIELD_HEIGHT - 1);
      const suitability = clamp(resource.growthSuitability ?? 0.65, 0, 1);
      const strength = amount * (0.72 + suitability * 0.28);

      for (let dy = -2; dy <= 2; dy++) {
        const row = centerRow + dy;
        if (row < 0 || row >= FIELD_HEIGHT) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const distanceSquared = dx * dx + dy * dy;
          if (distanceSquared > 6.25) continue;
          const weight = Math.exp(-distanceSquared * 0.48);
          field[fieldIndex(centerColumn + dx, row)] += strength * weight;
        }
      }
    }

    for (let index = 0; index < field.length; index++) {
      field[index] = 1 - Math.exp(-field[index] * 0.9);
    }
  }

  function sampleBiomass(x, y) {
    const fx = wrap(x, world.width) / world.width * FIELD_WIDTH - 0.5;
    const fy = clamp(y / world.height, 0, 0.999999) * FIELD_HEIGHT - 0.5;
    const x0 = Math.floor(fx);
    const y0 = clamp(Math.floor(fy), 0, FIELD_HEIGHT - 1);
    const x1 = x0 + 1;
    const y1 = clamp(y0 + 1, 0, FIELD_HEIGHT - 1);
    const tx = fx - Math.floor(fx);
    const ty = clamp(fy - Math.floor(fy), 0, 1);
    const a = field[fieldIndex(x0, y0)];
    const b = field[fieldIndex(x1, y0)];
    const c = field[fieldIndex(x0, y1)];
    const d = field[fieldIndex(x1, y1)];
    const top = a + (b - a) * tx;
    const bottom = c + (d - c) * tx;
    return clamp(top + (bottom - top) * ty, 0, 1);
  }

  function visualTerrain(x, y, source = originalSampleDynamicPlanet) {
    const terrain = source(x, y);
    if (!terrain?.land) return terrain;
    const vegetation = sampleBiomass(x, y);
    const biome = chooseVisualBiome(terrain, vegetation);
    if (biome === terrain.biome) return { ...terrain, visualVegetation: vegetation };
    return { ...terrain, biome, visualVegetation: vegetation };
  }

  function patchInteractionCache() {
    const cache = window.realitySandboxInteractionCache;
    if (!cache?.sampleTerrain || cache.__vegetationTerrainPresentationInstalled) return;
    const source = cache.sampleTerrain.bind(cache);
    cache.sampleTerrain = (x, y) => visualTerrain(x, y, source);
    cache.__vegetationTerrainPresentationInstalled = true;
  }

  function updateLabels() {
    const plantValue = document.querySelector('[data-stat="plants"]');
    const plantStat = plantValue?.closest('.planet-stat');
    const plantTerm = plantStat?.querySelector('dt');
    if (plantTerm) plantTerm.textContent = 'Vegetation patches';
    if (plantStat) {
      const definition = 'Simulated vegetation patches. Their biomass is shown through terrain and biome shading rather than individual plant markers.';
      plantStat.title = definition;
      plantStat.setAttribute('aria-label', `Vegetation patches. ${definition}`);
    }

    const legend = document.querySelector('.planet-legend');
    const plantLegend = [...(legend?.querySelectorAll('span') || [])].find(node => node.textContent.trim().toLowerCase() === 'plants');
    if (plantLegend) plantLegend.innerHTML = '<i style="background:#6b9a4f"></i>vegetation in terrain';
  }

  runtime.render = frame => {
    const timestamp = frame?.timestamp ?? performance.now();
    rebuildField(timestamp);
    patchInteractionCache();

    const hadOwnHas = Object.prototype.hasOwnProperty.call(resources, 'has');
    const previousHas = resources.has;
    const hadOwnIterator = Object.prototype.hasOwnProperty.call(resources, Symbol.iterator);
    const previousIterator = resources[Symbol.iterator];
    const previousSample = living.sampleDynamicPlanet;

    // Plant resources remain fully present in the simulation. They are hidden
    // only while presentation code draws, so vegetation is represented by the
    // terrain and the organism budget is reserved for animals.
    resources.has = () => false;
    resources[Symbol.iterator] = function* hiddenVegetationIterator() {};
    living.sampleDynamicPlanet = (x, y) => visualTerrain(x, y);

    let result;
    try {
      result = originalRender(frame);
    } finally {
      living.sampleDynamicPlanet = previousSample;
      if (hadOwnHas) resources.has = previousHas;
      else delete resources.has;
      if (hadOwnIterator) resources[Symbol.iterator] = previousIterator;
      else delete resources[Symbol.iterator];
    }

    // The renderer temporarily hides resource membership above. Refresh the
    // inspector at its normal cadence after restoring the real ecology so its
    // nearby-vegetation counts stay truthful.
    if (timestamp - lastUiRepair >= UI_REPAIR_MS) {
      lastUiRepair = timestamp;
      runtime.updateInterface(true);
    }
    return result;
  };

  rebuildField(performance.now(), true);
  patchInteractionCache();
  updateLabels();
  runtime.__vegetationTerrainPresentationInstalled = true;
  document.documentElement.dataset.vegetationPresentation = 'terrain';
  window.realitySandboxVegetationPresentation = {
    sampleBiomass,
    rebuild: () => rebuildField(performance.now(), true),
    fieldWidth: FIELD_WIDTH,
    fieldHeight: FIELD_HEIGHT,
  };
}

document.addEventListener('DOMContentLoaded', installVegetationTerrainPresentation, { once: true });
