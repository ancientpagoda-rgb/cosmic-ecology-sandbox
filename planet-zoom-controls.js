const canvas = document.getElementById('planet');
const zoomInput = document.getElementById('zoom');
const pointers = new Map();
let pinchStartDistance = 0;
let pinchStartZoom = Number(zoomInput.value) || 0.56;

function setZoom(value) {
  const zoom = Math.max(0, Math.min(1, value));
  zoomInput.value = String(zoom);
  zoomInput.dispatchEvent(new Event('input', { bubbles: true }));
}

function pointerDistance() {
  const values = [...pointers.values()];
  if (values.length < 2) return 0;
  return Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
}

canvas.addEventListener('pointerdown', event => {
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 2) {
    pinchStartDistance = pointerDistance();
    pinchStartZoom = Number(zoomInput.value) || 0.56;
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);

canvas.addEventListener('pointermove', event => {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size >= 2) {
    const distance = pointerDistance();
    if (pinchStartDistance > 0) {
      setZoom(pinchStartZoom + (distance - pinchStartDistance) / 260);
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);

function releasePointer(event) {
  pointers.delete(event.pointerId);
  if (pointers.size < 2) pinchStartDistance = 0;
}
canvas.addEventListener('pointerup', releasePointer, true);
canvas.addEventListener('pointercancel', releasePointer, true);
canvas.addEventListener('lostpointercapture', releasePointer, true);

canvas.addEventListener('wheel', event => {
  event.preventDefault();
  setZoom(Number(zoomInput.value) - event.deltaY * 0.0012);
}, { passive: false });
