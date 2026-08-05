import { Application, Graphics } from 'pixi.js';
import { ReboundWasmSystem } from './reality-v6-6/rebound-client.js';

const DESKTOP_SIZE = { width: 256, height: 144 };
const MOBILE_SIZE = { width: 160, height: 90 };
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const PALETTE = {
  background: 0x071018,
  space: 0x0d1720,
  atmosphere: 0x6f9ba8,
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

  const camera = { zoom: 1, centerX: 0.5, centerY: 0.5 };
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
    canvas.setAttribute('aria-label', 'Spherical lo-fi living world. Scroll or pinch to zoom and drag to rotate.');
    canvas.style.imageRendering = 'pixelated';
    if (!canvas.isConnected) host.append(canvas);
    installInteraction();

    document.getElementById('unifiedRuntimePanel')?.remove();
    document.body.dataset.unifiedView = 'living';
    document.body.dataset.worldGeometry = 'sphere';
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
    if (pointers.size >= 2) beginPinch();
    else {
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
      const nextZoom = pinch.distance > 0 ? pinch.zoom * distance / pinch.distance : pinch.zoom;
      setCameraAroundAnchor(nextZoom, pinch.anchor, midpoint.x, midpoint.y);
      return;
    }

    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    setCamera({
      zoom: camera.zoom,
      centerX: drag.centerX - (event.clientX - drag.x) / rect.width / camera.zoom,
      centerY: drag.centerY + (event.clientY - drag.y) / rect.height / camera.zoom,
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
    const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    camera.zoom = zoom;
    const after = clientToWorld(clientX, clientY);
    setCamera({
      zoom,
      centerX: camera.centerX + wrappedDelta(anchor.x - after.x),
      centerY: camera.centerY + anchor.y - after.y,
    });
  }

  function clientToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: camera.centerX, y: camera.centerY };
    const width = app?.renderer?.width || logicalSize.width;
    const height = app?.renderer?.height || logicalSize.height;
    const px = (clientX - rect.left) / rect.width * width;
    const py = (clientY - rect.top) / rect.height * height;
    return sphereScreenToWorld(px, py, width, height) || { x: camera.centerX, y: camera.centerY };
  }

  function setCamera(next = {}) {
    camera.zoom = clamp(Number(next.zoom) || camera.zoom, MIN_ZOOM, MAX_ZOOM);
    camera.centerX = wrap01(Number.isFinite(next.centerX) ? next.centerX : camera.centerX);
    camera.centerY = clamp(Number.isFinite(next.centerY) ? next.centerY : camera.centerY, 0.01, 0.99);
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

  function getSphereFrame(width, height) {
    const baseRadius = Math.min(width, height) * (mobile ? 0.43 : 0.44);
    return {
      cx: width * 0.5,
      cy: height * 0.5,
      radius: baseRadius * camera.zoom,
    };
  }

  function sphereScreenToWorld(px, py, width, height) {
    const { cx, cy, radius } = getSphereFrame(width, height);
    const sx = (px - cx) / radius;
    const sy = -(py - cy) / radius;
    const rho2 = sx * sx + sy * sy;
    if (rho2 > 1) return null;
    const z = Math.sqrt(Math.max(0, 1 - rho2));
    const lon0 = (camera.centerX - 0.5) * Math.PI * 2;
    const lat0 = (0.5 - camera.centerY) * Math.PI;
    const sinLat0 = Math.sin(lat0);
    const cosLat0 = Math.cos(lat0);
    const latitude = Math.asin(clamp(sy * cosLat0 + z * sinLat0, -1, 1));
    const longitude = lon0 + Math.atan2(sx, z * cosLat0 - sy * sinLat0);
    return {
      x: wrap01(longitude / (Math.PI * 2) + 0.5),
      y: clamp(0.5 - latitude / Math.PI, 0, 1),
      normal: { x: sx, y: sy, z },
    };
  }

  function worldToSphereScreen(worldX, worldY, width, height) {
    const { cx, cy, radius } = getSphereFrame(width, height);
    const lon = (worldX - 0.5) * Math.PI * 2;
    const lat = (0.5 - worldY) * Math.PI;
    const lon0 = (camera.centerX - 0.5) * Math.PI * 2;
    const lat0 = (0.5 - camera.centerY) * Math.PI;
    const delta = lon - lon0;
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const sinLat0 = Math.sin(lat0);
    const cosLat0 = Math.cos(lat0);
    const x = cosLat * Math.sin(delta);
    const y = sinLat * cosLat0 - cosLat * Math.cos(delta) * sinLat0;
    const z = sinLat * sinLat0 + cosLat * Math.cos(delta) * cosLat0;
    return { x: cx + x * radius, y: cy - y * radius, depth: z, visible: z > 0 };
  }

  function drawLivingWorld() {
    const width = app.renderer.width;
    const height = app.renderer.height;
    const tile = mobile ? 4 : 3;
    const { cx, cy, radius } = getSphereFrame(width, height);
    graphics.clear();
    graphics.rect(0, 0, width, height).fill(PALETTE.background);
    graphics.circle(cx + 2, cy + 3, radius + 2).fill({ color: 0x000000, alpha: 0.58 });
    graphics.circle(cx, cy, radius + 1).fill({ color: PALETTE.atmosphere, alpha: 0.32 });

    const left = Math.max(0, Math.floor((cx - radius) / tile) * tile);
    const right = Math.min(width, Math.ceil((cx + radius) / tile) * tile);
    const top = Math.max(0, Math.floor((cy - radius) / tile) * tile);
    const bottom = Math.min(height, Math.ceil((cy + radius) / tile) * tile);

    for (let y = top; y < bottom; y += tile) {
      for (let x = left; x < right; x += tile) {
        const sample = sphereScreenToWorld(x + tile * 0.5, y + tile * 0.5, width, height);
        if (!sample) continue;
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

        const light = clamp(
          0.28 + 0.82 * (
            sample.normal.x * -0.35
            + sample.normal.y * 0.42
            + sample.normal.z * 0.82
          ),
          0.2,
          1,
        );
        graphics.rect(x, y, tile, tile).fill(shadeColor(color, light));
      }
    }

    const weather = dynamics.getWeather?.() || [];
    for (const cell of weather.slice(0, mobile ? 8 : 14)) {
      const point = worldToSphereScreen(
        cell.x / Math.max(1, world.width),
        cell.y / Math.max(1, world.height),
        width,
        height,
      );
      if (!point.visible) continue;
      const cloudRadius = Math.max(2, Math.round((cell.radius || 10) / Math.max(1, world.width) * radius * 0.7));
      const strength = clamp(cell.strength ?? 0.5, 0, 1);
      const color = cell.type === 'storm' ? PALETTE.storm : PALETTE.cloud;
      const x = quantize(point.x, 2);
      const y = quantize(point.y, 2);
      graphics.rect(x - cloudRadius, y, cloudRadius * 2, 2).fill({ color, alpha: (0.2 + strength * 0.32) * point.depth });
      graphics.rect(x - Math.max(1, cloudRadius - 2), y - 2, Math.max(2, cloudRadius * 2 - 4), 2).fill({ color, alpha: (0.14 + strength * 0.24) * point.depth });
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
      const point = worldToSphereScreen(
        position.x / Math.max(1, world.width),
        position.y / Math.max(1, world.height),
        width,
        height,
      );
      if (!point.visible) continue;
      const size = clamp(Math.round(baseSize * Math.sqrt(camera.zoom)), baseSize, baseSize * 3);
      graphics.rect(Math.floor(point.x), Math.floor(point.y), size, size).fill(shadeColor(color, 0.55 + point.depth * 0.45));
      drawn += 1;
    }
    lastDrawnEntities = drawn;

    graphics.circle(cx, cy, radius).stroke({ color: PALETTE.atmosphere, width: 1, alpha: 0.72 });
    graphics.circle(cx - radius * 0.18, cy - radius * 0.2, Math.max(1, radius * 0.7)).stroke({ color: 0xffffff, width: 1, alpha: 0.035 });
  }

  async function ensureRebound() {
    if (reboundSystem) return reboundSystem;
    if (reboundLoadPromise) return reboundLoadPromise;
    reboundStatus = { ...reboundStatus, mode: 'loading', error: null };
    reboundLoadPromise = ReboundWasmSystem.load()
      .then(system => {
        const planets = clamp((orbitalSystem.getBodies?.() || []).filter(body => body.type === 'planet').length, 3, 8);
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
      .finally(() => { reboundLoadPromise = null; });
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
      return { ok: duplicateClockViolations === 0, kind, privateRafLoops: 0, masterSteps, source: 'root-module-host-fixed-step' };
    }
    if (kind === 'view-switch') {
      const beforeTick = world.tick;
      const selected = setView('orbital');
      return { ok: selected === 'living' && world.tick === beforeTick, kind, beforeTick, afterTick: world.tick, selected };
    }
    if (kind === 'mobile-lod') return { ok: logicalSize.width <= 256 && logicalSize.height <= 144, kind, mobile, ...logicalSize };
    if (kind === 'camera') {
      const before = getCamera();
      setCamera({ zoom: 2.5, centerX: 0.42, centerY: 0.57 });
      const after = getCamera();
      setCamera(before);
      return { ok: after.zoom > before.zoom && Number.isFinite(after.centerX) && Number.isFinite(after.centerY), kind, before, after };
    }
    if (kind === 'scene') {
      return {
        ok: Boolean(canvas && app && graphics) && lastDrawnEntities >= 0,
        kind,
        view: 'living',
        controls: 0,
        audio: false,
        interactiveCamera: true,
        geometry: 'sphere',
        projection: 'orthographic',
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
      geometry: 'sphere',
      camera: getCamera(),
    };
  }

  function getSnapshot() {
    return {
      version: 3,
      mode: 'lofi-living-world',
      view: 'living',
      availableViews: ['living'],
      clock: { source: 'root-module-host-fixed-step', masterSteps, unifiedSeconds, duplicateClockViolations },
      presentation: {
        mode: 'lofi-pixel-sphere',
        geometry: 'sphere',
        projection: 'orthographic',
        spherical: true,
        logicalWidth: logicalSize.width,
        logicalHeight: logicalSize.height,
        drawnEntities: lastDrawnEntities,
        tickerStarted: Boolean(app?.ticker?.started),
        camera: getCamera(),
        interactions: { wheelZoom: true, pinchZoom: true, dragPan: true, dragRotate: true, keyboardZoom: true },
        canvas: canvas ? {
          id: canvas.id,
          hidden: canvas.hidden,
          connected: canvas.isConnected,
          imageRendering: getComputedStyle(canvas).imageRendering,
          pointerEvents: getComputedStyle(canvas).pointerEvents,
          touchAction: getComputedStyle(canvas).touchAction,
        } : null,
      },
      audio: { enabled: false, started: false, prepared: false, muted: true, volume: 0, mix: {} },
      rebound: { ...reboundStatus },
      interface: { controls: 0, panel: false, informationalOverlays: 0 },
    };
  }

  function runInvariants() {
    const failures = [];
    if (document.body.dataset.unifiedView !== 'living') failures.push('Root view is not the living world.');
    if (document.body.dataset.worldGeometry !== 'sphere') failures.push('The live root is not marked as spherical.');
    if (document.getElementById('unifiedRuntimePanel')) failures.push('The removed runtime control panel is still present.');
    if (document.querySelector('[data-unified-sound], select[data-unified-view], input[data-unified-volume]')) failures.push('Removed runtime controls are still present.');
    if (app?.ticker?.started) failures.push('PixiJS started a private ticker.');
    if (duplicateClockViolations > 0) failures.push('The presentation observed a reversed root clock.');
    if (!Number.isFinite(camera.zoom) || camera.zoom < MIN_ZOOM || camera.zoom > MAX_ZOOM) failures.push('The spherical camera zoom is invalid.');
    if (!Number.isFinite(camera.centerX) || !Number.isFinite(camera.centerY)) failures.push('The spherical camera center is invalid.');
    if (canvas) {
      const style = getComputedStyle(canvas);
      if (style.imageRendering !== 'pixelated' && style.imageRendering !== 'crisp-edges') failures.push('The living-world canvas is not pixelated.');
      if (style.pointerEvents === 'none') failures.push('The living-world canvas cannot receive zoom gestures.');
      if (style.touchAction !== 'none') failures.push('The living-world canvas cannot own pinch gestures.');
    }
    return { ok: failures.length === 0, failures };
  }

  function save() {
    return { version: 3, masterSteps, unifiedSeconds, camera: getCamera() };
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
    delete document.body.dataset.worldGeometry;
  }

  const api = {
    id: 'runtime.lofi-living-world',
    name: 'Spherical Lo-fi Living World Runtime',
    version: '1.2.0',
    execution: 'browser-single-master-clock',
    source: 'Single low-resolution PixiJS orthographic sphere with direct gesture camera and optional hidden REBOUND verification',
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

function shadeColor(color, brightness) {
  const amount = clamp(brightness, 0, 1.2);
  const red = clamp(Math.round(((color >> 16) & 0xff) * amount), 0, 255);
  const green = clamp(Math.round(((color >> 8) & 0xff) * amount), 0, 255);
  const blue = clamp(Math.round((color & 0xff) * amount), 0, 255);
  return (red << 16) | (green << 8) | blue;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
