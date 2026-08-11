const EYE_HEIGHT = 3.6;
const TERRAIN_CEILING = 52;
const GLOBE_HANDOFF_ZOOM = 11.25;
const GLOBE_RETURN_ZOOM = 11.55;
const ALTITUDE_WHEEL_RATE = 0.06;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrap = (value, max) => ((value % max) + max) % max;

async function waitForDependencies() {
  for (let attempt = 0; attempt < 360; attempt++) {
    const runtime = window.realitySandboxUnified;
    const planet = window.realitySandboxPlanet;
    const surface = window.realitySandboxSurfaceMode;
    const canvas = document.getElementById('lofiLivingCanvas');
    if (runtime?.getCamera && runtime?.setCamera && planet?.world && surface?.getPlayer && surface?.enterAt && surface?.exit && canvas) {
      return { runtime, planet, surface, canvas };
    }
    await new Promise(resolve => setTimeout(resolve, 35));
  }
  return null;
}

function install({ runtime, planet, surface, canvas }) {
  if (window.realitySandboxPlanetCamera) return window.realitySandboxPlanetCamera;

  const world = planet.world;
  const originalGetPlayer = surface.getPlayer.bind(surface);
  const originalEnterAt = surface.enterAt.bind(surface);
  const originalEnter = surface.enter.bind(surface);
  const originalExit = surface.exit.bind(surface);

  const camera = {
    x: runtime.getCamera().centerX * world.width,
    y: runtime.getCamera().centerY * world.height,
    yaw: 0,
    pitch: 0.23,
    altitude: TERRAIN_CEILING,
    tier: 'globe',
  };

  let altitudeOwned = false;
  let transitions = 0;
  let globeToTerrainTransitions = 0;
  let terrainToGlobeTransitions = 0;
  let wheelAltitudeChanges = 0;
  let lastTransitionAt = 0;
  let destroyed = false;

  const style = document.createElement('style');
  style.id = 'eidolonContinuousPlanetCameraStyle';
  style.textContent = `
    #enterSurfaceMode,
    #surfaceModeHud > button,
    #surfaceModeHud > div:not(:last-child) { display: none !important; }
    #surfaceModeLayer { transition: opacity 180ms ease !important; }
  `;
  document.head.append(style);

  function setTier(tier) {
    camera.tier = tier;
    document.documentElement.dataset.planetCameraTier = tier;
    document.documentElement.dataset.planetNavigation = 'continuous-spherical-altitude';
  }

  function syncFromPrivatePlayer() {
    if (!surface.isActive?.()) return;
    const privatePlayer = originalGetPlayer();
    if (!privatePlayer) return;
    if (Number.isFinite(privatePlayer.x)) camera.x = wrap(privatePlayer.x, world.width);
    if (Number.isFinite(privatePlayer.y)) camera.y = clamp(privatePlayer.y, 0, world.height);
    if (Number.isFinite(privatePlayer.yaw)) camera.yaw = privatePlayer.yaw;
    if (Number.isFinite(privatePlayer.pitch)) camera.pitch = privatePlayer.pitch;
    if (!altitudeOwned && Number.isFinite(privatePlayer.altitude)) camera.altitude = clamp(privatePlayer.altitude, EYE_HEIGHT, TERRAIN_CEILING);
  }

  function publicPlayer() {
    syncFromPrivatePlayer();
    return {
      x: camera.x,
      y: camera.y,
      yaw: camera.yaw,
      pitch: camera.pitch,
      altitude: camera.altitude,
    };
  }

  // The terrain renderer and all optional surface visual layers consume this
  // getter. Redirecting it makes altitude one camera property instead of a
  // private property owned by a second navigation mode.
  surface.getPlayer = publicPlayer;

  function enterTerrainAt(x, y, altitude = EYE_HEIGHT) {
    camera.x = wrap(Number(x) || 0, world.width);
    camera.y = clamp(Number(y) || 0, 0, world.height);
    camera.altitude = clamp(Number(altitude) || EYE_HEIGHT, EYE_HEIGHT, TERRAIN_CEILING);
    altitudeOwned = true;
    originalEnterAt(camera.x, camera.y);
    syncFromPrivatePlayer();
    camera.altitude = clamp(Number(altitude) || EYE_HEIGHT, EYE_HEIGHT, TERRAIN_CEILING);
    setTier(camera.altitude > 34 ? 'atmosphere' : camera.altitude > 11 ? 'aerial' : 'terrain');
    transitions++;
    globeToTerrainTransitions++;
    lastTransitionAt = performance.now();
    return getState();
  }

  function enterFromGlobe() {
    const globe = runtime.getCamera();
    return enterTerrainAt(globe.centerX * world.width, globe.centerY * world.height, TERRAIN_CEILING);
  }

  function returnToGlobe(zoom = GLOBE_RETURN_ZOOM) {
    syncFromPrivatePlayer();
    const centerX = wrap(camera.x, world.width) / world.width;
    const centerY = clamp(camera.y / world.height, 0.01, 0.99);
    if (surface.isActive?.()) originalExit();
    altitudeOwned = false;
    runtime.setCamera({ centerX, centerY, zoom: clamp(zoom, GLOBE_HANDOFF_ZOOM, 12) });
    setTier('globe');
    transitions++;
    terrainToGlobeTransitions++;
    lastTransitionAt = performance.now();
    canvas.focus?.({ preventScroll: true });
    return getState();
  }

  // Keep the compatibility API for existing tests/tools, but route it through
  // the single planet camera. There is no separate player-facing Enter/Exit UI.
  surface.enterAt = (x, y) => enterTerrainAt(x, y, EYE_HEIGHT);
  surface.enter = () => {
    const globe = runtime.getCamera();
    return enterTerrainAt(globe.centerX * world.width, globe.centerY * world.height, EYE_HEIGHT);
  };
  surface.exit = () => returnToGlobe();

  function normalizedWheelDelta(event) {
    return event.deltaMode === 1
      ? event.deltaY * 16
      : event.deltaMode === 2
        ? event.deltaY * innerHeight
        : event.deltaY;
  }

  function onWheel(event) {
    if (destroyed) return;
    const delta = normalizedWheelDelta(event);

    if (surface.isActive?.()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      syncFromPrivatePlayer();
      altitudeOwned = true;
      const previous = camera.altitude;
      camera.altitude = clamp(camera.altitude + delta * ALTITUDE_WHEEL_RATE, EYE_HEIGHT, TERRAIN_CEILING);
      if (camera.altitude !== previous) wheelAltitudeChanges++;

      if (delta > 0 && camera.altitude >= TERRAIN_CEILING - 0.05) {
        returnToGlobe();
        return;
      }
      setTier(camera.altitude > 34 ? 'atmosphere' : camera.altitude > 11 ? 'aerial' : 'terrain');
      return;
    }

    const globe = runtime.getCamera();
    if (delta < 0 && globe.zoom >= GLOBE_HANDOFF_ZOOM) {
      event.preventDefault();
      event.stopImmediatePropagation();
      enterFromGlobe();
    }
  }

  function onKeyDown(event) {
    if (!surface.isActive?.()) return;
    if (event.code === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      returnToGlobe();
    }
  }

  // Capture before the legacy globe/surface listeners. Those listeners remain
  // as rendering/input backends, but scale transitions belong to this camera.
  window.addEventListener('wheel', onWheel, { capture: true, passive: false });
  window.addEventListener('keydown', onKeyDown, { capture: true });

  function frame() {
    if (destroyed) return;
    if (surface.isActive?.()) syncFromPrivatePlayer();
    else {
      const globe = runtime.getCamera();
      camera.x = globe.centerX * world.width;
      camera.y = globe.centerY * world.height;
      camera.altitude = TERRAIN_CEILING;
      setTier(globe.zoom < 0.68 ? 'cosmic' : 'globe');
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function getState() {
    const globe = runtime.getCamera();
    return {
      version: 1,
      model: 'one-spherical-camera-altitude-driven-render-lod',
      location: {
        x: camera.x,
        y: camera.y,
        longitude: camera.x / world.width * 360 - 180,
        latitude: 90 - camera.y / world.height * 180,
      },
      orientation: { yaw: camera.yaw, pitch: camera.pitch },
      altitude: camera.altitude,
      tier: camera.tier,
      detailedTerrainActive: Boolean(surface.isActive?.()),
      globeZoom: globe.zoom,
      handoffZoom: GLOBE_HANDOFF_ZOOM,
      terrainCeiling: TERRAIN_CEILING,
      transitions,
      globeToTerrainTransitions,
      terrainToGlobeTransitions,
      wheelAltitudeChanges,
      lastTransitionAt,
      enterExitUi: false,
      navigationSystems: 1,
    };
  }

  function setAltitude(value) {
    const altitude = clamp(Number(value) || EYE_HEIGHT, EYE_HEIGHT, TERRAIN_CEILING);
    if (!surface.isActive?.()) enterFromGlobe();
    altitudeOwned = true;
    camera.altitude = altitude;
    setTier(camera.altitude > 34 ? 'atmosphere' : camera.altitude > 11 ? 'aerial' : 'terrain');
    return getState();
  }

  function destroy() {
    destroyed = true;
    window.removeEventListener('wheel', onWheel, { capture: true });
    window.removeEventListener('keydown', onKeyDown, { capture: true });
    style.remove();
    surface.getPlayer = originalGetPlayer;
    surface.enterAt = originalEnterAt;
    surface.enter = originalEnter;
    surface.exit = originalExit;
  }

  const api = {
    version: 1,
    model: 'one-spherical-camera-altitude-driven-render-lod',
    getState,
    getPlayer: publicPlayer,
    setAltitude,
    enterTerrainAt,
    returnToGlobe,
    destroy,
  };

  window.realitySandboxPlanetCamera = api;
  planet.planetCamera = api;
  setTier(runtime.getCamera().zoom < 0.68 ? 'cosmic' : 'globe');
  window.dispatchEvent(new CustomEvent('eidolon-continuous-planet-camera-ready', { detail: getState() }));
  return api;
}

async function boot() {
  const dependencies = await waitForDependencies();
  if (!dependencies) {
    document.documentElement.dataset.planetNavigation = 'continuous-camera-failed';
    return;
  }
  install(dependencies);
}

boot();
