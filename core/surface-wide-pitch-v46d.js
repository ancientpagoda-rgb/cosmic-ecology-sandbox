const MAX_PITCH = 1.50;
const POINTER_SENSITIVITY = 0.0019;
const DRAG_SENSITIVITY = 0.0032;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

async function waitForMode() {
  while (true) {
    const mode = window.realitySandboxSurfaceMode;
    if (mode?.getPlayer && mode?.getStats && mode?.isActive) return mode;
    await new Promise(resolve => setTimeout(resolve, 60));
  }
}

function install(mode) {
  if (window.realitySandboxSurfaceWidePitchV46d?.installed) return;

  const nativeGetPlayer = mode.getPlayer.bind(mode);
  const nativeGetStats = mode.getStats.bind(mode);
  let widePitch = 0;
  let activeLastFrame = false;
  let dragging = false;
  let dragY = 0;
  let pointerMoves = 0;
  let dragMoves = 0;

  mode.getPlayer = () => {
    const player = nativeGetPlayer();
    return { ...player, pitch: widePitch };
  };

  mode.getStats = () => ({
    ...nativeGetStats(),
    widePitchEnabled: true,
    widePitch,
    minPitch: -MAX_PITCH,
    maxPitch: MAX_PITCH,
    downwardViewDegrees: MAX_PITCH * 180 / Math.PI,
  });

  const canvas = () => document.getElementById('surfaceModeCanvas');
  const setPitch = value => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return widePitch;
    widePitch = clamp(numeric, -MAX_PITCH, MAX_PITCH);
    return widePitch;
  };

  document.addEventListener('mousemove', event => {
    if (!mode.isActive?.()) return;
    const input = canvas();
    if (input && document.pointerLockElement === input) {
      setPitch(widePitch - event.movementY * POINTER_SENSITIVITY);
      pointerMoves++;
      return;
    }
    if (!dragging) return;
    const dy = event.clientY - dragY;
    dragY = event.clientY;
    setPitch(widePitch - dy * DRAG_SENSITIVITY);
    dragMoves++;
  }, { capture: true });

  window.addEventListener('pointerdown', event => {
    if (!mode.isActive?.() || event.pointerType !== 'mouse') return;
    dragging = true;
    dragY = event.clientY;
  }, { capture: true });
  window.addEventListener('pointerup', () => { dragging = false; }, { capture: true });
  window.addEventListener('pointercancel', () => { dragging = false; }, { capture: true });
  window.addEventListener('blur', () => { dragging = false; });

  function loop() {
    requestAnimationFrame(loop);
    const active = Boolean(mode.isActive?.() && document.documentElement.dataset.surfaceMode === 'active');
    if (active && !activeLastFrame) {
      setPitch(Number(nativeGetPlayer()?.pitch) || 0);
      activeLastFrame = true;
    } else if (!active && activeLastFrame) {
      activeLastFrame = false;
      widePitch = 0;
    }
    if (active) document.documentElement.dataset.surfaceWidePitchV46d = widePitch.toFixed(4);
  }
  requestAnimationFrame(loop);

  const api = {
    installed: true,
    setPitch,
    getStats: () => ({
      installed: true,
      maxPitchRadians: MAX_PITCH,
      maxPitchDegrees: MAX_PITCH * 180 / Math.PI,
      currentPitch: widePitch,
      pointerMoves,
      dragMoves,
      nearVerticalDownView: true,
      nearVerticalUpView: true,
      avoidsLookAtSingularity: MAX_PITCH < Math.PI * 0.5,
    }),
  };

  window.realitySandboxSurfaceWidePitchV46d = api;
  document.documentElement.dataset.surfaceWidePitchModeV46d = 'near-vertical-86deg';
  const previousDiagnostics = window.realitySandboxPresentationDiagnostics;
  window.realitySandboxPresentationDiagnostics = () => ({
    ...(typeof previousDiagnostics === 'function' ? previousDiagnostics() : {}),
    surfaceWidePitchV46d: api.getStats(),
  });
}

waitForMode().then(install);
