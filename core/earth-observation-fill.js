const MOBILE_QUERY = '(max-width: 720px), (pointer: coarse)';
let attempts = 0;

function bootEarthObservationFill() {
  if (window.realitySandboxEarthObservationFill?.ready) return;

  const unified = window.realitySandboxUnified;
  const hifi = window.realitySandboxHifi;
  const canvas = document.getElementById('lofiLivingCanvas');
  if (!unified || !hifi?.ready || typeof hifi.getViewGeometry !== 'function' || !canvas) {
    if (attempts++ < 240) setTimeout(bootEarthObservationFill, 50);
    return;
  }

  const context = canvas.getContext('2d');
  const mobile = matchMedia(MOBILE_QUERY).matches;
  let lastSignature = '';

  const originalUnifiedRender = unified.render.bind(unified);
  unified.render = frame => {
    originalUnifiedRender(frame);
    drawWhenFresh();
  };

  const originalHifiRender = hifi.render.bind(hifi);
  hifi.render = () => {
    originalHifiRender();
    drawObservationFill();
    rememberSignature();
  };

  const originalSnapshot = unified.getSnapshot.bind(unified);
  unified.getSnapshot = () => {
    const snapshot = originalSnapshot();
    snapshot.presentation = {
      ...snapshot.presentation,
      nightObservationFill: true,
      nightObservationFillMode: 'ambient-atmospheric-scattering',
    };
    return snapshot;
  };

  window.realitySandboxEarthObservationFill = {
    ready: true,
    mode: 'ambient-atmospheric-scattering',
    render: () => {
      drawObservationFill();
      rememberSignature();
    },
  };

  drawObservationFill();
  rememberSignature();

  function currentSignature() {
    const camera = unified.getCamera();
    return [
      Math.floor(Date.now() / 60000),
      camera.zoom.toFixed(4),
      camera.centerX.toFixed(5),
      camera.centerY.toFixed(5),
    ].join(':');
  }

  function rememberSignature() {
    lastSignature = currentSignature();
  }

  function drawWhenFresh() {
    const signature = currentSignature();
    if (signature === lastSignature) return;
    lastSignature = signature;
    drawObservationFill();
  }

  function drawObservationFill() {
    const { cx, cy, radius, baseRadius } = hifi.getViewGeometry();
    const visibleRadius = Math.min(radius, baseRadius * 1.02);
    const gradient = context.createRadialGradient(
      cx - visibleRadius * 0.12,
      cy - visibleRadius * 0.16,
      visibleRadius * 0.05,
      cx,
      cy,
      visibleRadius,
    );

    gradient.addColorStop(0, mobile
      ? 'rgba(76, 101, 137, 0.19)'
      : 'rgba(70, 95, 131, 0.17)');
    gradient.addColorStop(0.68, 'rgba(56, 82, 119, 0.13)');
    gradient.addColorStop(1, 'rgba(35, 68, 108, 0.07)');

    context.save();
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.clip();
    context.globalCompositeOperation = 'screen';
    context.fillStyle = gradient;
    context.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    context.restore();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootEarthObservationFill, { once: true });
} else {
  bootEarthObservationFill();
}
