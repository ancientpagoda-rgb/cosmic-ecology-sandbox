export const WORLD_NAME = 'Reality V5';
export const WORLD_RADIUS_METERS = 6_371_000;
const TAU = Math.PI * 2;

export function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

export function wrapLongitude(longitude) {
  while (longitude > Math.PI) longitude -= TAU;
  while (longitude < -Math.PI) longitude += TAU;
  return longitude;
}

function hash(value) {
  return Math.abs(Math.sin(value * 12.9898 + 78.233) * 43758.5453123) % 1;
}

export function sampleTerrain(latitude, longitude) {
  const lon = wrapLongitude(longitude);
  const cosLat = Math.cos(latitude);
  const x = cosLat * Math.cos(lon);
  const y = Math.sin(latitude);
  const z = cosLat * Math.sin(lon);

  const continent =
    Math.sin(x * 3.1 + z * 1.7) +
    Math.sin(y * 4.7 - x * 2.2) * 0.7;
  const ridge = Math.abs(Math.sin(x * 11 + y * 8 - z * 9));
  const detail =
    Math.sin((x + z) * 31 + y * 17) * 0.08 +
    Math.sin(x * 67 - y * 41 + z * 53) * 0.025 +
    Math.sin(x * 151 + y * 97 - z * 113) * 0.008;

  const elevation = clamp(
    continent * 0.18 + Math.pow(ridge, 2.3) * 0.28 + detail - 0.06,
    -0.35,
    0.65,
  );
  const temperature = clamp(1 - Math.abs(y), 0, 1);
  const baseMoisture = clamp(
    0.5 + Math.sin(z * 7 - x * 3) * 0.3 + Math.sin(y * 13) * 0.15,
    0,
    1,
  );

  return { elevation, temperature, baseMoisture };
}

export function terrainHeightMeters(latitude, longitude) {
  const { elevation } = sampleTerrain(latitude, longitude);
  return elevation < 0 ? elevation * 3_600 : elevation * 7_400;
}

export function sampleWorld(latitude, longitude, years = 0) {
  const terrain = sampleTerrain(latitude, longitude);
  const epoch = years / 1_500;
  const climatePulse = Math.sin(epoch * 0.61 + longitude * 2.2 + latitude * 1.7) * 0.07;
  const moisture = clamp(
    terrain.baseMoisture + climatePulse - Math.max(0, terrain.elevation) * 0.12,
    0,
    1,
  );
  const vegetation = terrain.elevation < 0
    ? 0
    : clamp(
        (moisture - 0.18) * 1.48 *
          (1 - Math.abs(terrain.temperature - 0.62) * 1.22),
        0,
        1,
      );
  const runoff = terrain.elevation < 0
    ? 0
    : clamp(
        Math.max(0, moisture - 0.5 - vegetation * 0.11) *
          (0.55 + Math.abs(Math.sin(longitude * 19 + latitude * 23)) * 1.4),
        0,
        1,
      );
  const habitability = terrain.elevation <= 0
    ? 0
    : clamp(
        vegetation * 0.48 +
          moisture * 0.33 -
          Math.abs(terrain.temperature - 0.58) * 0.68 -
          Math.max(0, terrain.elevation - 0.42) * 1.8,
        0,
        1,
      );
  const civilization = clamp(
    (habitability - 0.61) * 2.8 +
      (hash(latitude * 503 + longitude * 887) - 0.78) * 0.45 +
      Math.sin(epoch * 0.19 + longitude * 5.1) * 0.05,
    0,
    1,
  );

  return {
    ...terrain,
    moisture,
    vegetation,
    runoff,
    habitability,
    civilization,
    heightMeters: terrainHeightMeters(latitude, longitude),
  };
}

export function worldColor(sample) {
  if (sample.elevation < 0) {
    const depth = clamp(-sample.elevation / 0.35, 0, 1);
    return [
      Math.round(8 + depth * 3),
      Math.round(69 - depth * 24),
      Math.round(122 - depth * 28),
    ];
  }
  if (sample.runoff > 0.43 && sample.elevation < 0.36) return [16, 105, 171];
  if (sample.civilization > 0.54) return [221, 164, 67];
  if (sample.temperature < 0.18 || sample.elevation > 0.48) return [218, 230, 235];
  if (sample.moisture < 0.25) return [165, 124, 58];
  const green = sample.vegetation;
  return [
    Math.round(60 - green * 25 + (1 - sample.moisture) * 35),
    Math.round(104 + green * 76),
    Math.round(48 + sample.moisture * 38),
  ];
}

export function createWorldTexture(width = 1024, height = 512, years = 0) {
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
      const color = worldColor(sampleWorld(latitude, longitude, years));
      const index = (y * width + x) * 4;
      data[index] = color[0];
      data[index + 1] = color[1];
      data[index + 2] = color[2];
      data[index + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
  return canvas;
}

export function createTerrariumHeightTexture(width = 1024, height = 512) {
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
      const encoded = terrainHeightMeters(latitude, longitude) + 32_768;
      const red = Math.floor(encoded / 256);
      const green = Math.floor(encoded - red * 256);
      const blue = Math.floor((encoded - Math.floor(encoded)) * 256);
      const index = (y * width + x) * 4;
      data[index] = clamp(red, 0, 255);
      data[index + 1] = clamp(green, 0, 255);
      data[index + 2] = clamp(blue, 0, 255);
      data[index + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
  return canvas;
}

export function generateSettlements(years = 0, limit = 180) {
  const candidates = [];
  const lonSteps = 144;
  const latSteps = 72;

  for (let y = 1; y < latSteps - 1; y += 1) {
    const latitude = -Math.PI / 2 + (y / (latSteps - 1)) * Math.PI;
    for (let x = 0; x < lonSteps; x += 1) {
      const longitude = -Math.PI + (x / lonSteps) * TAU;
      const sample = sampleWorld(latitude, longitude, years);
      const noise = hash(x * 41.7 + y * 93.1);
      const score = sample.civilization * 0.87 + sample.habitability * 0.13 + noise * 0.04;
      if (sample.elevation > 0 && score > 0.63) {
        candidates.push({ latitude, longitude, score, sample });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, limit).map((candidate, index) => ({
    id: `settlement-${index + 1}`,
    name: `Site ${index + 1}`,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    heightMeters: Math.max(0, candidate.sample.heightMeters),
    population: Math.round(90 + candidate.score ** 4 * 92_000),
    score: candidate.score,
  }));
}

export function settlementsGeoJSON(years = 0, limit = 180) {
  return {
    type: 'FeatureCollection',
    name: `${WORLD_NAME} settlements`,
    features: generateSettlements(years, limit).map((settlement) => ({
      type: 'Feature',
      id: settlement.id,
      properties: {
        name: settlement.name,
        population: settlement.population,
        score: settlement.score,
        'marker-color': '#e0a74b',
        'marker-size': 'small',
      },
      geometry: {
        type: 'Point',
        coordinates: [
          settlement.longitude * 180 / Math.PI,
          settlement.latitude * 180 / Math.PI,
          settlement.heightMeters,
        ],
      },
    })),
  };
}
