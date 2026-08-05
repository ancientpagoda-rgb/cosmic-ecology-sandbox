const MOBILE_QUERY = '(max-width: 720px), (pointer: coarse)';
const TOUCH_FRAME_INTERVAL_MS = 33;
const IDLE_FRAME_INTERVAL_MS = 600;
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

  document.body.dataset.mobilePerformance = 'direct';
  canvas.style.touchAction = 'none';

  const pointers = new Map();
  const interactionState = { active: false };
  window.realitySandboxMobileInteraction = interactionState;

  let lastVisualAt = 0;
  let lastCameraAt = 0;
  let scheduledCamera = null;
  let cameraTimer = 0;
  let cameraFrame = 0;
  let drag = null;
  let pinch = null;

  const originalUnifiedRender = unified.render.bind(unified);
  const fullRender = hifi.render.bind(hifi);

  unified.render = frame => {
    if (interactionState.active) return;
    const now = frame?.timestamp ?? performance.now();
    if (now - lastVisualAt < IDLE_FRAME_INTERVAL_MS) return;
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
    mode: 'direct-30fps-no-inertia',
    getState: () => ({
      ready: true,
      active: true,
      mode: 'direct-30fps-no-inertia',
      targetIntervalMs: interactionState.active ? TOUCH_FRAME_INTERVAL_MS : IDLE_FRAME_INTERVAL_MS,
      lastRenderMs: hifi.getState?.().lastRenderMs ?? null,
      pointerCount: pointers.size,
      interacting: interactionState.active,
      buffer: hifi.buffer,
    }),
  };

  function consume(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onPointerDown(event) {
    consume(event);
    interactionState.active = true;
    canvas.focus({ preventScroll: true });
    try { canvas.setPointerCapture?.(event.pointerId); } catch {}
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size >= 2) beginPinch();
    else {
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      pinch = null;
    }
    canvas.dataset.dragging = 'true';
  }

  function onPointerMove(event) {
    if (!pointers.has(event.pointerId)) return;
    consume(event);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size >= 2) {
      const pair = [...pointers.values()].slice(0, 2);
      const distance = Math.max(1, Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y));
      if (!pinch) {
        beginPinch();
        return;
      }
      const camera = pendingOrCurrentCamera();
      const ratio = distance / Math.max(1, pinch.distance);
      scheduleCamera({ ...camera, zoom: clamp(camera.zoom * ratio, 1, 8) });
      pinch.distance = distance;
      return;
    }

    if (!drag || drag.id !== event.pointerId) return;
    const rect = canvas.getBoundingClientRect();
    const camera = pendingOrCurrentCamera();
    const dx = (event.clientX - drag.x) / Math.max(1, rect.width);
    const dy = (event.clientY - drag.y) / Math.max(1, rect.height);
    drag.x = event.clientX;
    drag.y = event.clientY;

    scheduleCamera({
      zoom: camera.zoom,
      centerX: wrap01(camera.centerX - dx / Math.max(1, camera.zoom)),
      centerY: clamp(camera.centerY + dy / Math.max(1, camera.zoom), 0.015, 0.985),
    });
  }

  function onPointerEnd(event) {
    if (!pointers.has(event.pointerId)) return;
    consume(event);
    pointers.delete(event.pointerId);
    try { canvas.releasePointerCapture?.(event.pointerId); } catch {}
    flushCamera();
    drag = null;
    pinch = null;

    if (pointers.size === 1) {
      const [id, point] = [...pointers.entries()][0];
      drag = { id, x: point.x, y: point.y };
    } else if (pointers.size >= 2) {
      beginPinch();
    } else {
      interactionState.active = false;
      canvas.dataset.dragging = 'false';
      requestAnimationFrame(() => {
        lastVisualAt = performance.now();
        fullRender();
      });
    }
  }

  function onWheel(event) {
    consume(event);
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    const camera = pendingOrCurrentCamera();
    scheduleCamera({ ...camera, zoom: clamp(camera.zoom * Math.exp(-delta * 0.0015), 1, 8) });
  }

  function onDoubleClick(event) {
    consume(event);
    clearScheduledCamera();
    interactionState.active = false;
    unified.resetCamera();
    lastVisualAt = performance.now();
    fullRender();
  }

  function beginPinch() {
    const pair = [...pointers.values()].slice(0, 2);
    if (pair.length < 2) return;
    pinch = { distance: Math.max(1, Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y)) };
    drag = null;
  }

  function pendingOrCurrentCamera() {
    return scheduledCamera ? { ...scheduledCamera } : unified.getCamera();
  }

  function scheduleCamera(camera) {
    scheduledCamera = camera;
    if (cameraTimer || cameraFrame) return;
    const delay = Math.max(0, TOUCH_FRAME_INTERVAL_MS - (performance.now() - lastCameraAt));
    cameraTimer = window.setTimeout(() => {
      cameraTimer = 0;
      cameraFrame = requestAnimationFrame(() => {
        cameraFrame = 0;
        flushCamera();
      });
    }, delay);
  }

  function flushCamera() {
    clearScheduledCallbacks();
    if (!scheduledCamera) return;
    const camera = scheduledCamera;
    scheduledCamera = null;
    unified.setCamera(camera);
    lastCameraAt = performance.now();
    lastVisualAt = lastCameraAt;

    const interactionRender = window.realitySandboxLilacClouds?.render || fullRender;
    interactionRender();
  }

  function clearScheduledCamera() {
    clearScheduledCallbacks();
    scheduledCamera = null;
  }

  function clearScheduledCallbacks() {
    if (cameraTimer) clearTimeout(cameraTimer);
    if (cameraFrame) cancelAnimationFrame(cameraFrame);
    cameraTimer = 0;
    cameraFrame = 0;
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
