const GLOBE_DESCENT_ZOOM = 10.4;
const GLOBE_HANDOFF_ZOOM = 8.8;
const GLOBE_NEAR_ZOOM = 12;
const EYE_ALTITUDE = 3.6;
const BLEND_START_ALTITUDE = 48;
const HANDOFF_ALTITUDE = 190;
const ALTITUDE_WHEEL_RATE = 0.00215;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const wrap01 = value => ((value % 1) + 1) % 1;

async function waitForWorldViewDependencies() {
  for (let attempt = 0; attempt < 360; attempt++) {
    const runtime = window.realitySandboxUnified;
    const planet = window.realitySandboxPlanet;
    const surface = window.realitySandboxSurfaceMode;
    const modules = window.realitySandboxModules;
    const globeCanvas = document.getElementById('lofiLivingCanvas');
    const surfaceCanvas = document.getElementById('surfaceModeCanvas');
    const surfaceLayer = document.getElementById('surfaceModeLayer');
    if (runtime?.getCamera && runtime?.setCamera && planet?.world && surface?.getPlayer && surface?.enterAt && surface?.exit && modules?.step && globeCanvas && surfaceCanvas && surfaceLayer) {
      return { runtime, planet, surface, modules, globeCanvas, surfaceCanvas, surfaceLayer };
    }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  return null;
}

function install({ runtime, planet, surface, modules, globeCanvas, surfaceCanvas, surfaceLayer }) {
  if (window.realitySandboxWorldView) return window.realitySandboxWorldView;

  const world = planet.world;
  const nativeGetPlayer = surface.getPlayer.bind(surface);
  const nativeModuleStep = modules.step;
  const hadWorldBudget = Object.prototype.hasOwnProperty.call(world, 'getSphericalStepDt');
  const nativeWorldBudget = world.getSphericalStepDt;

  let altitudeOverride = null;
  let lastLocalX = runtime.getCamera().centerX * world.width;
  let lastLocalY = runtime.getCamera().centerY * world.height;
  let transitionsToLocal = 0;
  let transitionsToGlobe = 0;
  let simulationRestores = 0;
  let lastRegime = 'globe';
  let installedAt = performance.now();

  surface.getPlayer = function unifiedWorldPlayer() {
    const player = nativeGetPlayer();
    if (surface.isActive?.() && Number.isFinite(altitudeOverride)) {
      return { ...player, altitude: altitudeOverride };
    }
    return player;
  };

  function pixelDelta(event) {
    if (event.deltaMode === 1) return event.deltaY * 16;
    if (event.deltaMode === 2) return event.deltaY * innerHeight;
    return event.deltaY;
  }

  function currentEffectivePlayer() {
    return surface.getPlayer();
  }

  function localBlend(altitude) {
    return clamp((altitude - BLEND_START_ALTITUDE) / (HANDOFF_ALTITUDE - BLEND_START_ALTITUDE), 0, 1);
  }

  function setLayerBlend(altitude) {
    if (!surface.isActive?.()) return 0;
    const blend = localBlend(altitude);
    // The globe remains alive underneath. Local terrain becomes transparent as
    // altitude rises, turning two renderer implementations into one visual LOD chain.
    surfaceLayer.style.opacity = String(clamp(1 - blend, 0.025, 1));
    surfaceLayer.style.pointerEvents = blend > 0.985 ? 'none' : 'auto';
    document.documentElement.dataset.worldViewBlend = blend.toFixed(4);
    return blend;
  }

  function syncGlobeToLocal(player = currentEffectivePlayer()) {
    if (!player) return;
    lastLocalX = player.x;
    lastLocalY = player.y;
    const blend = localBlend(player.altitude || EYE_ALTITUDE);
    const globeZoom = lerp(GLOBE_NEAR_ZOOM, GLOBE_HANDOFF_ZOOM, blend);
    runtime.setCamera({
      zoom: globeZoom,
      centerX: wrap01(player.x / world.width),
      centerY: clamp(player.y / world.height, 0.01, 0.99),
    });
    setLayerBlend(player.altitude || EYE_ALTITUDE);
  }

  function restoreContinuousSimulationIfNeeded() {
    if (!window.realitySandboxSurfaceSphereV37?.installed) return false;
    let changed = false;
    if (modules.step !== nativeModuleStep) {
      modules.step = nativeModuleStep;
      changed = true;
    }
    if (world.getSphericalStepDt !== nativeWorldBudget) {
      if (hadWorldBudget) world.getSphericalStepDt = nativeWorldBudget;
      else delete world.getSphericalStepDt;
      changed = true;
    }
    if (changed) simulationRestores++;
    document.documentElement.dataset.worldViewSimulation = 'continuous';
    return true;
  }

  function hideLegacyModeControls() {
    const enter = document.getElementById('enterSurfaceMode');
    if (enter) {
      enter.hidden = true;
      enter.style.display = 'none';
      enter.setAttribute('aria-hidden', 'true');
    }
    const hud = document.getElementById('surfaceModeHud');
    const exit = hud?.querySelector('button');
    if (exit) {
      exit.hidden = true;
      exit.style.display = 'none';
      exit.setAttribute('aria-hidden', 'true');
    }
    const help = hud?.children?.[2];
    if (help && help.textContent !== 'WASD move · mouse look · wheel changes altitude / scale · E scan life · Esc jumps outward') {
      help.textContent = 'WASD move · mouse look · wheel changes altitude / scale · E scan life · Esc jumps outward';
    }
  }

  function relabelLocalHud() {
    const hud = document.getElementById('surfaceModeHud');
    const info = hud?.children?.[0];
    if (!info || !info.innerHTML.includes('SURFACE MODE')) return;
    info.innerHTML = info.innerHTML.replace('SURFACE MODE · EIDOLON · SPHERE GPU', 'EIDOLON · CONTINUOUS LOCAL SCALE');
  }

  function enterLocalFromGlobe() {
    if (surface.isActive?.()) return;
    const camera = runtime.getCamera();
    lastLocalX = camera.centerX * world.width;
    lastLocalY = camera.centerY * world.height;
    altitudeOverride = HANDOFF_ALTITUDE * 0.92;
    surface.enterAt(lastLocalX, lastLocalY);
    transitionsToLocal++;
    document.documentElement.dataset.worldViewTransition = 'descending-to-local';
    // Auto-descending should never steal the pointer. A click on the local view
    // can still acquire pointer lock normally for mouse-look.
    queueMicrotask(() => {
      if (document.pointerLockElement === surfaceCanvas) document.exitPointerLock?.();
    });
    setTimeout(() => {
      if (document.pointerLockElement === surfaceCanvas) document.exitPointerLock?.();
    }, 80);
    syncGlobeToLocal();
  }

  function handoffToGlobe() {
    if (!surface.isActive?.()) return;
    const player = currentEffectivePlayer();
    lastLocalX = player.x;
    lastLocalY = player.y;
    runtime.setCamera({
      zoom: GLOBE_HANDOFF_ZOOM,
      centerX: wrap01(player.x / world.width),
      centerY: clamp(player.y / world.height, 0.01, 0.99),
    });
    altitudeOverride = null;
    surface.exit();
    surfaceLayer.style.opacity = '0';
    surfaceLayer.style.pointerEvents = 'none';
    transitionsToGlobe++;
    document.documentElement.dataset.worldViewTransition = 'orbital';
  }

  function onGlobeWheelCapture(event) {
    if (surface.isActive?.()) return;
    const delta = pixelDelta(event);
    if (!(delta < 0)) return;
    const camera = runtime.getCamera();
    if (camera.zoom < GLOBE_DESCENT_ZOOM) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    enterLocalFromGlobe();
  }

  function onSurfaceWheelCapture(event) {
    if (!surface.isActive?.()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const delta = pixelDelta(event);
    const player = currentEffectivePlayer();
    const current = Number.isFinite(altitudeOverride) ? altitudeOverride : Math.max(EYE_ALTITUDE, player.altitude || EYE_ALTITUDE);
    const next = clamp(current * Math.exp(delta * ALTITUDE_WHEEL_RATE), EYE_ALTITUDE, HANDOFF_ALTITUDE);
    altitudeOverride = next;
    document.documentElement.dataset.worldViewAltitude = next.toFixed(3);
    syncGlobeToLocal({ ...player, altitude: next });
    if (delta > 0 && next >= HANDOFF_ALTITUDE * 0.995) handoffToGlobe();
  }

  function onEscapeCapture(event) {
    if (event.code !== 'Escape' || !surface.isActive?.()) return;
    // Keep Escape as an emergency way out, but make it an altitude jump within
    // the same world-view controller instead of exposing a separate mode.
    event.preventDefault();
    event.stopImmediatePropagation();
    altitudeOverride = HANDOFF_ALTITUDE;
    handoffToGlobe();
  }

  globeCanvas.addEventListener('wheel', onGlobeWheelCapture, { capture: true, passive: false });
  surfaceCanvas.addEventListener('wheel', onSurfaceWheelCapture, { capture: true, passive: false });
  window.addEventListener('keydown', onEscapeCapture, { capture: true });

  function frame() {
    if (!document.documentElement.isConnected) return;
    hideLegacyModeControls();
    restoreContinuousSimulationIfNeeded();

    if (surface.isActive?.()) {
      const player = currentEffectivePlayer();
      if (!Number.isFinite(altitudeOverride)) altitudeOverride = Math.max(EYE_ALTITUDE, player.altitude || EYE_ALTITUDE);
      syncGlobeToLocal({ ...player, altitude: altitudeOverride });
      relabelLocalHud();
      lastRegime = localBlend(altitudeOverride) > 0 ? 'transition' : 'local';
    } else {
      altitudeOverride = null;
      lastRegime = runtime.getCamera().zoom < 0.68 ? 'cosmic' : 'globe';
      surfaceLayer.style.pointerEvents = 'none';
    }
    document.documentElement.dataset.worldViewRegime = lastRegime;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const api = {
    version: 1,
    model: 'single-authoritative-location-altitude-continuous-lod-view',
    enterLocal: enterLocalFromGlobe,
    jumpOutward: handoffToGlobe,
    getSnapshot() {
      const player = surface.isActive?.() ? currentEffectivePlayer() : null;
      const camera = runtime.getCamera();
      const enter = document.getElementById('enterSurfaceMode');
      const exit = document.getElementById('surfaceModeHud')?.querySelector('button');
      return {
        version: 1,
        model: 'single-authoritative-location-altitude-continuous-lod-view',
        regime: lastRegime,
        localRendererActive: Boolean(surface.isActive?.()),
        altitude: player?.altitude ?? null,
        blend: player ? localBlend(player.altitude || EYE_ALTITUDE) : 1,
        location: player
          ? { x: player.x, y: player.y, nx: wrap01(player.x / world.width), ny: clamp(player.y / world.height, 0, 1) }
          : { x: camera.centerX * world.width, y: camera.centerY * world.height, nx: camera.centerX, ny: camera.centerY },
        globeCamera: camera,
        transitionsToLocal,
        transitionsToGlobe,
        simulationRestores,
        simulationContinuous: window.realitySandboxSurfaceSphereV37?.installed ? modules.step === nativeModuleStep && world.getSphericalStepDt === nativeWorldBudget : true,
        legacyModeControlsVisible: Boolean((enter && getComputedStyle(enter).display !== 'none') || (exit && getComputedStyle(exit).display !== 'none')),
        rendererPolicy: 'globe-and-local-renderers-are-private-lod-backends',
        installedAt,
      };
    },
    destroy() {
      globeCanvas.removeEventListener('wheel', onGlobeWheelCapture, true);
      surfaceCanvas.removeEventListener('wheel', onSurfaceWheelCapture, true);
      window.removeEventListener('keydown', onEscapeCapture, true);
      surface.getPlayer = nativeGetPlayer;
    },
  };

  planet.worldView = api;
  window.realitySandboxWorldView = api;
  document.body.dataset.worldViewSystem = 'single-continuous-altitude-lod';
  document.documentElement.dataset.worldViewReady = 'true';
  window.dispatchEvent(new CustomEvent('eidolon-world-view-ready', { detail: api.getSnapshot() }));
  return api;
}

async function boot() {
  const dependencies = await waitForWorldViewDependencies();
  if (!dependencies) {
    document.documentElement.dataset.worldViewReady = 'false';
    return;
  }
  try {
    install(dependencies);
  } catch (error) {
    console.warn('[continuous-world-view] disabled:', error);
    document.documentElement.dataset.worldViewReady = 'false';
  }
}

boot();
