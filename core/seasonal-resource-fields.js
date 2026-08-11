const GRID_COLUMNS = 18;
const GRID_ROWS = 10;

export function createSeasonalResourceFields(world, living, waterCycle, journal) {
  const cells = Array.from({ length: GRID_COLUMNS * GRID_ROWS }, () => ({ food: 0, moisture: 0, fertility: 0, temperature: 0 }));
  let clock = 0;
  let meanFood = 0;
  let previousSeason = -1;
  const api = {
    step,
    sample,
    getSummary: () => ({ ...api.summary }),
    summary: { meanFood, fertileCells: 0, season: 'Vernal rise' },
  };

  function step(dt) {
    clock += dt;
    if (clock < 1.2) return;
    clock = 0;
    refresh();
    applyToPlants();
  }

  function refresh() {
    let totalFood = 0;
    let fertileCells = 0;
    const season = living.getSeason();
    for (let row = 0; row < GRID_ROWS; row += 1) {
      for (let column = 0; column < GRID_COLUMNS; column += 1) {
        const x = (column + 0.5) / GRID_COLUMNS * world.width;
        const y = (row + 0.5) / GRID_ROWS * world.height;
        const terrain = living.sampleDynamicPlanet(x, y);
        const water = waterCycle.sample(x, y);
        const latitude = Math.abs(0.5 - y / world.height) * 2;
        const seasonalLight = 0.56 + Math.sin(season * Math.PI * 2 + x / world.width * Math.PI * 2) * (0.22 - latitude * 0.08);
        const thermalFit = 1 - Math.min(1, Math.abs(terrain.temperature - 0.58) * 1.45);
        // Water-cycle fields can be extended independently; missing optional
        // coastal or sediment fields must not poison the visible food summary.
        const soil = finite(water.soil);
        const river = finite(water.river);
        const delta = finite(water.delta);
        const lake = finite(water.lake);
        const depositedSediment = finite(water.sediment?.depositedFraction);
        const activeErosion = finite(water.sediment?.erosionActivity);
        const moisture = clamp(soil * 0.62 + terrain.rainfall * 0.24 + river * 0.34 + delta * 0.4, 0, 1);
        // Newly deposited material modestly enriches floodplains/deltas while
        // active stripping reduces near-term substrate quality. These remain
        // model fertility effects, not claimed soil-chemistry measurements.
        const fertility = clamp(
          thermalFit * 0.35 + terrain.rainfall * 0.3 + moisture * 0.45
          + depositedSediment * 0.12 - activeErosion * 0.08,
          0,
          1,
        );
        const vegetation = vegetationCover(terrain.biome);
        // The forage map follows the planet's generated vegetation zones. A
        // rainforest is a broad food landscape, while steppe and scrub provide
        // thinner browsing; water, ice, and bare mountains provide none.
        const food = terrain.land && vegetation > 0
          ? clamp(fertility * seasonalLight * vegetation * (lake > 0.72 ? 0.18 : 1), 0, 1)
          : 0;
        const cell = cells[row * GRID_COLUMNS + column];
        Object.assign(cell, { food, moisture, fertility, temperature: terrain.temperature });
        totalFood += food;
        if (food > 0.64) fertileCells += 1;
      }
    }
    meanFood = totalFood / cells.length;
    const seasonIndex = Math.floor(season * 4) % 4;
    if (previousSeason >= 0 && seasonIndex !== previousSeason) {
      journal?.record('Seasonal resource shift', `${seasonName(seasonIndex)} redistributed plant productivity across Eidolon’s watersheds and coasts.`, 'season');
    }
    previousSeason = seasonIndex;
    api.summary = { meanFood, fertileCells, season: seasonName(seasonIndex) };
  }

  function applyToPlants() {
    const { position, resource } = world.ecs.components;
    for (const [id, plant] of resource) {
      const pos = position.get(id);
      if (!pos || plant.kind !== 'plant') continue;
      const availability = sample(pos.x, pos.y);
      plant.seasonalFood = availability.food;
      plant.amount = clamp(plant.amount + (availability.food - 0.42) * 0.025, 0, 1);
    }
  }

  function sample(x, y) {
    const column = clamp(Math.floor((x / world.width) * GRID_COLUMNS), 0, GRID_COLUMNS - 1);
    const row = clamp(Math.floor((y / world.height) * GRID_ROWS), 0, GRID_ROWS - 1);
    return { ...cells[row * GRID_COLUMNS + column] };
  }

  refresh();
  return api;
}

function seasonName(index) {
  return ['Vernal rise', 'High sun', 'Harvest dusk', 'Deep rest'][index] || 'Vernal rise';
}

function vegetationCover(biome) {
  if (biome === 'rainforest') return 1;
  if (biome === 'forest') return 0.9;
  if (biome === 'grassland') return 0.72;
  if (biome === 'steppe') return 0.46;
  if (biome === 'desert') return 0.12;
  // Reduced-order callers may not label a biome; treat suitable land as a
  // modest vegetated plain rather than turning the whole food map off.
  return 0.62;
}

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const finite = value => Number.isFinite(value) ? value : 0;
