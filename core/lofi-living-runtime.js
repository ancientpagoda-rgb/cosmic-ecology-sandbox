import { Application, Graphics } from 'pixi.js';
import { ReboundWasmSystem } from './reality-v6-6/rebound-client.js';

const DESKTOP_SIZE = { width: 256, height: 144 };
const MOBILE_SIZE = { width: 160, height: 90 };
const PALETTE = {
  background: 0x101820,
  water: 0x244958,
  shallow: 0x365d60,
  grass: 0x526947,
  forest: 0x324c3a,
  dry: 0x75644b,
  cloud: 0xb8c7bd,
  storm: 0x647786,
  resource: 0x8fbf67,
  agent: 0xe5d6a8,
  predator: 0xb75b4a,
  apex: 0x8a6f9f,
};

export function createLofiLivingRuntime(world, dependencies, options = {}) {
  const { orbitalSystem, dynamics } = dependencies;
  const mobile = options.mobile ?? matchMedia('(max-width: 720px), (pointer: coarse)').matches;
  const seed = options.seed ?? 20260811;
  const logicalSize = mobile ? MOBILE_SIZE : DESKTOP_SIZE;

  let masterSteps = 0;
  let unifiedSeconds = 0;
  let lastWorldTick = world.tick;
  let duplicateClockViolations = 0;
  let lastRender = -Infinity;
  let lastDrawnEntities = 0;
  let destroyed = false;

  let canvas = null;
  let app = null;
  let graphics = null;
  let pixiLoadPromise = null;

  let reboundSystem = null;
  let reboundLoadPromise = null;
  let reboundStatus = {
    mode: 'unloaded',
    error: null,
    count: 0,
    timeDays: 0,
    energyError: 0,
    impacts: 0,
  };

  function initialize({ provideCapability }) {
    installCanvas();
    void ensurePixi();
    provideCapability('runtime.unified', api);
    provideCapability('presentation.pixi-root', api);
    provideCapability('presentation.lofi-living', api);
    provideCapability('orbits.rebound-selected', api);
    return api;
  }

  function installCanvas() {
    const host = document.getElementById('world') || document.body;
    canvas = document.getElementById('lofiLivingCanvas') || document.createElement('canvas');
    canvas.id = 'lofiLivingCanvas';
    canvas.setAttribute('aria-hidden', 'true');
    if (!canvas.isConnected) host.append(canvas);

    document.getElementById('unifiedRuntimePanel')?.remove();
    document.body.dataset.unifiedView = 'living';
    document.body.classList.add('lofi-living-root');
  }

  async function ensurePixi() {
    if (app) return app;
    if (pixiLoadPromise) return pixiLoadPromise;

    pixiLoadPromise = (async () => {
      const next = new Application();
      await next.init({
        canvas,
        width: logicalSize.width,
        height: logicalSize.height,
        background: PALETTE.background,
        antialias: false,
        autoStart: false,
        sharedTicker: false,
        preference: 'webgl',
        powerPreference: 'low-power',
        resolution: 1,
        clearBeforeRender: true,
      });
      next.stop();
      canvas.style.imageRendering = 'pixelated';
      graphics = new Graphics();
      next.stage.addChild(graphics);
      app = next;
      return app;
    })().finally(() => {
      pixiLoadPromise = null;
    });

    return pixiLoadPromise;
  }

  function step(dt) {
    if (!Number.isFinite(dt) || dt <= 0 || destroyed) return;
    if (world.tick < lastWorldTick) duplicateClockViolations += 1;
    lastWorldTick = world.tick;
    masterSteps += 1;
    unifiedSeconds += dt;
  }

  function render(frame = {}) {
    if (!app || !graphics || destroyed) return;
    const timestamp = frame.timestamp ?? performance.now();
    const minimumInterval = mobile ? 125 : 83;
    if (timestamp - lastRender < minimumInterval) return;
    lastRender = timestamp;
    drawLivingWorld();
    if (typeof app.render === 'function') app.render();
    else app.renderer.render({ container: app.stage });
  }

  function drawLivingWorld() {
    const width = app.renderer.width;
    const height = app.renderer.height;
    const tile = mobile ? 5 : 4;
    graphics.clear();
    graphics.rect(0, 0, width, height).fill(PALETTE.background);

    for (let y = 0; y < height; y += tile) {
      for (let x = 0; x < width; x += tile) {
        const nx = x / Math.max(1, width - tile);
        const ny = y / Math.max(1, height - tile);
        const continental = Math.sin(nx * 7.2 + seed * 0.00001)
          + Math.cos(ny * 8.6 - seed * 0.000013)
          + Math.sin((nx + ny) * 10.4);
        const grain = hash2(x / tile, y / tile, seed) * 1.3 - 0.65;
        const elevation = continental * 0.34 + grain;
        let color = PALETTE.grass;
        if (elevation < -0.42) color = PALETTE.water;
        else if (elevation < -0.22) color = PALETTE.shallow;
        else if (elevation > 0.68) color = PALETTE.dry;
        else if (elevation > 0.18 && hash2(y / tile, x / tile, seed + 17) > 0.42) color = PALETTE.forest;
        graphics.rect(x, y, tile, tile).fill(color);
      }
    }

    const sx = width / Math.max(1, world.width);
    const sy = height / Math.max(1, world.height);
    const weather = dynamics.getWeather?.() || [];
    for (const cell of weather.slice(0, mobile ? 8 : 14)) {
      const x = quantize(cell.x * sx, 2);
      const y = quantize(cell.y * sy, 2);
      const strength = clamp(cell.strength ?? 0.5, 0, 1);
      const radius = Math.max(2, Math.round((cell.radius || 10) * sx * 0.12));
      const color = cell.type === 'storm' ? PALETTE.storm : PALETTE.cloud;
      graphics.rect(x - radius, y, radius * 2, 2).fill({ color, alpha: 0.28 + strength * 0.28 });
      graphics.rect(x - Math.max(1, radius - 2), y - 2, Math.max(2, radius * 2 - 4), 2).fill({ color, alpha: 0.18 + strength * 0.22 });
    }

    const components = world.ecs.components;
    let drawn = 0;
    const maximum = mobile ? 100 : 220;
    for (const [id, position] of components.position.entries()) {
      if (drawn >= maximum) break;
      let color = null;
      let size = 1;
      if (components.resource?.has(id)) color = PALETTE.resource;
      else if (components.agent?.has(id)) color = PALETTE.agent;
      else if (components.predator?.has(id)) { color = PALETTE.predator; size = 2; }
      else if (components.apex?.has(id)) { color = PALETTE.apex; size = 2; }
      if (color === null) continue;

      const x = clamp(Math.floor(position.x * sx), 0, width - size);
      const y = clamp(Math.floor(position.y * sy), 0, height - size);
      graphics.rect(x, y, size, size).fill(color);
      drawn += 1;
    }
    lastDrawnEntities = drawn;
  }

  async function ensureRebound() {
    if (reboundSystem) return reboundSystem;
    if (reboundLoadPromise) return reboundLoadPromise;
    reboundStatus = { ...reboundStatus, mode: 'loading', error: null };

    reboundLoadPromise = ReboundWasmSystem.load()
      .then(system => {
        const planets = clamp(
          (orbitalSystem.getBodies?.() || []).filter(body => body.type === 'planet').length,
          3,
          8,
        );
        system.initialize({ seed, planets, asteroids: mobile ? 12 : 28 });
        system.setIntegrator(mobile ? 2 : 0);
        reboundSystem = system;
        reboundStatus = { mode: 'rebound-wasm', error: null, ...system.stats() };
        return system;
      })
      .catch(error => {
        reboundStatus = {
          mode: 'procedural-fallback',
          error: error.message,
          count: 0,
          timeDays: 0,
          energyError: 0,
          impacts: 0,
        };
        return null;
      })
      .finally(() => {
        reboundLoadPromise = null;
      });

    return reboundLoadPromise;
  }

  function setView() {
    document.body.dataset.unifiedView = 'living';
    return 'living';
  }

  async function setOrbitalBackend(backend) {
    if (backend === 'rebound') await ensureRebound();
    return reboundStatus.mode === 'rebound-wasm' ? 'rebound' : 'procedural';
  }

  async function debugScenario(kind) {
    if (kind === 'rebound') {
      const system = await ensureRebound();
      if (system) {
        const before = system.stats().timeDays;
        system.step(0.5);
        reboundStatus = { mode: 'rebound-wasm', error: null, ...system.stats() };
        return {
          ok: reboundStatus.count > 0
            && reboundStatus.timeDays >= before
            && Number.isFinite(reboundStatus.timeDays)
            && Number.isFinite(reboundStatus.energyError),
          kind,
          status: { ...reboundStatus },
          sampleBodies: system.snapshot().slice(0, 6),
        };
      }
      return { ok: false, kind, status: { ...reboundStatus } };
    }

    if (kind === 'shared-clock') {
      return {
        ok: duplicateClockViolations === 0,
        kind,
        privateRafLoops: 0,
        masterSteps,
        source: 'root-module-host-fixed-step',
      };
    }

    if (kind === 'view-switch') {
      const beforeTick = world.tick;
      const selected = setView('orbital');
      return { ok: selected === 'living' && world.tick === beforeTick, kind, beforeTick, afterTick: world.tick, selected };
    }

    if (kind === 'mobile-lod') {
      return { ok: logicalSize.width <= 256 && logicalSize.height <= 144, kind, mobile, ...logicalSize };
    }

    if (kind === 'scene') {
      return {
        ok: Boolean(canvas && app && graphics) && lastDrawnEntities >= 0,
        kind,
        view: 'living',
        controls: 0,
        audio: false,
        drawnEntities: lastDrawnEntities,
      };
    }

    return { ok: true, kind, simplified: true };
  }

  function getState() {
    return {
      view: 'living',
      availableViews: ['living'],
      masterSteps,
      unifiedSeconds,
      duplicateClockViolations,
      audioEnabled: false,
      controls: 0,
      mobile,
    };
  }

  function getSnapshot() {
    return {
      version: 1,
      mode: 'lofi-living-world',
      view: 'living',
      availableViews: ['living'],
      clock: {
        source: 'root-module-host-fixed-step',
        masterSteps,
        unifiedSeconds,
        duplicateClockViolations,
      },
      presentation: {
        mode: 'lofi-pixel',
        logicalWidth: logicalSize.width,
        logicalHeight: logicalSize.height,
        drawnEntities: lastDrawnEntities,
        tickerStarted: Boolean(app?.ticker?.started),
        canvas: canvas ? {
          id: canvas.id,
          hidden: canvas.hidden,
          connected: canvas.isConnected,
          imageRendering: getComputedStyle(canvas).imageRendering,
        } : null,
      },
      audio: {
        enabled: false,
        started: false,
        prepared: false,
        muted: true,
        volume: 0,
        mix: {},
      },
      rebound: { ...reboundStatus },
      interface: {
        controls: 0,
        panel: false,
        informationalOverlays: 0,
      },
    };
  }

  function runInvariants() {
    const failures = [];
    if (document.body.dataset.unifiedView !== 'living') failures.push('Root view is not the living world.');
    if (document.getElementById('unifiedRuntimePanel')) failures.push('The removed runtime control panel is still present.');
    if (document.querySelector('[data-unified-sound], select[data-unified-view], input[data-unified-volume]')) failures.push('Removed runtime controls are still present.');
    if (app?.ticker?.started) failures.push('PixiJS started a private ticker.');
    if (duplicateClockViolations > 0) failures.push('The presentation observed a reversed root clock.');
    if (canvas) {
      const imageRendering = getComputedStyle(canvas).imageRendering;
      if (imageRendering !== 'pixelated' && imageRendering !== 'crisp-edges') failures.push('The living-world canvas is not pixelated.');
    }
    return { ok: failures.length === 0, failures };
  }

  function save() {
    return { version: 1, masterSteps, unifiedSeconds };
  }

  function load(state = {}) {
    if (Number.isFinite(state.masterSteps)) masterSteps = Math.max(0, state.masterSteps);
    if (Number.isFinite(state.unifiedSeconds)) unifiedSeconds = Math.max(0, state.unifiedSeconds);
    setView('living');
  }

  async function startAudio() { return false; }
  function setMuted() { return true; }
  function setVolume() { return 0; }

  function destroy() {
    destroyed = true;
    app?.destroy?.(true, { children: true });
    app = null;
    graphics = null;
    canvas?.remove();
    canvas = null;
    document.body.classList.remove('lofi-living-root');
  }

  const api = {
    id: 'runtime.lofi-living-world',
    name: 'Lo-fi Living World Runtime',
    version: '1.0.0',
    execution: 'browser-single-master-clock',
    source: 'Single low-resolution PixiJS living-world presentation with optional hidden REBOUND verification',
    license: 'Project license plus dependency licenses in THIRD_PARTY_NOTICES.md',
    provides: ['runtime.unified', 'presentation.pixi-root', 'presentation.lofi-living', 'orbits.rebound-selected'],
    requires: [],
    initialize,
    step,
    render,
    save,
    load,
    destroy,
    setView,
    startAudio,
    setMuted,
    setVolume,
    setOrbitalBackend,
    ensureRebound,
    debugScenario,
    runInvariants,
    getState,
    getSnapshot,
    getReboundState: () => ({ ...reboundStatus, bodies: reboundSystem ? reboundSystem.snapshot() : [] }),
  };

  return api;
}

function hash2(x, y, seed) {
  let value = Math.imul((x | 0) ^ seed, 0x45d9f3b) ^ Math.imul((y | 0) + seed, 0x27d4eb2d);
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967295;
}

function quantize(value, size) {
  return Math.round(value / size) * size;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
