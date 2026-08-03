import FastNoiseLite from 'https://cdn.jsdelivr.net/npm/fastnoise-lite@1.1.1/FastNoiseLite.js';

const TAU = Math.PI * 2;
const STORAGE_KEY = 'reality-v6-1-weather-hours';
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

function configureNoise(seed, frequency) {
  const noise = new FastNoiseLite();
  noise.SetSeed(seed);
  noise.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2);
  noise.SetFrequency(frequency);
  return noise;
}

function sphericalPoint(latitude, longitude, scale = 1) {
  const cosLatitude = Math.cos(latitude);
  return {
    x: Math.cos(longitude) * cosLatitude * scale,
    y: Math.sin(latitude) * scale,
    z: Math.sin(longitude) * cosLatitude * scale,
  };
}

function normalizeLongitude(degrees) {
  let value = degrees % 360;
  if (value > 180) value -= 360;
  if (value < -180) value += 360;
  return value;
}

export class FastNoiseWeather {
  constructor(simulation) {
    this.simulation = simulation;
    try {
      this.hours = Number(localStorage.getItem(STORAGE_KEY)) || 0;
    } catch (_) {
      this.hours = 0;
    }
    this.largeScale = configureNoise(77123, 0.61);
    this.detail = configureNoise(99173, 1.38);
    this.flow = configureNoise(44117, 0.83);
    this.latestStats = {
      cloudCover: 0,
      stormCells: 0,
      strongestStorm: 0,
    };
  }

  advance(hours) {
    this.hours += hours;
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, String(this.hours));
      return true;
    } catch (_) {
      return false;
    }
  }

  sample(latitude, longitude, hours = this.hours) {
    const point = sphericalPoint(latitude, longitude, 3.7);
    const drift = hours * 0.012;
    const planetary = this.largeScale.GetNoise(
      point.x + drift,
      point.y + Math.sin(hours * 0.004) * 0.35,
      point.z - drift * 0.63,
    );
    const smallScale = this.detail.GetNoise(
      point.x * 1.9 - drift * 1.7,
      point.y * 1.9 + drift * 0.22,
      point.z * 1.9 + drift * 1.2,
    );
    const circulation = this.flow.GetNoise(
      point.x * 0.72 + drift * 0.44,
      point.y * 0.72 - drift * 0.18,
      point.z * 0.72 - drift * 0.37,
    );
    const world = this.simulation.sample(latitude, longitude);
    const latitudeMoisture = 0.13 + Math.cos(latitude * 2) * 0.08;
    const humidity = clamp(world.moisture * 0.58 + latitudeMoisture + planetary * 0.2 + 0.18);
    const cloudSignal = planetary * 0.68 + smallScale * 0.32 + humidity * 0.8;
    const cloud = smoothstep(0.31, 0.89, cloudSignal);
    const storm = smoothstep(0.68, 1.12, cloudSignal + humidity * 0.22) * smoothstep(0.33, 0.72, humidity);
    const pressure = clamp(0.52 - planetary * 0.31 - storm * 0.25, 0, 1);
    const windAngle = (circulation * 0.5 + 0.5) * TAU + longitude * 0.14;
    const windSpeed = 6 + Math.abs(smallScale) * 28 + storm * 55;
    const precipitation = clamp(storm * 0.82 + cloud * humidity * 0.28 - 0.12);
    return {
      cloud,
      storm,
      humidity,
      pressure,
      precipitation,
      windAngle,
      windSpeed,
      temperatureC: Math.round(world.temperature * 42 - 12 - cloud * 4),
      world,
    };
  }

  condition(weather) {
    if (weather.storm > 0.74) return 'severe storm';
    if (weather.storm > 0.48) return 'thunderstorms';
    if (weather.precipitation > 0.45) return 'rain';
    if (weather.cloud > 0.72) return 'overcast';
    if (weather.cloud > 0.34) return 'partly cloudy';
    return 'clear';
  }

  createCloudTexture(width = 256, height = 128) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    const image = context.createImageData(width, height);
    const pixels = image.data;
    let totalCloud = 0;
    let strongestStorm = 0;
    let stormPixels = 0;

    for (let y = 0; y < height; y += 1) {
      const latitude = Math.PI / 2 - (y / (height - 1)) * Math.PI;
      for (let x = 0; x < width; x += 1) {
        const longitude = -Math.PI + (x / (width - 1)) * TAU;
        const weather = this.sample(latitude, longitude);
        const offset = (y * width + x) * 4;
        const cloud = Math.pow(weather.cloud, 1.18);
        const storm = weather.storm;
        totalCloud += cloud;
        strongestStorm = Math.max(strongestStorm, storm);
        if (storm > 0.54) stormPixels += 1;

        const brightness = 238 - storm * 118;
        pixels[offset] = Math.round(brightness - storm * 18);
        pixels[offset + 1] = Math.round(brightness - storm * 4);
        pixels[offset + 2] = Math.round(brightness + 8);
        pixels[offset + 3] = Math.round(clamp(cloud * 0.86 + storm * 0.2) * 218);
      }
    }

    context.putImageData(image, 0, 0);
    this.latestStats = {
      cloudCover: Math.round((totalCloud / (width * height)) * 100),
      stormCells: stormPixels,
      strongestStorm,
    };
    return canvas;
  }

  stormSystems(longitudeStep = 18, latitudeStep = 12) {
    const candidates = [];
    for (let latitude = -72; latitude <= 72; latitude += latitudeStep) {
      for (let longitude = -180; longitude < 180; longitude += longitudeStep) {
        const radiansLatitude = latitude * Math.PI / 180;
        const radiansLongitude = longitude * Math.PI / 180;
        const weather = this.sample(radiansLatitude, radiansLongitude);
        if (weather.storm < 0.46) continue;
        candidates.push({
          latitude,
          longitude,
          ...weather,
        });
      }
    }

    candidates.sort((a, b) => b.storm - a.storm);
    const selected = [];
    for (const candidate of candidates) {
      const overlaps = selected.some((existing) => {
        const latitudeDistance = existing.latitude - candidate.latitude;
        const longitudeDistance = normalizeLongitude(existing.longitude - candidate.longitude) * Math.cos(candidate.latitude * Math.PI / 180);
        return Math.hypot(latitudeDistance, longitudeDistance) < 24;
      });
      if (!overlaps) selected.push(candidate);
      if (selected.length >= 18) break;
    }
    return selected;
  }

  windEndpoint(system, distanceDegrees = 7) {
    const latitudeScale = Math.cos(system.latitude * Math.PI / 180);
    const longitude = normalizeLongitude(
      system.longitude + Math.cos(system.windAngle) * distanceDegrees / Math.max(0.25, latitudeScale),
    );
    const latitude = clamp(
      system.latitude + Math.sin(system.windAngle) * distanceDegrees,
      -84,
      84,
    );
    return { longitude, latitude };
  }
}
