const CONTROL_ID = 'eidolon-pause-toggle';
const STEP_ID = 'eidolon-step-once';
const SPEED_ID = 'eidolon-playback-speed';
const GROUP_ID = 'eidolon-time-controls';
const STYLE_ID = 'eidolon-pause-control-style';
const SPEEDS = Object.freeze([0.25, 1, 4, 8]);

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
  if (document.getElementById(GROUP_ID)) return;
  const debug = window.realitySandboxDebug;
  if (
    !debug ||
    typeof debug.pause !== 'function' ||
    typeof debug.resume !== 'function' ||
    typeof debug.isPaused !== 'function' ||
    typeof debug.advance !== 'function' ||
    typeof debug.setTimeScale !== 'function' ||
    typeof debug.snapshot !== 'function'
  ) {
    throw new Error('Simulation pause/step/speed API is incomplete.');
  }

  installStyles();

  const group = document.createElement('div');
  group.id = GROUP_ID;
  group.className = 'eidolon-time-controls';

  const button = document.createElement('button');
  button.id = CONTROL_ID;
  button.type = 'button';
  button.className = 'eidolon-pause-control';
  button.setAttribute('aria-live', 'polite');
  button.title = 'Pause or resume the simulation (P)';

  const stepButton = document.createElement('button');
  stepButton.id = STEP_ID;
  stepButton.type = 'button';
  stepButton.className = 'eidolon-step-control';
  stepButton.setAttribute('aria-label', 'Advance one simulation step');
  stepButton.title = 'Advance one simulation step while paused (.)';
  stepButton.innerHTML = '<span aria-hidden="true">▸|</span><span>Step</span>';

  const speedButton = document.createElement('button');
  speedButton.id = SPEED_ID;
  speedButton.type = 'button';
  speedButton.className = 'eidolon-speed-control';
  speedButton.title = 'Cycle simulation playback speed ([ slower, ] faster)';

  const readTimeScale = () => {
    const value = Number(debug.snapshot()?.timeScale);
    return Number.isFinite(value) && value > 0 ? value : 1;
  };

  const update = () => {
    const paused = Boolean(debug.isPaused());
    const timeScale = readTimeScale();
    button.dataset.paused = paused ? 'true' : 'false';
    button.setAttribute('aria-pressed', paused ? 'true' : 'false');
    button.setAttribute('aria-label', paused ? 'Resume simulation' : 'Pause simulation');
    button.innerHTML = paused
      ? '<span class="eidolon-pause-icon" aria-hidden="true">▶</span><span>Resume</span>'
      : '<span class="eidolon-pause-icon" aria-hidden="true">Ⅱ</span><span>Pause</span>';
    stepButton.hidden = !paused;
    group.dataset.paused = paused ? 'true' : 'false';
    speedButton.textContent = `${formatScale(timeScale)}×`;
    speedButton.setAttribute('aria-label', `Simulation playback speed ${formatScale(timeScale)} times`);
    speedButton.dataset.scale = String(timeScale);
  };

  const dispatchState = () => {
    window.dispatchEvent(new CustomEvent('eidolon-pause-state-changed', {
      detail: { paused: Boolean(debug.isPaused()) },
    }));
  };

  const dispatchSpeed = (previous, current, source) => {
    window.dispatchEvent(new CustomEvent('eidolon-time-scale-changed', {
      detail: { previous, current, source },
    }));
  };

  const toggle = () => {
    if (debug.isPaused()) debug.resume();
    else debug.pause();
    update();
    dispatchState();
  };

  const stepOnce = () => {
    if (!debug.isPaused()) return false;
    const before = Number(window.realitySandboxPlanet?.world?.tick);
    debug.advance(1);
    const after = Number(window.realitySandboxPlanet?.world?.tick);
    update();
    window.dispatchEvent(new CustomEvent('eidolon-simulation-stepped', {
      detail: { beforeTick: before, afterTick: after, steps: 1 },
    }));
    return Number.isFinite(before) && Number.isFinite(after) && after > before;
  };

  const setSpeed = (value, source = 'api') => {
    const previous = readTimeScale();
    const current = Number(debug.setTimeScale(value));
    update();
    dispatchSpeed(previous, current, source);
    return current;
  };

  const nearestSpeedIndex = value => {
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < SPEEDS.length; index += 1) {
      const distance = Math.abs(Math.log(SPEEDS[index]) - Math.log(Math.max(0.001, value)));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    return bestIndex;
  };

  const adjustSpeed = (direction, source = 'hotkey') => {
    const current = readTimeScale();
    const index = nearestSpeedIndex(current);
    const next = clamp(index + Math.sign(direction || 1), 0, SPEEDS.length - 1);
    return setSpeed(SPEEDS[next], source);
  };

  const cycleSpeed = () => {
    const current = readTimeScale();
    const index = nearestSpeedIndex(current);
    return setSpeed(SPEEDS[(index + 1) % SPEEDS.length], 'button');
  };

  button.addEventListener('click', toggle);
  stepButton.addEventListener('click', stepOnce);
  speedButton.addEventListener('click', cycleSpeed);
  window.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;

    const key = String(event.key).toLowerCase();
    if (key === 'p') {
      event.preventDefault();
      toggle();
      return;
    }
    if (key === '.' && debug.isPaused()) {
      event.preventDefault();
      stepOnce();
      return;
    }
    if (key === '[') {
      event.preventDefault();
      adjustSpeed(-1, 'hotkey');
      return;
    }
    if (key === ']') {
      event.preventDefault();
      adjustSpeed(1, 'hotkey');
    }
  });

  group.append(button, stepButton, speedButton);
  document.body.append(group);
  update();

  const syncTimer = window.setInterval(update, 250);
  window.addEventListener('pagehide', () => window.clearInterval(syncTimer), { once: true });

  const api = {
    pause() { debug.pause(); update(); dispatchState(); },
    resume() { debug.resume(); update(); dispatchState(); },
    toggle,
    step: stepOnce,
    setSpeed: value => setSpeed(value, 'api'),
    speedUp: () => adjustSpeed(1, 'api'),
    slowDown: () => adjustSpeed(-1, 'api'),
    isPaused: () => Boolean(debug.isPaused()),
    getTimeScale: readTimeScale,
    getSnapshot: () => ({
      version: 3,
      model: 'master-simulation-pause-step-and-playback-speed-control',
      paused: Boolean(debug.isPaused()),
      timeScale: readTimeScale(),
      speedPresets: [...SPEEDS],
      hotkey: 'P',
      stepHotkey: '.',
      slowerHotkey: '[',
      fasterHotkey: ']',
      controlId: CONTROL_ID,
      stepControlId: STEP_ID,
      speedControlId: SPEED_ID,
    }),
  };
  window.realitySandboxPauseControl = api;
  window.realitySandboxPlanet.pauseControl = api;
  window.dispatchEvent(new CustomEvent('eidolon-pause-control-ready', { detail: api.getSnapshot() }));
}

function formatScale(value) {
  if (Math.abs(value - Math.round(value)) < 1e-9) return String(Math.round(value));
  return String(Number(value.toFixed(2)));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .eidolon-time-controls {
      position: fixed;
      left: max(14px, env(safe-area-inset-left));
      bottom: max(14px, env(safe-area-inset-bottom));
      z-index: 10040;
      display: flex;
      align-items: center;
      gap: 7px;
      pointer-events: none;
    }
    .eidolon-pause-control,
    .eidolon-step-control,
    .eidolon-speed-control {
      display: inline-flex;
      align-items: center;
      justify-content: center;
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
      pointer-events: auto;
    }
    .eidolon-speed-control {
      min-width: 48px;
      font-variant-numeric: tabular-nums;
    }
    .eidolon-pause-control:hover,
    .eidolon-step-control:hover,
    .eidolon-speed-control:hover {
      border-color: rgba(190, 255, 225, 0.42);
      background: rgba(8, 28, 23, 0.9);
    }
    .eidolon-pause-control:focus-visible,
    .eidolon-step-control:focus-visible,
    .eidolon-speed-control:focus-visible {
      outline: 2px solid rgba(185, 255, 225, 0.88);
      outline-offset: 3px;
    }
    .eidolon-pause-control[data-paused="true"],
    .eidolon-step-control {
      background: rgba(30, 22, 8, 0.88);
      border-color: rgba(255, 222, 155, 0.42);
      color: rgba(255, 245, 220, 0.98);
    }
    .eidolon-step-control[hidden] {
      display: none !important;
    }
    .eidolon-pause-icon {
      display: inline-grid;
      place-items: center;
      width: 1em;
      font-size: 11px;
      line-height: 1;
    }
    @media (max-width: 720px), (pointer: coarse) {
      .eidolon-time-controls {
        left: max(8px, env(safe-area-inset-left));
        bottom: max(8px, env(safe-area-inset-bottom));
        gap: 6px;
      }
      .eidolon-pause-control,
      .eidolon-step-control,
      .eidolon-speed-control {
        min-height: 44px;
        padding: 10px 13px;
        font-size: 13px;
      }
      .eidolon-speed-control {
        min-width: 52px;
      }
    }
  `;
  document.head.appendChild(style);
}

if (typeof window !== 'undefined') start();
