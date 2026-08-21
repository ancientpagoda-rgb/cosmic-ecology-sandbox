const BUILD = 'v87-mouse-gamepad';
const html = document.documentElement;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const deadzone = (value, zone = 0.16) => {
  const magnitude = Math.abs(Number(value) || 0);
  if (magnitude <= zone) return 0;
  const normalized = (magnitude - zone) / (1 - zone);
  return Math.sign(value) * normalized * normalized;
};

async function waitForSurface() {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const mode = window.realitySandboxSurfaceMode;
    const canvas = document.getElementById('surfaceModeCanvas');
    const layer = document.getElementById('surfaceModeLayer');
    if (mode?.isActive && canvas && layer) return { mode, canvas, layer };
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  return null;
}

function install({ mode, canvas }) {
  if (window.realitySandboxSurfaceInputV87) return;

  const syntheticKeys = new Set();
  const keyNames = new Map([
    ['KeyW', 'w'], ['KeyA', 'a'], ['KeyS', 's'], ['KeyD', 'd'],
    ['ShiftLeft', 'Shift'], ['Space', ' '], ['ControlLeft', 'Control'], ['KeyE', 'e'],
  ]);
  let activeGamepadIndex = null;
  let virtualX = innerWidth * 0.5;
  let virtualY = innerHeight * 0.5;
  let gamepadLookActive = false;
  let gamepadLabel = '';
  let previousStartPressed = false;
  let rawX = 0;
  let rawY = 0;
  let smoothX = 0;
  let smoothY = 0;
  let mouseFramePending = false;

  function isSurfaceActive() {
    return Boolean(mode.isActive?.() && html.dataset.surfaceMode === 'active');
  }

  function makeMouseMove(dx, dy, clientX = virtualX, clientY = virtualY) {
    const event = new MouseEvent('mousemove', {
      bubbles: true,
      cancelable: false,
      clientX,
      clientY,
    });
    // movementX/Y are read-only prototype accessors in some engines. Own
    // properties make the synthetic delta portable across current browsers.
    try {
      Object.defineProperties(event, {
        movementX: { value: dx },
        movementY: { value: dy },
        __surfaceInputV87: { value: true },
      });
    } catch {
      try { Object.defineProperty(event, '__surfaceInputV87', { value: true }); } catch {}
    }
    return event;
  }

  function flushMouse() {
    mouseFramePending = false;
    if (!isSurfaceActive() || document.pointerLockElement !== canvas) {
      rawX = rawY = smoothX = smoothY = 0;
      return;
    }
    // Low-pass filtering retains the full movement over time while removing
    // high-rate jitter. A mild sensitivity reduction makes fine aiming easier.
    smoothX = smoothX * 0.24 + rawX * 0.76;
    smoothY = smoothY * 0.24 + rawY * 0.76;
    rawX = 0;
    rawY = 0;
    if (Math.abs(smoothX) > 0.01 || Math.abs(smoothY) > 0.01) {
      document.dispatchEvent(makeMouseMove(smoothX * 0.86, smoothY * 0.86));
      if (Math.abs(smoothX) > 0.04 || Math.abs(smoothY) > 0.04) {
        mouseFramePending = true;
        requestAnimationFrame(flushMouse);
      }
    }
  }

  document.addEventListener('mousemove', event => {
    if (!event.isTrusted || event.__surfaceInputV87) return;
    if (!isSurfaceActive() || document.pointerLockElement !== canvas) return;
    event.stopImmediatePropagation();
    rawX += Number(event.movementX) || 0;
    rawY += Number(event.movementY) || 0;
    if (!mouseFramePending) {
      mouseFramePending = true;
      requestAnimationFrame(flushMouse);
    }
  }, { capture: true });

  canvas.addEventListener('click', event => {
    if (!isSurfaceActive() || event.pointerType === 'touch') return;
    if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.().catch?.(() => {});
  });

  canvas.addEventListener('contextmenu', event => {
    if (isSurfaceActive()) event.preventDefault();
  });

  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    canvas.style.cursor = locked ? 'none' : 'crosshair';
    html.dataset.surfaceMouseCaptured = String(locked);
    rawX = rawY = smoothX = smoothY = 0;
    refreshHelp();
  });

  // First Escape releases the mouse; a second Escape exits Surface Mode using
  // the existing controller. This prevents an accidental exit while aiming.
  window.addEventListener('keydown', event => {
    if (!event.isTrusted || event.code !== 'Escape' || !isSurfaceActive()) return;
    if (document.pointerLockElement === canvas) {
      event.preventDefault();
      event.stopImmediatePropagation();
      document.exitPointerLock?.();
    }
  }, { capture: true });

  function dispatchKey(code, pressed) {
    const already = syntheticKeys.has(code);
    if (pressed === already) return;
    if (pressed) syntheticKeys.add(code);
    else syntheticKeys.delete(code);
    const event = new KeyboardEvent(pressed ? 'keydown' : 'keyup', {
      bubbles: true,
      cancelable: true,
      code,
      key: keyNames.get(code) || '',
      repeat: false,
    });
    try { Object.defineProperty(event, '__surfaceInputV87', { value: true }); } catch {}
    window.dispatchEvent(event);
  }

  function releaseSyntheticKeys() {
    for (const code of [...syntheticKeys]) dispatchKey(code, false);
  }

  function beginGamepadLook() {
    if (gamepadLookActive) return;
    gamepadLookActive = true;
    virtualX = clamp(innerWidth * 0.5, 100, Math.max(100, innerWidth - 100));
    virtualY = clamp(innerHeight * 0.5, 100, Math.max(100, innerHeight - 100));
    try {
      canvas.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerId: 8701,
        pointerType: 'mouse',
        isPrimary: true,
        buttons: 1,
        clientX: virtualX,
        clientY: virtualY,
      }));
    } catch {}
  }

  function endGamepadLook() {
    if (!gamepadLookActive) return;
    gamepadLookActive = false;
    try {
      window.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        pointerId: 8701,
        pointerType: 'mouse',
        isPrimary: true,
        buttons: 0,
        clientX: virtualX,
        clientY: virtualY,
      }));
    } catch {}
  }

  function emitGamepadLook(x, y) {
    const dx = x * 15.5;
    const dy = y * 13.2;
    if (!dx && !dy) {
      endGamepadLook();
      return;
    }
    beginGamepadLook();
    virtualX = clamp(virtualX + dx, 40, Math.max(40, innerWidth - 40));
    virtualY = clamp(virtualY + dy, 40, Math.max(40, innerHeight - 40));
    document.dispatchEvent(makeMouseMove(dx, dy, virtualX, virtualY));
  }

  function currentGamepad() {
    const pads = navigator.getGamepads?.() || [];
    if (activeGamepadIndex != null && pads[activeGamepadIndex]?.connected) return pads[activeGamepadIndex];
    for (const pad of pads) {
      if (pad?.connected) {
        activeGamepadIndex = pad.index;
        gamepadLabel = String(pad.id || 'Gamepad').replace(/\s*\([^)]*\)\s*$/, '').slice(0, 42);
        html.dataset.surfaceGamepad = 'connected';
        refreshHelp();
        return pad;
      }
    }
    activeGamepadIndex = null;
    return null;
  }

  function buttonPressed(pad, index, threshold = 0.45) {
    const button = pad?.buttons?.[index];
    return Boolean(button?.pressed || Number(button?.value) > threshold);
  }

  function updateGamepad() {
    requestAnimationFrame(updateGamepad);
    if (!isSurfaceActive()) {
      releaseSyntheticKeys();
      endGamepadLook();
      previousStartPressed = false;
      return;
    }

    const pad = currentGamepad();
    if (!pad) {
      releaseSyntheticKeys();
      endGamepadLook();
      return;
    }

    const moveX = deadzone(pad.axes?.[0]);
    const moveY = deadzone(pad.axes?.[1]);
    const moveMagnitude = Math.hypot(moveX, moveY);
    dispatchKey('KeyA', moveX < -0.08);
    dispatchKey('KeyD', moveX > 0.08);
    dispatchKey('KeyW', moveY < -0.08);
    dispatchKey('KeyS', moveY > 0.08);

    const sprint = moveMagnitude > 0.86 || buttonPressed(pad, 10) || buttonPressed(pad, 7, 0.7);
    dispatchKey('ShiftLeft', sprint);
    dispatchKey('Space', buttonPressed(pad, 0));
    dispatchKey('ControlLeft', buttonPressed(pad, 1));
    dispatchKey('KeyE', buttonPressed(pad, 3));

    const lookX = deadzone(pad.axes?.[2], 0.13);
    const lookY = deadzone(pad.axes?.[3], 0.13);
    emitGamepadLook(lookX, lookY);

    const startPressed = buttonPressed(pad, 9);
    if (startPressed && !previousStartPressed) {
      const escape = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, code: 'Escape', key: 'Escape' });
      try { Object.defineProperty(escape, '__surfaceInputV87', { value: true }); } catch {}
      window.dispatchEvent(escape);
    }
    previousStartPressed = startPressed;
  }

  function findHelp() {
    return [...document.querySelectorAll('#surfaceModeHud > div')]
      .find(node => /WASD move|mouse look|scan (?:life|plants)/i.test(node.textContent || '')) || null;
  }

  function refreshHelp() {
    const help = findHelp();
    if (!help) return;
    const captured = document.pointerLockElement === canvas;
    const mouse = captured ? 'mouse captured · Esc releases' : 'click view for mouse look';
    const gamepad = activeGamepadIndex == null
      ? 'gamepad ready'
      : `${gamepadLabel || 'gamepad'} · LS move · RS look · A/Cross up · B/Circle down · Y/Triangle scan`;
    help.textContent = `WASD move · ${mouse} · Shift sprint · Space/Ctrl altitude · E scan · ${gamepad} · Esc exit`;
    help.style.whiteSpace = 'normal';
    help.style.textAlign = 'center';
  }

  window.addEventListener('gamepadconnected', event => {
    activeGamepadIndex = event.gamepad.index;
    gamepadLabel = String(event.gamepad.id || 'Gamepad').replace(/\s*\([^)]*\)\s*$/, '').slice(0, 42);
    html.dataset.surfaceGamepad = 'connected';
    refreshHelp();
  });

  window.addEventListener('gamepaddisconnected', event => {
    if (event.gamepad.index === activeGamepadIndex) activeGamepadIndex = null;
    html.dataset.surfaceGamepad = 'disconnected';
    releaseSyntheticKeys();
    endGamepadLook();
    refreshHelp();
  });

  window.addEventListener('blur', () => {
    releaseSyntheticKeys();
    endGamepadLook();
  });

  const helpTimer = setInterval(() => {
    if (isSurfaceActive()) refreshHelp();
  }, 900);

  window.realitySandboxSurfaceInputV87 = {
    installed: true,
    build: BUILD,
    mouse: 'pointer-lock-smoothed-click-capture',
    gamepad: 'standard-mapping-dual-stick',
    destroy() {
      clearInterval(helpTimer);
      releaseSyntheticKeys();
      endGamepadLook();
    },
  };
  html.dataset.surfaceInput = BUILD;
  requestAnimationFrame(updateGamepad);
}

waitForSurface().then(state => {
  if (!state) {
    html.dataset.surfaceInput = 'v87-unavailable';
    return;
  }
  install(state);
});
