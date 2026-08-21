const BUILD = 'v88-default-spherical-input';
const html = document.documentElement;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrap = (value, max) => ((value % max) + max) % max;
const wrapAngle = value => ((value + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;

function deadzone(value, zone = 0.14) {
  const n = Number(value) || 0;
  const magnitude = Math.abs(n);
  if (magnitude <= zone) return 0;
  const normalized = (magnitude - zone) / Math.max(1e-6, 1 - zone);
  return Math.sign(n) * normalized * normalized;
}

async function waitForRenderer() {
  for (let attempt = 0; attempt < 360; attempt++) {
    const api = window.realitySandboxSingleSphericalRenderer;
    const canvas = document.getElementById('eidolonSingleWorldCanvas');
    const world = window.realitySandboxPlanet?.world;
    if (api?.installed && api?.getState && api?.setLocation && api?.setOrientation && api?.setAltitude && canvas && world) {
      return { api, canvas, world };
    }
    await new Promise(resolve => setTimeout(resolve, 35));
  }
  return null;
}

function install({ api, canvas, world }) {
  if (window.realitySandboxSphericalInputV88?.installed) return;

  let lastPointerType = 'mouse';
  let rawMouseX = 0;
  let rawMouseY = 0;
  let smoothMouseX = 0;
  let smoothMouseY = 0;
  let mouseFramePending = false;
  let activeGamepadIndex = null;
  let gamepadLabel = '';
  let previousInspect = false;
  let previousReset = false;
  let previousFrame = performance.now();

  const overlay = document.createElement('div');
  overlay.id = 'sphericalInputHelpV88';
  Object.assign(overlay.style, {
    position: 'absolute',
    left: '50%',
    bottom: 'max(18px, env(safe-area-inset-bottom))',
    transform: 'translateX(-50%)',
    zIndex: '8',
    maxWidth: 'min(760px, calc(100vw - 210px))',
    padding: '7px 10px',
    border: '1px solid rgba(228,244,238,.18)',
    borderRadius: '10px',
    background: 'rgba(5,12,10,.56)',
    color: '#edf7f1',
    font: '600 10px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    textAlign: 'center',
    textShadow: '0 1px 4px rgba(0,0,0,.8)',
    backdropFilter: 'blur(5px)',
    pointerEvents: 'none',
    opacity: '.84',
    transition: 'opacity 180ms ease',
  });

  const crosshair = document.createElement('div');
  crosshair.id = 'sphericalCrosshairV88';
  crosshair.textContent = '+';
  Object.assign(crosshair.style, {
    position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
    zIndex: '7', color: '#eef7ef', font: '300 19px/1 monospace', textShadow: '0 1px 4px #000',
    pointerEvents: 'none', opacity: '0', transition: 'opacity 120ms ease',
  });

  const host = canvas.parentElement || document.getElementById('world') || document.body;
  host.append(overlay, crosshair);

  function refreshHelp() {
    const locked = document.pointerLockElement === canvas;
    const state = api.getState();
    const mouseText = locked ? 'mouse captured · Esc releases' : state.altitude <= 80 ? 'click view for mouse-look' : 'drag globe · wheel altitude';
    const gamepadText = activeGamepadIndex == null
      ? 'gamepad ready'
      : `${gamepadLabel || 'gamepad'} · LS move · RS look · A/B altitude · Y inspect · Start ground view`;
    overlay.textContent = `WASD move · ${mouseText} · Shift sprint · E inspect · ${gamepadText}`;
    crosshair.style.opacity = locked ? '.72' : '0';
    canvas.style.cursor = locked ? 'none' : state.altitude <= 80 ? 'crosshair' : 'grab';
    html.dataset.sphericalMouseCaptured = String(locked);
  }

  function flushMouse() {
    mouseFramePending = false;
    if (document.pointerLockElement !== canvas) {
      rawMouseX = rawMouseY = smoothMouseX = smoothMouseY = 0;
      return;
    }
    smoothMouseX = smoothMouseX * 0.28 + rawMouseX * 0.72;
    smoothMouseY = smoothMouseY * 0.28 + rawMouseY * 0.72;
    rawMouseX = 0;
    rawMouseY = 0;

    if (Math.abs(smoothMouseX) > 0.01 || Math.abs(smoothMouseY) > 0.01) {
      const state = api.getState();
      api.setOrientation(
        wrapAngle(state.yaw + smoothMouseX * 0.00175),
        clamp(state.pitch - smoothMouseY * 0.00155, -0.72, 0.72),
      );
      if (Math.abs(smoothMouseX) > 0.04 || Math.abs(smoothMouseY) > 0.04) {
        mouseFramePending = true;
        requestAnimationFrame(flushMouse);
      }
    }
  }

  function onMouseMove(event) {
    if (document.pointerLockElement !== canvas || !event.isTrusted) return;
    rawMouseX += Number(event.movementX) || 0;
    rawMouseY += Number(event.movementY) || 0;
    if (!mouseFramePending) {
      mouseFramePending = true;
      requestAnimationFrame(flushMouse);
    }
  }

  canvas.addEventListener('pointerdown', event => {
    lastPointerType = event.pointerType || 'mouse';
  }, { capture: true });

  canvas.addEventListener('click', () => {
    if (lastPointerType !== 'mouse') return;
    if (api.getState().altitude > 80) return;
    if (document.pointerLockElement === canvas) return;
    try {
      const result = canvas.requestPointerLock?.();
      result?.catch?.(() => {});
    } catch {}
  });

  document.addEventListener('mousemove', onMouseMove, { capture: true });
  document.addEventListener('pointerlockchange', refreshHelp);

  window.addEventListener('keydown', event => {
    if (event.code === 'Escape' && document.pointerLockElement === canvas) {
      event.preventDefault();
      event.stopImmediatePropagation();
      document.exitPointerLock?.();
      return;
    }
    if (event.code === 'KeyE' && api.getState().altitude <= 95) {
      const rect = canvas.getBoundingClientRect();
      api.selectCreatureAt?.(rect.left + rect.width * 0.5, rect.top + rect.height * 0.5);
      event.preventDefault();
    }
  }, { capture: true });

  function currentGamepad() {
    const pads = navigator.getGamepads?.() || [];
    if (activeGamepadIndex != null && pads[activeGamepadIndex]?.connected) return pads[activeGamepadIndex];
    for (const pad of pads) {
      if (!pad?.connected) continue;
      activeGamepadIndex = pad.index;
      gamepadLabel = String(pad.id || 'Gamepad').replace(/\s*\([^)]*\)\s*$/, '').slice(0, 38);
      html.dataset.sphericalGamepad = 'connected';
      refreshHelp();
      return pad;
    }
    activeGamepadIndex = null;
    return null;
  }

  const button = (pad, index, threshold = 0.45) => {
    const value = pad?.buttons?.[index];
    return Boolean(value?.pressed || Number(value?.value) > threshold);
  };

  function applySphereTopology(x, y, yaw) {
    let sx = x;
    let sy = y;
    let nextYaw = yaw;
    while (sy < 0 || sy > world.height) {
      if (sy < 0) {
        sy = -sy;
        sx += world.width * 0.5;
        nextYaw += Math.PI;
      } else {
        sy = world.height - (sy - world.height);
        sx += world.width * 0.5;
        nextYaw += Math.PI;
      }
    }
    return { x: wrap(sx, world.width), y: clamp(sy, 0, world.height), yaw: wrapAngle(nextYaw) };
  }

  function updateGamepad(now) {
    requestAnimationFrame(updateGamepad);
    const dt = clamp((now - previousFrame) / 1000, 0, 0.05);
    previousFrame = now;
    const pad = currentGamepad();
    if (!pad) return;

    const state = api.getState();
    let moveX = deadzone(pad.axes?.[0]);
    let moveY = deadzone(pad.axes?.[1]);
    if (button(pad, 14)) moveX -= 1;
    if (button(pad, 15)) moveX += 1;
    if (button(pad, 12)) moveY -= 1;
    if (button(pad, 13)) moveY += 1;
    moveX = clamp(moveX, -1, 1);
    moveY = clamp(moveY, -1, 1);

    let yaw = state.yaw;
    let pitch = state.pitch;
    const lookX = deadzone(pad.axes?.[2], 0.12);
    const lookY = deadzone(pad.axes?.[3], 0.12);
    if (lookX || lookY) {
      yaw = wrapAngle(yaw + lookX * dt * 2.45);
      pitch = clamp(pitch - lookY * dt * 2.05, -0.72, 0.72);
      api.setOrientation(yaw, pitch);
    }

    if (state.altitude <= 95 && (Math.abs(moveX) > 0.02 || Math.abs(moveY) > 0.02)) {
      const magnitude = Math.max(1, Math.hypot(moveX, moveY));
      const strafe = moveX / magnitude;
      const forward = -moveY / magnitude;
      const sprint = Math.hypot(moveX, moveY) > 0.88 || button(pad, 10) || button(pad, 7, 0.7);
      const speed = sprint ? 24 : 8;
      const fx = Math.sin(yaw);
      const fy = -Math.cos(yaw);
      const rx = Math.cos(yaw);
      const ry = Math.sin(yaw);
      const topology = applySphereTopology(
        state.x + (fx * forward + rx * strafe) * speed * dt,
        state.y + (fy * forward + ry * strafe) * speed * dt,
        yaw,
      );
      api.setLocation(topology.x, topology.y);
      if (topology.yaw !== yaw) {
        yaw = topology.yaw;
        api.setOrientation(yaw, pitch);
      }
    }

    const altitudeDirection = (button(pad, 0) ? 1 : 0) - (button(pad, 1) ? 1 : 0);
    if (altitudeDirection) api.setAltitude(state.altitude + altitudeDirection * 18 * dt);

    const inspect = button(pad, 3);
    if (inspect && !previousInspect) {
      const rect = canvas.getBoundingClientRect();
      api.selectCreatureAt?.(rect.left + rect.width * 0.5, rect.top + rect.height * 0.5);
    }
    previousInspect = inspect;

    const reset = button(pad, 9);
    if (reset && !previousReset) {
      api.setAltitude(12);
      api.setOrientation(yaw, 0.02);
    }
    previousReset = reset;
  }

  window.addEventListener('gamepadconnected', event => {
    activeGamepadIndex = event.gamepad.index;
    gamepadLabel = String(event.gamepad.id || 'Gamepad').replace(/\s*\([^)]*\)\s*$/, '').slice(0, 38);
    html.dataset.sphericalGamepad = 'connected';
    refreshHelp();
  });

  window.addEventListener('gamepaddisconnected', event => {
    if (event.gamepad.index === activeGamepadIndex) activeGamepadIndex = null;
    html.dataset.sphericalGamepad = 'disconnected';
    refreshHelp();
  });

  const helpTimer = setInterval(refreshHelp, 900);
  refreshHelp();
  requestAnimationFrame(updateGamepad);

  window.realitySandboxSphericalInputV88 = {
    installed: true,
    build: BUILD,
    mouse: 'pointer-lock-smoothed-ground-look',
    gamepad: 'standard-dual-stick-analog',
    destroy() {
      clearInterval(helpTimer);
      document.removeEventListener('mousemove', onMouseMove, { capture: true });
      document.removeEventListener('pointerlockchange', refreshHelp);
      overlay.remove();
      crosshair.remove();
    },
  };
  html.dataset.sphericalInput = BUILD;
}

waitForRenderer().then(state => {
  if (!state) {
    html.dataset.sphericalInput = 'v88-unavailable';
    return;
  }
  install(state);
});
