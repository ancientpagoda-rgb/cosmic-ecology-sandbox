const DRAG_THRESHOLD_PX = 6;
const attachedCanvases = new WeakSet();

function attachDirectDrag(canvas) {
  if (attachedCanvases.has(canvas)) return;
  attachedCanvases.add(canvas);

  let drag = null;

  function runtime() {
    return window.realitySandboxUnified;
  }

  function finishDrag(event, selectRegion) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const active = drag;
    drag = null;
    canvas.dataset.dragging = 'false';
    try { canvas.releasePointerCapture?.(event.pointerId); } catch {}

    if (selectRegion && active.moved < DRAG_THRESHOLD_PX) {
      runtime()?.selectAtClientPoint?.(event.clientX, event.clientY);
    }
  }

  canvas.addEventListener('pointerdown', event => {
    // Keep the runtime's native two-finger pinch behavior on touchscreens.
    if (event.pointerType === 'touch' || event.button !== 0) return;

    const api = runtime();
    const camera = api?.getCamera?.();
    if (!camera || !api?.setCamera) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture?.(event.pointerId);
    canvas.dataset.dragging = 'true';

    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      camera,
      moved: 0,
    };
  }, { capture: true, passive: false });

  canvas.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));

    // Direct manipulation: the visible surface follows the pointer on both axes.
    runtime()?.setCamera?.({
      zoom: drag.camera.zoom,
      centerX: drag.camera.centerX - dx / rect.width / drag.camera.zoom,
      centerY: drag.camera.centerY - dy / rect.height / drag.camera.zoom,
    });
  }, { capture: true, passive: false });

  canvas.addEventListener('pointerup', event => finishDrag(event, true), { capture: true, passive: false });
  canvas.addEventListener('pointercancel', event => finishDrag(event, false), { capture: true, passive: false });
  canvas.addEventListener('lostpointercapture', event => {
    if (drag?.pointerId === event.pointerId) {
      drag = null;
      canvas.dataset.dragging = 'false';
    }
  }, { capture: true });
}

function attachExistingCanvas() {
  const canvas = document.getElementById('lofiLivingCanvas');
  if (canvas instanceof HTMLCanvasElement) attachDirectDrag(canvas);
}

attachExistingCanvas();
new MutationObserver(attachExistingCanvas).observe(document.documentElement, {
  childList: true,
  subtree: true,
});
