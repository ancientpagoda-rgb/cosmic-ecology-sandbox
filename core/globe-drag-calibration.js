const COSMIC_ZOOM_THRESHOLD = 0.68;
const DESKTOP_RADIUS_FACTOR = 0.43;
const DRAG_GAIN = 0.96;
const FLICK_DECAY_PER_SECOND = 5.4;
const FLICK_MIN_SPEED = 0.018;
const MAX_YAW_SPEED = 0.42;
const MAX_PITCH_SPEED = 0.30;
const CLICK_TOLERANCE_PX = 6;

function startWhenReady() {
  const start = async () => {
    try {
      if (window.realitySandboxReady) await window.realitySandboxReady;
      const runtime = window.realitySandboxUnified;
      const canvas = document.getElementById('lofiLivingCanvas');
      if (!runtime?.getCamera || !runtime?.setCamera || !canvas) return;

      const controller = installCalibratedGlobeDrag(runtime, canvas);
      window.realitySandboxGlobeDragCalibration = controller;
      window.dispatchEvent(new CustomEvent('eidolon-globe-drag-calibrated', {
        detail: controller.getSnapshot(),
      }));

      window.addEventListener('pagehide', controller.destroy, { once: true });
    } catch (error) {
      console.warn('[globe-drag-calibration] disabled:', error);
    }
  };

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}

export function calibratedDragDelta({
  dx = 0,
  dy = 0,
  width = 1,
  height = 1,
  zoom = 1,
  radiusFactor = DESKTOP_RADIUS_FACTOR,
  gain = DRAG_GAIN,
} = {}) {
  const radius = Math.max(1, Math.min(width, height) * radiusFactor * Math.max(COSMIC_ZOOM_THRESHOLD, zoom));
  return {
    centerX: -dx / (Math.PI * 2 * radius) * gain,
    // Grab semantics: dragging the visible surface downward should move the
    // projected surface downward, which requires the camera latitude to move
    // north (smaller normalized centerY), not south.
    centerY: -dy / (Math.PI * radius) * gain,
    radius,
  };
}

export function installCalibratedGlobeDrag(runtime, canvas) {
  let drag = null;
  let inertiaFrame = 0;
  let inertia = null;
  let handledDrags = 0;
  let lastRadius = 0;

  function isSupportedPointer(event) {
    return event.pointerType === 'mouse' || event.pointerType === 'pen' || !event.pointerType;
  }

  function projectedRadius(rect, camera) {
    return Math.max(1, Math.min(rect.width, rect.height) * DESKTOP_RADIUS_FACTOR * Math.max(COSMIC_ZOOM_THRESHOLD, finite(camera.zoom, 1)));
  }

  function beginsOnGlobe(event, rect, camera) {
    const radius = projectedRadius(rect, camera);
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5;
    return Math.hypot(event.clientX - cx, event.clientY - cy) <= radius;
  }

  function cancelInertia() {
    if (inertiaFrame) cancelAnimationFrame(inertiaFrame);
    inertiaFrame = 0;
    inertia = null;
  }

  function onPointerDown(event) {
    if (!isSupportedPointer(event) || event.button !== 0) return;
    const camera = runtime.getCamera();
    if (finite(camera.zoom) < COSMIC_ZOOM_THRESHOLD) return;

    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || !beginsOnGlobe(event, rect, camera)) return;

    cancelInertia();
    lastRadius = projectedRadius(rect, camera);
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: performance.now(),
      startCamera: { ...camera },
      radius: lastRadius,
      moved: 0,
      velocityX: 0,
      velocityY: 0,
    };

    canvas.focus?.({ preventScroll: true });
    canvas.setPointerCapture?.(event.pointerId);
    canvas.dataset.dragging = 'true';

    event.stopImmediatePropagation();
  }

  function onPointerMove(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const now = performance.now();
    const elapsed = Math.max(1, now - drag.lastTime) / 1000;
    const stepX = event.clientX - drag.lastX;
    const stepY = event.clientY - drag.lastY;
    const totalX = event.clientX - drag.startX;
    const totalY = event.clientY - drag.startY;

    drag.moved = Math.max(drag.moved, Math.hypot(totalX, totalY));

    const delta = calibratedDragDelta({
      dx: totalX,
      dy: totalY,
      width: drag.radius / DESKTOP_RADIUS_FACTOR / Math.max(COSMIC_ZOOM_THRESHOLD, drag.startCamera.zoom),
      height: drag.radius / DESKTOP_RADIUS_FACTOR / Math.max(COSMIC_ZOOM_THRESHOLD, drag.startCamera.zoom),
      zoom: drag.startCamera.zoom,
    });

    runtime.setCamera({
      ...drag.startCamera,
      centerX: drag.startCamera.centerX + delta.centerX,
      centerY: drag.startCamera.centerY + delta.centerY,
    });

    const instantaneousX = clamp(
      -stepX / (Math.PI * 2 * drag.radius) * DRAG_GAIN / elapsed,
      -MAX_YAW_SPEED,
      MAX_YAW_SPEED,
    );
    const instantaneousY = clamp(
      -stepY / (Math.PI * drag.radius) * DRAG_GAIN / elapsed,
      -MAX_PITCH_SPEED,
      MAX_PITCH_SPEED,
    );

    drag.velocityX = drag.velocityX * 0.62 + instantaneousX * 0.38;
    drag.velocityY = drag.velocityY * 0.62 + instantaneousY * 0.38;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.lastTime = now;
  }

  function onPointerUp(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;

    event.stopImmediatePropagation();
    try { canvas.releasePointerCapture?.(event.pointerId); } catch {}

    const completed = drag;
    drag = null;
    canvas.dataset.dragging = 'false';

    if (completed.moved < CLICK_TOLERANCE_PX) {
      runtime.selectAtClientPoint?.(event.clientX, event.clientY);
      return;
    }

    handledDrags += 1;
    const speed = Math.hypot(completed.velocityX, completed.velocityY);
    if (speed >= FLICK_MIN_SPEED) {
      beginInertia(completed.velocityX, completed.velocityY);
    }
  }

  function onPointerCancel(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopImmediatePropagation();
    drag = null;
    canvas.dataset.dragging = 'false';
  }

  function beginInertia(velocityX, velocityY) {
    cancelInertia();
    inertia = {
      velocityX: clamp(velocityX, -MAX_YAW_SPEED, MAX_YAW_SPEED),
      velocityY: clamp(velocityY, -MAX_PITCH_SPEED, MAX_PITCH_SPEED),
      lastTime: performance.now(),
    };

    const tick = now => {
      if (!inertia) return;
      const elapsed = Math.min(0.035, Math.max(0.001, (now - inertia.lastTime) / 1000));
      inertia.lastTime = now;

      const decay = Math.exp(-FLICK_DECAY_PER_SECOND * elapsed);
      inertia.velocityX *= decay;
      inertia.velocityY *= decay;

      const camera = runtime.getCamera();
      if (finite(camera.zoom) < COSMIC_ZOOM_THRESHOLD) {
        cancelInertia();
        return;
      }

      const nextY = clamp(
        finite(camera.centerY, 0.5) + inertia.velocityY * elapsed,
        0.01,
        0.99,
      );

      if (
        (nextY <= 0.0101 && inertia.velocityY < 0) ||
        (nextY >= 0.9899 && inertia.velocityY > 0)
      ) {
        inertia.velocityY = 0;
      }

      runtime.setCamera({
        centerX: finite(camera.centerX, 0.5) + inertia.velocityX * elapsed,
        centerY: nextY,
        zoom: camera.zoom,
      });

      if (Math.hypot(inertia.velocityX, inertia.velocityY) < FLICK_MIN_SPEED * 0.24) {
        cancelInertia();
        return;
      }

      inertiaFrame = requestAnimationFrame(tick);
    };

    inertiaFrame = requestAnimationFrame(tick);
  }

  function getSnapshot() {
    return {
      version: 2,
      model: 'sphere-radius-angular-grab-drag',
      radiusFactor: DESKTOP_RADIUS_FACTOR,
      gain: DRAG_GAIN,
      flickDecayPerSecond: FLICK_DECAY_PER_SECOND,
      maxYawSpeed: MAX_YAW_SPEED,
      maxPitchSpeed: MAX_PITCH_SPEED,
      handledDrags,
      lastRadius,
      active: Boolean(drag),
      inertiaActive: Boolean(inertia),
      pointerTypes: ['mouse', 'pen'],
      grabDirection: true,
    };
  }

  function destroy() {
    cancelInertia();
    drag = null;
    canvas.removeEventListener('pointerdown', onPointerDown, true);
    canvas.removeEventListener('pointermove', onPointerMove, true);
    canvas.removeEventListener('pointerup', onPointerUp, true);
    canvas.removeEventListener('pointercancel', onPointerCancel, true);
  }

  canvas.addEventListener('pointerdown', onPointerDown, true);
  canvas.addEventListener('pointermove', onPointerMove, true);
  canvas.addEventListener('pointerup', onPointerUp, true);
  canvas.addEventListener('pointercancel', onPointerCancel, true);

  return { getSnapshot, destroy };
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

startWhenReady();
