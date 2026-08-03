import {
  clamp,
  sampleTerrain,
  terrainHeightMeters,
  wrapLongitude,
} from '../reality-v5/world-model.js';

export const GRID_WIDTH = 96;
export const GRID_HEIGHT = 48;
export const CELL_COUNT = GRID_WIDTH * GRID_HEIGHT;
export const STORAGE_KEY = 'reality-engine-v6-world-1';
const TAU = Math.PI * 2;

function wrapX(x) {
  x %= GRID_WIDTH;
  return x < 0 ? x + GRID_WIDTH : x;
}

function clampY(y) {
  return Math.max(0, Math.min(GRID_HEIGHT - 1, y));
}

function indexOf(x, y) {
  return clampY(y) * GRID_WIDTH + wrapX(x);
}

function hash(value) {
  return Math.abs(Math.sin(value * 12.9898 + 78.233) * 43758.5453123) % 1;
}

function radiansToDegrees(value) {
  return value * 180 / Math.PI;
}

function angularDistance(a, b) {
  const sinA = Math.sin(a.latitude);
  const sinB = Math.sin(b.latitude);
  const cosA = Math.cos(a.latitude);
  const cosB = Math.cos(b.latitude);
  const cosine = sinA * sinB + cosA * cosB * Math.cos(a.longitude - b.longitude);
  return Math.acos(clamp(cosine, -1, 1));
}

function interpolateGreatCircle(a, b, steps = 18) {
  const points = [];
  const distance = angularDistance(a, b);
  const sinDistance = Math.sin(distance);
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    if (distance < 1e-6 || Math.abs(sinDistance) < 1e-6) {
      points.push([
        radiansToDegrees(a.longitude + (b.longitude - a.longitude) * t),
        radiansToDegrees(a.latitude + (b.latitude - a.latitude) * t),
      ]);
      continue;
    }
    const wa = Math.sin((1 - t) * distance) / sinDistance;
    const wb = Math.sin(t * distance) / sinDistance;
    const ax = Math.cos(a.latitude) * Math.cos(a.longitude);
    const ay = Math.sin(a.latitude);
    const az = Math.cos(a.latitude) * Math.sin(a.longitude);
    const bx = Math.cos(b.latitude) * Math.cos(b.longitude);
    const by = Math.sin(b.latitude);
    const bz = Math.cos(b.latitude) * Math.sin(b.longitude);
    const x = ax * wa + bx * wb;
    const y = ay * wa + by * wb;
    const z = az * wa + bz * wb;
    const longitude = Math.atan2(z, x);
    const latitude = Math.atan2(y, Math.hypot(x, z));
    points.push([radiansToDegrees(longitude), radiansToDegrees(latitude)]);
  }
  return points;
}

export class LivingWorldSimulation {
  constructor({ years = 0 } = {}) {
    this.years = years;
    this.baseElevation = new Float32Array(CELL_COUNT);
    this.temperature = new Float32Array(CELL_COUNT);
    this.baseMoisture = new Float32Array(CELL_COUNT);
    this.slope = new Float32Array(CELL_COUNT);
    this.moisture = new Float32Array(CELL_COUNT);
    this.vegetation = new Float32Array(CELL_COUNT);
    this.runoff = new Float32Array(CELL_COUNT);
    this.population = new Float32Array(CELL_COUNT);
    this.nextMoisture = new Float32Array(CELL_COUNT);
    this.nextVegetation = new Float32Array(CELL_COUNT);
    this.nextRunoff = new Float32Array(CELL_COUNT);
    this.nextPopulation = new Float32Array(CELL_COUNT);
    this.settlements = [];
    this.roads = [];
    this.rivers = [];
    this._initializeTerrain();
    this._seedState();
    this.rebuildFeatures();
  }

  _initializeTerrain() {
    for (let y = 0; y < GRID_HEIGHT; y += 1) {
      const latitude = -Math.PI / 2 + ((y + 0.5) / GRID_HEIGHT) * Math.PI;
      for (let x = 0; x < GRID_WIDTH; x += 1) {
        const longitude = -Math.PI + ((x + 0.5) / GRID_WIDTH) * TAU;
        const i = indexOf(x, y);
        const terrain = sampleTerrain(latitude, longitude);
        this.baseElevation[i] = terrain.elevation;
        this.temperature[i] = terrain.temperature;
        this.baseMoisture[i] = terrain.baseMoisture;
      }
    }

    for (let y = 0; y < GRID_HEIGHT; y += 1) {
      for (let x = 0; x < GRID_WIDTH; x += 1) {
        const i = indexOf(x, y);
        const elevation = this.baseElevation[i];
        const neighbors = [
          this.baseElevation[indexOf(x - 1, y)],
          this.baseElevation[indexOf(x + 1, y)],
          this.baseElevation[indexOf(x, y - 1)],
          this.baseElevation[indexOf(x, y + 1)],
        ];
        this.slope[i] = Math.max(...neighbors.map((value) => Math.abs(elevation - value)));
      }
    }
  }

  _seedState() {
    for (let y = 0; y < GRID_HEIGHT; y += 1) {
      for (let x = 0; x < GRID_WIDTH; x += 1) {
        const i = indexOf(x, y);
        const elevation = this.baseElevation[i];
        if (elevation < 0) {
          this.moisture[i] = 1;
          this.vegetation[i] = 0;
          this.runoff[i] = 0;
          this.population[i] = 0;
          continue;
        }
        const moisture = clamp(this.baseMoisture[i] * 0.74 + 0.11 - elevation * 0.08, 0, 1);
        const vegetation = this._vegetationTarget(i, moisture);
        const habitability = this._habitability(i, moisture, vegetation);
        this.moisture[i] = moisture;
        this.vegetation[i] = vegetation;
        this.runoff[i] = 0;
        this.population[i] = habitability > 0.69 && hash(i * 41.17) > 0.986
          ? 120 + hash(i * 9.71) * 880
          : 0;
      }
    }
  }

  _vegetationTarget(i, moisture) {
    const temperature = this.temperature[i];
    if (this.baseElevation[i] <= 0 || temperature < 0.11) return 0;
    return clamp(
      (moisture - 0.15) * 1.56 *
        (1 - Math.abs(temperature - 0.61) * 1.24) -
        Math.max(0, this.baseElevation[i] - 0.44) * 0.8,
      0,
      1,
    );
  }

  _habitability(i, moisture, vegetation) {
    const elevation = this.baseElevation[i];
    const temperature = this.temperature[i];
    if (elevation <= 0 || elevation > 0.5 || temperature < 0.13 || temperature > 0.94) return 0;
    return clamp(
      vegetation * 0.48 +
        moisture * 0.34 -
        Math.abs(temperature - 0.58) * 0.72 -
        this.slope[i] * 0.62,
      0,
      1,
    );
  }

  step(years = 25) {
    const dt = clamp(years / 100, 0.04, 1.2);
    const epoch = Math.floor((this.years + years) / 600);

    for (let y = 0; y < GRID_HEIGHT; y += 1) {
      for (let x = 0; x < GRID_WIDTH; x += 1) {
        const i = indexOf(x, y);
        const elevation = this.baseElevation[i];
        if (elevation < 0) {
          this.nextMoisture[i] = 1;
          this.nextVegetation[i] = 0;
          this.nextRunoff[i] = 0;
          this.nextPopulation[i] = 0;
          continue;
        }

        const left = indexOf(x - 1, y);
        const right = indexOf(x + 1, y);
        const up = indexOf(x, y - 1);
        const down = indexOf(x, y + 1);
        const moistureAverage = (this.moisture[left] + this.moisture[right] + this.moisture[up] + this.moisture[down]) * 0.25;
        const vegetationAverage = (this.vegetation[left] + this.vegetation[right] + this.vegetation[up] + this.vegetation[down]) * 0.25;
        const populationAverage = (this.population[left] + this.population[right] + this.population[up] + this.population[down]) * 0.25;
        const oceanNeighbors =
          (this.baseElevation[left] < 0 ? 1 : 0) +
          (this.baseElevation[right] < 0 ? 1 : 0) +
          (this.baseElevation[up] < 0 ? 1 : 0) +
          (this.baseElevation[down] < 0 ? 1 : 0);

        const climatePulse = Math.sin(epoch * 0.31 + i * 0.017) * 0.07;
        const rainfall = clamp(
          0.13 + this.baseMoisture[i] * 0.72 + oceanNeighbors * 0.045 + climatePulse - elevation * 0.11,
          0,
          1,
        );
        const evaporation = (0.024 + this.temperature[i] * 0.057) * (1 - this.vegetation[i] * 0.3);
        const moisture = clamp(
          this.moisture[i] +
            ((rainfall - evaporation) * 0.045 + (moistureAverage - this.moisture[i]) * 0.13) * dt,
          0,
          1,
        );

        const localDrainage = Math.max(0, moisture - (0.48 + this.vegetation[i] * 0.13));
        const neighborFlow = (this.runoff[left] + this.runoff[right] + this.runoff[up] + this.runoff[down]) * 0.25;
        const runoff = clamp(
          localDrainage * (0.24 + this.slope[i] * 4.8) + neighborFlow * 0.14,
          0,
          1,
        );

        const vegetationTarget = this._vegetationTarget(i, moisture);
        const vegetation = clamp(
          this.vegetation[i] +
            ((vegetationTarget - this.vegetation[i]) * 0.075 + (vegetationAverage - this.vegetation[i]) * 0.02) * dt,
          0,
          1,
        );

        const habitability = this._habitability(i, moisture, vegetation);
        let population = this.population[i];
        population += population * (habitability - 0.42) * 0.0085 * dt;
        population += (populationAverage - population) * 0.0018 * dt;
        if (population < 1 && habitability > 0.75 && hash(i * 13.7 + epoch * 5.1) > 0.9988) {
          population = 45 + hash(i + epoch * 1.73) * 210;
        }
        if (runoff > 0.34 && habitability > 0.52) population *= 1 + 0.0028 * dt;
        population = clamp(population, 0, 180_000);

        this.nextMoisture[i] = moisture;
        this.nextVegetation[i] = vegetation;
        this.nextRunoff[i] = runoff;
        this.nextPopulation[i] = population;
      }
    }

    this.moisture.set(this.nextMoisture);
    this.vegetation.set(this.nextVegetation);
    this.runoff.set(this.nextRunoff);
    this.population.set(this.nextPopulation);
    this.years += years;
    this.rebuildFeatures();
  }

  rebuildFeatures() {
    this.settlements = this._buildSettlements();
    this.roads = this._buildRoads(this.settlements);
    this.rivers = this._buildRivers();
  }

  _buildSettlements() {
    const candidates = [];
    for (let y = 1; y < GRID_HEIGHT - 1; y += 1) {
      for (let x = 0; x < GRID_WIDTH; x += 1) {
        const i = indexOf(x, y);
        const population = this.population[i];
        if (population < 35 || this.baseElevation[i] <= 0) continue;
        const neighbors = [
          this.population[indexOf(x - 1, y)],
          this.population[indexOf(x + 1, y)],
          this.population[indexOf(x, y - 1)],
          this.population[indexOf(x, y + 1)],
        ];
        if (neighbors.some((value) => value > population)) continue;
        const latitude = -Math.PI / 2 + ((y + 0.5) / GRID_HEIGHT) * Math.PI;
        const longitude = -Math.PI + ((x + 0.5) / GRID_WIDTH) * TAU;
        candidates.push({
          id: `settlement-${i}`,
          cell: i,
          latitude,
          longitude,
          heightMeters: Math.max(0, terrainHeightMeters(latitude, longitude)),
          population: Math.round(population),
          score: population * (0.72 + this._habitability(i, this.moisture[i], this.vegetation[i]) * 0.28),
        });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, 90).map((settlement, index) => ({
      ...settlement,
      name: `City ${index + 1}`,
    }));
  }

  _buildRoads(settlements) {
    const roads = [];
    const seen = new Set();
    for (let i = 0; i < settlements.length; i += 1) {
      const origin = settlements[i];
      const nearest = settlements
        .map((target, targetIndex) => ({
          target,
          targetIndex,
          distance: targetIndex === i ? Infinity : angularDistance(origin, target),
        }))
        .filter(({ distance }) => distance < 0.72)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, origin.population > 20_000 ? 3 : 2);

      for (const { target, targetIndex, distance } of nearest) {
        const key = i < targetIndex ? `${i}:${targetIndex}` : `${targetIndex}:${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        roads.push({
          id: `road-${key}`,
          from: origin.id,
          to: target.id,
          distanceRadians: distance,
          coordinates: interpolateGreatCircle(origin, target, Math.max(8, Math.ceil(distance * 28))),
        });
      }
    }
    return roads;
  }

  _buildRivers() {
    const candidates = [];
    for (let y = 1; y < GRID_HEIGHT - 1; y += 1) {
      for (let x = 0; x < GRID_WIDTH; x += 1) {
        const i = indexOf(x, y);
        if (this.baseElevation[i] <= 0 || this.runoff[i] < 0.24) continue;
        const neighbors = [
          { x: x - 1, y, i: indexOf(x - 1, y) },
          { x: x + 1, y, i: indexOf(x + 1, y) },
          { x, y: y - 1, i: indexOf(x, y - 1) },
          { x, y: y + 1, i: indexOf(x, y + 1) },
        ].sort((a, b) => this.baseElevation[a.i] - this.baseElevation[b.i]);
        const destination = neighbors[0];
        if (this.baseElevation[destination.i] >= this.baseElevation[i]) continue;
        candidates.push({ x, y, i, destination, strength: this.runoff[i] });
      }
    }

    candidates.sort((a, b) => b.strength - a.strength);
    return candidates.slice(0, 900).map((river, index) => {
      const latitudeA = -Math.PI / 2 + ((river.y + 0.5) / GRID_HEIGHT) * Math.PI;
      const longitudeA = -Math.PI + ((river.x + 0.5) / GRID_WIDTH) * TAU;
      const latitudeB = -Math.PI / 2 + ((river.destination.y + 0.5) / GRID_HEIGHT) * Math.PI;
      const longitudeB = -Math.PI + ((river.destination.x + 0.5) / GRID_WIDTH) * TAU;
      return {
        id: `river-${index}`,
        strength: river.strength,
        coordinates: [
          [radiansToDegrees(longitudeA), radiansToDegrees(latitudeA)],
          [radiansToDegrees(longitudeB), radiansToDegrees(latitudeB)],
        ],
      };
    });
  }

  sample(latitude, longitude) {
    const lon = wrapLongitude(longitude);
    const gx = ((lon + Math.PI) / TAU) * GRID_WIDTH - 0.5;
    const gy = ((latitude + Math.PI / 2) / Math.PI) * GRID_HEIGHT - 0.5;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    const i00 = indexOf(x0, y0);
    const i10 = indexOf(x1, y0);
    const i01 = indexOf(x0, y1);
    const i11 = indexOf(x1, y1);
    const bilinear = (field) =>
      field[i00] * (1 - fx) * (1 - fy) +
      field[i10] * fx * (1 - fy) +
      field[i01] * (1 - fx) * fy +
      field[i11] * fx * fy;
    const terrain = sampleTerrain(latitude, lon);
    return {
      ...terrain,
      heightMeters: terrainHeightMeters(latitude, lon),
      moisture: bilinear(this.moisture),
      vegetation: bilinear(this.vegetation),
      runoff: bilinear(this.runoff),
      population: bilinear(this.population),
    };
  }

  color(sample) {
    if (sample.elevation < 0) {
      const depth = clamp(-sample.elevation / 0.35, 0, 1);
      return [8, Math.round(72 - depth * 28), Math.round(128 - depth * 32)];
    }
    if (sample.runoff > 0.35 && sample.elevation < 0.36) return [14, 105, 174];
    if (sample.population > 2_000) return [225, 164, 67];
    if (sample.temperature < 0.18 || sample.elevation > 0.48) return [218, 230, 235];
    if (sample.moisture < 0.24) return [165, 124, 58];
    return [
      Math.round(58 - sample.vegetation * 24 + (1 - sample.moisture) * 34),
      Math.round(102 + sample.vegetation * 78),
      Math.round(47 + sample.moisture * 38),
    ];
  }

  createTexture(width = 1024, height = 512) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    const image = context.createImageData(width, height);
    const data = image.data;
    for (let y = 0; y < height; y += 1) {
      const latitude = Math.PI / 2 - (y / (height - 1)) * Math.PI;
      for (let x = 0; x < width; x += 1) {
        const longitude = -Math.PI + (x / (width - 1)) * TAU;
        const color = this.color(this.sample(latitude, longitude));
        const offset = (y * width + x) * 4;
        data[offset] = color[0];
        data[offset + 1] = color[1];
        data[offset + 2] = color[2];
        data[offset + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
    return canvas;
  }

  settlementsGeoJSON() {
    return {
      type: 'FeatureCollection',
      features: this.settlements.map((settlement) => ({
        type: 'Feature',
        id: settlement.id,
        properties: {
          name: settlement.name,
          population: settlement.population,
        },
        geometry: {
          type: 'Point',
          coordinates: [
            radiansToDegrees(settlement.longitude),
            radiansToDegrees(settlement.latitude),
            settlement.heightMeters,
          ],
        },
      })),
    };
  }

  roadsGeoJSON() {
    return {
      type: 'FeatureCollection',
      features: this.roads.map((road) => ({
        type: 'Feature',
        id: road.id,
        properties: { from: road.from, to: road.to },
        geometry: { type: 'LineString', coordinates: road.coordinates },
      })),
    };
  }

  riversGeoJSON() {
    return {
      type: 'FeatureCollection',
      features: this.rivers.map((river) => ({
        type: 'Feature',
        id: river.id,
        properties: { strength: river.strength },
        geometry: { type: 'LineString', coordinates: river.coordinates },
      })),
    };
  }

  stats() {
    let land = 0;
    let forest = 0;
    let population = 0;
    for (let i = 0; i < CELL_COUNT; i += 1) {
      if (this.baseElevation[i] > 0) {
        land += 1;
        forest += this.vegetation[i];
      }
      population += this.population[i];
    }
    return {
      years: this.years,
      cells: CELL_COUNT,
      settlements: this.settlements.length,
      roads: this.roads.length,
      rivers: this.rivers.length,
      population: Math.round(population),
      forestPercent: land ? Math.round((forest / land) * 100) : 0,
    };
  }

  serialize() {
    return JSON.stringify({
      version: 1,
      years: this.years,
      moisture: Array.from(this.moisture),
      vegetation: Array.from(this.vegetation),
      runoff: Array.from(this.runoff),
      population: Array.from(this.population),
    });
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, this.serialize());
      return true;
    } catch (_) {
      return false;
    }
  }

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved || saved.version !== 1 || saved.moisture?.length !== CELL_COUNT) return false;
      this.years = Number(saved.years) || 0;
      this.moisture.set(saved.moisture);
      this.vegetation.set(saved.vegetation);
      this.runoff.set(saved.runoff);
      this.population.set(saved.population);
      this.rebuildFeatures();
      return true;
    } catch (_) {
      return false;
    }
  }

  reset() {
    this.years = 0;
    this._seedState();
    this.rebuildFeatures();
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  }
}
