const BUILD = 'v89-natural-left-drag';
const html = document.documentElement;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrap = (value, max) => ((value % max) + max) % max;
const wrapAngle = value => ((value + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;

async function waitForRenderer() {
  for (let attempt = 0; attempt < 360; attempt += 1) {
    const api = window.realitySandboxSingleSphericalRenderer;
    const canvas = document.getElementById('eidolonSingleWorldCanvas');
    const world = window.realitySandboxPlanet?.world;
    if (api?.installed && api?.getState && api?.setLocation && api?.setOrientation && canvas && world) {
      return { api, canvas, world };
    }
    await new Promise(resolve => setTimeout(resolve, 35));
  }
  return null;
}

function install({ api, canvas, world }) {
  if (window.realitySandboxSphericalDragV89?.installed) return;

  let drag = null;

  function onPointerDown(event) {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    if (event.button !== 0) return;
    if (document.pointerLockElement === canvas) return;

    const state = api.getState();
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: state.x,
      startY: state.y,
      startYaw: state.yaw,
      startPitch: state.pitch,
      startAltitude: state.altitude,
      moved: 0,
    };

    // Own desktop left-drag in capture phase so the older renderer handler
    // cannot abort the interaction when Firefox rejects setPointerCapture().
    event.preventDefault();
    event.stopImmediatePropagation();
    canvas.focus({ preventScroll: true });
    canvas.style.cursor = 'grabbing';
    html.dataset.sphericalDragActive = 'true';
  }

  function onPointerMove(event) {
    if (!drag || drag.id !== event.pointerId) return;
    event.preventDefault();

    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));

    const rect = canvas.getBoundingClientRect();
    if (drag.startAltitude > 70) {
      const sensitivity = clamp(drag.startAltitude / 700, 0.22, 1.7);
      api.setLocation(
        wrap(drag.startX - dx / Math.max(1, rect.width) * world.width * sensitivity, world.width),
        clamp(drag.startY + dy / Math.max(1, rect.height) * world.height * sensitivity, 0.01, world.height - 0.01),
      );
      return;
    }

    // Natural camera convention: drag/move right turns the view right and
    // drag/move up looks up. The renderer's local screen-right axis is the
    // negative yaw direction, so horizontal input must subtract from yaw.
    api.setOrientation(
      wrapAngle(drag.startYaw - dx * 0.005),
      clamp(drag.startPitch - dy * 0.004, -0.72, 0.72),
    );
  }

  function finishDrag(event, cancelled = false) {
    if (!drag || drag.id !== event.pointerId) return;
    const completed = drag;
    drag = null;
    html.dataset.sphericalDragActive = 'false';
    canvas.style.cursor = api.getState().altitude <= 80 ? 'crosshair' : 'grab';

    if (!cancelled && completed.moved < 6) {
      api.selectCreatureAt?.(event.clientX, event.clientY);
    }
  }

  function onPointerUp(event) {
    finishDrag(event, false);
  }

  function onPointerCancel(event) {
    finishDrag(event, true);
  }

  canvas.addEventListener('pointerdown', onPointerDown, { capture: true, passive: false });
  window.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
  window.addEventListener('pointerup', onPointerUp, { capture: true });
  window.addEventListener('pointercancel', onPointerCancel, { capture: true });

  window.realitySandboxSphericalDragV89 = {
    installed: true,
    build: BUILD,
    mouse: 'left-drag-natural-look-with-window-fallback',
    horizontalLook: 'natural',
    verticalLook: 'natural',
    pointerCaptureRequired: false,
    destroy() {
      drag = null;
      canvas.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('pointermove', onPointerMove, { capture: true });
      window.removeEventListener('pointerup', onPointerUp, { capture: true });
      window.removeEventListener('pointercancel', onPointerCancel, { capture: true });
    },
  };
  html.dataset.sphericalDragControls = BUILD;
}

waitForRenderer().then(state => {
  if (!state) {
    html.dataset.sphericalDragControls = 'v89-unavailable';
    return;
  }
  install(state);
});
