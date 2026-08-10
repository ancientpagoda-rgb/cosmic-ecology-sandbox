const CONTROL_ID = 'eidolon-pause-toggle';
const STYLE_ID = 'eidolon-pause-control-style';

async function start() {
  try {
    if (document.readyState === 'loading') {
      await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    }
    const ready = window.realitySandboxReady;
    if (ready && typeof ready.then === 'function') await ready;
    await waitForDebugApi();
    installPauseControl();
  } catch (error) {
    console.warn('[pause-control] disabled:', error);
  }
}

function waitForDebugApi() {
  if (window.realitySandboxDebug?.ready) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const poll = () => {
      if (window.realitySandboxDebug?.ready) return resolve();
      if (performance.now() - started > 10000) return reject(new Error('Simulation pause API did not become available.'));
      setTimeout(poll, 25);
    };
    poll();
  });
}

function installPauseControl() {
  if (document.getElementById(CONTROL_ID)) return;
  const debug = window.realitySandboxDebug;
  if (!debug || typeof debug.pause !== 'function' || typeof debug.resume !== 'function' || typeof debug.isPaused !== 'function') {
    throw new Error('Simulation pause API is incomplete.');
  }

  installStyles();

  const button = document.createElement('button');
  button.id = CONTROL_ID;
  button.type = 'button';
  button.className = 'eidolon-pause-control';
  button.setAttribute('aria-live', 'polite');
  button.title = 'Pause or resume the simulation (P)';

  const update = () => {
    const paused = Boolean(debug.isPaused());
    button.dataset.paused = paused ? 'true' : 'false';
    button.setAttribute('aria-pressed', paused ? 'true' : 'false');
    button.setAttribute('aria-label', paused ? 'Resume simulation' : 'Pause simulation');
    button.innerHTML = paused
      ? '<span class="eidolon-pause-icon" aria-hidden="true">▶</span><span>Resume</span>'
      : '<span class="eidolon-pause-icon" aria-hidden="true">Ⅱ</span><span>Pause</span>';
  };

  const toggle = () => {
    if (debug.isPaused()) debug.resume();
    else debug.pause();
    update();
    window.dispatchEvent(new CustomEvent('eidolon-pause-state-changed', {
      detail: { paused: Boolean(debug.isPaused()) },
    }));
  };

  button.addEventListener('click', toggle);
  window.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    if (String(event.key).toLowerCase() !== 'p') return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    event.preventDefault();
    toggle();
  });

  document.body.appendChild(button);
  update();

  const syncTimer = window.setInterval(update, 250);
  window.addEventListener('pagehide', () => window.clearInterval(syncTimer), { once: true });

  const api = {
    pause() { debug.pause(); update(); },
    resume() { debug.resume(); update(); },
    toggle,
    isPaused: () => Boolean(debug.isPaused()),
    getSnapshot: () => ({
      version: 1,
      model: 'master-simulation-pause-control',
      paused: Boolean(debug.isPaused()),
      hotkey: 'P',
      controlId: CONTROL_ID,
    }),
  };
  window.realitySandboxPauseControl = api;
  window.realitySandboxPlanet.pauseControl = api;
  window.dispatchEvent(new CustomEvent('eidolon-pause-control-ready', { detail: api.getSnapshot() }));
}

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .eidolon-pause-control {
      position: fixed;
      left: max(14px, env(safe-area-inset-left));
      bottom: max(14px, env(safe-area-inset-bottom));
      z-index: 10040;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      min-height: 38px;
      padding: 8px 12px;
      border: 1px solid rgba(190, 255, 225, 0.24);
      border-radius: 999px;
      background: rgba(5, 18, 15, 0.82);
      color: rgba(239, 255, 249, 0.96);
      box-shadow: 0 5px 20px rgba(0, 0, 0, 0.28);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      font: 600 12px/1.1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0.02em;
      cursor: pointer;
      user-select: none;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }
    .eidolon-pause-control:hover {
      border-color: rgba(190, 255, 225, 0.42);
      background: rgba(8, 28, 23, 0.9);
    }
    .eidolon-pause-control:focus-visible {
      outline: 2px solid rgba(185, 255, 225, 0.88);
      outline-offset: 3px;
    }
    .eidolon-pause-control[data-paused="true"] {
      background: rgba(30, 22, 8, 0.88);
      border-color: rgba(255, 222, 155, 0.42);
      color: rgba(255, 245, 220, 0.98);
    }
    .eidolon-pause-icon {
      display: inline-grid;
      place-items: center;
      width: 1em;
      font-size: 11px;
      line-height: 1;
    }
    @media (max-width: 720px), (pointer: coarse) {
      .eidolon-pause-control {
        min-height: 44px;
        padding: 10px 14px;
        font-size: 13px;
      }
    }
  `;
  document.head.appendChild(style);
}

if (typeof window !== 'undefined') start();
