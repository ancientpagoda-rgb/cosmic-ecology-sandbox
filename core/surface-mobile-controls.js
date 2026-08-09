const MOVE_CODES = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
const HELD_CODES = new Set();

function dispatchKey(code, down) {
  if (down === HELD_CODES.has(code)) return;
  if (down) HELD_CODES.add(code);
  else HELD_CODES.delete(code);
  window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', {
    code,
    bubbles: true,
    cancelable: true,
  }));
}

function releaseMovement() {
  for (const code of [...HELD_CODES]) dispatchKey(code, false);
}

function isTouchDevice() {
  return navigator.maxTouchPoints > 0 || window.matchMedia?.('(pointer: coarse)')?.matches;
}

function makeButton(label, ariaLabel) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('aria-label', ariaLabel);
  Object.assign(button.style, {
    width: '58px',
    height: '58px',
    borderRadius: '50%',
    border: '1px solid rgba(220,240,230,.38)',
    background: 'rgba(4,12,10,.62)',
    color: '#eef8f1',
    font: '700 13px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    boxShadow: '0 5px 20px rgba(0,0,0,.28)',
    backdropFilter: 'blur(5px)',
    WebkitBackdropFilter: 'blur(5px)',
    touchAction: 'none',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    pointerEvents: 'auto',
  });
  return button;
}

async function installMobileSurfaceControls() {
  if (window.realitySandboxSurfaceMobileControls?.installed) return;
  if (!isTouchDevice()) return;

  let canvas = null;
  let layer = null;
  for (let attempt = 0; attempt < 240; attempt++) {
    canvas = document.getElementById('surfaceModeCanvas');
    layer = document.getElementById('surfaceModeLayer');
    if (canvas && layer && window.realitySandboxSurfaceMode) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!canvas || !layer || !window.realitySandboxSurfaceMode) return;

  const root = document.createElement('div');
  root.id = 'surfaceMobileControls';
  root.setAttribute('aria-label', 'Surface mode touch controls');
  Object.assign(root.style, {
    position: 'absolute',
    inset: '0',
    zIndex: '6',
    display: 'none',
    pointerEvents: 'none',
    touchAction: 'none',
  });

  const stick = document.createElement('div');
  stick.setAttribute('aria-label', 'Movement joystick');
  Object.assign(stick.style, {
    position: 'absolute',
    left: 'max(18px, env(safe-area-inset-left))',
    bottom: 'max(22px, env(safe-area-inset-bottom))',
    width: '124px',
    height: '124px',
    borderRadius: '50%',
    border: '1px solid rgba(220,240,230,.28)',
    background: 'rgba(4,12,10,.28)',
    boxShadow: 'inset 0 0 24px rgba(0,0,0,.25)',
    backdropFilter: 'blur(3px)',
    WebkitBackdropFilter: 'blur(3px)',
    pointerEvents: 'auto',
    touchAction: 'none',
  });

  const knob = document.createElement('div');
  Object.assign(knob.style, {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: '54px',
    height: '54px',
    marginLeft: '-27px',
    marginTop: '-27px',
    borderRadius: '50%',
    border: '1px solid rgba(235,248,240,.42)',
    background: 'rgba(190,230,205,.28)',
    boxShadow: '0 3px 12px rgba(0,0,0,.28)',
    transform: 'translate(0px, 0px)',
    pointerEvents: 'none',
  });
  stick.append(knob);

  const actions = document.createElement('div');
  Object.assign(actions.style, {
    position: 'absolute',
    right: 'max(18px, env(safe-area-inset-right))',
    bottom: 'max(22px, env(safe-area-inset-bottom))',
    display: 'grid',
    gridTemplateColumns: '58px 58px',
    gap: '10px',
    alignItems: 'end',
    pointerEvents: 'none',
  });

  const upButton = makeButton('↑', 'Increase altitude');
  const downButton = makeButton('↓', 'Decrease altitude');
  const runButton = makeButton('RUN', 'Sprint');
  runButton.style.gridColumn = '1 / span 2';
  runButton.style.width = '126px';
  runButton.style.borderRadius = '29px';
  actions.append(upButton, downButton, runButton);

  const lookHint = document.createElement('div');
  lookHint.textContent = 'drag to look';
  Object.assign(lookHint.style, {
    position: 'absolute',
    right: 'max(20px, env(safe-area-inset-right))',
    bottom: 'max(166px, calc(env(safe-area-inset-bottom) + 166px))',
    padding: '5px 8px',
    borderRadius: '8px',
    background: 'rgba(4,12,10,.34)',
    color: 'rgba(238,248,241,.72)',
    font: '10px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    pointerEvents: 'none',
  });

  root.append(stick, actions, lookHint);
  layer.append(root);

  let stickPointer = null;
  let lookPointer = null;
  let lookActive = false;

  function updateStick(clientX, clientY) {
    const rect = stick.getBoundingClientRect();
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5;
    const maxRadius = rect.width * 0.34;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const length = Math.hypot(dx, dy);
    if (length > maxRadius) {
      dx *= maxRadius / length;
      dy *= maxRadius / length;
    }
    knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;

    const nx = dx / maxRadius;
    const ny = dy / maxRadius;
    const deadZone = 0.22;
    dispatchKey('KeyA', nx < -deadZone);
    dispatchKey('KeyD', nx > deadZone);
    dispatchKey('KeyW', ny < -deadZone);
    dispatchKey('KeyS', ny > deadZone);
  }

  function resetStick() {
    for (const code of MOVE_CODES) dispatchKey(code, false);
    knob.style.transform = 'translate(0px, 0px)';
    stickPointer = null;
  }

  stick.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse') return;
    event.preventDefault();
    event.stopPropagation();
    stickPointer = event.pointerId;
    stick.setPointerCapture?.(event.pointerId);
    updateStick(event.clientX, event.clientY);
  }, { passive: false });

  stick.addEventListener('pointermove', event => {
    if (event.pointerId !== stickPointer) return;
    event.preventDefault();
    updateStick(event.clientX, event.clientY);
  }, { passive: false });

  stick.addEventListener('pointerup', event => {
    if (event.pointerId !== stickPointer) return;
    event.preventDefault();
    resetStick();
  }, { passive: false });
  stick.addEventListener('pointercancel', resetStick);

  function bindHeldButton(button, code) {
    let pointerId = null;
    button.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse') return;
      event.preventDefault();
      event.stopPropagation();
      pointerId = event.pointerId;
      button.setPointerCapture?.(pointerId);
      dispatchKey(code, true);
      button.style.background = 'rgba(190,230,205,.34)';
    }, { passive: false });
    const release = event => {
      if (event?.pointerId != null && pointerId != null && event.pointerId !== pointerId) return;
      dispatchKey(code, false);
      pointerId = null;
      button.style.background = 'rgba(4,12,10,.62)';
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
  }

  bindHeldButton(upButton, 'Space');
  bindHeldButton(downButton, 'ControlLeft');
  bindHeldButton(runButton, 'ShiftLeft');

  function syntheticMousePointer(type, clientX, clientY) {
    if (typeof PointerEvent !== 'function') return;
    const event = new PointerEvent(type, {
      pointerType: 'mouse',
      clientX,
      clientY,
      bubbles: true,
      cancelable: true,
    });
    (type === 'pointerdown' ? canvas : window).dispatchEvent(event);
  }

  canvas.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' || lookPointer != null) return;
    if (document.documentElement.dataset.surfaceMode !== 'active') return;
    event.preventDefault();
    lookPointer = event.pointerId;
    lookActive = true;
    canvas.setPointerCapture?.(event.pointerId);
    syntheticMousePointer('pointerdown', event.clientX, event.clientY);
  }, { passive: false });

  canvas.addEventListener('pointermove', event => {
    if (!lookActive || event.pointerId !== lookPointer) return;
    event.preventDefault();
    document.dispatchEvent(new MouseEvent('mousemove', {
      clientX: event.clientX,
      clientY: event.clientY,
      bubbles: true,
      cancelable: true,
    }));
  }, { passive: false });

  function endLook(event) {
    if (!lookActive) return;
    if (event?.pointerId != null && lookPointer != null && event.pointerId !== lookPointer) return;
    syntheticMousePointer('pointerup', event?.clientX || 0, event?.clientY || 0);
    lookActive = false;
    lookPointer = null;
  }
  canvas.addEventListener('pointerup', endLook);
  canvas.addEventListener('pointercancel', endLook);
  canvas.addEventListener('lostpointercapture', endLook);

  function syncVisibility() {
    const active = document.documentElement.dataset.surfaceMode === 'active';
    root.style.display = active ? 'block' : 'none';
    if (!active) {
      resetStick();
      releaseMovement();
      endLook();
    }
    document.documentElement.dataset.surfaceMobileControls = active ? 'active' : 'ready';
  }

  const observer = new MutationObserver(syncVisibility);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-surface-mode'] });
  window.addEventListener('blur', () => {
    resetStick();
    releaseMovement();
    endLook();
  });

  window.realitySandboxSurfaceMobileControls = {
    installed: true,
    release: releaseMovement,
  };
  document.documentElement.dataset.surfaceMobileControls = 'ready';
  syncVisibility();
}

installMobileSurfaceControls();

