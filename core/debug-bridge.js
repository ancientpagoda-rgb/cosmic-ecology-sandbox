const SPECTOR_URL = 'https://cdn.jsdelivr.net/npm/spectorjs@0.9.30/dist/spector.bundle.js';

export function createDebugBridge(options) {
  const {
    world,
    moduleHost,
    globe,
    groundLevel,
    origin,
    evolution,
    civilization,
    phase8,
    controls,
  } = options;
  const errors = [];
  const warnings = [];
  const events = [];
  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);
  let spector = null;
  let lastCapture = null;
  let panel = null;
  let panelOutput = null;
  let destroyed = false;

  function store(collection, values) {
    collection.push({ at: performance.now(), values: values.map(serializeValue) });
    if (collection.length > 120) collection.splice(0, collection.length - 120);
  }

  console.error = (...values) => {
    store(errors, values);
    originalError(...values);
  };
  console.warn = (...values) => {
    store(warnings, values);
    originalWarn(...values);
  };

  const onError = event => store(errors, [event.error || event.message]);
  const onRejection = event => store(errors, [event.reason]);
  const onHistory = event => {
    events.unshift(event.detail);
    if (events.length > 150) events.length = 150;
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('phase8-history', onHistory);
  window.addEventListener('civilization-history', onHistory);
  window.addEventListener('evolution-event', onHistory);

  function snapshot() {
    return {
      generatedAt: new Date().toISOString(),
      paused: controls.isPaused(),
      timeScale: controls.getTimeScale(),
      tick: world.tick,
      world: {
        width: world.width,
        height: world.height,
        globals: sanitize(world.globals),
        populations: populationCounts(world),
      },
      camera: sanitize(globe.getCameraState?.()),
      ground: sanitize(groundLevel.getState?.()),
      origin: sanitize(origin.getState?.()),
      evolution: sanitize(evolution.getState?.()),
      civilization: sanitize(civilization.getState?.()),
      phase8: sanitize(phase8.getSnapshot?.()),
      modules: moduleHost.list?.().map(item => ({ id: item.id, name: item.name, version: item.version })) || [],
      errors: errors.slice(-40),
      warnings: warnings.slice(-40),
      events: events.slice(0, 80),
      webgl: inspectCanvases(),
    };
  }

  function diagnostics() {
    const phase8Check = phase8.runInvariants?.() || { ok: true, failures: [] };
    const failures = [...phase8Check.failures];
    const state = snapshot();
    if (!state.modules.length) failures.push('no-modules');
    if (!Number.isFinite(state.tick)) failures.push('invalid-world-tick');
    if (!state.webgl.length) failures.push('no-webgl-canvas');
    if (errors.length) failures.push(`runtime-errors:${errors.length}`);
    if (state.phase8?.state && state.phase8.state.communities < 0) failures.push('negative-community-count');
    return {
      ok: failures.length === 0,
      failures,
      phase8: phase8Check,
      errorCount: errors.length,
      warningCount: warnings.length,
      canvasCount: state.webgl.length,
      checkedAt: new Date().toISOString(),
    };
  }

  function pause() {
    controls.setPaused(true);
    refreshPanel();
    return true;
  }

  function resume() {
    controls.setPaused(false);
    refreshPanel();
    return true;
  }

  function advance(steps = 1) {
    const count = clamp(Math.floor(steps), 1, 10000);
    const wasPaused = controls.isPaused();
    controls.setPaused(true);
    for (let index = 0; index < count; index++) controls.stepOnce();
    controls.setPaused(wasPaused);
    refreshPanel();
    return snapshot();
  }

  function setTimeScale(value) {
    controls.setTimeScale(clamp(Number(value) || 1, 0.05, 100));
    refreshPanel();
    return controls.getTimeScale();
  }

  function seedScenario(kind) {
    const result = phase8.debugSeedScenario?.(kind) || { ok: false, reason: 'phase8-debug-unavailable' };
    refreshPanel();
    return result;
  }

  function resetStorage() {
    localStorage.removeItem('reality-sandbox-globe-v1');
    return true;
  }

  async function loadSpector(showUi = false) {
    if (spector) {
      if (showUi) spector.displayUI?.();
      return spector;
    }
    await loadScript(SPECTOR_URL, 'reality-sandbox-spector');
    if (!window.SPECTOR?.Spector) throw new Error('Spector.js did not initialize.');
    spector = new window.SPECTOR.Spector();
    spector.spyCanvases?.();
    if (showUi) spector.displayUI?.();
    return spector;
  }

  async function captureWebGL(canvasIndex = 0) {
    const instance = await loadSpector(false);
    const canvases = [...document.querySelectorAll('canvas')].filter(canvas => {
      try {
        return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
      } catch {
        return false;
      }
    });
    const canvas = canvases[clamp(Math.floor(canvasIndex), 0, Math.max(0, canvases.length - 1))];
    if (!canvas) throw new Error('No WebGL canvas is available for capture.');
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Spector.js capture timed out.')), 12000);
      const listener = capture => {
        clearTimeout(timeout);
        lastCapture = capture;
        resolve({
          canvasIndex,
          width: canvas.width,
          height: canvas.height,
          commandCount: capture?.commands?.length || 0,
          capture,
        });
      };
      instance.onCapture.addOnce?.(listener);
      if (!instance.onCapture.addOnce) instance.onCapture.add(listener);
      instance.captureCanvas(canvas);
    });
  }

  async function showSpector() {
    await loadSpector(true);
    return true;
  }

  function downloadDiagnostics() {
    downloadJson(`reality-sandbox-diagnostics-${Date.now()}.json`, snapshot());
    return true;
  }

  function downloadLastCapture() {
    if (!lastCapture) return false;
    downloadJson(`reality-sandbox-spector-${Date.now()}.json`, lastCapture);
    return true;
  }

  function inspectCanvases() {
    return [...document.querySelectorAll('canvas')].map((canvas, index) => {
      let context = '2d-or-unknown';
      try {
        if (canvas.getContext('webgl2')) context = 'webgl2';
        else if (canvas.getContext('webgl')) context = 'webgl';
      } catch {
        context = 'context-unavailable';
      }
      return {
        index,
        className: canvas.className,
        width: canvas.width,
        height: canvas.height,
        clientWidth: canvas.clientWidth,
        clientHeight: canvas.clientHeight,
        context,
      };
    });
  }

  function createPanel() {
    if (panel || !new URLSearchParams(location.search).has('debug')) return;
    panel = document.createElement('aside');
    panel.setAttribute('aria-label', 'Reality Sandbox debug console');
    panel.style.cssText = 'position:fixed;right:10px;top:10px;z-index:10000;width:min(390px,calc(100vw - 20px));max-height:calc(100vh - 20px);overflow:auto;padding:12px;border:1px solid rgba(117,207,255,.4);border-radius:12px;background:rgba(0,7,13,.92);color:#dff5ff;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;box-shadow:0 18px 60px rgba(0,0,0,.48);backdrop-filter:blur(12px)';
    panel.innerHTML = `
      <header style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:9px"><strong style="color:#91d7ff">REALITY DEBUG BRIDGE</strong><button data-close type="button">×</button></header>
      <div data-buttons style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px"></div>
      <label style="display:flex;gap:8px;align-items:center;margin:9px 0">Speed <input data-speed type="range" min="0.05" max="20" step="0.05" value="1"><output data-speed-output>1×</output></label>
      <pre data-output style="white-space:pre-wrap;word-break:break-word;margin:0;padding:9px;border-radius:8px;background:rgba(134,213,255,.06);max-height:42vh;overflow:auto"></pre>
    `;
    document.body.append(panel);
    panelOutput = panel.querySelector('[data-output]');
    const buttons = [
      ['Pause', pause], ['Resume', resume], ['Step', () => advance(1)], ['+100', () => advance(100)],
      ['Check', () => diagnostics()], ['Industry', () => seedScenario('industrial')], ['Outbreak', () => seedScenario('outbreak')], ['Crisis', () => seedScenario('crisis')],
      ['Snapshot', () => snapshot()], ['Export', downloadDiagnostics], ['Spector', showSpector], ['Capture', () => captureWebGL(0)],
    ];
    const buttonRoot = panel.querySelector('[data-buttons]');
    for (const [label, action] of buttons) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.style.cssText = 'padding:7px 4px;border:1px solid rgba(145,215,255,.25);border-radius:7px;background:rgba(145,215,255,.08);color:#e8f8ff;font:inherit';
      button.addEventListener('click', async () => {
        try {
          const result = await action();
          showPanelResult(result);
        } catch (error) {
          showPanelResult({ error: error.message });
        }
      });
      buttonRoot.append(button);
    }
    const speed = panel.querySelector('[data-speed]');
    const speedOutput = panel.querySelector('[data-speed-output]');
    speed.value = String(controls.getTimeScale());
    speedOutput.textContent = `${Number(speed.value).toFixed(2)}×`;
    speed.addEventListener('input', () => {
      setTimeScale(speed.value);
      speedOutput.textContent = `${Number(speed.value).toFixed(2)}×`;
    });
    panel.querySelector('[data-close]').addEventListener('click', () => panel.remove());
    refreshPanel();
  }

  function showPanelResult(value) {
    if (!panelOutput) return;
    panelOutput.textContent = JSON.stringify(sanitize(value), null, 2).slice(0, 20000);
  }

  function refreshPanel() {
    if (!panelOutput) return;
    showPanelResult({
      paused: controls.isPaused(),
      timeScale: controls.getTimeScale(),
      diagnostics: diagnostics(),
      phase8: phase8.getState?.(),
    });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    console.error = originalError;
    console.warn = originalWarn;
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    window.removeEventListener('phase8-history', onHistory);
    window.removeEventListener('civilization-history', onHistory);
    window.removeEventListener('evolution-event', onHistory);
    panel?.remove();
  }

  const api = {
    version: '1.0.0',
    ready: true,
    pause,
    resume,
    advance,
    setTimeScale,
    snapshot,
    diagnostics,
    seedScenario,
    resetStorage,
    inspectCanvases,
    loadSpector,
    showSpector,
    captureWebGL,
    downloadDiagnostics,
    downloadLastCapture,
    getErrors: () => errors.slice(),
    getWarnings: () => warnings.slice(),
    getLastCapture: () => lastCapture,
    destroy,
  };

  createPanel();
  window.realitySandboxDebug = api;
  window.realitySandboxReady = Promise.resolve(api);
  window.dispatchEvent(new CustomEvent('reality-sandbox-ready', { detail: api }));
  return api;
}

function populationCounts(world) {
  return {
    resources: world.ecs.components.resource.size,
    plants: world.ecs.components.plant.size,
    grazers: world.ecs.components.agent.size,
    predators: world.ecs.components.predator.size,
    apex: world.ecs.components.apex.size,
  };
}

function serializeValue(value) {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  return sanitize(value);
}

function sanitize(value, depth = 0, seen = new WeakSet()) {
  if (depth > 7) return '[max-depth]';
  if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (value instanceof Map) return Object.fromEntries([...value].slice(0, 200).map(([key, item]) => [String(key), sanitize(item, depth + 1, seen)]));
  if (value instanceof Set) return [...value].slice(0, 200).map(item => sanitize(item, depth + 1, seen));
  if (Array.isArray(value)) return value.slice(0, 300).map(item => sanitize(item, depth + 1, seen));
  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 300)) result[key] = sanitize(item, depth + 1, seen);
  return result;
}

function loadScript(src, id) {
  const existing = document.getElementById(id);
  if (existing) return new Promise((resolve, reject) => {
    if (window.SPECTOR) resolve();
    else {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
    }
  });
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.crossOrigin = 'anonymous';
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => reject(new Error(`Unable to load ${src}`)), { once: true });
    document.head.append(script);
  });
}

function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(sanitize(value), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
