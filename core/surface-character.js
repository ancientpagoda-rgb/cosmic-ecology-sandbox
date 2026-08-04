export function createSurfaceCharacter(globe, options = {}) {
  const groundLevel = options.groundLevel || null;
  const root = document.createElement('div');
  root.className = 'surface-character-ui';
  root.hidden = true;
  root.innerHTML = `
    <div class="surface-character" aria-hidden="true">
      <div class="surface-character__head"></div>
      <div class="surface-character__body"></div>
      <div class="surface-character__legs"></div>
    </div>
    <div class="surface-joystick" aria-label="Move character">
      <div class="surface-joystick__knob"></div>
    </div>
    <button class="surface-exit" type="button" aria-label="Exit surface mode">↑</button>
  `;
  document.body.append(root);

  const avatar = root.querySelector('.surface-character');
  const joystick = root.querySelector('.surface-joystick');
  const knob = root.querySelector('.surface-joystick__knob');
  const exitButton = root.querySelector('.surface-exit');
  const keys = new Set();

  let activePointer = null;
  let inputX = 0;
  let inputY = 0;
  let walkingPhase = 0;
  let enabled = false;
  let lastTime = performance.now();
  let syntheticPointerId = 9182;

  function updateVisibility() {
    const distance = globe.getCameraState().distance;
    const shouldEnable = distance <= 1.32 && (groundLevel?.isActive?.() ?? true);
    if (shouldEnable === enabled) return;

    enabled = shouldEnable;
    root.hidden = !enabled;
    document.body.classList.toggle('surface-mode', enabled);
    resetInput();
  }

  function resetInput() {
    inputX = 0;
    inputY = 0;
    activePointer = null;
    knob.style.transform = 'translate3d(0,0,0)';
    avatar.classList.remove('walking', 'blocked');
  }

  function updateJoystick(clientX, clientY) {
    const rect = joystick.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const max = rect.width * 0.3;
    let dx = clientX - centerX;
    let dy = clientY - centerY;
    const length = Math.hypot(dx, dy) || 1;

    if (length > max) {
      dx = dx / length * max;
      dy = dy / length * max;
    }

    inputX = dx / max;
    inputY = dy / max;
    knob.style.transform = `translate3d(${dx}px,${dy}px,0)`;
  }

  function moveWorld(x, y, amount) {
    if (typeof groundLevel?.move === 'function' && groundLevel.isActive?.()) {
      return groundLevel.move(x, y, amount);
    }

    if (typeof globe.moveSurface === 'function') {
      globe.moveSurface(x, y, amount);
      return { moved: true, blocked: false };
    }

    const canvas = globe.element;
    if (!canvas) return { moved: false, blocked: false };

    const rect = canvas.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const scale = amount * 180;
    syntheticPointerId += 1;
    const common = {
      pointerId: syntheticPointerId,
      pointerType: 'touch',
      bubbles: true,
      cancelable: true,
      isPrimary: true,
    };

    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      ...common,
      clientX: centerX,
      clientY: centerY,
      buttons: 1,
    }));
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      ...common,
      clientX: centerX - x * scale,
      clientY: centerY - y * scale,
      buttons: 1,
    }));
    canvas.dispatchEvent(new PointerEvent('pointerup', {
      ...common,
      clientX: centerX - x * scale,
      clientY: centerY - y * scale,
      buttons: 0,
    }));
    return { moved: true, blocked: false };
  }

  joystick.addEventListener('pointerdown', event => {
    if (!enabled) return;
    event.preventDefault();
    activePointer = event.pointerId;
    joystick.setPointerCapture?.(event.pointerId);
    updateJoystick(event.clientX, event.clientY);
  });

  joystick.addEventListener('pointermove', event => {
    if (event.pointerId !== activePointer) return;
    event.preventDefault();
    updateJoystick(event.clientX, event.clientY);
  }, { passive: false });

  const endPointer = event => {
    if (event.pointerId !== activePointer) return;
    resetInput();
  };
  joystick.addEventListener('pointerup', endPointer);
  joystick.addEventListener('pointercancel', endPointer);

  window.addEventListener('keydown', event => {
    if ([
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'ShiftLeft',
      'ShiftRight',
    ].includes(event.code)) {
      keys.add(event.code);
      if (enabled && !event.metaKey && !event.ctrlKey && !event.altKey) event.preventDefault();
    }
  });

  window.addEventListener('keyup', event => keys.delete(event.code));

  exitButton.addEventListener('click', () => {
    if (typeof groundLevel?.exit === 'function') groundLevel.exit();
    else for (let i = 0; i < 6; i++) globe.zoomOut?.();
  });

  function frame(now) {
    requestAnimationFrame(frame);
    updateVisibility();

    if (!enabled) {
      lastTime = now;
      return;
    }

    const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;

    let x = inputX;
    let y = inputY;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;

    const magnitude = Math.min(1, Math.hypot(x, y));
    const sprinting = keys.has('ShiftLeft') || keys.has('ShiftRight');

    if (magnitude > 0.04) {
      const length = Math.max(1, Math.hypot(x, y));
      const directionX = x / length;
      const directionY = y / length;
      const speed = dt * (options.speed || 0.34) * (sprinting ? 1.65 : 1);
      const movement = moveWorld(directionX, directionY, speed);

      if (movement?.blocked) {
        avatar.classList.remove('walking');
        avatar.classList.add('blocked');
      } else {
        walkingPhase += dt * (sprinting ? 15 : 10) * magnitude;
        avatar.classList.remove('blocked');
        avatar.classList.add('walking');
        avatar.style.setProperty('--walk-phase', String(Math.sin(walkingPhase)));
        avatar.style.transform = `translateX(-50%) rotate(${directionX * 5}deg)`;
      }
    } else {
      avatar.classList.remove('walking', 'blocked');
      avatar.style.transform = 'translateX(-50%)';
    }
  }

  requestAnimationFrame(frame);

  return {
    isEnabled: () => enabled,
    destroy() {
      root.remove();
      document.body.classList.remove('surface-mode');
    },
  };
}
