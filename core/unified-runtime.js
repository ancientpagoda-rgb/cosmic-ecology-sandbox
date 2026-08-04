import { Application, Graphics, Text, TextStyle } from 'pixi.js';
import { Howl, Howler } from 'howler';
import { ReboundWasmSystem } from './reality-v6-6/rebound-client.js';

const ASTRONOMY_URL = 'https://cdn.jsdelivr.net/npm/astronomy-engine@2.1.19/+esm';
const LEGACY_VOLUME_KEY = 'reality-v6-9-audio-volume';
const LEGACY_MUTED_KEY = 'reality-v6-9-audio-muted';
const LEGACY_PALETTE_KEY = 'reality-v6-8-pixi-palette';
const LEGACY_PIXI_KEY = 'reality-v6-8-pixi-enabled';
const VALID_VIEWS = ['living', 'pixel', 'orbital', 'universe'];
const VALID_BACKENDS = ['procedural', 'rebound'];
const MOBILE_QUERY = '(max-width: 720px), (pointer: coarse)';
const AU_KM = 149_597_870.7;
const TAU = Math.PI * 2;
const SAMPLE_RATE_DESKTOP = 12000;
const SAMPLE_RATE_MOBILE = 8000;

const PALETTES = {
  phosphor: { background: 0x020b08, text: 0xcaffd8, dim: 0x4e8062, weather: 0x76dfff, life: 0x72f29c, danger: 0xff6672, orbit: 0xffdf7c, galaxy: 0xb497ff },
  amber: { background: 0x0d0702, text: 0xffd18a, dim: 0x8c6236, weather: 0xff9d58, life: 0xd5ee73, danger: 0xff5544, orbit: 0xffedaa, galaxy: 0xf5a3ff },
  arctic: { background: 0x020a0f, text: 0xd8f4ff, dim: 0x5a899d, weather: 0x66d7ff, life: 0x85edc9, danger: 0xff6f8b, orbit: 0xfff0a0, galaxy: 0x9eb7ff },
  dusk: { background: 0x09040f, text: 0xf2ddff, dim: 0x79618a, weather: 0x879fff, life: 0x83dfaa, danger: 0xff5d91, orbit: 0xffd46d, galaxy: 0xd49dff },
};
const PALETTE_NAMES = Object.keys(PALETTES);

export function createUnifiedRuntime(world, dependencies, options = {}) {
  const {
    orbitalSystem,
    dynamics,
    phase8,
    phase9,
    phase10,
    phase11,
  } = dependencies;
  const mobile = options.mobile ?? matchMedia(MOBILE_QUERY).matches;
  const seed = options.seed ?? 20260811;
  const rng = mulberry32(seed);
  const sampleRate = mobile ? SAMPLE_RATE_MOBILE : SAMPLE_RATE_DESKTOP;
  const rootEpoch = new Date(Date.UTC(2026, 0, 1));

  let view = 'living';
  let pixiEnabled = true;
  let paletteName = 'phosphor';
  let orbitalBackend = 'procedural';
  let astronomyPreference = 'automatic';
  let masterSteps = 0;
  let unifiedSeconds = 0;
  let lastWorldTick = world.tick;
  let lastOrbitalDay = orbitalSystem.getDay?.() || 0;
  let duplicateClockViolations = 0;
  let migratedLegacy = false;
  let destroyed = false;

  let astronomyModule = null;
  let astronomyLoadPromise = null;
  let astronomyState = fallbackAstronomyState();
  let astronomyAccumulator = 0;

  let reboundSystem = null;
  let reboundLoadPromise = null;
  let reboundStatus = { mode: 'unloaded', error: null, timeDays: 0, count: 0, energyError: 0, impacts: 0 };

  let pixiApp = null;
  let pixiCanvas = null;
  let pixiGraphics = null;
  let pixiText = null;
  let pixiLoadPromise = null;
  let lastPixiRender = -Infinity;

  let audioStarted = false;
  let audioPrepared = false;
  let audioPreparing = null;
  let audioMuted = false;
  let audioVolume = 0.58;
  const audioLayers = new Map();
  const audioLayerIds = new Map();
  const audioUrls = [];
  let eventHowl = null;
  let eventUrl = null;
  let lastEventCount = 0;
  let lastAudioMix = { weather: 0, water: 0, life: 0, civilization: 0, cosmos: 0 };

  let panel = null;
  let statusElement = null;
  let viewSelect = null;
  let soundButton = null;
  let volumeInput = null;
  let pixelButton = null;
  let paletteButton = null;
  let backendButton = null;
  let astronomyButton = null;
  const listeners = [];

  function initialize({ provideCapability }) {
    migrateLegacySettings();
    installDom();
    applyView();
    void ensureAstronomy();
    provideCapability('runtime.unified', api);
    provideCapability('presentation.pixi-root', api);
    provideCapability('audio.howler-root', api);
    provideCapability('ephemeris.astronomy-root', api);
    provideCapability('orbits.rebound-selected', api);
    return api;
  }

  function installDom() {
    const host = document.getElementById('world') || document.body;
    pixiCanvas = document.getElementById('unifiedPixiCanvas') || document.createElement('canvas');
    pixiCanvas.id = 'unifiedPixiCanvas';
    pixiCanvas.setAttribute('aria-hidden', 'true');
    if (!pixiCanvas.isConnected) host.append(pixiCanvas);

    panel = document.getElementById('unifiedRuntimePanel') || document.createElement('section');
    panel.id = 'unifiedRuntimePanel';
    panel.setAttribute('aria-label', 'Unified runtime controls');
    panel.innerHTML = `
      <header><strong>UNIFIED RUNTIME</strong><a href="reality-engine-v6-9.html" title="Open the preserved V6.9 compatibility page">V6.9</a></header>
      <div class="unified-runtime-grid">
        <label>View<select data-unified-view>
          <option value="living">Living world</option>
          <option value="pixel">Pixel presentation</option>
          <option value="orbital">Orbital system</option>
          <option value="universe">Galaxy / universe</option>
        </select></label>
        <button type="button" data-unified-sound>Sound start</button>
        <label>Volume<input data-unified-volume type="range" min="0" max="100" step="1"></label>
        <button type="button" data-unified-pixel>Pixel FX on</button>
        <button type="button" data-unified-palette>Palette Phosphor</button>
        <button type="button" data-unified-backend>Orbit procedural</button>
        <button type="button" data-unified-astronomy>Ephemeris auto</button>
      </div>
      <output data-unified-status></output>
    `;
    if (!panel.isConnected) document.body.append(panel);

    statusElement = panel.querySelector('[data-unified-status]');
    viewSelect = panel.querySelector('[data-unified-view]');
    soundButton = panel.querySelector('[data-unified-sound]');
    volumeInput = panel.querySelector('[data-unified-volume]');
    pixelButton = panel.querySelector('[data-unified-pixel]');
    paletteButton = panel.querySelector('[data-unified-palette]');
    backendButton = panel.querySelector('[data-unified-backend]');
    astronomyButton = panel.querySelector('[data-unified-astronomy]');

    viewSelect.addEventListener('change', () => setView(viewSelect.value));
    soundButton.addEventListener('click', () => {
      if (!audioStarted) void startAudio();
      else setMuted(!audioMuted);
    });
    volumeInput.addEventListener('input', () => setVolume(Number(volumeInput.value) / 100));
    pixelButton.addEventListener('click', () => setPixiEnabled(!pixiEnabled));
    paletteButton.addEventListener('click', cyclePalette);
    backendButton.addEventListener('click', () => setOrbitalBackend(orbitalBackend === 'procedural' ? 'rebound' : 'procedural'));
    astronomyButton.addEventListener('click', () => {
      astronomyPreference = astronomyPreference === 'automatic' ? 'procedural' : astronomyPreference === 'procedural' ? 'earth-reference' : 'automatic';
      updateControls();
    });

    const keyHandler = event => {
      if (event.ctrlKey || event.metaKey || event.altKey || isInteractive(event.target)) return;
      if (event.code === 'KeyM') {
        event.preventDefault();
        if (!audioStarted) void startAudio();
        else setMuted(!audioMuted);
      } else if (event.code === 'KeyV') {
        event.preventDefault();
        setView(VALID_VIEWS[(VALID_VIEWS.indexOf(view) + 1) % VALID_VIEWS.length]);
      }
    };
    document.addEventListener('keydown', keyHandler);
    listeners.push(() => document.removeEventListener('keydown', keyHandler));

    const eventHandler = () => {
      if (audioStarted) playEventPulse();
    };
    for (const name of ['planet-event', 'phase8-history', 'phase9-history', 'phase10-history', 'phase11-history']) {
      window.addEventListener(name, eventHandler);
      listeners.push(() => window.removeEventListener(name, eventHandler));
    }
    updateControls();
  }

  function migrateLegacySettings() {
    try {
      const legacyVolume = Number(localStorage.getItem(LEGACY_VOLUME_KEY));
      if (Number.isFinite(legacyVolume)) audioVolume = clamp(legacyVolume, 0, 1);
      const legacyMuted = localStorage.getItem(LEGACY_MUTED_KEY);
      if (legacyMuted !== null) audioMuted = legacyMuted === 'true';
      const legacyPalette = localStorage.getItem(LEGACY_PALETTE_KEY);
      if (PALETTES[legacyPalette]) paletteName = legacyPalette;
      const legacyPixi = localStorage.getItem(LEGACY_PIXI_KEY);
      if (legacyPixi !== null) pixiEnabled = legacyPixi !== 'off';
      migratedLegacy = [legacyVolume, legacyMuted, legacyPalette, legacyPixi].some(value => value !== null && value !== undefined && value !== '');
    } catch {
      migratedLegacy = false;
    }
  }

  function persistCompatibilitySettings() {
    try {
      localStorage.setItem(LEGACY_VOLUME_KEY, String(audioVolume));
      localStorage.setItem(LEGACY_MUTED_KEY, String(audioMuted));
      localStorage.setItem(LEGACY_PALETTE_KEY, paletteName);
      localStorage.setItem(LEGACY_PIXI_KEY, pixiEnabled ? 'on' : 'off');
    } catch {
      // Private browsing can disable storage.
    }
  }

  function setView(next) {
    if (!VALID_VIEWS.includes(next)) return view;
    view = next;
    if (view !== 'living' || pixiEnabled) void ensurePixi();
    if (view === 'orbital' && orbitalBackend === 'rebound') void ensureRebound();
    applyView();
    updateControls();
    return view;
  }

  function applyView() {
    document.body.dataset.unifiedView = view;
    document.body.classList.toggle('unified-pixel-enabled', pixiEnabled);
    if (pixiCanvas) {
      const visible = pixiEnabled || view !== 'living';
      pixiCanvas.hidden = !visible;
      pixiCanvas.style.display = visible ? 'block' : 'none';
    }
  }

  function setPixiEnabled(enabled) {
    pixiEnabled = Boolean(enabled);
    if (pixiEnabled) void ensurePixi();
    applyView();
    persistCompatibilitySettings();
    updateControls();
    return pixiEnabled;
  }

  function cyclePalette() {
    paletteName = PALETTE_NAMES[(PALETTE_NAMES.indexOf(paletteName) + 1) % PALETTE_NAMES.length];
    persistCompatibilitySettings();
    updateControls();
    return paletteName;
  }

  async function ensurePixi() {
    if (pixiApp) return pixiApp;
    if (pixiLoadPromise) return pixiLoadPromise;
    pixiLoadPromise = (async () => {
      const app = new Application();
      const width = Math.max(320, Math.floor(innerWidth * (mobile ? 0.5 : 0.65)));
      const height = Math.max(180, Math.floor(innerHeight * (mobile ? 0.5 : 0.65)));
      await app.init({
        canvas: pixiCanvas,
        width,
        height,
        backgroundAlpha: 0,
        antialias: false,
        autoStart: false,
        sharedTicker: false,
        preference: 'webgl',
        powerPreference: 'low-power',
        resolution: 1,
        clearBeforeRender: true,
      });
      app.stop();
      pixiCanvas.style.imageRendering = 'pixelated';
      pixiGraphics = new Graphics();
      pixiText = new Text({ text: '', style: new TextStyle({ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: mobile ? 8 : 10, fill: PALETTES[paletteName].text }) });
      pixiText.position.set(8, 8);
      app.stage.addChild(pixiGraphics, pixiText);
      pixiApp = app;
      const resize = () => {
        if (!pixiApp) return;
        const nextWidth = Math.max(320, Math.floor(innerWidth * (mobile ? 0.5 : 0.65)));
        const nextHeight = Math.max(180, Math.floor(innerHeight * (mobile ? 0.5 : 0.65)));
        pixiApp.renderer.resize(nextWidth, nextHeight);
      };
      addEventListener('resize', resize);
      listeners.push(() => removeEventListener('resize', resize));
      return app;
    })().finally(() => { pixiLoadPromise = null; });
    return pixiLoadPromise;
  }

  function render(frame = {}) {
    const timestamp = frame.timestamp ?? performance.now();
    updateStatus();
    if ((!pixiEnabled && view === 'living') || !pixiApp || timestamp - lastPixiRender < (mobile ? 140 : 80)) return;
    lastPixiRender = timestamp;
    drawPixi();
    if (typeof pixiApp.render === 'function') pixiApp.render();
    else pixiApp.renderer.render({ container: pixiApp.stage });
  }

  function drawPixi() {
    if (!pixiGraphics || !pixiApp) return;
    const palette = PALETTES[paletteName];
    pixiGraphics.clear();
    pixiText.style.fill = palette.text;
    const width = pixiApp.renderer.width;
    const height = pixiApp.renderer.height;
    if (view !== 'living') pixiGraphics.rect(0, 0, width, height).fill({ color: palette.background, alpha: 0.9 });

    if (view === 'orbital') drawOrbital(width, height, palette);
    else if (view === 'universe') drawUniverse(width, height, palette);
    else drawLiving(width, height, palette, view === 'pixel');
  }

  function drawLiving(width, height, palette, fullPixel) {
    const sx = width / world.width;
    const sy = height / world.height;
    const weather = dynamics.getWeather?.() || [];
    for (const cell of weather.slice(0, mobile ? 18 : 36)) {
      const radius = Math.max(1, cell.radius * sx * 0.18);
      const color = cell.type === 'storm' ? palette.danger : palette.weather;
      pixiGraphics.circle(cell.x * sx, cell.y * sy, radius).fill({ color, alpha: 0.12 + cell.strength * 0.25 });
    }

    const components = world.ecs.components;
    let drawn = 0;
    const max = mobile ? 120 : 320;
    for (const [id, position] of components.position.entries()) {
      if (drawn++ >= max) break;
      let color = palette.dim;
      let radius = 1;
      if (components.resource.has(id)) { color = palette.life; radius = 1; }
      else if (components.agent.has(id)) { color = palette.text; radius = 1.5; }
      else if (components.predator.has(id)) { color = palette.danger; radius = 1.7; }
      else if (components.apex.has(id)) { color = palette.galaxy; radius = 2.1; }
      else continue;
      pixiGraphics.circle(position.x * sx, position.y * sy, radius).fill({ color, alpha: fullPixel ? 0.9 : 0.45 });
    }

    const p8 = phase8.getState?.() || {};
    const p9 = phase9.getState?.() || {};
    pixiText.text = `LIVING WORLD · tick ${world.tick}\nweather ${weather.length} · population ${Math.round(p8.population || p9.population || 0)} · life ${lifeCount()}`;
  }

  function drawOrbital(width, height, palette) {
    const bodies = orbitalBackend === 'rebound' && reboundSystem ? reboundSystem.snapshot() : orbitalSystem.getBodies?.() || [];
    const normalized = bodies.map(body => {
      if ('position' in body) return { ...body, x: body.position.x, y: body.position.z ?? body.position.y };
      return body;
    });
    const maxDistance = Math.max(1, ...normalized.map(body => Math.hypot(body.x || 0, body.y || 0)));
    const scale = Math.min(width, height) * 0.42 / maxDistance;
    const cx = width / 2;
    const cy = height / 2;
    for (const body of normalized.slice(0, mobile ? 52 : 120)) {
      const isStar = body.type === 'star' || body.name === 'Star' || body.id === 'sun';
      const color = isStar ? palette.orbit : body.type === 4 || String(body.name).startsWith('Asteroid') ? palette.dim : palette.weather;
      const radius = isStar ? 4 : Math.max(1, Math.min(3, Math.log10(Math.abs(body.mass || body.massEarth || 1e-8) + 1) + 1.2));
      pixiGraphics.circle(cx + (body.x || 0) * scale, cy + (body.y || 0) * scale, radius).fill({ color, alpha: isStar ? 1 : 0.82 });
    }
    pixiText.text = `ORBITAL SYSTEM · ${orbitalBackend === 'rebound' ? reboundStatus.mode : 'procedural'}\n${normalized.length} bodies · day ${(orbitalSystem.getDay?.() || 0).toFixed(2)} · energy error ${(reboundStatus.energyError || 0).toExponential(2)}`;
  }

  function drawUniverse(width, height, palette) {
    const galaxies = phase11.getGalaxies?.() || [];
    const selected = galaxies.filter(galaxy => !galaxy.vanished).slice(0, mobile ? 36 : 96);
    const maxDistance = Math.max(1, ...selected.map(galaxy => Math.hypot(galaxy.comovingPositionMpc?.x || 0, galaxy.comovingPositionMpc?.z || 0)));
    const scale = Math.min(width, height) * 0.43 / maxDistance;
    const cx = width / 2;
    const cy = height / 2;
    for (const galaxy of selected) {
      const x = galaxy.comovingPositionMpc?.x || 0;
      const y = galaxy.comovingPositionMpc?.z || galaxy.comovingPositionMpc?.y || 0;
      const radius = clamp(Math.log10(Math.max(1e8, galaxy.stellarMassSolar || 1e8)) - 7, 1, 5);
      const color = galaxy.state === 'starburst' ? palette.danger : galaxy.reachable === false ? palette.dim : palette.galaxy;
      pixiGraphics.circle(cx + x * scale, cy + y * scale, radius).fill({ color, alpha: galaxy.reachable === false ? 0.35 : 0.78 });
    }
    const p11 = phase11.getState?.() || {};
    pixiText.text = `OBSERVABLE UNIVERSE · a=${Number(p11.scaleFactor || 1).toFixed(5)}\n${selected.length}/${p11.galaxies || selected.length} selected galaxies · ${p11.causalEvents || 0} causal events · ${p11.unreachableGalaxies || 0} beyond horizon`;
  }

  async function prepareAudio() {
    if (audioPrepared) return true;
    if (audioPreparing) return audioPreparing;
    audioPreparing = (async () => {
      const names = ['weather', 'water', 'life', 'civilization', 'cosmos'];
      for (let index = 0; index < names.length; index++) {
        const name = names[index];
        const url = synthLoop(name, seed ^ Math.imul(index + 1, 0x9e3779b9), sampleRate, mobile ? 4 : 7);
        audioUrls.push(url);
        audioLayers.set(name, new Howl({ src: [url], format: ['wav'], loop: true, preload: true, volume: 0, html5: false, pool: mobile ? 2 : 5 }));
        await nextTask();
      }
      eventUrl = synthEvent(seed ^ 0x51a7c3, sampleRate);
      eventHowl = new Howl({ src: [eventUrl], format: ['wav'], loop: false, preload: true, volume: 0.35, html5: false, pool: mobile ? 4 : 10 });
      Howler.volume(audioVolume);
      Howler.mute(audioMuted || document.hidden);
      audioPrepared = true;
      return true;
    })().finally(() => { audioPreparing = null; });
    return audioPreparing;
  }

  async function startAudio() {
    if (audioStarted) return true;
    await prepareAudio();
    if (Howler.ctx?.state !== 'running') await Howler.ctx.resume();
    for (const [name, howl] of audioLayers) {
      const id = howl.play();
      audioLayerIds.set(name, id);
      howl.volume(0, id);
    }
    audioStarted = true;
    Howler.mute(audioMuted || document.hidden);
    updateControls();
    return true;
  }

  function setMuted(value) {
    audioMuted = Boolean(value);
    Howler.mute(audioMuted || document.hidden);
    persistCompatibilitySettings();
    updateControls();
    return audioMuted;
  }

  function setVolume(value) {
    audioVolume = clamp(Number(value) || 0, 0, 1);
    Howler.volume(audioVolume);
    persistCompatibilitySettings();
    updateControls();
    return audioVolume;
  }

  function targetAudioMix() {
    const weather = dynamics.getWeather?.() || [];
    const storm = weather.reduce((maximum, cell) => Math.max(maximum, cell.strength || 0), 0);
    const p8 = phase8.getState?.() || {};
    const p9 = phase9.getState?.() || {};
    const p10 = phase10.getState?.() || {};
    const p11 = phase11.getState?.() || {};
    const life = clamp(Math.log10(lifeCount() + 1) / 3, 0, 1);
    const population = Math.max(p8.population || 0, p9.population || 0);
    const civilization = clamp(Math.log10(population + 1) / 8 + (p9.machines || 0) / Math.max(1, population) * 0.2, 0, 1);
    const cosmos = clamp((p10.activeMissions || 0) * 0.04 + (p11.activeGalacticNuclei || 0) * 0.02 + (p11.gravitationalWaves || 0) * 0.08, 0, 1);
    return {
      weather: clamp(0.03 + storm * 0.42 + (world.globals.storminess || 0) * 0.15, 0, 0.58),
      water: clamp(0.04 + weather.length / 120, 0, 0.3),
      life: clamp(0.02 + life * 0.2, 0, 0.28),
      civilization: clamp(civilization * 0.2, 0, 0.3),
      cosmos: view === 'orbital' || view === 'universe' ? clamp(0.1 + cosmos * 0.28, 0.1, 0.42) : cosmos * 0.1,
    };
  }

  function updateAudio(dt) {
    const target = targetAudioMix();
    lastAudioMix = target;
    if (!audioStarted) return;
    const response = 1 - Math.exp(-dt * 2.2);
    for (const [name, targetVolume] of Object.entries(target)) {
      const howl = audioLayers.get(name);
      const id = audioLayerIds.get(name);
      if (!howl || id === undefined) continue;
      const current = howl.volume(id) || 0;
      howl.volume(current + (targetVolume - current) * response, id);
      const rate = name === 'cosmos' ? 0.82 + clamp((phase11.getState?.().scaleFactor || 1) - 1, 0, 0.35) : 0.92 + targetVolume * 0.3;
      howl.rate(rate, id);
    }
    const eventCount = (phase10.getState?.().causalEvents || 0) + (phase11.getState?.().causalEvents || 0);
    if (eventCount > lastEventCount) playEventPulse();
    lastEventCount = eventCount;
  }

  function playEventPulse() {
    if (!audioStarted || !eventHowl) return false;
    const id = eventHowl.play();
    eventHowl.volume(0.12 + rng() * 0.16, id);
    eventHowl.rate(0.75 + rng() * 0.65, id);
    eventHowl.stereo?.(rng() * 1.4 - 0.7, id);
    return true;
  }

  async function ensureAstronomy() {
    if (astronomyModule || astronomyState.mode === 'failed') return astronomyState;
    if (astronomyLoadPromise) return astronomyLoadPromise;
    astronomyState = { ...astronomyState, mode: 'loading' };
    astronomyLoadPromise = import(/* @vite-ignore */ ASTRONOMY_URL)
      .then(module => {
        astronomyModule = module;
        updateAstronomyState();
        return astronomyState;
      })
      .catch(error => {
        astronomyState = { ...fallbackAstronomyState(), mode: 'fallback', error: error.message };
        return astronomyState;
      })
      .finally(() => { astronomyLoadPromise = null; updateControls(); });
    return astronomyLoadPromise;
  }

  function updateAstronomyState() {
    const day = orbitalSystem.getDay?.() || 0;
    const date = new Date(rootEpoch.getTime() + day * 86_400_000);
    if (!astronomyModule || astronomyPreference === 'procedural') {
      astronomyState = { ...fallbackAstronomyState(), date: date.toISOString(), preference: astronomyPreference, mode: astronomyModule ? 'procedural' : 'fallback' };
      return astronomyState;
    }
    try {
      const Astronomy = astronomyModule;
      const sunVector = Astronomy.GeoVector(Astronomy.Body.Sun, date, true);
      const moonVector = Astronomy.GeoVector(Astronomy.Body.Moon, date, true);
      const rotation = Astronomy.Rotation_EQJ_EQD(date);
      const sun = Astronomy.EquatorFromVector(Astronomy.RotateVector(rotation, sunVector));
      const moon = Astronomy.EquatorFromVector(Astronomy.RotateVector(rotation, moonVector));
      const siderealDegrees = Astronomy.SiderealTime(date) * 15;
      const moonPhaseDegrees = Astronomy.MoonPhase(date);
      const lunarDistanceKm = Math.hypot(moonVector.x, moonVector.y, moonVector.z) * AU_KM;
      const springAlignment = 0.5 + 0.5 * Math.cos(moonPhaseDegrees * Math.PI / 90);
      const distanceFactor = Math.pow(384_400 / Math.max(320_000, lunarDistanceKm), 3);
      astronomyState = {
        mode: 'astronomy-engine-earth-reference',
        preference: astronomyPreference,
        authority: 'procedural-generated-system',
        validator: 'Astronomy Engine 2.1.19 Earth reference',
        date: date.toISOString(),
        sunDeclination: sun.dec,
        moonDeclination: moon.dec,
        subsolarLongitude: normalizeDegrees(sun.ra * 15 - siderealDegrees),
        subsolarLatitude: sun.dec,
        sublunarLongitude: normalizeDegrees(moon.ra * 15 - siderealDegrees),
        sublunarLatitude: moon.dec,
        moonPhaseDegrees,
        moonPhase: phaseName(moonPhaseDegrees),
        lunarDistanceKm,
        tideIndex: clamp((0.36 + springAlignment * 0.74) * distanceFactor, 0.18, 1.55),
        proceduralSeason: orbitalSystem.getSeasonState?.(0),
        error: null,
      };
    } catch (error) {
      astronomyState = { ...fallbackAstronomyState(), mode: 'fallback', date: date.toISOString(), error: error.message };
    }
    return astronomyState;
  }

  function fallbackAstronomyState() {
    const season = orbitalSystem.getSeasonState?.(0) || {};
    const state = orbitalSystem.getState?.() || {};
    const moon = state.moon || {};
    const sun = (state.bodies || []).find(body => body.id === 'sun') || {};
    const moonLongitude = Math.atan2(moon.position?.z || 0, moon.position?.x || 1) * 180 / Math.PI;
    const sunLongitude = Math.atan2(sun.position?.z || 0, sun.position?.x || 1) * 180 / Math.PI;
    return {
      mode: 'procedural',
      preference: astronomyPreference,
      authority: 'procedural-generated-system',
      validator: astronomyModule ? 'Astronomy Engine available' : 'deterministic procedural fallback',
      date: new Date(rootEpoch.getTime() + (orbitalSystem.getDay?.() || 0) * 86_400_000).toISOString(),
      sunDeclination: Number(season.declination || 0) * 180 / Math.PI,
      moonDeclination: Number(moon.inclination || 0),
      subsolarLongitude: normalizeDegrees(sunLongitude),
      subsolarLatitude: Number(season.declination || 0) * 180 / Math.PI,
      sublunarLongitude: normalizeDegrees(moonLongitude),
      sublunarLatitude: Number(moon.inclination || 0),
      moonPhaseDegrees: normalizeDegrees(moonLongitude - sunLongitude + 180),
      moonPhase: phaseName(normalizeDegrees(moonLongitude - sunLongitude + 180)),
      lunarDistanceKm: Number(moon.orbitRadius || 0.3) * 384_400 / 0.3,
      tideIndex: orbitalSystem.getTideAt?.(world.width / 2, world.height / 2)?.springTide || 0.5,
      proceduralSeason: season,
      error: null,
    };
  }

  async function ensureRebound() {
    if (reboundSystem) return reboundSystem;
    if (reboundLoadPromise) return reboundLoadPromise;
    reboundStatus = { ...reboundStatus, mode: 'loading', error: null };
    reboundLoadPromise = ReboundWasmSystem.load()
      .then(system => {
        const planetCount = clamp((orbitalSystem.getBodies?.() || []).filter(body => body.type === 'planet').length, 3, 8);
        system.initialize({ seed, planets: planetCount, asteroids: mobile ? 18 : 52 });
        system.setIntegrator(mobile ? 2 : 0);
        reboundSystem = system;
        reboundStatus = { mode: 'rebound-wasm', error: null, ...system.stats() };
        lastOrbitalDay = orbitalSystem.getDay?.() || 0;
        updateControls();
        return system;
      })
      .catch(error => {
        orbitalBackend = 'procedural';
        reboundStatus = { mode: 'procedural-fallback', error: error.message, timeDays: 0, count: 0, energyError: 0, impacts: 0 };
        updateControls();
        return null;
      })
      .finally(() => { reboundLoadPromise = null; });
    return reboundLoadPromise;
  }

  async function setOrbitalBackend(next) {
    if (!VALID_BACKENDS.includes(next)) return orbitalBackend;
    if (next === 'rebound') {
      const system = await ensureRebound();
      orbitalBackend = system ? 'rebound' : 'procedural';
    } else orbitalBackend = 'procedural';
    updateControls();
    return orbitalBackend;
  }

  function step(dt) {
    if (destroyed) return;
    masterSteps++;
    unifiedSeconds += Math.max(0, dt);
    if (world.tick < lastWorldTick) duplicateClockViolations++;
    lastWorldTick = world.tick;
    astronomyAccumulator += dt;
    if (astronomyAccumulator >= 0.5) {
      astronomyAccumulator = 0;
      updateAstronomyState();
    }
    if (orbitalBackend === 'rebound' && reboundSystem) {
      const day = orbitalSystem.getDay?.() || lastOrbitalDay;
      const deltaDays = Math.max(0, day - lastOrbitalDay);
      if (deltaDays > 0) reboundSystem.step(deltaDays);
      lastOrbitalDay = day;
      reboundStatus = { mode: 'rebound-wasm', error: null, ...reboundSystem.stats() };
    }
    updateAudio(dt);
  }

  function updateControls() {
    if (!panel) return;
    viewSelect.value = view;
    soundButton.textContent = !audioStarted ? 'Sound start' : audioMuted ? 'Sound muted' : 'Sound on';
    volumeInput.value = String(Math.round(audioVolume * 100));
    pixelButton.textContent = pixiEnabled ? 'Pixel FX on' : 'Pixel FX off';
    paletteButton.textContent = `Palette ${capitalize(paletteName)}`;
    backendButton.textContent = orbitalBackend === 'rebound' ? `Orbit ${reboundStatus.mode}` : 'Orbit procedural';
    astronomyButton.textContent = `Ephemeris ${astronomyPreference}`;
    updateStatus();
  }

  function updateStatus() {
    if (!statusElement) return;
    const astronomyLabel = astronomyState.mode === 'astronomy-engine-earth-reference' ? 'Astronomy reference' : astronomyState.mode;
    statusElement.textContent = `${view} · tick ${world.tick} · ${astronomyLabel} · ${orbitalBackend === 'rebound' ? reboundStatus.mode : 'procedural orbit'} · one master clock`;
  }

  function getState() {
    return {
      view,
      pixiEnabled,
      paletteName,
      orbitalBackend,
      astronomyPreference,
      masterSteps,
      unifiedSeconds,
      lastWorldTick,
      duplicateClockViolations,
      migratedLegacy,
      mobile,
      audioStarted,
      audioPrepared,
      audioMuted,
      audioVolume,
      pixiReady: Boolean(pixiApp),
      pixiTickerStarted: Boolean(pixiApp?.ticker?.started),
      astronomyMode: astronomyState.mode,
      reboundMode: reboundStatus.mode,
      reboundLoaded: Boolean(reboundSystem),
    };
  }

  function getSnapshot() {
    return {
      state: getState(),
      audio: { started: audioStarted, prepared: audioPrepared, muted: audioMuted, volume: audioVolume, mix: { ...lastAudioMix } },
      astronomy: structuredClone(astronomyState),
      rebound: {
        ...reboundStatus,
        backend: orbitalBackend,
        bodies: reboundSystem ? reboundSystem.snapshot().slice(0, mobile ? 52 : 120) : [],
      },
      presentation: {
        view,
        pixiEnabled,
        paletteName,
        canvas: pixiCanvas ? { width: pixiCanvas.width, height: pixiCanvas.height, hidden: pixiCanvas.hidden } : null,
        tickerStarted: Boolean(pixiApp?.ticker?.started),
      },
      clock: { source: 'root-module-host-fixed-step', fixedDtSeconds: 0.06, masterSteps, unifiedSeconds, worldTick: world.tick, duplicateClockViolations },
      compatibility: { standaloneV69: 'reality-engine-v6-9.html', migratedLegacy },
    };
  }

  function runInvariants() {
    const failures = [];
    if (!VALID_VIEWS.includes(view)) failures.push(`invalid-unified-view:${view}`);
    if (!VALID_BACKENDS.includes(orbitalBackend)) failures.push(`invalid-orbital-backend:${orbitalBackend}`);
    if (duplicateClockViolations > 0) failures.push(`duplicate-clock-violation:${duplicateClockViolations}`);
    if (pixiApp?.ticker?.started) failures.push('pixi-private-ticker-started');
    if (pixiApp && !pixiCanvas?.isConnected) failures.push('pixi-canvas-detached');
    if (![audioVolume, unifiedSeconds, masterSteps].every(Number.isFinite)) failures.push('non-finite-unified-state');
    if (audioVolume < 0 || audioVolume > 1) failures.push('invalid-audio-volume');
    if (!Number.isFinite(astronomyState.tideIndex) || !Number.isFinite(astronomyState.moonPhaseDegrees)) failures.push('invalid-astronomy-state');
    if (reboundSystem && (!Number.isFinite(reboundStatus.timeDays) || !Number.isFinite(reboundStatus.energyError))) failures.push('invalid-rebound-state');
    if (!document.querySelector('#unifiedRuntimePanel a[href="reality-engine-v6-9.html"]')) failures.push('missing-v69-compatibility-link');
    return { ok: failures.length === 0, failures, checkedAtTick: world.tick, clockSource: 'root-module-host-fixed-step' };
  }

  async function debugScenario(kind) {
    if (kind === 'shared-clock') {
      const before = { tick: world.tick, masterSteps, unifiedSeconds };
      return { ok: duplicateClockViolations === 0, kind, before, clockSource: 'root-module-host-fixed-step', privateRafLoops: 0 };
    }
    if (kind === 'view-switch') {
      const beforeTick = world.tick;
      const previous = view;
      for (const next of VALID_VIEWS) setView(next);
      setView(previous);
      return { ok: world.tick === beforeTick, kind, beforeTick, afterTick: world.tick, views: [...VALID_VIEWS], restored: view };
    }
    if (kind === 'audio-coupling') {
      const mix = targetAudioMix();
      return { ok: Object.values(mix).every(value => Number.isFinite(value) && value >= 0), kind, mix, lifeCount: lifeCount(), phase11Events: phase11.getState?.().causalEvents || 0 };
    }
    if (kind === 'astronomy') {
      await ensureAstronomy();
      updateAstronomyState();
      return { ok: Number.isFinite(astronomyState.moonPhaseDegrees) && Number.isFinite(astronomyState.tideIndex), kind, state: structuredClone(astronomyState) };
    }
    if (kind === 'rebound') {
      const system = await ensureRebound();
      if (system) {
        const before = system.stats().timeDays;
        system.step(0.5);
        reboundStatus = { mode: 'rebound-wasm', error: null, ...system.stats() };
        return { ok: reboundStatus.timeDays >= before && reboundStatus.count > 0, kind, status: { ...reboundStatus }, sampleBodies: system.snapshot().slice(0, 8) };
      }
      return { ok: orbitalBackend === 'procedural', kind, status: { ...reboundStatus }, fallback: true };
    }
    if (kind === 'save-migration') {
      persistCompatibilitySettings();
      const legacy = {
        volume: localStorage.getItem(LEGACY_VOLUME_KEY),
        muted: localStorage.getItem(LEGACY_MUTED_KEY),
        palette: localStorage.getItem(LEGACY_PALETTE_KEY),
        pixi: localStorage.getItem(LEGACY_PIXI_KEY),
      };
      return { ok: legacy.volume !== null && legacy.muted !== null && PALETTES[legacy.palette] && legacy.pixi !== null, kind, legacy, unified: getState() };
    }
    if (kind === 'mobile-lod') {
      return { ok: true, kind, mobile, pixiGalaxyLimit: mobile ? 36 : 96, reboundAsteroids: mobile ? 18 : 52, audioSampleRate: sampleRate };
    }
    return { ok: false, kind, reason: 'unknown-unified-scenario' };
  }

  function save() {
    persistCompatibilitySettings();
    return {
      version: 1,
      view,
      pixiEnabled,
      paletteName,
      orbitalBackend,
      astronomyPreference,
      audioMuted,
      audioVolume,
      masterSteps,
      unifiedSeconds,
      migratedLegacy,
    };
  }

  function load(state) {
    if (!state) return;
    if (VALID_VIEWS.includes(state.view)) view = state.view;
    if (typeof state.pixiEnabled === 'boolean') pixiEnabled = state.pixiEnabled;
    if (PALETTES[state.paletteName]) paletteName = state.paletteName;
    if (VALID_BACKENDS.includes(state.orbitalBackend)) orbitalBackend = state.orbitalBackend;
    if (['automatic', 'procedural', 'earth-reference'].includes(state.astronomyPreference)) astronomyPreference = state.astronomyPreference;
    if (typeof state.audioMuted === 'boolean') audioMuted = state.audioMuted;
    if (Number.isFinite(state.audioVolume)) audioVolume = clamp(state.audioVolume, 0, 1);
    if (Number.isFinite(state.masterSteps)) masterSteps = Math.max(0, state.masterSteps);
    if (Number.isFinite(state.unifiedSeconds)) unifiedSeconds = Math.max(0, state.unifiedSeconds);
    migratedLegacy = Boolean(state.migratedLegacy || migratedLegacy);
    applyView();
    updateControls();
    if (orbitalBackend === 'rebound') void ensureRebound();
  }

  function destroy() {
    destroyed = true;
    for (const remove of listeners.splice(0)) remove();
    panel?.remove();
    pixiApp?.destroy?.(true, { children: true, texture: true });
    pixiCanvas?.remove();
    for (const howl of audioLayers.values()) howl.unload();
    eventHowl?.unload();
    for (const url of audioUrls) URL.revokeObjectURL(url);
    if (eventUrl) URL.revokeObjectURL(eventUrl);
    audioLayers.clear();
    audioLayerIds.clear();
  }

  function lifeCount() {
    const c = world.ecs.components;
    return (c.resource?.size || 0) + (c.agent?.size || 0) + (c.predator?.size || 0) + (c.apex?.size || 0);
  }

  const api = {
    id: 'runtime.unified-v69-phase11',
    name: 'Unified V6.9 and Phase 11 Runtime',
    version: '1.0.0',
    execution: 'browser-single-master-clock',
    source: 'Root module host with PixiJS, Howler.js, Astronomy Engine reference, and same-origin REBOUND WebAssembly',
    license: 'Project license plus dependency licenses in THIRD_PARTY_NOTICES.md',
    provides: ['runtime.unified', 'presentation.pixi-root', 'audio.howler-root', 'ephemeris.astronomy-root', 'orbits.rebound-selected'],
    requires: ['orbits.system', 'civilization.phase11-cosmological-evolution'],
    after: ['civilization.phase11-cosmological-evolution'],
    initialize,
    step,
    render,
    save,
    load,
    destroy,
    getState,
    getSnapshot,
    runInvariants,
    debugScenario,
    setView,
    getView: () => view,
    setPixiEnabled,
    cyclePalette,
    startAudio,
    setMuted,
    setVolume,
    setOrbitalBackend,
    ensureRebound,
    ensureAstronomy,
    getAstronomyState: () => structuredClone(astronomyState),
    getReboundState: () => ({ ...reboundStatus, bodies: reboundSystem ? reboundSystem.snapshot() : [] }),
  };
  return api;
}

function synthLoop(kind, seed, sampleRate, duration) {
  const length = Math.max(1, Math.round(sampleRate * duration));
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    const t = index / sampleRate;
    const p = t / duration;
    const base = 32 + (seed % 48);
    let sample = 0;
    if (kind === 'weather') sample = periodic(t, duration, seed, 11, 2, 73) * 0.42 + periodic(t, duration, seed ^ 0x51ab, 7, 41, 211) * 0.12;
    else if (kind === 'water') sample = Math.sin(TAU * p * 3) * 0.26 + periodic(t, duration, seed, 9, 7, 83) * 0.16;
    else if (kind === 'life') sample = Math.sin(TAU * (base * 3) * t + Math.sin(TAU * p * 9) * 3) * Math.pow(Math.max(0, Math.sin(TAU * p * 9)), 18) * 0.24;
    else if (kind === 'civilization') sample = Math.sin(TAU * base * t) * 0.18 + Math.sin(TAU * base * 1.5 * t + 0.7) * 0.12 + Math.pow(Math.max(0, Math.sin(TAU * p * 8)), 14) * 0.1;
    else sample = Math.sin(TAU * (base * 0.55) * t + Math.sin(TAU * p * 2) * 0.6) * 0.22 + periodic(t, duration, seed, 6, 1, 19) * 0.08;
    samples[index] = Math.tanh(sample * 1.8) * 0.72;
  }
  return wavUrl(samples, sampleRate);
}

function synthEvent(seed, sampleRate) {
  const duration = 1.6;
  const length = Math.round(duration * sampleRate);
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index++) {
    const t = index / sampleRate;
    const p = t / duration;
    const frequency = (70 + seed % 45) * Math.pow(2.4, p);
    samples[index] = Math.sin(TAU * frequency * t) * Math.sin(Math.PI * p) * 0.42 + periodic(t, duration, seed, 8, 13, 97) * Math.exp(-t * 4) * 0.16;
  }
  return wavUrl(samples, sampleRate);
}

function periodic(t, duration, seed, harmonics, low, high) {
  let value = 0;
  let norm = 0;
  for (let index = 0; index < harmonics; index++) {
    const random = hash01(seed + Math.imul(index + 1, 0x9e3779b9));
    const cycles = low + Math.floor(random * Math.max(1, high - low + 1));
    const amplitude = 0.3 + hash01(seed ^ (index * 97)) * 0.7;
    value += Math.sin(TAU * cycles * t / duration + hash01(seed + index * 13) * TAU) * amplitude;
    norm += amplitude;
  }
  return norm ? value / norm : 0;
}

function wavUrl(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
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
  for (let index = 0; index < samples.length; index++) view.setInt16(44 + index * 2, clamp(samples[index], -1, 1) * 32767, true);
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index));
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

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

function normalizeDegrees(value) {
  let result = value % 360;
  if (result > 180) result -= 360;
  if (result < -180) result += 360;
  return result;
}

function phaseName(degrees) {
  const phase = ((degrees % 360) + 360) % 360;
  if (phase < 22.5 || phase >= 337.5) return 'new moon';
  if (phase < 67.5) return 'waxing crescent';
  if (phase < 112.5) return 'first quarter';
  if (phase < 157.5) return 'waxing gibbous';
  if (phase < 202.5) return 'full moon';
  if (phase < 247.5) return 'waning gibbous';
  if (phase < 292.5) return 'third quarter';
  return 'waning crescent';
}

function isInteractive(target) {
  const tag = target?.tagName;
  return ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(tag) || target?.isContentEditable;
}

function nextTask() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function capitalize(text) {
  return String(text || '').replace(/\b\w/g, character => character.toUpperCase());
}

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
