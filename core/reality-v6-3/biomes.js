import { contours } from 'https://cdn.jsdelivr.net/npm/d3-contour@4.0.2/+esm';
import { GRID_WIDTH, GRID_HEIGHT, CELL_COUNT } from '../reality-v6/simulation.js';

const STORAGE_KEY = 'reality-v6-3-season-day';
const TAU = Math.PI * 2;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

const BIOMES = [
  { id: 'desert', label: 'Desert', threshold: 0.61, color: '#c9a45d', alpha: 0.075, outline: '#edce8a' },
  { id: 'forest', label: 'Forest', threshold: 0.57, color: '#2c8a50', alpha: 0.105, outline: '#61bd75' },
  { id: 'wetland', label: 'Wetland', threshold: 0.58, color: '#52a893', alpha: 0.12, outline: '#8ee0bd' },
  { id: 'snow', label: 'Snowfield', threshold: 0.57, color: '#dcecf3', alpha: 0.19, outline: '#f3fbff' },
  { id: 'lake', label: 'Lake basin', threshold: 0.6, color: '#2189c4', alpha: 0.48, outline: '#78cef2' },
];

function indexOf(x, y) {
  const wrappedX = ((x % GRID_WIDTH) + GRID_WIDTH) % GRID_WIDTH;
  const clampedY = Math.max(0, Math.min(GRID_HEIGHT - 1, y));
  return clampedY * GRID_WIDTH + wrappedX;
}

function smoothField(values, passes = 2) {
  let current = Float32Array.from(values);
  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Float32Array(CELL_COUNT);
    for (let y = 0; y < GRID_HEIGHT; y += 1) {
      for (let x = 0; x < GRID_WIDTH; x += 1) {
        const i = indexOf(x, y);
        next[i] =
          current[i] * 0.48 +
          (current[indexOf(x - 1, y)] + current[indexOf(x + 1, y)]) * 0.14 +
          (current[indexOf(x, y - 1)] + current[indexOf(x, y + 1)]) * 0.12;
      }
    }
    current = next;
  }
  return current;
}

function ringArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    area += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
  }
  return Math.abs(area) * 0.5;
}

function gridCoordinateToDegrees(coordinate) {
  const longitude = clamp(-180 + (coordinate[0] / GRID_WIDTH) * 360, -179.999, 179.999);
  const latitude = clamp(-90 + (coordinate[1] / GRID_HEIGHT) * 180, -89.8, 89.8);
  return [longitude, latitude];
}

function convertGeometry(geometry) {
  if (!geometry?.coordinates) return [];
  const polygons = [];
  for (const polygon of geometry.coordinates) {
    if (!polygon?.length || ringArea(polygon[0]) < 1.25) continue;
    const converted = polygon
      .filter((ring, index) => index === 0 || ringArea(ring) > 0.35)
      .map((ring) => ring.map(gridCoordinateToDegrees));
    if (converted[0]?.length >= 4) polygons.push(converted);
  }
  return polygons;
}

function seasonName(day) {
  const normalized = ((day % 360) + 360) % 360;
  if (normalized < 90) return 'northern spring';
  if (normalized < 180) return 'northern summer';
  if (normalized < 270) return 'northern autumn';
  return 'northern winter';
}

export class ContourBiomes {
  constructor(simulation) {
    this.simulation = simulation;
    try {
      this.seasonDay = Number(localStorage.getItem(STORAGE_KEY)) || 45;
    } catch (_) {
      this.seasonDay = 45;
    }
    this.snapshot = this.build();
  }

  advance(days) {
    this.seasonDay = (this.seasonDay + days) % 360;
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, String(this.seasonDay));
      return true;
    } catch (_) {
      return false;
    }
  }

  reset() {
    this.seasonDay = 45;
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    this.snapshot = this.build();
  }

  seasonalAdjustment(y) {
    const latitude = -Math.PI / 2 + ((y + 0.5) / GRID_HEIGHT) * Math.PI;
    const hemisphere = latitude >= 0 ? 1 : -1;
    const annual = Math.sin((this.seasonDay / 360) * TAU - Math.PI / 2);
    return annual * hemisphere * Math.sin(Math.abs(latitude)) * 0.19;
  }

  cellScores(i, y) {
    const elevation = this.simulation.baseElevation[i];
    const land = elevation > 0 ? 1 : 0;
    const temperature = clamp(this.simulation.temperature[i] + this.seasonalAdjustment(y));
    const moisture = this.simulation.moisture[i];
    const vegetation = this.simulation.vegetation[i];
    const runoff = this.simulation.runoff[i];
    const slope = this.simulation.slope[i];
    const lowland = clamp(1 - elevation / 0.34);
    const flatness = clamp(1 - slope * 6.5);

    return {
      desert: land * clamp((1 - moisture) * 0.72 + temperature * 0.28 - vegetation * 0.18),
      forest: land * clamp(vegetation * 0.76 + moisture * 0.21 - Math.max(0, elevation - 0.42) * 1.4),
      wetland: land * clamp(moisture * 0.46 + runoff * 0.43 + lowland * 0.18 + flatness * 0.12 - 0.24),
      snow: land * clamp((1 - temperature) * 0.72 + Math.max(0, elevation - 0.24) * 1.28),
      lake: land * clamp(runoff * 0.58 + moisture * 0.24 + flatness * 0.24 + lowland * 0.18 - 0.39),
    };
  }

  buildFields() {
    const fields = Object.fromEntries(BIOMES.map((biome) => [biome.id, new Float32Array(CELL_COUNT)]));
    const counts = Object.fromEntries(BIOMES.map((biome) => [biome.id, 0]));
    let landCells = 0;

    for (let y = 0; y < GRID_HEIGHT; y += 1) {
      for (let x = 0; x < GRID_WIDTH; x += 1) {
        const i = y * GRID_WIDTH + x;
        const scores = this.cellScores(i, y);
        if (this.simulation.baseElevation[i] > 0) landCells += 1;
        for (const biome of BIOMES) {
          fields[biome.id][i] = scores[biome.id];
          if (scores[biome.id] >= biome.threshold) counts[biome.id] += 1;
        }
      }
    }

    return { fields, counts, landCells };
  }

  build() {
    const { fields, counts, landCells } = this.buildFields();
    const features = [];
    const percentages = {};

    for (const biome of BIOMES) {
      const smoothed = smoothField(fields[biome.id], biome.id === 'lake' ? 1 : 2);
      const geometry = contours()
        .size([GRID_WIDTH, GRID_HEIGHT])
        .smooth(true)
        .thresholds([biome.threshold])(smoothed)[0];
      const polygons = convertGeometry(geometry);
      percentages[biome.id] = landCells ? Math.round((counts[biome.id] / landCells) * 100) : 0;
      features.push({ ...biome, polygons });
    }

    this.snapshot = {
      seasonDay: this.seasonDay,
      season: seasonName(this.seasonDay),
      features,
      percentages,
      regions: features.reduce((sum, feature) => sum + feature.polygons.length, 0),
      watershedRegions: features.find((feature) => feature.id === 'wetland')?.polygons.length || 0,
      lakeRegions: features.find((feature) => feature.id === 'lake')?.polygons.length || 0,
    };
    return this.snapshot;
  }

  classify(latitude, longitude) {
    let x = Math.floor(((longitude + Math.PI) / TAU) * GRID_WIDTH);
    let y = Math.floor(((latitude + Math.PI / 2) / Math.PI) * GRID_HEIGHT);
    x = ((x % GRID_WIDTH) + GRID_WIDTH) % GRID_WIDTH;
    y = Math.max(0, Math.min(GRID_HEIGHT - 1, y));
    const i = y * GRID_WIDTH + x;
    const scores = this.cellScores(i, y);
    const ranked = BIOMES
      .map((biome) => ({ biome, score: scores[biome.id] }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    return {
      id: best.score >= best.biome.threshold * 0.82 ? best.biome.id : 'grassland',
      label: best.score >= best.biome.threshold * 0.82 ? best.biome.label : 'Grassland',
      score: best.score,
      season: seasonName(this.seasonDay),
      moisture: this.simulation.moisture[i],
      vegetation: this.simulation.vegetation[i],
      runoff: this.simulation.runoff[i],
    };
  }
}
