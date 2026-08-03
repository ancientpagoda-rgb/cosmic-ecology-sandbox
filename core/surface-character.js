export function createSurfaceCharacter(globe, options = {}) {
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

  function updateVisibility() {
    const distance = globe.getCameraState().distance;
    const shouldEnable = distance <= 1.32;
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
    avatar.classList.remove('walking');
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
    if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code)) {
      keys.add(event.code);
      event.preventDefault();
    }
  });
  window.addEventListener('keyup', event => keys.delete(event.code));

  exitButton.addEventListener('click', () => {
    globe.setDistance?.(2.85);
    globe.zoomOut?.();
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

    if (magnitude > 0.04) {
      const directionX = x / Math.max(1, Math.hypot(x, y));
      const directionY = y / Math.max(1, Math.hypot(x, y));
      globe.moveSurface?.(directionX, directionY, dt * (options.speed || 0.34));
      walkingPhase += dt * 10 * magnitude;
      avatar.classList.add('walking');
      avatar.style.setProperty('--walk-phase', String(Math.sin(walkingPhase)));
      avatar.style.transform = `translateX(-50%) rotate(${directionX * 5}deg)`;
    } else {
      avatar.classList.remove('walking');
      avatar.style.transform = 'translateX(-50%)';
    }
  }
  requestAnimationFrame(frame);

  return {
    destroy() {
      root.remove();
      document.body.classList.remove('surface-mode');
    },
  };
}
