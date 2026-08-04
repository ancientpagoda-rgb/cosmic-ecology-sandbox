import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';

const FIXED_STEP_SECONDS = 1 / 20;
const MAX_CATCHUP_STEPS = 4;
const IMPACT_LOG_KEY = 'reality-v6-6-impact-log';
const PALETTE_KEY = 'reality-v6-8-pixi-palette';
const FX_KEY = 'reality-v6-8-pixi-enabled';
const mobile = innerWidth < 720 || (navigator.deviceMemory && navigator.deviceMemory <= 4);

const PALETTES = {
  phosphor: {
    label: 'Phosphor', cloud: 0xb9ffd0, rain: 0x7bdcff, light: 0xffe38a,
    coast: 0xff9b73, danger: 0xff5e66, text: 0xd8ffe2, dim: 0x5e9570,
    star: 0xffef9b, planet: 0x75c9ff, moon: 0xd9e5ef, living: 0x79f2a6,
  },
  amber: {
    label: 'Amber', cloud: 0xffd28a, rain: 0xffa95f, light: 0xffefb0,
    coast: 0xff8a55, danger: 0xff4f3d, text: 0xffd88f, dim: 0x9e6e39,
    star: 0xffffbd, planet: 0xffb35e, moon: 0xe8c9a4, living: 0xd6f07a,
  },
  arctic: {
    label: 'Arctic', cloud: 0xe7f7ff, rain: 0x6ed8ff, light: 0xbef7ff,
    coast: 0xffc66f, danger: 0xff6f84, text: 0xd8f4ff, dim: 0x6093a8,
    star: 0xfff3a8, planet: 0x8ccfff, moon: 0xe8f1ff, living: 0x8ff0d0,
  },
  dusk: {
    label: 'Dusk', cloud: 0xe8c5ff, rain: 0x8da8ff, light: 0xffd36d,
    coast: 0xff9a76, danger: 0xff5e8a, text: 0xf4ddff, dim: 0x806596,
    star: 0xffe997, planet: 0xaa9cff, moon: 0xe6def5, living: 0x8de5b2,
  },
};
const PALETTE_ORDER = Object.keys(PALETTES);

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function loadPaletteName() {
  try {
    const stored = localStorage.getItem(PALETTE_KEY);
    if (PALETTES[stored]) return stored;
  } catch (_) {}
  return 'phosphor';
}

function loadEnabled() {
  try {
    return localStorage.getItem(FX_KEY) !== 'off';
  } catch (_) {
    return true;
  }
}

function saveSetting(key, value) {
  try { localStorage.setItem(key, value); } catch (_) {}
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

function hash01(seed, salt = 0) {
  let value = ((seed || 1) + Math.imul(salt + 1, 0x9e3779b9)) | 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return ((value ^ (value >>> 15)) >>> 0) / 4294967296;
}

function sortSettlements(simulation) {
  return [...(simulation?.settlements || [])]
    .sort((a, b) => (b.population || 0) - (a.population || 0))
    .slice(0, mobile ? 28 : 64);
}

function angularDarkness(settlement, state) {
  if (!state) return 0.45;
  const latitude = settlement.latitude;
  const longitude = settlement.longitude;
  const sunLatitude = state.subsolarLatitude * Math.PI / 180;
  const sunLongitude = state.subsolarLongitude * Math.PI / 180;
  const dot = Math.sin(latitude) * Math.sin(sunLatitude)
    + Math.cos(latitude) * Math.cos(sunLatitude) * Math.cos(longitude - sunLongitude);
  return clamp((-dot + 0.08) / 1.08, 0, 1);
}

function readImpactLog() {
  try {
    const parsed = JSON.parse(localStorage.getItem(IMPACT_LOG_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

export class PixiPresentation {
  constructor(canvas) {
    this.canvas = canvas;
    this.app = new Application();
    this.surfaceLayer = new Container();
    this.universeLayer = new Container();
    this.surfaceGraphics = {};
    this.universeGraphics = {};
    this.surfaceLabels = [];
    this.universeLabels = [];
    this.paletteName = loadPaletteName();
    this.palette = PALETTES[this.paletteName];
    this.enabled = loadEnabled();
    this.activeMode = 'surface';
    this.width = 1;
    this.height = 1;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.fixedTicks = 0;
    this.lastDataRefresh = 0;
    this.lastImpactRead = 0;
    this.cachedStorms = [];
    this.cachedSettlements = [];
    this.coastalRisk = new Map();
    this.knownImpactIds = new Set(readImpactLog().map((event) => event.id));
    this.surfaceBursts = [];
    this.universeBursts = [];
    this.lastUniverseImpacts = new Map();
    this.hidden = document.hidden;
    this.random = seededRandom(0x6819f00d);
    this.decorativeClouds = Array.from({ length: mobile ? 10 : 18 }, () => ({
      x: this.random(),
      y: 0.08 + this.random() * 0.62,
      speed: 0.0015 + this.random() * 0.0035,
      size: 0.7 + this.random() * 1.4,
      phase: this.random() * Math.PI * 2,
    }));
    this._loop = (time) => this.loop(time);
  }

  async init() {
    const initialScale = mobile ? 0.42 : 0.55;
    this.width = Math.max(320, Math.round(innerWidth * initialScale));
    this.height = Math.max(180, Math.round(innerHeight * initialScale));
    await this.app.init({
      canvas: this.canvas,
      width: this.width,
      height: this.height,
      backgroundAlpha: 0,
      antialias: false,
      autoStart: false,
      sharedTicker: false,
      preference: 'webgl',
      powerPreference: 'low-power',
      resolution: 1,
      clearBeforeRender: true,
    });
    this.app.stop();
    this.canvas.style.imageRendering = 'pixelated';
    this.canvas.style.pointerEvents = 'none';
    this.app.stage.addChild(this.surfaceLayer, this.universeLayer);
    this.createLayers();
    this.createLabels();
    this.applyPalette();
    this.resize();
    this.installControls();
    this.syncHost(true);
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden;
      this.lastTime = performance.now();
    });
    requestAnimationFrame(this._loop);
    return this;
  }

  createLayers() {
    for (const name of ['clouds', 'rain', 'lights', 'markers', 'impacts']) {
      const graphics = new Graphics();
      this.surfaceGraphics[name] = graphics;
      this.surfaceLayer.addChild(graphics);
    }
    for (const name of ['dust', 'markers', 'impacts']) {
      const graphics = new Graphics();
      this.universeGraphics[name] = graphics;
      this.universeLayer.addChild(graphics);
    }
  }

  createLabel(style) {
    const text = new Text({ text: '', style });
    text.anchor.set(0.5, 1);
    text.visible = false;
    text.roundPixels = true;
    return text;
  }

  makeTextStyle() {
    return new TextStyle({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: mobile ? 7 : 8,
      fontWeight: '600',
      fill: this.palette.text,
      align: 'center',
      letterSpacing: 0,
    });
  }

  createLabels() {
    const style = this.makeTextStyle();
    this.surfaceLabels = Array.from({ length: mobile ? 12 : 22 }, () => this.createLabel(style));
    this.universeLabels = Array.from({ length: mobile ? 14 : 28 }, () => this.createLabel(style));
    for (const label of this.surfaceLabels) this.surfaceLayer.addChild(label);
    for (const label of this.universeLabels) this.universeLayer.addChild(label);
  }

  applyPalette() {
    this.palette = PALETTES[this.paletteName] || PALETTES.phosphor;
    const style = this.makeTextStyle();
    for (const label of [...this.surfaceLabels, ...this.universeLabels]) label.style = style;
    document.documentElement.style.setProperty('--pixi-accent', `#${this.palette.text.toString(16).padStart(6, '0')}`);
    this.updateControlLabels();
  }

  cyclePalette() {
    const index = PALETTE_ORDER.indexOf(this.paletteName);
    this.paletteName = PALETTE_ORDER[(index + 1) % PALETTE_ORDER.length];
    saveSetting(PALETTE_KEY, this.paletteName);
    this.applyPalette();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    saveSetting(FX_KEY, this.enabled ? 'on' : 'off');
    this.canvas.style.display = this.enabled ? 'block' : 'none';
    this.updateControlLabels();
  }

  installControls() {
    for (const id of ['pixiPalette', 'pixiPaletteSystem']) {
      document.getElementById(id)?.addEventListener('click', () => this.cyclePalette());
    }
    for (const id of ['pixiFx', 'pixiFxSystem']) {
      document.getElementById(id)?.addEventListener('click', () => this.setEnabled(!this.enabled));
    }
    this.setEnabled(this.enabled);
  }

  updateControlLabels() {
    for (const id of ['pixiPalette', 'pixiPaletteSystem']) {
      const button = document.getElementById(id);
      if (button) button.textContent = `Palette ${this.palette?.label || this.paletteName}`;
    }
    for (const id of ['pixiFx', 'pixiFxSystem']) {
      const button = document.getElementById(id);
      if (button) button.textContent = this.enabled ? 'Pixel FX on' : 'Pixel FX off';
    }
  }

  resize() {
    const scale = mobile ? 0.42 : 0.55;
    this.width = Math.max(320, Math.round(innerWidth * scale));
    this.height = Math.max(180, Math.round(innerHeight * scale));
    this.app.renderer.resize(this.width, this.height);
    this.canvas.style.width = '100vw';
    this.canvas.style.height = '100vh';
  }

  syncHost(force = false) {
    const universeActive = document.body.classList.contains('system-active');
    const nextMode = universeActive ? 'universe' : 'surface';
    if (!force && nextMode === this.activeMode) return;
    this.activeMode = nextMode;
    this.surfaceLayer.visible = nextMode === 'surface';
    this.universeLayer.visible = nextMode === 'universe';
    const target = universeActive ? document.getElementById('systemPanel') : document.body;
    if (target && this.canvas.parentElement !== target) target.appendChild(this.canvas);
    this.canvas.classList.toggle('inside-system', universeActive);
  }

  loop(time) {
    requestAnimationFrame(this._loop);
    if (this.hidden || !this.enabled) return;
    this.syncHost();
    const delta = Math.min(0.25, Math.max(0, (time - this.lastTime) / 1000));
    this.lastTime = time;
    this.accumulator += delta;
    let steps = 0;
    while (this.accumulator >= FIXED_STEP_SECONDS && steps < MAX_CATCHUP_STEPS) {
      this.update(FIXED_STEP_SECONDS, time);
      this.accumulator -= FIXED_STEP_SECONDS;
      steps += 1;
    }
    if (steps > 0) this.render();
  }

  update(delta, now) {
    this.fixedTicks += 1;
    if (this.activeMode === 'surface') this.updateSurface(delta, now);
    else this.updateUniverse(delta, now);
  }

  render() {
    if (typeof this.app.render === 'function') this.app.render();
    else this.app.renderer.render({ container: this.app.stage });
  }

  refreshSurfaceData(now) {
    if (now - this.lastDataRefresh < 1800) return;
    this.lastDataRefresh = now;
    const weather = globalThis.realityV61?.weather;
    this.cachedStorms = weather?.stormSystems?.() || [];
    this.cachedSettlements = sortSettlements(globalThis.realityV6?.simulation);
    this.coastalRisk.clear();
    const coupling = globalThis.realityV65?.coupling;
    for (const settlement of coupling?.coastalSettlements?.() || []) {
      this.coastalRisk.set(settlement.id, settlement.tideRisk || 0);
    }
  }

  projectCesium(longitude, latitude, height = 90_000) {
    const viewer = globalThis.realityV6?.viewer;
    if (!viewer || !globalThis.Cesium) return null;
    const cartesian = Cesium.Cartesian3.fromDegrees(longitude, latitude, height);
    const toPoint = Cesium.Cartesian3.subtract(cartesian, viewer.camera.positionWC, new Cesium.Cartesian3());
    if (Cesium.Cartesian3.dot(toPoint, viewer.camera.directionWC) <= 0) return null;
    const point = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, cartesian);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const x = point.x * this.width / Math.max(1, innerWidth);
    const y = point.y * this.height / Math.max(1, innerHeight);
    if (x < -20 || x > this.width + 20 || y < -20 || y > this.height + 20) return null;
    return { x: Math.round(x), y: Math.round(y) };
  }

  hideLabels(labels) {
    for (const label of labels) label.visible = false;
  }

  showLabel(labels, index, text, x, y, tint = this.palette.text) {
    if (index >= labels.length) return index;
    const label = labels[index];
    label.text = text;
    label.position.set(Math.round(x), Math.round(y));
    label.tint = tint;
    label.visible = true;
    return index + 1;
  }

  pixelCloud(graphics, x, y, size, alpha = 0.72) {
    const width = Math.max(3, Math.round(5 * size));
    const height = Math.max(1, Math.round(2 * size));
    graphics.rect(x - width, y, width * 2, height).fill({ color: this.palette.cloud, alpha });
    graphics.rect(x - Math.round(width * 0.55), y - height, Math.round(width * 1.1), height).fill({ color: this.palette.cloud, alpha: alpha * 0.9 });
    graphics.rect(x - Math.round(width * 0.2), y - height * 2, Math.max(2, Math.round(width * 0.55)), height).fill({ color: this.palette.cloud, alpha: alpha * 0.78 });
  }

  pixelStorm(graphics, x, y, size, alpha, seed) {
    for (let lobe = 0; lobe < 3; lobe += 1) {
      const offsetX = Math.round((hash01(seed, lobe * 3) - 0.5) * size * 8);
      const offsetY = Math.round((hash01(seed, lobe * 3 + 1) - 0.5) * size * 4);
      const lobeSize = size * (0.5 + hash01(seed, lobe * 3 + 2) * 0.42);
      this.pixelCloud(graphics, x + offsetX, y + offsetY, lobeSize, alpha * (0.72 + lobe * 0.1));
    }
  }

  pixelBracket(graphics, x, y, radius, color, alpha = 0.92) {
    const arm = Math.max(2, Math.round(radius * 0.45));
    const r = Math.round(radius);
    const segments = [
      [x - r, y - r, arm, 1], [x - r, y - r, 1, arm],
      [x + r - arm, y - r, arm, 1], [x + r, y - r, 1, arm],
      [x - r, y + r, arm, 1], [x - r, y + r - arm, 1, arm],
      [x + r - arm, y + r, arm, 1], [x + r, y + r - arm, 1, arm],
    ];
    for (const [left, top, width, height] of segments) {
      graphics.rect(Math.round(left), Math.round(top), width, height).fill({ color, alpha });
    }
  }

  updateSurface(delta, now) {
    this.refreshSurfaceData(now);
    this.readSurfaceImpacts(now);
    const clouds = this.surfaceGraphics.clouds.clear();
    const rain = this.surfaceGraphics.rain.clear();
    const lights = this.surfaceGraphics.lights.clear();
    const markers = this.surfaceGraphics.markers.clear();
    const impacts = this.surfaceGraphics.impacts.clear();
    this.hideLabels(this.surfaceLabels);
    let labelIndex = 0;

    const cloudCover = (globalThis.realityV61?.weather?.latestStats?.cloudCover || 45) / 100;
    const decorativeCount = Math.round(this.decorativeClouds.length * clamp(cloudCover + 0.18, 0.2, 1));
    for (let index = 0; index < decorativeCount; index += 1) {
      const cloud = this.decorativeClouds[index];
      cloud.x = (cloud.x + cloud.speed * delta * 12) % 1.12;
      const x = Math.round((cloud.x - 0.06) * this.width);
      const y = Math.round(cloud.y * this.height + Math.sin(this.fixedTicks * 0.014 + cloud.phase) * 1.5);
      this.pixelCloud(clouds, x, y, cloud.size, 0.12 + cloudCover * 0.2);
    }

    const weather = globalThis.realityV61?.weather;
    for (let index = 0; index < Math.min(9, this.cachedStorms.length); index += 1) {
      const storm = this.cachedStorms[index];
      const position = weather?.stormPosition?.(storm) || storm;
      const point = this.projectCesium(position.longitude, position.latitude, 115_000);
      if (!point) continue;
      const size = 0.5 + storm.storm * 1.02;
      this.pixelStorm(clouds, point.x, point.y, size, 0.3 + storm.storm * 0.42, storm.shapeSeed);
      const drops = Math.round(1 + storm.precipitation * 5);
      for (let drop = 0; drop < drops; drop += 1) {
        const offset = ((drop * 7 + this.fixedTicks * 2) % 22) - 11;
        const phase = (drop * 5 + this.fixedTicks) % 9;
        const slant = Math.round(Math.cos(storm.windAngle) * phase * 0.35);
        rain.rect(point.x + offset + slant, point.y + 4 + phase, 1, 2 + Math.round(storm.precipitation * 2))
          .fill({ color: this.palette.rain, alpha: 0.35 + storm.precipitation * 0.55 });
      }
      if (storm.storm > 0.78) {
        labelIndex = this.showLabel(this.surfaceLabels, labelIndex, 'STORM', point.x, point.y - 8, this.palette.danger);
      }
    }

    const state = globalThis.realityV65?.coupling?.lastState;
    for (let index = 0; index < this.cachedSettlements.length; index += 1) {
      const settlement = this.cachedSettlements[index];
      const longitude = settlement.longitude * 180 / Math.PI;
      const latitude = settlement.latitude * 180 / Math.PI;
      const point = this.projectCesium(longitude, latitude, (settlement.heightMeters || 0) + 2500);
      if (!point) continue;
      const darkness = angularDarkness(settlement, state);
      const risk = this.coastalRisk.get(settlement.id) || 0;
      if (darkness > 0.08) {
        const size = clamp(1 + Math.log10((settlement.population || 0) + 10) * 0.28, 1, 3);
        lights.rect(point.x - Math.floor(size / 2), point.y - Math.floor(size / 2), Math.ceil(size), Math.ceil(size))
          .fill({ color: risk > 0.55 ? this.palette.coast : this.palette.light, alpha: 0.22 + darkness * 0.76 });
        if (darkness > 0.55 && settlement.population > 45_000 && labelIndex < this.surfaceLabels.length - 2) {
          labelIndex = this.showLabel(this.surfaceLabels, labelIndex, settlement.name.toUpperCase(), point.x, point.y - 3,
            risk > 0.55 ? this.palette.coast : this.palette.text);
        }
      }
      if (risk > 0.66) {
        const blink = 0.45 + (Math.sin(this.fixedTicks * 0.28 + index) + 1) * 0.24;
        this.pixelBracket(markers, point.x, point.y, 4, this.palette.danger, blink);
      }
    }

    if (state) {
      const sun = this.projectCesium(state.subsolarLongitude, state.subsolarLatitude, 150_000);
      if (sun) {
        markers.rect(sun.x - 2, sun.y - 2, 5, 5).fill({ color: this.palette.star, alpha: 0.9 });
        labelIndex = this.showLabel(this.surfaceLabels, labelIndex, 'SUN', sun.x, sun.y - 5, this.palette.star);
      }
      const moon = this.projectCesium(state.sublunarLongitude, state.sublunarLatitude, 155_000);
      if (moon) {
        this.pixelBracket(markers, moon.x, moon.y, 4, this.palette.moon, 0.82);
        labelIndex = this.showLabel(this.surfaceLabels, labelIndex, state.moonPhase?.toUpperCase?.() || 'MOON', moon.x, moon.y - 6, this.palette.moon);
      }
    }

    this.drawSurfaceBursts(impacts, delta);
  }

  readSurfaceImpacts(now) {
    if (now - this.lastImpactRead < 500) return;
    this.lastImpactRead = now;
    for (const event of readImpactLog()) {
      if (!event?.id || this.knownImpactIds.has(event.id)) continue;
      this.knownImpactIds.add(event.id);
      this.surfaceBursts.push({
        longitude: event.longitude,
        latitude: event.latitude,
        age: 0,
        duration: 2.4,
        seed: this.knownImpactIds.size * 17,
      });
    }
  }

  drawSurfaceBursts(graphics, delta) {
    for (const burst of this.surfaceBursts) burst.age += delta;
    this.surfaceBursts = this.surfaceBursts.filter((burst) => burst.age < burst.duration);
    for (const burst of this.surfaceBursts) {
      const point = this.projectCesium(burst.longitude, burst.latitude, 180_000);
      if (!point) continue;
      const progress = burst.age / burst.duration;
      const radius = 3 + progress * 28;
      const alpha = 1 - progress;
      this.pixelBracket(graphics, point.x, point.y, radius, this.palette.danger, alpha);
      for (let index = 0; index < 8; index += 1) {
        const angle = index / 8 * Math.PI * 2 + burst.seed;
        const distance = progress * (12 + index * 2);
        graphics.rect(
          Math.round(point.x + Math.cos(angle) * distance),
          Math.round(point.y + Math.sin(angle) * distance),
          1 + (index % 2),
          1 + ((index + 1) % 2),
        ).fill({ color: index % 2 ? this.palette.star : this.palette.danger, alpha });
      }
    }
  }

  projectThree(mesh, camera) {
    if (!mesh?.visible || !camera) return null;
    const vector = mesh.position.clone();
    mesh.getWorldPosition(vector);
    vector.project(camera);
    if (vector.z < -1 || vector.z > 1 || Math.abs(vector.x) > 1.08 || Math.abs(vector.y) > 1.08) return null;
    return {
      x: Math.round((vector.x * 0.5 + 0.5) * this.width),
      y: Math.round((-vector.y * 0.5 + 0.5) * this.height),
    };
  }

  projectThreeVector(vector, camera) {
    vector.project(camera);
    if (vector.z < -1 || vector.z > 1 || Math.abs(vector.x) > 1.08 || Math.abs(vector.y) > 1.08) return null;
    return {
      x: Math.round((vector.x * 0.5 + 0.5) * this.width),
      y: Math.round((-vector.y * 0.5 + 0.5) * this.height),
    };
  }

  updateUniverse(delta) {
    const dust = this.universeGraphics.dust.clear();
    const markers = this.universeGraphics.markers.clear();
    const impacts = this.universeGraphics.impacts.clear();
    this.hideLabels(this.universeLabels);
    let labelIndex = 0;
    const runtime = globalThis.realityV67;
    const universe = runtime?.universe;
    const camera = universe?.camera;
    if (!universe || !camera) return;

    for (let systemIndex = 0; systemIndex < universe.systems.length; systemIndex += 1) {
      const system = universe.systems[systemIndex];
      const groupPoint = this.projectThreeVector(system.group.position.clone(), camera);
      if (groupPoint && labelIndex < this.universeLabels.length) {
        labelIndex = this.showLabel(this.universeLabels, labelIndex, system.name.toUpperCase(), groupPoint.x, groupPoint.y - 12, this.palette.dim);
      }

      const asteroidLimit = mobile ? 22 : 52;
      const stride = Math.max(1, Math.floor(system.asteroidPositions.length / asteroidLimit));
      for (let index = 0; index < system.asteroidPositions.length; index += stride) {
        const vector = system.asteroidPositions[index].clone();
        system.group.localToWorld(vector);
        const point = this.projectThreeVector(vector, camera);
        if (!point) continue;
        dust.rect(point.x, point.y, 1, 1).fill({ color: this.palette.dim, alpha: 0.42 });
      }

      for (const [name, mesh] of system.meshes) {
        const point = this.projectThree(mesh, camera);
        if (!point) continue;
        const type = mesh.userData.bodyType;
        const radius = type === 0 ? 8 : type === 2 ? 6 : type === 3 ? 4 : 4;
        const color = type === 0
          ? this.palette.star
          : type === 2
            ? this.palette.living
            : type === 3
              ? this.palette.moon
              : this.palette.planet;
        this.pixelBracket(markers, point.x, point.y, radius, color, type === 2 ? 1 : 0.78);
        if (type === 0 || type === 2 || type === 3 || labelIndex < 8) {
          labelIndex = this.showLabel(this.universeLabels, labelIndex, name.toUpperCase(), point.x, point.y - radius - 2, color);
        }
      }
    }

    this.detectUniverseImpacts(runtime.systems || []);
    this.drawUniverseBursts(impacts, delta, camera);
  }

  detectUniverseImpacts(runtimes) {
    for (const runtime of runtimes) {
      const count = runtime.stats?.impacts || 0;
      const previous = this.lastUniverseImpacts.get(runtime.index);
      this.lastUniverseImpacts.set(runtime.index, count);
      if (previous === undefined || count <= previous) continue;
      const system = globalThis.realityV67?.universe?.systems?.[runtime.index];
      if (!system) continue;
      const targetType = runtime.stats?.impactTargetType;
      const target = [...system.meshes.values()].find((mesh) => mesh.userData.bodyType === targetType)
        || [...system.meshes.values()].find((mesh) => mesh.visible);
      if (target) this.universeBursts.push({ mesh: target, age: 0, duration: 1.8, seed: count * 13 });
    }
  }

  drawUniverseBursts(graphics, delta, camera) {
    for (const burst of this.universeBursts) burst.age += delta;
    this.universeBursts = this.universeBursts.filter((burst) => burst.age < burst.duration && burst.mesh?.parent);
    for (const burst of this.universeBursts) {
      const point = this.projectThree(burst.mesh, camera);
      if (!point) continue;
      const progress = burst.age / burst.duration;
      const radius = 4 + progress * 34;
      const alpha = 1 - progress;
      this.pixelBracket(graphics, point.x, point.y, radius, this.palette.danger, alpha);
      for (let index = 0; index < 10; index += 1) {
        const angle = index / 10 * Math.PI * 2 + burst.seed;
        const distance = progress * (14 + index * 2.2);
        graphics.rect(
          Math.round(point.x + Math.cos(angle) * distance),
          Math.round(point.y + Math.sin(angle) * distance),
          index % 3 === 0 ? 2 : 1,
          index % 3 === 1 ? 2 : 1,
        ).fill({ color: index % 2 ? this.palette.star : this.palette.danger, alpha });
      }
    }
  }

  triggerSurfaceImpact(event) {
    if (!event) return;
    this.surfaceBursts.push({
      longitude: event.longitude,
      latitude: event.latitude,
      age: 0,
      duration: 2.4,
      seed: this.fixedTicks,
    });
  }
}

export async function createPixiPresentation(canvas) {
  const presentation = new PixiPresentation(canvas);
  await presentation.init();
  return presentation;
}
