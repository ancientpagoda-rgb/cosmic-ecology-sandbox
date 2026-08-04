import { Howl, Howler } from 'howler';

const VOLUME_KEY = 'reality-v6-9-audio-volume';
const MUTED_KEY = 'reality-v6-9-audio-muted';
const IMPACT_LOG_KEY = 'reality-v6-6-impact-log';
const SYSTEM_SEED_KEY = 'reality-v6-7-system-seeds';
const mobile = innerWidth < 720 || (navigator.deviceMemory && navigator.deviceMemory <= 4);
const SAMPLE_RATE = mobile ? 8000 : 12000;
const LOOP_SECONDS = mobile ? 4 : 8;
const FIXED_STEP = mobile ? 0.25 : 0.125;
const MAX_CATCHUP_STEPS = 4;
const TAU = Math.PI * 2;
const LAYER_NAMES = mobile
  ? ['wind', 'rain', 'tide', 'drone', 'orbit']
  : ['wind', 'rain', 'tide', 'city', 'night', 'drone', 'orbit'];

const SEASON_SCALES = {
  spring: [0, 2, 4, 7, 9],
  summer: [0, 4, 7, 9, 11],
  autumn: [0, 3, 5, 7, 10],
  fall: [0, 3, 5, 7, 10],
  winter: [0, 2, 5, 7, 9],
};

const clamp = (value, minimum = 0, maximum = 1) => Math.max(minimum, Math.min(maximum, value));
const lerp = (a, b, t) => a + (b - a) * t;

function loadNumber(key, fallback) {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) ? value : fallback;
  } catch (_) {
    return fallback;
  }
}

function loadBoolean(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    if (value === null) return fallback;
    return value === 'true';
  } catch (_) {
    return fallback;
  }
}

function saveSetting(key, value) {
  try { localStorage.setItem(key, String(value)); } catch (_) {}
}

function fnv1a(text, seed = 2166136261) {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hash01(value) {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function seededRandom(seed) {
  let value = seed >>> 0 || 1;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 4294967296;
  };
}

function normalizeRadians(value) {
  value = (value + Math.PI) % TAU;
  if (value < 0) value += TAU;
  return value - Math.PI;
}

function worldSeed() {
  const simulation = globalThis.realityV6?.simulation;
  let seed = fnv1a('reality-v6-9');
  for (const settlement of (simulation?.settlements || []).slice(0, 16)) {
    seed = fnv1a(`${settlement.name}:${Math.round(settlement.population || 0)}`, seed);
  }
  try {
    seed = fnv1a(localStorage.getItem(SYSTEM_SEED_KEY) || '', seed);
  } catch (_) {}
  return seed >>> 0 || 0x6909a11d;
}

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
}

function wavUrl(samples, sampleRate = SAMPLE_RATE) {
  const bytes = 44 + samples.length * 2;
  const buffer = new ArrayBuffer(bytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = clamp(samples[index], -1, 1);
    view.setInt16(44 + index * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

function periodicNoise(t, duration, seed, harmonics, lowCycles, highCycles) {
  let value = 0;
  let normalization = 0;
  for (let index = 0; index < harmonics; index += 1) {
    const random = hash01(seed + index * 0x9e3779b9);
    const cycles = lowCycles + Math.floor(random * Math.max(1, highCycles - lowCycles + 1));
    const phase = hash01(seed ^ (index * 0x85ebca6b)) * TAU;
    const amplitude = 0.25 + hash01(seed + index * 97) * 0.75;
    value += Math.sin(TAU * cycles * t / duration + phase) * amplitude;
    normalization += amplitude;
  }
  return normalization > 0 ? value / normalization : 0;
}

function synthLoop(kind, seed, duration = LOOP_SECONDS, sampleRate = SAMPLE_RATE) {
  const length = Math.max(1, Math.round(duration * sampleRate));
  const samples = new Float32Array(length);
  const random = seededRandom(seed ^ fnv1a(kind));
  const root = 42 + (seed % 22);
  for (let index = 0; index < length; index += 1) {
    const t = index / sampleRate;
    const phase = t / duration;
    let sample = 0;
    if (kind === 'wind') {
      const low = periodicNoise(t, duration, seed, 9, 1, 17);
      const high = periodicNoise(t, duration, seed ^ 0xa52f11, 7, 19, 71);
      sample = low * 0.66 + high * 0.18 + Math.sin(TAU * phase * 2) * 0.08;
    } else if (kind === 'rain') {
      const hiss = periodicNoise(t, duration, seed, 22, 83, 347);
      const patter = periodicNoise(t, duration, seed ^ 0x51ab9, 16, 19, 163);
      sample = hiss * 0.34 + patter * 0.22;
      const beat = (phase * 64) % 1;
      if (beat < 0.045) sample += (1 - beat / 0.045) * (0.15 + random() * 0.15);
    } else if (kind === 'tide') {
      const swell = Math.sin(TAU * phase * 3) * 0.42 + Math.sin(TAU * phase * 5 + 1.1) * 0.21;
      const foam = periodicNoise(t, duration, seed, 12, 17, 101) * (0.18 + Math.max(0, swell) * 0.2);
      sample = swell * 0.48 + foam;
    } else if (kind === 'city') {
      const hum = Math.sin(TAU * root * t) * 0.24 + Math.sin(TAU * root * 2 * t + 0.3) * 0.08;
      const pulse = Math.pow(Math.max(0, Math.sin(TAU * phase * 8)), 12) * 0.2;
      sample = hum + pulse + periodicNoise(t, duration, seed, 8, 7, 41) * 0.08;
    } else if (kind === 'night') {
      const chirpGate = Math.pow(Math.max(0, Math.sin(TAU * phase * 12)), 24);
      const chirp = Math.sin(TAU * (760 + (seed % 220)) * t + Math.sin(TAU * phase * 12) * 4) * chirpGate;
      sample = chirp * 0.18 + periodicNoise(t, duration, seed, 5, 3, 13) * 0.08;
    } else if (kind === 'drone') {
      const fifth = root * 1.5;
      sample = Math.sin(TAU * root * t) * 0.28
        + Math.sin(TAU * fifth * t + 0.7) * 0.18
        + Math.sin(TAU * root * 2 * t + 1.4) * 0.07;
      sample *= 0.76 + Math.sin(TAU * phase * 2) * 0.16;
    } else if (kind === 'orbit') {
      const carrier = 34 + (seed % 18);
      sample = Math.sin(TAU * carrier * t + Math.sin(TAU * phase * 2) * 0.8) * 0.3
        + Math.sin(TAU * carrier * 2.01 * t + 0.9) * 0.11
        + periodicNoise(t, duration, seed, 5, 2, 19) * 0.07;
    }
    samples[index] = Math.tanh(sample * 1.7) * 0.72;
  }
  return wavUrl(samples, sampleRate);
}

function synthOneShot(kind, seed, duration = 2.2, sampleRate = SAMPLE_RATE) {
  const length = Math.max(1, Math.round(duration * sampleRate));
  const samples = new Float32Array(length);
  const root = 92 + (seed % 70);
  for (let index = 0; index < length; index += 1) {
    const t = index / sampleRate;
    const p = t / duration;
    let sample = 0;
    if (kind === 'note') {
      const attack = clamp(t / 0.025);
      const release = Math.pow(1 - p, 2.4);
      const vibrato = Math.sin(TAU * 4.2 * t) * 0.005;
      sample = (Math.sin(TAU * root * (1 + vibrato) * t)
        + Math.sin(TAU * root * 2.01 * t + 0.4) * 0.28
        + Math.sin(TAU * root * 3 * t + 0.8) * 0.11) * attack * release * 0.52;
    } else if (kind === 'impact') {
      const envelope = Math.exp(-t * 2.8);
      const drop = 74 * Math.pow(0.16, p) + 28;
      sample = Math.sin(TAU * drop * t) * envelope * 0.75
        + periodicNoise(t, duration, seed, 18, 13, 239) * Math.exp(-t * 4.4) * 0.35;
    } else if (kind === 'travel') {
      const frequency = 70 * Math.pow(7.2, p);
      const envelope = Math.sin(Math.PI * clamp(p)) * 0.82;
      sample = (Math.sin(TAU * frequency * t)
        + Math.sin(TAU * frequency * 1.51 * t + 0.5) * 0.22) * envelope * 0.42;
    } else if (kind === 'thunder') {
      const envelope = Math.exp(-t * 1.7);
      sample = periodicNoise(t, duration, seed, 24, 3, 181) * envelope * 0.7
        + Math.sin(TAU * (38 + 20 * (1 - p)) * t) * envelope * 0.35;
    }
    samples[index] = Math.tanh(sample * 1.5) * 0.78;
  }
  return wavUrl(samples, sampleRate);
}

function readImpactLog() {
  try {
    const parsed = JSON.parse(localStorage.getItem(IMPACT_LOG_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function seasonKey(value) {
  const text = String(value || 'spring').toLowerCase();
  if (text.includes('winter')) return 'winter';
  if (text.includes('summer')) return 'summer';
  if (text.includes('autumn') || text.includes('fall')) return 'autumn';
  return 'spring';
}

function angularDistance(latitudeA, longitudeA, latitudeB, longitudeB) {
  const cosine = Math.sin(latitudeA) * Math.sin(latitudeB)
    + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.cos(longitudeA - longitudeB);
  return Math.acos(clamp(cosine, -1, 1));
}

function localDarkness(latitude, longitude, state) {
  if (!state) return 0.45;
  const sunLatitude = state.subsolarLatitude * Math.PI / 180;
  const sunLongitude = state.subsolarLongitude * Math.PI / 180;
  const dot = Math.sin(latitude) * Math.sin(sunLatitude)
    + Math.cos(latitude) * Math.cos(sunLatitude) * Math.cos(longitude - sunLongitude);
  return clamp((-dot + 0.08) / 1.08);
}

function relativeSpatial(longitude, latitude, cameraLongitude, cameraLatitude, scale = 4) {
  const dlon = normalizeRadians(longitude - cameraLongitude);
  const dlat = latitude - cameraLatitude;
  const distance = clamp(Math.hypot(dlon * Math.cos(cameraLatitude), dlat) / Math.PI, 0.05, 1);
  return {
    x: Math.sin(dlon) * scale * distance,
    y: clamp(dlat / (Math.PI / 2), -1, 1) * scale * 0.35,
    z: -Math.cos(dlon) * scale * distance,
  };
}

export class HowlerSoundscape {
  constructor() {
    this.seed = worldSeed();
    this.volume = clamp(loadNumber(VOLUME_KEY, 0.58));
    this.muted = loadBoolean(MUTED_KEY, false);
    this.started = false;
    this.prepared = false;
    this.preparing = false;
    this.preparePromise = null;
    this.hidden = document.hidden;
    this.layers = new Map();
    this.layerIds = new Map();
    this.currentVolumes = Object.fromEntries(LAYER_NAMES.map((name) => [name, 0]));
    this.urls = [];
    this.oneshots = {};
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.fixedTicks = 0;
    this.musicAccumulator = 0;
    this.musicBeat = 0;
    this.lastStateRefresh = 0;
    this.cachedStorms = [];
    this.cachedNearest = null;
    this.knownImpactIds = new Set(readImpactLog().map((event) => event.id));
    this.lastUniverseImpacts = new Map();
    this.lastSelectedSystem = null;
    this.statusValues = { cloud: 0, rain: 0, city: 0, tide: 0, orbit: 0 };
    this._loop = (time) => this.loop(time);
    this.installControls();
    this.updateControls();
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden;
      this.lastTime = performance.now();
      Howler.mute(this.hidden || this.muted);
    });
    addEventListener('pagehide', () => this.save());
    requestAnimationFrame(this._loop);
  }

  save() {
    saveSetting(VOLUME_KEY, this.volume);
    saveSetting(MUTED_KEY, this.muted);
  }

  installControls() {
    for (const id of ['audioToggle', 'audioToggleSystem']) {
      document.getElementById(id)?.addEventListener('click', () => {
        if (!this.started) this.start().catch((error) => this.fail(error));
        else this.setMuted(!this.muted);
      });
    }
    for (const id of ['audioVolume', 'audioVolumeSystem']) {
      const input = document.getElementById(id);
      input?.addEventListener('input', () => this.setVolume(Number(input.value) / 100));
      input?.addEventListener('change', () => {
        if (!this.started) this.start().catch((error) => this.fail(error));
      });
    }
    document.addEventListener('keydown', (event) => {
      if (event.code !== 'KeyM' || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      if (!this.started) this.start().catch((error) => this.fail(error));
      else this.setMuted(!this.muted);
    });
  }

  async prepare() {
    if (this.prepared) return;
    if (this.preparePromise) return this.preparePromise;
    this.preparing = true;
    this.preparePromise = (async () => {
      this.setStatus('Synthesizing deterministic sound loops…');
      await new Promise((resolve) => setTimeout(resolve, 0));
      for (const [index, name] of LAYER_NAMES.entries()) {
        const url = synthLoop(name, this.seed ^ Math.imul(index + 1, 0x9e3779b9));
        this.urls.push(url);
        const howl = new Howl({
          src: [url], format: ['wav'], loop: true, preload: true, volume: 0, html5: false,
          pool: mobile ? 2 : 5,
          pannerAttr: { panningModel: 'HRTF', refDistance: 1, rolloffFactor: 1, distanceModel: 'inverse', maxDistance: 60 },
        });
        this.layers.set(name, howl);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      for (const [kind, duration] of [['note', 1.5], ['impact', 3], ['travel', 2.4], ['thunder', 3.5]]) {
        const url = synthOneShot(kind, this.seed ^ fnv1a(kind), duration);
        this.urls.push(url);
        this.oneshots[kind] = new Howl({
          src: [url], format: ['wav'], loop: false, preload: true, volume: 0.5, html5: false,
          pool: mobile ? 4 : 12,
          pannerAttr: { panningModel: 'HRTF', refDistance: 0.8, rolloffFactor: 0.8, distanceModel: 'inverse', maxDistance: 80 },
        });
      }
      Howler.pos(0, 0, 0);
      Howler.orientation(0, 0, -1, 0, 1, 0);
      Howler.volume(this.volume);
      this.prepared = true;
    })().finally(() => {
      this.preparing = false;
      this.preparePromise = null;
    });
    return this.preparePromise;
  }

  async start() {
    if (this.started) return;
    await this.prepare();
    if (Howler.ctx?.state !== 'running') await Howler.ctx.resume();
    for (const [name, howl] of this.layers) {
      const id = howl.play();
      this.layerIds.set(name, id);
      howl.volume(0, id);
    }
    this.started = true;
    Howler.mute(this.hidden || this.muted);
    this.updateControls();
  }

  setMuted(value) {
    this.muted = Boolean(value);
    saveSetting(MUTED_KEY, this.muted);
    Howler.mute(this.hidden || this.muted);
    this.updateControls();
  }

  setVolume(value) {
    this.volume = clamp(value);
    saveSetting(VOLUME_KEY, this.volume);
    Howler.volume(this.volume);
    this.updateControls();
  }

  fail(error) {
    console.error('[Reality V6.9 soundscape]', error);
    this.setStatus(`Soundscape unavailable · ${error instanceof Error ? error.message : String(error)}`);
  }

  setStatus(text) {
    for (const id of ['audioStatus', 'audioStatusSystem']) {
      const element = document.getElementById(id);
      if (element) element.textContent = text;
    }
  }

  updateControls() {
    const label = !this.started ? 'Sound start' : this.muted ? 'Sound muted' : 'Sound on';
    for (const id of ['audioToggle', 'audioToggleSystem']) {
      const button = document.getElementById(id);
      if (button) button.textContent = label;
    }
    const value = String(Math.round(this.volume * 100));
    for (const id of ['audioVolume', 'audioVolumeSystem']) {
      const input = document.getElementById(id);
      if (input && input.value !== value) input.value = value;
    }
    if (!this.started) this.setStatus(`HOWLER 2.2.4 · ${mobile ? 'mobile' : 'desktop'} deterministic mix · click Sound start`);
  }

  loop(time) {
    requestAnimationFrame(this._loop);
    if (this.hidden) return;
    const delta = clamp((time - this.lastTime) / 1000, 0, 0.25);
    this.lastTime = time;
    this.accumulator += delta;
    let steps = 0;
    while (this.accumulator >= FIXED_STEP && steps < MAX_CATCHUP_STEPS) {
      this.update(FIXED_STEP, time);
      this.accumulator -= FIXED_STEP;
      steps += 1;
    }
  }

  update(delta, now) {
    this.fixedTicks += 1;
    const snapshot = this.snapshot(now);
    if (this.started) {
      this.mix(snapshot, delta);
      this.musicAccumulator += delta;
      const interval = mobile ? 2.4 : 1.2;
      if (this.musicAccumulator >= interval) {
        this.musicAccumulator %= interval;
        this.playMusic(snapshot);
      }
      this.checkImpacts(snapshot);
      this.checkTravel(snapshot);
      this.maybeThunder(snapshot);
    }
    if (this.fixedTicks % Math.max(1, Math.round(1 / FIXED_STEP)) === 0) this.updateStatus(snapshot);
  }

  snapshot(now) {
    const viewer = globalThis.realityV6?.viewer;
    const simulation = globalThis.realityV6?.simulation;
    const coupling = globalThis.realityV65?.coupling;
    const weather = globalThis.realityV61?.weather;
    const camera = viewer?.camera?.positionCartographic;
    const latitude = camera?.latitude || 0;
    const longitude = camera?.longitude || 0;
    const weatherSample = weather?.sample?.(latitude, longitude) || {};
    const state = coupling?.lastState || {};
    const darkness = localDarkness(latitude, longitude, state);
    const universeActive = document.body.classList.contains('system-active');

    if (now - this.lastStateRefresh > (mobile ? 3000 : 1800)) {
      this.lastStateRefresh = now;
      this.cachedStorms = weather?.stormSystems?.() || [];
      this.cachedNearest = this.findNearestSettlement(simulation, latitude, longitude);
    }

    const nearestStorm = this.findNearestStorm(latitude, longitude);
    const selectedIndex = Number(document.getElementById('systemSelect')?.value || 0);
    const runtime = globalThis.realityV67?.systems?.[selectedIndex];
    return {
      viewer, simulation, coupling, latitude, longitude, weatherSample,
      cloudCover: clamp((weather?.latestStats?.cloudCover || 0) / 100),
      state, darkness, universeActive, nearestSettlement: this.cachedNearest,
      nearestStorm, selectedIndex, runtime, season: seasonKey(state.season),
    };
  }

  findNearestSettlement(simulation, latitude, longitude) {
    let nearest = null;
    for (const settlement of simulation?.settlements || []) {
      const distance = angularDistance(latitude, longitude, settlement.latitude, settlement.longitude);
      const score = Math.log10((settlement.population || 0) + 10) / (0.12 + distance);
      if (!nearest || score > nearest.score) nearest = { settlement, distance, score };
    }
    return nearest;
  }

  findNearestStorm(latitude, longitude) {
    let nearest = null;
    for (const storm of this.cachedStorms) {
      const stormLatitude = storm.latitude * Math.PI / 180;
      const stormLongitude = storm.longitude * Math.PI / 180;
      const distance = angularDistance(latitude, longitude, stormLatitude, stormLongitude);
      const strength = (storm.storm || 0) * Math.exp(-distance * 1.8);
      if (!nearest || strength > nearest.strength) nearest = { storm, distance, strength, latitude: stormLatitude, longitude: stormLongitude };
    }
    return nearest;
  }

  coastAt(snapshot) {
    const coastal = snapshot.coupling?.coastal;
    if (!coastal) return 0;
    const x = ((Math.floor(((snapshot.longitude + Math.PI) / TAU) * 96) % 96) + 96) % 96;
    const y = clamp(Math.floor(((snapshot.latitude + Math.PI / 2) / Math.PI) * 48), 0, 47);
    return coastal[y * 96 + x] ? 1 : 0;
  }

  targetMix(snapshot) {
    const weather = snapshot.weatherSample;
    const precipitation = clamp(weather.precipitation || 0);
    const wind = clamp((weather.windSpeed || 0) / 90);
    const humidity = clamp(weather.humidity || 0);
    const tide = clamp(snapshot.state.tideIndex || 0.5);
    const coast = this.coastAt(snapshot);
    const settlement = snapshot.nearestSettlement;
    const cityPresence = settlement
      ? clamp(Math.log10((settlement.settlement.population || 0) + 10) / 7 * Math.exp(-settlement.distance * 1.3))
      : 0;
    const bodyCount = snapshot.runtime?.stats?.count || 0;

    if (snapshot.universeActive) {
      return {
        wind: 0, rain: 0, tide: 0, city: 0, night: 0, drone: 0.10,
        orbit: clamp(0.18 + bodyCount / 360, 0.18, 0.48),
        rates: { drone: 0.82 + snapshot.selectedIndex * 0.04, orbit: 0.72 + bodyCount / 300 },
      };
    }

    return {
      wind: 0.035 + wind * 0.3 + snapshot.cloudCover * 0.07,
      rain: precipitation * 0.42 + snapshot.cloudCover * 0.04,
      tide: (0.035 + tide * 0.18) * (0.35 + coast * 0.65),
      city: cityPresence * (0.05 + snapshot.darkness * 0.36),
      night: snapshot.darkness * (0.04 + humidity * 0.17),
      drone: 0.055 + (1 - precipitation) * 0.035 + snapshot.darkness * 0.025,
      orbit: 0,
      rates: {
        wind: 0.78 + wind * 0.68,
        rain: 0.86 + precipitation * 0.28,
        tide: 0.78 + tide * 0.22,
        city: 0.92 + cityPresence * 0.12,
        night: 0.88 + clamp((weather.temperatureC || 18) / 40) * 0.25,
        drone: { spring: 1.03, summer: 1.08, autumn: 0.94, winter: 0.86 }[snapshot.season],
      },
    };
  }

  mix(snapshot, delta) {
    const target = this.targetMix(snapshot);
    const response = 1 - Math.exp(-delta * 2.4);
    for (const name of LAYER_NAMES) {
      const howl = this.layers.get(name);
      const id = this.layerIds.get(name);
      if (!howl || id === undefined) continue;
      const targetVolume = clamp(target[name] || 0, 0, 0.62);
      const current = lerp(this.currentVolumes[name] || 0, targetVolume, response);
      this.currentVolumes[name] = current;
      howl.volume(current, id);
      howl.rate(clamp(target.rates?.[name] || 1, 0.5, 1.65), id);
    }

    this.layers.get('wind')?.stereo?.(Math.cos(snapshot.weatherSample.windAngle || 0) * 0.65, this.layerIds.get('wind'));
    const rainPan = snapshot.nearestStorm ? clamp(normalizeRadians(snapshot.nearestStorm.longitude - snapshot.longitude) / Math.PI, -0.85, 0.85) : 0;
    this.layers.get('rain')?.stereo?.(rainPan, this.layerIds.get('rain'));
    const cityPan = snapshot.nearestSettlement ? clamp(normalizeRadians(snapshot.nearestSettlement.settlement.longitude - snapshot.longitude) / Math.PI, -0.8, 0.8) : 0;
    this.layers.get('city')?.stereo?.(cityPan, this.layerIds.get('city'));
    const tidePan = Number.isFinite(snapshot.state.sublunarLongitude)
      ? clamp(normalizeRadians(snapshot.state.sublunarLongitude * Math.PI / 180 - snapshot.longitude) / Math.PI, -0.75, 0.75) : 0;
    this.layers.get('tide')?.stereo?.(tidePan, this.layerIds.get('tide'));

    const orbit = this.layers.get('orbit');
    const orbitId = this.layerIds.get('orbit');
    const system = globalThis.realityV67?.universe?.systems?.[snapshot.selectedIndex];
    const camera = globalThis.realityV67?.universe?.camera;
    if (orbit && orbitId !== undefined && system && camera) {
      const position = system.group.position.clone();
      position.applyMatrix4(camera.matrixWorldInverse);
      const length = Math.max(1, position.length());
      orbit.pos(clamp(position.x / length, -1, 1) * 5, clamp(position.y / length, -1, 1) * 2, clamp(position.z / length, -1, 1) * 5, orbitId);
    }

    this.statusValues = {
      cloud: snapshot.cloudCover,
      rain: clamp(snapshot.weatherSample.precipitation || 0),
      city: clamp(target.city || 0),
      tide: clamp(snapshot.state.tideIndex || 0),
      orbit: clamp(target.orbit || 0),
    };
  }

  playMusic(snapshot) {
    this.musicBeat += 1;
    const intensity = snapshot.universeActive ? 0.45 : 0.75 - this.statusValues.rain * 0.35;
    const chance = hash01(this.seed ^ Math.imul(this.musicBeat, 0x9e3779b9));
    if (chance > intensity) return;
    const scale = SEASON_SCALES[snapshot.season] || SEASON_SCALES.spring;
    const day = Math.floor((snapshot.coupling?.date?.getTime?.() || Date.now()) / 86400000);
    const step = Math.floor(hash01(this.seed + day + this.musicBeat * 17) * scale.length);
    const octave = hash01(this.seed ^ (this.musicBeat * 31)) > 0.78 ? 12 : 0;
    const rootOffset = (this.seed % 7) - 3;
    const semitones = scale[step] + octave + rootOffset;
    const id = this.oneshots.note?.play();
    if (id === undefined) return;
    const rate = Math.pow(2, semitones / 12);
    const volume = snapshot.universeActive ? 0.075 : 0.055 + snapshot.darkness * 0.08;
    const pan = hash01(this.seed + this.musicBeat * 101) * 1.4 - 0.7;
    this.oneshots.note.rate(rate, id);
    this.oneshots.note.volume(volume, id);
    this.oneshots.note.stereo(pan, id);

    if (!mobile && this.musicBeat % 4 === 0 && chance < 0.34) {
      const harmonyId = this.oneshots.note.play();
      this.oneshots.note.rate(rate * Math.pow(2, 7 / 12), harmonyId);
      this.oneshots.note.volume(volume * 0.55, harmonyId);
      this.oneshots.note.stereo(-pan * 0.7, harmonyId);
    }
  }

  playSpatial(kind, position, volume = 0.5, rate = 1) {
    const howl = this.oneshots[kind];
    if (!howl) return;
    const id = howl.play();
    howl.volume(clamp(volume, 0, 0.9), id);
    howl.rate(clamp(rate, 0.55, 1.8), id);
    howl.pos(position.x || 0, position.y || 0, position.z ?? -1, id);
  }

  checkImpacts(snapshot) {
    for (const event of readImpactLog()) {
      if (!event?.id || this.knownImpactIds.has(event.id)) continue;
      this.knownImpactIds.add(event.id);
      const position = relativeSpatial(Number(event.longitude || 0) * Math.PI / 180, Number(event.latitude || 0) * Math.PI / 180, snapshot.longitude, snapshot.latitude, 7);
      const energy = Math.max(1e14, Number(event.energy || 1e18));
      const volume = clamp(0.32 + (Math.log10(energy) - 14) * 0.055, 0.32, 0.85);
      this.playSpatial('impact', position, volume, 0.78 + hash01(this.seed ^ this.knownImpactIds.size) * 0.32);
    }

    for (const runtime of globalThis.realityV67?.systems || []) {
      const count = runtime.stats?.impacts || 0;
      const previous = this.lastUniverseImpacts.get(runtime.index);
      this.lastUniverseImpacts.set(runtime.index, count);
      if (previous === undefined || count <= previous) continue;
      this.playSpatial('impact', { x: ((runtime.index % 3) - 1) * 3.2, y: 0, z: -3 }, 0.48, 0.9 + runtime.index * 0.08);
    }
  }

  checkTravel(snapshot) {
    if (!snapshot.universeActive) {
      this.lastSelectedSystem = snapshot.selectedIndex;
      return;
    }
    if (this.lastSelectedSystem === null) {
      this.lastSelectedSystem = snapshot.selectedIndex;
      return;
    }
    if (snapshot.selectedIndex === this.lastSelectedSystem) return;
    const direction = snapshot.selectedIndex > this.lastSelectedSystem ? 1 : -1;
    this.lastSelectedSystem = snapshot.selectedIndex;
    this.playSpatial('travel', { x: direction * 4, y: 0.5, z: -2 }, 0.58, 0.86 + snapshot.selectedIndex * 0.06);
  }

  maybeThunder(snapshot) {
    if (mobile || snapshot.universeActive || !snapshot.nearestStorm || snapshot.nearestStorm.strength < 0.42) return;
    const intervalTicks = Math.round(7 / FIXED_STEP);
    if (this.fixedTicks % intervalTicks !== 0) return;
    const bucket = Math.floor(this.fixedTicks / intervalTicks);
    if (hash01(this.seed ^ bucket) > snapshot.nearestStorm.strength * 0.72) return;
    const position = relativeSpatial(snapshot.nearestStorm.longitude, snapshot.nearestStorm.latitude, snapshot.longitude, snapshot.latitude, 8);
    this.playSpatial('thunder', position, 0.25 + snapshot.nearestStorm.strength * 0.38, 0.84 + hash01(bucket + this.seed) * 0.24);
  }

  updateStatus(snapshot) {
    if (!this.started) return;
    const mode = snapshot.universeActive ? 'orbital' : snapshot.darkness > 0.52 ? 'night' : 'day';
    const text = this.muted
      ? `HOWLER 2.2.4 · muted · volume ${Math.round(this.volume * 100)}%`
      : `HOWLER 2.2.4 · ${mode} mix · cloud ${Math.round(this.statusValues.cloud * 100)}% · tide ${this.statusValues.tide.toFixed(2)} · ${snapshot.season}`;
    this.setStatus(text);
  }
}

export async function createHowlerSoundscape() {
  return new HowlerSoundscape();
}
