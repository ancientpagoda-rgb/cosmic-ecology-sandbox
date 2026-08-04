import FastNoiseLite from 'https://cdn.jsdelivr.net/npm/fastnoise-lite@1.1.1/FastNoiseLite.js';

const TAU = Math.PI * 2;
const STORAGE_KEY = 'reality-v6-1-weather-hours';
const DEG_TO_RAD = Math.PI / 180;
const mobileWeather = matchMedia('(max-width: 720px), (pointer: coarse)').matches
  || (navigator.deviceMemory && navigator.deviceMemory <= 4);
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const lerp = (start, end, amount) => start + (end - start) * amount;
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

function angularDistanceDegrees(a, b) {
  const latitudeDistance = a.latitude - b.latitude;
  const longitudeDistance = normalizeLongitude(a.longitude - b.longitude)
    * Math.cos(((a.latitude + b.latitude) * 0.5) * DEG_TO_RAD);
  return Math.hypot(latitudeDistance, longitudeDistance);
}

function mixAngle(start, end, amount) {
  const difference = Math.atan2(Math.sin(end - start), Math.cos(end - start));
  return start + difference * amount;
}

function hash01(value) {
  let hash = value | 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x21f0aaad);
  hash = Math.imul(hash ^ (hash >>> 15), 0x735a2d97);
  return ((hash ^ (hash >>> 15)) >>> 0) / 4294967296;
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
    this.stormTracks = [];
    this.nextStormId = 1;
    this.maxStormSystems = mobileWeather ? 5 : 8;
    this.cachedStormSystems = [];
    this.lastStormScanHour = Number.NEGATIVE_INFINITY;
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
    const rawStorm = smoothstep(0.68, 1.12, cloudSignal + humidity * 0.22)
      * smoothstep(0.33, 0.72, humidity);
    const polarSuitability = 1 - smoothstep(58 * DEG_TO_RAD, 76 * DEG_TO_RAD, Math.abs(latitude));
    const temperatureSuitability = smoothstep(0.08, 0.26, world.temperature)
      * (1 - smoothstep(0.94, 1.04, world.temperature));
    const terrainSuitability = world.elevation <= 0
      ? 1
      : (1 - smoothstep(0.34, 0.68, world.elevation));
    const moistureSource = world.elevation <= 0 ? 1 : smoothstep(0.2, 0.58, world.moisture);
    const formationSuitability = polarSuitability * temperatureSuitability
      * terrainSuitability * lerp(0.32, 1, moistureSource);
    const storm = rawStorm * smoothstep(0.18, 0.72, formationSuitability);
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

  scanStormCandidates(
    longitudeStep = mobileWeather ? 18 : 12,
    latitudeStep = mobileWeather ? 12 : 8,
  ) {
    const latitudeValues = [];
    for (let latitude = -64; latitude <= 64; latitude += latitudeStep) latitudeValues.push(latitude);
    const longitudeValues = [];
    for (let longitude = -180; longitude < 180; longitude += longitudeStep) longitudeValues.push(longitude);

    const grid = latitudeValues.map((latitude) => longitudeValues.map((longitude) => {
      const weather = this.sample(latitude * DEG_TO_RAD, longitude * DEG_TO_RAD);
      return { latitude, longitude, ...weather };
    }));
    const candidates = [];
    for (let latitudeIndex = 1; latitudeIndex < grid.length - 1; latitudeIndex += 1) {
      for (let longitudeIndex = 0; longitudeIndex < longitudeValues.length; longitudeIndex += 1) {
        const candidate = grid[latitudeIndex][longitudeIndex];
        if (candidate.storm < 0.52) continue;
        let localPeak = true;
        for (let y = -1; y <= 1 && localPeak; y += 1) {
          for (let x = -1; x <= 1; x += 1) {
            if (x === 0 && y === 0) continue;
            const neighborLongitude = (longitudeIndex + x + longitudeValues.length) % longitudeValues.length;
            if (grid[latitudeIndex + y][neighborLongitude].storm > candidate.storm) {
              localPeak = false;
              break;
            }
          }
        }
        if (localPeak) candidates.push(candidate);
      }
    }

    candidates.sort((a, b) => b.storm - a.storm);
    const selected = [];
    const hemisphereCounts = { north: 0, south: 0 };
    const hemisphereLimit = Math.ceil(this.maxStormSystems / 2);
    const latitudeBandCounts = new Map();
    for (const candidate of candidates) {
      const hemisphere = candidate.latitude >= 0 ? 'north' : 'south';
      if (hemisphereCounts[hemisphere] >= hemisphereLimit) continue;
      const latitudeBand = Math.floor((candidate.latitude + 90) / 30);
      if ((latitudeBandCounts.get(latitudeBand) || 0) >= 3) continue;
      const overlaps = selected.some((existing) => {
        return angularDistanceDegrees(existing, candidate) < 18;
      });
      if (!overlaps) {
        selected.push(candidate);
        hemisphereCounts[hemisphere] += 1;
        latitudeBandCounts.set(latitudeBand, (latitudeBandCounts.get(latitudeBand) || 0) + 1);
      }
      if (selected.length >= this.maxStormSystems) break;
    }
    return selected;
  }

  stormSystems() {
    if (this.cachedStormSystems.length && Math.abs(this.hours - this.lastStormScanHour) < 0.75) {
      return this.cachedStormSystems;
    }

    const candidates = this.scanStormCandidates();
    for (const track of this.stormTracks) {
      const advected = this.stormPosition(track, this.hours);
      track.longitude = advected.longitude;
      track.latitude = advected.latitude;
      track.updatedHour = this.hours;
    }
    const unmatchedTracks = new Set(this.stormTracks);
    const nextTracks = [];

    for (const candidate of candidates) {
      let track = null;
      let trackDistance = 22;
      for (const existing of unmatchedTracks) {
        const distance = angularDistanceDegrees(existing, candidate);
        if (distance < trackDistance) {
          track = existing;
          trackDistance = distance;
        }
      }

      if (track) {
        unmatchedTracks.delete(track);
        track.longitude = normalizeLongitude(
          track.longitude + normalizeLongitude(candidate.longitude - track.longitude) * 0.34,
        );
        track.latitude = lerp(track.latitude, candidate.latitude, 0.34);
        track.storm = lerp(track.storm, candidate.storm, 0.42);
        track.precipitation = lerp(track.precipitation, candidate.precipitation, 0.42);
        track.humidity = lerp(track.humidity, candidate.humidity, 0.35);
        track.pressure = lerp(track.pressure, candidate.pressure, 0.35);
        track.windSpeed = lerp(track.windSpeed, candidate.windSpeed, 0.3);
        track.windAngle = mixAngle(track.windAngle, candidate.windAngle, 0.24);
        track.temperatureC = candidate.temperatureC;
        track.world = candidate.world;
        track.misses = 0;
        track.updatedHour = this.hours;
        nextTracks.push(track);
      } else {
        const id = this.nextStormId;
        this.nextStormId += 1;
        nextTracks.push({
          ...candidate,
          id: `storm-${id}`,
          shapeSeed: Math.floor(hash01(id * 0x9e3779b9) * 0x7fffffff),
          storm: candidate.storm * 0.72,
          precipitation: candidate.precipitation * 0.72,
          misses: 0,
          updatedHour: this.hours,
        });
      }
    }

    for (const track of unmatchedTracks) {
      track.misses += 1;
      track.storm *= 0.68;
      track.precipitation *= 0.72;
      track.updatedHour = this.hours;
      if (track.misses <= 2 && track.storm > 0.28) nextTracks.push(track);
    }

    nextTracks.sort((a, b) => b.storm - a.storm);
    this.stormTracks = nextTracks.slice(0, this.maxStormSystems);
    this.cachedStormSystems = this.stormTracks.map((track) => ({ ...track }));
    this.lastStormScanHour = this.hours;
    return this.cachedStormSystems;
  }

  stormPosition(system, hours = this.hours) {
    const elapsedHours = clamp(hours - system.updatedHour, 0, 8);
    const travelDegrees = (system.windSpeed / 111) * elapsedHours * 0.52;
    return this.windEndpoint(system, travelDegrees);
  }

  offsetStormPosition(system, alongDegrees = 0, crossDegrees = 0, hours = this.hours) {
    const center = this.stormPosition(system, hours);
    const latitudeScale = Math.max(0.25, Math.cos(center.latitude * DEG_TO_RAD));
    const longitudeOffset = (
      Math.cos(system.windAngle) * alongDegrees - Math.sin(system.windAngle) * crossDegrees
    ) / latitudeScale;
    const latitudeOffset = Math.sin(system.windAngle) * alongDegrees
      + Math.cos(system.windAngle) * crossDegrees;
    return {
      longitude: normalizeLongitude(center.longitude + longitudeOffset),
      latitude: clamp(center.latitude + latitudeOffset, -76, 76),
    };
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
