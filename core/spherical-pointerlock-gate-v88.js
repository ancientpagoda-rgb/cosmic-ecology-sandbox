const BUILD = 'v88-right-click-pointer-lock';
const html = document.documentElement;

async function waitForRenderer() {
  for (let attempt = 0; attempt < 360; attempt += 1) {
    const canvas = document.getElementById('eidolonSingleWorldCanvas');
    const renderer = window.realitySandboxSingleSphericalRenderer;
    if (canvas && renderer?.getState) return { canvas, renderer };
    await new Promise(resolve => setTimeout(resolve, 35));
  }
  return null;
}

function install({ canvas, renderer }) {
  if (window.realitySandboxSphericalPointerLockGateV88?.installed) return;

  const nativeRequest = canvas.requestPointerLock?.bind(canvas);
  if (typeof nativeRequest !== 'function') {
    html.dataset.sphericalPointerLockGate = 'unsupported';
    return;
  }

  let allowRequest = false;
  const gatedRequest = (...args) => {
    if (!allowRequest) return Promise.reject(new DOMException('Mouse capture requires right click.', 'NotAllowedError'));
    return nativeRequest(...args);
  };

  try {
    Object.defineProperty(canvas, 'requestPointerLock', {
      configurable: true,
      writable: true,
      value: gatedRequest,
    });
  } catch {
    html.dataset.sphericalPointerLockGate = 'override-failed';
    return;
  }

  function requestFromContextMenu(event) {
    if (renderer.getState().altitude > 80) return;
    event.preventDefault();
    if (document.pointerLockElement === canvas) return;
    allowRequest = true;
    try {
      const result = nativeRequest();
      result?.catch?.(() => {});
    } catch {}
    queueMicrotask(() => { allowRequest = false; });
  }

  function updateHelp() {
    const help = document.getElementById('sphericalInputHelpV88');
    if (!help) return;
    help.textContent = help.textContent.replace(/click view for mouse-look/gi, 'right-click view for mouse-look');
  }

  canvas.addEventListener('contextmenu', requestFromContextMenu, { capture: true });
  const helpTimer = setInterval(updateHelp, 700);
  updateHelp();

  window.realitySandboxSphericalPointerLockGateV88 = {
    installed: true,
    build: BUILD,
    activation: 'right-click',
    destroy() {
      clearInterval(helpTimer);
      canvas.removeEventListener('contextmenu', requestFromContextMenu, { capture: true });
      try { delete canvas.requestPointerLock; } catch {}
    },
  };
  html.dataset.sphericalPointerLockGate = BUILD;
}

waitForRenderer().then(state => {
  if (!state) {
    html.dataset.sphericalPointerLockGate = 'v88-unavailable';
    return;
  }
  install(state);
});
