const EYE_HEIGHT = 3.6;
const LEGACY_ALTITUDE = 52;
const MAX_ALTITUDE = 4200;
const CLIMB_SPEED = 58;
const FAST_CLIMB_SPEED = 920;
const WHEEL_SCALE_LOW = 0.28;
const WHEEL_SCALE_HIGH = 2.8;
const CAMERA_FAR = 42000;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

async function waitForMode() {
  for (let i = 0; i < 300; i++) {
    const mode = window.realitySandboxSurfaceMode;
    if (mode?.getPlayer && mode?.getStats && mode?.isActive) return mode;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  return null;
}

function install(mode) {
  if (window.realitySandboxSurfaceFlightV38?.installed) return;

  const nativeGetPlayer = mode.getPlayer.bind(mode);
  const nativeGetStats = mode.getStats.bind(mode);
  const keys = new Set();
  let virtualAltitude = EYE_HEIGHT;
  let activeLastFrame = false;
  let last = performance.now();
  let lastHudPatch = -Infinity;
  let wheelEvents = 0;
  let highFlightFrames = 0;

  mode.getPlayer = () => {
    const p = nativeGetPlayer();
    return { ...p, altitude: clamp(Math.max(EYE_HEIGHT, virtualAltitude), EYE_HEIGHT, MAX_ALTITUDE) };
  };
  mode.getStats = () => ({
    ...nativeGetStats(),
    extendedFlight: true,
    largePlanetFlight: true,
    maxAltitude: MAX_ALTITUDE,
    virtualAltitude,
    wheelAltitudeControl: true,
    fastClimbWithShift: true,
  });

  const tracked = new Set(['Space', 'ControlLeft', 'ControlRight', 'KeyC', 'ShiftLeft', 'ShiftRight']);
  window.addEventListener('keydown', event => {
    if (!mode.isActive?.() || !tracked.has(event.code)) return;
    keys.add(event.code);
  }, { passive: true });
  window.addEventListener('keyup', event => keys.delete(event.code));
  window.addEventListener('blur', () => keys.clear());

  window.addEventListener('wheel', event => {
    if (!mode.isActive?.() || document.documentElement.dataset.surfaceMode !== 'active') return;
    event.preventDefault();
    const base = nativeGetPlayer();
    if (!activeLastFrame) virtualAltitude = base.altitude || EYE_HEIGHT;
    const t = clamp((virtualAltitude - 120) / 1500, 0, 1);
    const wheelScale = WHEEL_SCALE_LOW + (WHEEL_SCALE_HIGH - WHEEL_SCALE_LOW) * t;
    virtualAltitude = clamp(virtualAltitude - event.deltaY * wheelScale, EYE_HEIGHT, MAX_ALTITUDE);
    wheelEvents++;
  }, { passive: false, capture: true });

  function updateHelp() {
    const hud = document.getElementById('surfaceModeHud');
    if (!hud) return;
    const divs = [...hud.querySelectorAll('div')];
    const help = divs.find(el => el.textContent?.includes('WASD move'));
    if (help && !help.dataset.v43FlightHelp) {
      help.dataset.v43FlightHelp = 'true';
      help.textContent = 'WASD move · mouse look · Space/Ctrl fly · Shift = rapid climb · wheel altitude · T sky time-lapse · Esc exit';
    }
  }

  function patchHudAltitude(now) {
    if (now - lastHudPatch < 160) return;
    lastHudPatch = now;
    const hud = document.getElementById('surfaceModeHud');
    if (!hud) return;
    const info = [...hud.querySelectorAll('div')].find(el => el.innerHTML?.includes('altitude +'));
    if (!info) return;
    info.innerHTML = info.innerHTML.replace(/altitude \+[0-9.]+/, `altitude +${Math.max(0, virtualAltitude - EYE_HEIGHT).toFixed(1)}`);
  }

  function loop(now) {
    requestAnimationFrame(loop);
    const active = mode.isActive?.() && document.documentElement.dataset.surfaceMode === 'active';
    if (!active) {
      activeLastFrame = false;
      last = now;
      return;
    }

    const base = nativeGetPlayer();
    if (!activeLastFrame) {
      activeLastFrame = true;
      virtualAltitude = base.altitude || EYE_HEIGHT;
      updateHelp();
      last = now;
    }

    const dt = clamp((now - last) / 1000, 0, 0.06);
    last = now;
    const fast = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const speed = fast ? FAST_CLIMB_SPEED : CLIMB_SPEED;
    if (keys.has('Space')) virtualAltitude += speed * dt;
    if (keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC')) virtualAltitude -= speed * dt;
    virtualAltitude = clamp(virtualAltitude, EYE_HEIGHT, MAX_ALTITUDE);

    if (virtualAltitude <= LEGACY_ALTITUDE && !keys.has('Space') && !keys.has('ControlLeft') && !keys.has('ControlRight') && !keys.has('KeyC')) {
      virtualAltitude = clamp(base.altitude || EYE_HEIGHT, EYE_HEIGHT, MAX_ALTITUDE);
    }

    if (virtualAltitude > LEGACY_ALTITUDE) highFlightFrames++;

    const hook = window.realitySandboxSurfaceLightHookV36?.getObjects?.();
    const camera = hook?.camera;
    const scene = hook?.scene;
    if (camera && camera.far !== CAMERA_FAR) {
      camera.far = CAMERA_FAR;
      camera.updateProjectionMatrix();
    }
    if (scene?.fog) {
      const t = clamp((virtualAltitude - LEGACY_ALTITUDE) / (MAX_ALTITUDE - LEGACY_ALTITUDE), 0, 1);
      scene.fog.near = 180 + t * 980;
      scene.fog.far = 1320 + t * 24600;
    }

    patchHudAltitude(now);
    document.documentElement.dataset.surfaceAltitudeV38 = virtualAltitude.toFixed(1);
  }
  requestAnimationFrame(loop);

  const api = {
    installed: true,
    getStats: () => ({
      extendedFlight: true,
      largePlanetFlight: true,
      maxAltitude: MAX_ALTITUDE,
      virtualAltitude,
      wheelEvents,
      highFlightFrames,
      cameraFar: window.realitySandboxSurfaceLightHookV36?.getObjects?.().camera?.far || null,
      legacyAltitudeCeiling: LEGACY_ALTITUDE,
      hudAltitudeSynced: true,
      altitudeScaleMultiplier: MAX_ALTITUDE / 480,
    }),
  };
  window.realitySandboxSurfaceFlightV38 = api;
  document.documentElement.dataset.surfaceFlightV38 = 'large-planet-extended-altitude';

  const prev = window.realitySandboxPresentationDiagnostics;
  window.realitySandboxPresentationDiagnostics = () => ({
    ...(typeof prev === 'function' ? prev() : {}),
    surfaceFlightV38: api.getStats(),
  });
}

waitForMode().then(mode => {
  if (!mode) {
    document.documentElement.dataset.surfaceFlightV38 = 'unavailable';
    return;
  }
  install(mode);
});
