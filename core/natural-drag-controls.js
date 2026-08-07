const DRAG_THRESHOLD_PX = 6;
const attachedCanvases = new WeakSet();

function midpoint(a, b) {
  return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function attachDirectDrag(canvas) {
  if (attachedCanvases.has(canvas)) return;
  attachedCanvases.add(canvas);

  const pointers = new Map();
  let gesture = null;

  function runtime() {
    return window.realitySandboxUnified;
  }

  function beginDrag(pointerId, point, allowSelection = true) {
    const camera = runtime()?.getCamera?.();
    if (!camera) return;
    gesture = {
      kind: 'drag',
      pointerId,
      startX: point.x,
      startY: point.y,
      camera,
      moved: allowSelection ? 0 : DRAG_THRESHOLD_PX,
      allowSelection,
    };
    canvas.dataset.dragging = 'true';
  }

  function beginPinch() {
    const pair = [...pointers.values()].slice(0, 2);
    const camera = runtime()?.getCamera?.();
    if (pair.length < 2 || !camera) return;
    gesture = {
      kind: 'pinch',
      camera,
      startDistance: Math.max(1, distance(pair[0], pair[1])),
      startMidpoint: midpoint(pair[0], pair[1]),
    };
    canvas.dataset.dragging = 'true';
  }

  function consume(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function resetGesture() {
    gesture = null;
    canvas.dataset.dragging = 'false';
  }

  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const api = runtime();
    if (!api?.getCamera || !api?.setCamera) return;

    consume(event);
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 1) beginDrag(event.pointerId, pointers.get(event.pointerId));
    else beginPinch();
  }, { capture: true, passive: false });

  canvas.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    consume(event);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const api = runtime();
    const rect = canvas.getBoundingClientRect();
    if (!api?.setCamera || !rect.width || !rect.height) return;

    if (pointers.size >= 2) {
      if (gesture?.kind !== 'pinch') beginPinch();
      const pair = [...pointers.values()].slice(0, 2);
      const currentMidpoint = midpoint(pair[0], pair[1]);
      const currentDistance = Math.max(1, distance(pair[0], pair[1]));
      const dx = currentMidpoint.x - gesture.startMidpoint.x;
      const dy = currentMidpoint.y - gesture.startMidpoint.y;

      api.setCamera({
        zoom: gesture.camera.zoom * currentDistance / gesture.startDistance,
        centerX: gesture.camera.centerX - dx / rect.width / gesture.camera.zoom,
        centerY: gesture.camera.centerY - dy / rect.height / gesture.camera.zoom,
      });
      return;
    }

    if (gesture?.kind !== 'drag' || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    gesture.moved = Math.max(gesture.moved, Math.hypot(dx, dy));

    // Direct manipulation: the visible globe follows the pointer on both axes.
    api.setCamera({
      zoom: gesture.camera.zoom,
      centerX: gesture.camera.centerX - dx / rect.width / gesture.camera.zoom,
      centerY: gesture.camera.centerY - dy / rect.height / gesture.camera.zoom,
    });
  }, { capture: true, passive: false });

  function finishPointer(event, allowSelection) {
    if (!pointers.has(event.pointerId)) return;
    consume(event);

    const selected = allowSelection &&
      pointers.size === 1 &&
      gesture?.kind === 'drag' &&
      gesture.pointerId === event.pointerId &&
      gesture.allowSelection &&
      gesture.moved < DRAG_THRESHOLD_PX;

    pointers.delete(event.pointerId);
    try { canvas.releasePointerCapture?.(event.pointerId); } catch {}

    if (selected) runtime()?.selectAtClientPoint?.(event.clientX, event.clientY);

    if (pointers.size >= 2) beginPinch();
    else if (pointers.size === 1) {
      const [pointerId, point] = pointers.entries().next().value;
      beginDrag(pointerId, point, false);
    } else resetGesture();
  }

  canvas.addEventListener('pointerup', event => finishPointer(event, true), { capture: true, passive: false });
  canvas.addEventListener('pointercancel', event => finishPointer(event, false), { capture: true, passive: false });
  canvas.addEventListener('lostpointercapture', event => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (pointers.size === 1) {
      const [pointerId, point] = pointers.entries().next().value;
      beginDrag(pointerId, point, false);
    } else if (!pointers.size) resetGesture();
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
