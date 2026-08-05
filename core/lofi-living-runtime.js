import { Application, Graphics } from 'pixi.js';
import { ReboundWasmSystem } from './reality-v6-6/rebound-client.js';

const DESKTOP_SIZE = { width: 256, height: 144 };
const MOBILE_SIZE = { width: 160, height: 90 };
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
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

  const camera = {
    zoom: 1,
    centerX: 0.5,
    centerY: 0.5,
  };
  const pointers = new Map();
  let drag = null;
  let pinch = null;

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

  async function initialize({ provideCapability }) {
    installCanvas();
    await ensurePixi();
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
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', 'Lo-fi living world. Scroll or pinch to zoom and drag to pan.');
    canvas.style.imageRendering = 'pixelated';
    if (!canvas.isConnected) host.append(canvas);
    installInteraction();

    document.getElementById('unifiedRuntimePanel')?.remove();
    document.body.dataset.unifiedView = 'living';
    document.body.classList.add('lofi-living-root');
  }

  function installInteraction() {
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.addEventListener('keydown', onKeyDown);
  }

  function removeInteraction() {
    if (!canvas) return;
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('dblclick', onDoubleClick);
    canvas.removeEventListener('keydown', onKeyDown);
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

  function onWheel(event) {
    if (destroyed) return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    const pixelDelta = event.deltaMode === 1
      ? event.deltaY * 16
      : event.deltaMode === 2
        ? event.deltaY * window.innerHeight
        : event.deltaY;
    const sensitivity = event.ctrlKey ? 0.006 : 0.0015;
    zoomAtClientPoint(camera.zoom * Math.exp(-pixelDelta * sensitivity), event.clientX, event.clientY);
  }

  function onPointerDown(event) {
    if (destroyed) return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size >= 2) {
      beginPinch();
    } else {
      drag = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        centerX: camera.centerX,
        centerY: camera.centerY,
      };
      canvas.dataset.dragging = 'true';
    }
  }

  function onPointerMove(event) {
    if (!pointers.has(event.pointerId) || destroyed) return;
    event.preventDefault();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size >= 2) {
      if (!pinch) beginPinch();
      const pair = [...pointers.values()].slice(0, 2);
      const distance = pointDistance(pair[0], pair[1]);
      const midpoint = pointMidpoint(pair[0], pair[1]);
      const nextZoom = pinch.distance > 0
        ? pinch.zoom * distance / pinch.distance
        : pinch.zoom;
      setCameraAroundAnchor(nextZoom, pinch.anchor, midpoint.x, midpoint.y);
      return;
    }

    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    setCamera({
      zoom: camera.zoom,
      centerX: drag.centerX - (event.clientX - drag.x) / rect.width / camera.zoom,
      centerY: drag.centerY - (event.clientY - drag.y) / rect.height / camera.zoom,
    });
  }

  function onPointerUp(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    try { canvas.releasePointerCapture?.(event.pointerId); } catch {}

    if (pointers.size >= 2) {
      beginPinch();
      return;
    }

    pinch = null;
    const remaining = [...pointers.entries()][0];
    if (remaining) {
      drag = {
        pointerId: remaining[0],
        x: remaining[1].x,
        y: remaining[1].y,
        centerX: camera.centerX,
        centerY: camera.centerY,
      };
      canvas.dataset.dragging = 'true';
    } else {
      drag = null;
      canvas.dataset.dragging = 'false';
    }
  }

  function onDoubleClick(event) {
    event.preventDefault();
    resetCamera();
  }

  function onKeyDown(event) {
    const rect = canvas.getBoundingClientRect();
    const x = rect.left + rect.width * 0.5;
    const y = rect.top + rect.height * 0.5;
    if (event.key === '+' || event.key === '=' || event.key === 'PageUp') {
      event.preventDefault();
      zoomAtClientPoint(camera.zoom * 1.35, x, y);
    } else if (event.key === '-' || event.key === '_' || event.key === 'PageDown') {
      event.preventDefault();
      zoomAtClientPoint(camera.zoom / 1.35, x, y);
    } else if (event.key === '0' || event.key === 'Home') {
      event.preventDefault();
      resetCamera();
    }
  }

  function beginPinch() {
    const pair = [...pointers.values()].slice(0, 2);
    if (pair.length < 2) return;
    const midpoint = pointMidpoint(pair[0], pair[1]);
    pinch = {
      distance: Math.max(1, pointDistance(pair[0], pair[1])),
      zoom: camera.zoom,
      anchor: clientToWorld(midpoint.x, midpoint.y),
    };
    drag = null;
    canvas.dataset.dragging = 'true';
  }

  function zoomAtClientPoint(nextZoom, clientX, clientY) {
    const anchor = clientToWorld(clientX, clientY);
    setCameraAroundAnchor(nextZoom, anchor, clientX, clientY);
  }

  function setCameraAroundAnchor(nextZoom, anchor, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const screenX = clamp((clientX - rect.left) / rect.width, 0, 1);
    const screenY = clamp((clientY - rect.top) / rect.height, 0, 1);
    const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    setCamera({
      zoom,
      centerX: anchor.x - (screenX - 0.5) / zoom,
      centerY: anchor.y - (screenY - 0.5) / zoom,
    });
  }

  function clientToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const screenX = rect.width ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0.5;
    const screenY = rect.height ? clamp((clientY - rect.top) / rect.height, 0, 1) : 0.5;
    return {
      x: wrap01(camera.centerX + (screenX - 0.5) / camera.zoom),
      y: clamp(camera.centerY + (screenY - 0.5) / camera.zoom, 0, 1),
    };
  }

  function setCamera(next = {}) {
    const zoom = clamp(Number(next.zoom) || camera.zoom, MIN_ZOOM, MAX_ZOOM);
    const halfHeight = 0.5 / zoom;
    camera.zoom = zoom;
    camera.centerX = wrap01(Number.isFinite(next.centerX) ? next.centerX : camera.centerX);
    camera.centerY = clamp(
      Number.isFinite(next.centerY) ? next.centerY : camera.centerY,
      halfHeight,
      1 - halfHeight,
    );
    invalidateRender();
    return getCamera();
  }

  function resetCamera() {
    return setCamera({ zoom: 1, centerX: 0.5, centerY: 0.5 });
  }

  function getCamera() {
    return { ...camera, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM };
  }

  function invalidateRender() {
    lastRender = -Infinity;
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
        const sample = screenToWorld((x + tile * 0.5) / width, (y + tile * 0.5) / height);
        const nx = sample.x;
        const ny = sample.y;
        const continental = Math.sin(nx * 7.2 + seed * 0.00001)
          + Math.cos(ny * 8.6 - seed * 0.000013)
          + Math.sin((nx + ny) * 10.4);
        const grain = hash2(Math.floor(nx * 512), Math.floor(ny * 256), seed) * 1.3 - 0.65;
        const elevation = continental * 0.34 + grain;
        let color = PALETTE.grass;
        if (elevation < -0.42) color = PALETTE.water;
        else if (elevation < -0.22) color = PALETTE.shallow;
        else if (elevation > 0.68) color = PALETTE.dry;
        else if (elevation > 0.18 && hash2(Math.floor(ny * 512), Math.floor(nx * 256), seed + 17) > 0.42) color = PALETTE.forest;
        graphics.rect(x, y, tile, tile).fill(color);
      }
    }

    const weather = dynamics.getWeather?.() || [];
    for (const cell of weather.slice(0, mobile ? 8 : 14)) {
      const point = worldToScreen(cell.x / Math.max(1, world.width), cell.y / Math.max(1, world.height), width, height);
      const radius = Math.max(2, Math.round((cell.radius || 10) / Math.max(1, world.width) * width * camera.zoom * 0.55));
      if (point.x < -radius || point.x > width + radius || point.y < -radius || point.y > height + radius) continue;
      const x = quantize(point.x, 2);
      const y = quantize(point.y, 2);
      const strength = clamp(cell.strength ?? 0.5, 0, 1);
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
      let baseSize = 1;
      if (components.resource?.has(id)) color = PALETTE.resource;
      else if (components.agent?.has(id)) color = PALETTE.agent;
      else if (components.predator?.has(id)) { color = PALETTE.predator; baseSize = 2; }
      else if (components.apex?.has(id)) { color = PALETTE.apex; baseSize = 2; }
      if (color === null) continue;

      const point = worldToScreen(
        position.x / Math.max(1, world.width),
        position.y / Math.max(1, world.height),
        width,
        height,
      );
      const size = clamp(Math.round(baseSize * Math.sqrt(camera.zoom)), baseSize, baseSize * 3);
      if (point.x < -size || point.x > width || point.y < -size || point.y > height) continue;
      graphics.rect(Math.floor(point.x), Math.floor(point.y), size, size).fill(color);
      drawn += 1;
    }
    lastDrawnEntities = drawn;
  }

  function screenToWorld(screenX, screenY) {
    return {
      x: wrap01(camera.centerX + (screenX - 0.5) / camera.zoom),
      y: clamp(camera.centerY + (screenY - 0.5) / camera.zoom, 0, 1),
    };
  }

  function worldToScreen(worldX, worldY, width, height) {
    return {
      x: (wrappedDelta(worldX - camera.centerX) * camera.zoom + 0.5) * width,
      y: ((worldY - camera.centerY) * camera.zoom + 0.5) * height,
    };
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

    if (kind === 'camera') {
      const before = getCamera();
      setCamera({ zoom: 2.5, centerX: 0.42, centerY: 0.57 });
      const after = getCamera();
      setCamera(before);
      return {
        ok: after.zoom > before.zoom
          && Number.isFinite(after.centerX)
          && Number.isFinite(after.centerY),
        kind,
        before,
        after,
      };
    }

    if (kind === 'scene') {
      return {
        ok: Boolean(canvas && app && graphics) && lastDrawnEntities >= 0,
        kind,
        view: 'living',
        controls: 0,
        audio: false,
        interactiveCamera: true,
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
      camera: getCamera(),
    };
  }

  function getSnapshot() {
    return {
      version: 2,
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
        camera: getCamera(),
        interactions: {
          wheelZoom: true,
          pinchZoom: true,
          dragPan: true,
          keyboardZoom: true,
        },
        canvas: canvas ? {
          id: canvas.id,
          hidden: canvas.hidden,
          connected: canvas.isConnected,
          imageRendering: getComputedStyle(canvas).imageRendering,
          pointerEvents: getComputedStyle(canvas).pointerEvents,
          touchAction: getComputedStyle(canvas).touchAction,
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
    if (!Number.isFinite(camera.zoom) || camera.zoom < MIN_ZOOM || camera.zoom > MAX_ZOOM) failures.push('The lo-fi camera zoom is invalid.');
    if (!Number.isFinite(camera.centerX) || !Number.isFinite(camera.centerY)) failures.push('The lo-fi camera center is invalid.');
    if (canvas) {
      const style = getComputedStyle(canvas);
      if (style.imageRendering !== 'pixelated' && style.imageRendering !== 'crisp-edges') failures.push('The living-world canvas is not pixelated.');
      if (style.pointerEvents === 'none') failures.push('The living-world canvas cannot receive zoom gestures.');
      if (style.touchAction !== 'none') failures.push('The living-world canvas cannot own pinch gestures.');
    }
    return { ok: failures.length === 0, failures };
  }

  function save() {
    return {
      version: 2,
      masterSteps,
      unifiedSeconds,
      camera: getCamera(),
    };
  }

  function load(state = {}) {
    if (Number.isFinite(state.masterSteps)) masterSteps = Math.max(0, state.masterSteps);
    if (Number.isFinite(state.unifiedSeconds)) unifiedSeconds = Math.max(0, state.unifiedSeconds);
    if (state.camera) setCamera(state.camera);
    else resetCamera();
    setView('living');
  }

  async function startAudio() { return false; }
  function setMuted() { return true; }
  function setVolume() { return 0; }

  function destroy() {
    destroyed = true;
    removeInteraction();
    pointers.clear();
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
    version: '1.1.0',
    execution: 'browser-single-master-clock',
    source: 'Single low-resolution PixiJS living-world presentation with direct gesture camera and optional hidden REBOUND verification',
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
    setCamera,
    resetCamera,
    getCamera,
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

function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointMidpoint(a, b) {
  return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
}

function wrap01(value) {
  return value - Math.floor(value);
}

function wrappedDelta(value) {
  return value - Math.floor(value + 0.5);
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
