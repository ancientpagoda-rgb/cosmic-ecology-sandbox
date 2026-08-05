const MOBILE_QUERY = '(max-width: 720px), (pointer: coarse)';
const INTERACTION_FRAME_INTERVAL_MS = 67;
const IDLE_FRAME_INTERVAL_MS = 400;
let attempts = 0;

function bootIPhonePerformanceMode() {
  if (window.realitySandboxIPhonePerformance?.ready) return;

  const unified = window.realitySandboxUnified;
  const hifi = window.realitySandboxHifi;
  const canvas = document.getElementById('lofiLivingCanvas');
  if (!unified || !hifi?.ready || !canvas) {
    if (attempts++ < 240) setTimeout(bootIPhonePerformanceMode, 50);
    return;
  }

  const mobile = matchMedia(MOBILE_QUERY).matches;
  if (!mobile) {
    window.realitySandboxIPhonePerformance = { ready: true, active: false };
    return;
  }

  document.body.dataset.mobilePerformance = 'balanced';
  canvas.style.touchAction = 'none';

  let lastVisualAt = 0;
  let lastCameraAt = 0;
  let scheduledCamera = null;
  let cameraTimer = 0;
  let cameraFrame = 0;
  let drag = null;
  let pinch = null;
  const pointers = new Map();

  const originalUnifiedRender = unified.render.bind(unified);
  unified.render = frame => {
    const now = frame?.timestamp ?? performance.now();
    const interval = pointers.size ? INTERACTION_FRAME_INTERVAL_MS : IDLE_FRAME_INTERVAL_MS;
    if (now - lastVisualAt < interval) return;
    lastVisualAt = now;
    originalUnifiedRender(frame);
  };

  canvas.addEventListener('pointerdown', onPointerDown, { capture: true, passive: false });
  canvas.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
  canvas.addEventListener('pointerup', onPointerEnd, { capture: true, passive: false });
  canvas.addEventListener('pointercancel', onPointerEnd, { capture: true, passive: false });
  canvas.addEventListener('wheel', onWheel, { capture: true, passive: false });
  canvas.addEventListener('dblclick', onDoubleClick, { capture: true, passive: false });

  window.realitySandboxIPhonePerformance = {
    ready: true,
    active: true,
    mode: 'idle-2.5fps-touch-15fps',
    getState: () => ({
      ready: true,
      active: true,
      mode: 'idle-2.5fps-touch-15fps',
      targetIntervalMs: pointers.size ? INTERACTION_FRAME_INTERVAL_MS : IDLE_FRAME_INTERVAL_MS,
      lastRenderMs: hifi.getState?.().lastRenderMs ?? null,
      pointerCount: pointers.size,
    }),
  };

  function consume(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onPointerDown(event) {
    consume(event);
    canvas.focus({ preventScroll: true });
    try { canvas.setPointerCapture?.(event.pointerId); } catch {}
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size >= 2) beginPinch();
    else {
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        camera: pendingOrCurrentCamera(),
      };
      pinch = null;
    }
    canvas.dataset.dragging = 'true';
  }

  function onPointerMove(event) {
    if (!pointers.has(event.pointerId)) return;
    consume(event);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size >= 2) {
      if (!pinch) beginPinch();
      const pair = [...pointers.values()].slice(0, 2);
      const distance = Math.max(1, Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y));
      scheduleCamera({
        ...pinch.camera,
        zoom: clamp(pinch.camera.zoom * distance / pinch.distance, 1, 8),
      });
      return;
    }

    if (!drag || drag.id !== event.pointerId) return;
    const rect = canvas.getBoundingClientRect();
    const dx = (event.clientX - drag.x) / Math.max(1, rect.width);
    const dy = (event.clientY - drag.y) / Math.max(1, rect.height);
    scheduleCamera({
      zoom: drag.camera.zoom,
      centerX: wrap01(drag.camera.centerX - dx / Math.max(1, drag.camera.zoom)),
      centerY: clamp(drag.camera.centerY + dy / Math.max(1, drag.camera.zoom), 0.01, 0.99),
    });
  }

  function onPointerEnd(event) {
    if (!pointers.has(event.pointerId)) return;
    consume(event);
    pointers.delete(event.pointerId);
    try { canvas.releasePointerCapture?.(event.pointerId); } catch {}
    flushCamera(true);
    drag = null;
    pinch = null;

    if (pointers.size === 1) {
      const [id, point] = [...pointers.entries()][0];
      drag = { id, x: point.x, y: point.y, camera: pendingOrCurrentCamera() };
    } else if (pointers.size >= 2) {
      beginPinch();
    }
    canvas.dataset.dragging = pointers.size ? 'true' : 'false';
  }

  function onWheel(event) {
    consume(event);
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    const camera = pendingOrCurrentCamera();
    scheduleCamera({
      ...camera,
      zoom: clamp(camera.zoom * Math.exp(-delta * 0.0015), 1, 8),
    });
  }

  function onDoubleClick(event) {
    consume(event);
    scheduledCamera = null;
    unified.resetCamera();
    lastVisualAt = performance.now();
    hifi.render();
  }

  function beginPinch() {
    const pair = [...pointers.values()].slice(0, 2);
    if (pair.length < 2) return;
    pinch = {
      distance: Math.max(1, Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y)),
      camera: pendingOrCurrentCamera(),
    };
    drag = null;
  }

  function pendingOrCurrentCamera() {
    return scheduledCamera ? { ...scheduledCamera } : unified.getCamera();
  }

  function scheduleCamera(camera) {
    scheduledCamera = camera;
    if (cameraTimer || cameraFrame) return;

    const delay = Math.max(0, INTERACTION_FRAME_INTERVAL_MS - (performance.now() - lastCameraAt));
    cameraTimer = window.setTimeout(() => {
      cameraTimer = 0;
      cameraFrame = requestAnimationFrame(() => {
        cameraFrame = 0;
        flushCamera(false);
      });
    }, delay);
  }

  function flushCamera(force) {
    if (cameraTimer) {
      clearTimeout(cameraTimer);
      cameraTimer = 0;
    }
    if (cameraFrame) {
      cancelAnimationFrame(cameraFrame);
      cameraFrame = 0;
    }
    if (!scheduledCamera && !force) return;

    const camera = scheduledCamera;
    scheduledCamera = null;
    if (camera) unified.setCamera(camera);
    lastCameraAt = performance.now();
    lastVisualAt = lastCameraAt;
    hifi.render();
  }
}

function wrap01(value) {
  return value - Math.floor(value);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootIPhonePerformanceMode, { once: true });
} else {
  bootIPhonePerformanceMode();
}
