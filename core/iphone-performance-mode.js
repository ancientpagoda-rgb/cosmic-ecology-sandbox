const MOBILE_QUERY = '(max-width: 720px), (pointer: coarse)';
const INTERACTION_FRAME_INTERVAL_MS = 42;
const IDLE_FRAME_INTERVAL_MS = 500;
const INERTIA_STOP_SPEED = 0.000006;
const INERTIA_DAMPING_PER_FRAME = 0.91;
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

  document.body.dataset.mobilePerformance = 'free-motion';
  canvas.style.touchAction = 'none';

  let lastVisualAt = 0;
  let lastCameraAt = 0;
  let scheduledCamera = null;
  let cameraTimer = 0;
  let cameraFrame = 0;
  let inertiaFrame = 0;
  let inertiaLastAt = 0;
  let velocityX = 0;
  let velocityY = 0;
  let drag = null;
  let pinch = null;
  const pointers = new Map();

  const originalUnifiedRender = unified.render.bind(unified);
  unified.render = frame => {
    const now = frame?.timestamp ?? performance.now();
    const active = pointers.size > 0 || inertiaFrame !== 0;
    const interval = active ? INTERACTION_FRAME_INTERVAL_MS : IDLE_FRAME_INTERVAL_MS;
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
    mode: 'free-motion-24fps-inertia',
    getState: () => ({
      ready: true,
      active: true,
      mode: 'free-motion-24fps-inertia',
      targetIntervalMs: pointers.size || inertiaFrame ? INTERACTION_FRAME_INTERVAL_MS : IDLE_FRAME_INTERVAL_MS,
      lastRenderMs: hifi.getState?.().lastRenderMs ?? null,
      pointerCount: pointers.size,
      inertiaActive: inertiaFrame !== 0,
      velocity: { x: velocityX, y: velocityY },
    }),
  };

  function consume(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onPointerDown(event) {
    consume(event);
    cancelInertia();
    canvas.focus({ preventScroll: true });
    try { canvas.setPointerCapture?.(event.pointerId); } catch {}
    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      timestamp: performance.now(),
    });

    velocityX = 0;
    velocityY = 0;
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
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    consume(event);

    const now = performance.now();
    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      timestamp: now,
    });

    if (pointers.size >= 2) {
      velocityX = 0;
      velocityY = 0;
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
    const next = normalizeFreeCamera({
      zoom: drag.camera.zoom,
      centerX: drag.camera.centerX - dx / Math.max(1, drag.camera.zoom),
      centerY: drag.camera.centerY + dy / Math.max(1, drag.camera.zoom),
    });

    const elapsed = clamp(now - previous.timestamp, 8, 80);
    const localVelocityX = -(event.clientX - previous.x) / Math.max(1, rect.width) / Math.max(1, next.zoom) / elapsed;
    const localVelocityY = (event.clientY - previous.y) / Math.max(1, rect.height) / Math.max(1, next.zoom) / elapsed;
    velocityX = velocityX * 0.58 + localVelocityX * 0.42;
    velocityY = velocityY * 0.58 + localVelocityY * 0.42;
    scheduleCamera(next);
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
      drag = {
        id,
        x: point.x,
        y: point.y,
        camera: pendingOrCurrentCamera(),
      };
      velocityX = 0;
      velocityY = 0;
    } else if (pointers.size >= 2) {
      beginPinch();
    } else {
      startInertia();
    }
    canvas.dataset.dragging = pointers.size ? 'true' : 'false';
  }

  function onWheel(event) {
    consume(event);
    cancelInertia();
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    const camera = pendingOrCurrentCamera();
    scheduleCamera({
      ...camera,
      zoom: clamp(camera.zoom * Math.exp(-delta * 0.0015), 1, 8),
    });
  }

  function onDoubleClick(event) {
    consume(event);
    cancelInertia();
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
    scheduledCamera = normalizeFreeCamera(camera);
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

  function startInertia() {
    const speed = Math.hypot(velocityX, velocityY);
    if (speed < INERTIA_STOP_SPEED) {
      velocityX = 0;
      velocityY = 0;
      return;
    }

    inertiaLastAt = performance.now();
    inertiaFrame = requestAnimationFrame(stepInertia);
  }

  function stepInertia(now) {
    const elapsed = Math.min(64, Math.max(1, now - inertiaLastAt));
    if (elapsed < INTERACTION_FRAME_INTERVAL_MS) {
      inertiaFrame = requestAnimationFrame(stepInertia);
      return;
    }
    inertiaLastAt = now;

    const camera = unified.getCamera();
    unified.setCamera(normalizeFreeCamera({
      ...camera,
      centerX: camera.centerX + velocityX * elapsed,
      centerY: camera.centerY + velocityY * elapsed,
    }));
    lastVisualAt = now;
    hifi.render();

    const damping = Math.pow(INERTIA_DAMPING_PER_FRAME, elapsed / 16.667);
    velocityX *= damping;
    velocityY *= damping;
    if (Math.hypot(velocityX, velocityY) < INERTIA_STOP_SPEED || pointers.size) {
      inertiaFrame = 0;
      velocityX = 0;
      velocityY = 0;
      return;
    }
    inertiaFrame = requestAnimationFrame(stepInertia);
  }

  function cancelInertia() {
    if (inertiaFrame) cancelAnimationFrame(inertiaFrame);
    inertiaFrame = 0;
    velocityX = 0;
    velocityY = 0;
  }
}

function normalizeFreeCamera(camera) {
  let centerX = Number.isFinite(camera.centerX) ? camera.centerX : 0.5;
  let centerY = Number.isFinite(camera.centerY) ? camera.centerY : 0.5;

  while (centerY < 0 || centerY > 1) {
    if (centerY < 0) {
      centerY = -centerY;
      centerX += 0.5;
    } else {
      centerY = 2 - centerY;
      centerX += 0.5;
    }
  }

  return {
    ...camera,
    centerX: wrap01(centerX),
    centerY,
  };
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
