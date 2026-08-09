const PANEL_STORAGE_KEY = 'reality-sandbox-panel-state-v3';
const PANEL_DEFINITIONS = [
  ['.planet-dashboard', 'overview', 'overview panel'],
  ['.planet-inspector', 'inspector', 'region inspector'],
  ['.planet-legend', 'legend', 'map legend'],
];
const compactLayout = matchMedia('(max-width: 800px)').matches;
const DEFAULT_PANEL_STATE = compactLayout
  ? { overview: true, inspector: true, legend: true }
  : { overview: false, inspector: true, legend: true };

let panelState = readPanelState();
let fittedCanvas = null;
let canvasAttributeObserver = null;
let resizeFrame = 0;

function readPanelState() {
  try {
    const stored = JSON.parse(localStorage.getItem(PANEL_STORAGE_KEY) || '{}');
    return stored && typeof stored === 'object'
      ? { ...DEFAULT_PANEL_STATE, ...stored }
      : { ...DEFAULT_PANEL_STATE };
  } catch {
    return { ...DEFAULT_PANEL_STATE };
  }
}

function savePanelState() {
  try { localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(panelState)); }
  catch { /* Storage may be unavailable in private browsing. */ }
}

function setPanelCollapsed(panel, key, label, collapsed) {
  panel.classList.toggle('is-collapsed', collapsed);
  panel.dataset.collapsed = String(collapsed);
  const button = panel.querySelector(':scope > .planet-panel-toggle');
  if (!button) return;
  button.textContent = collapsed ? '+' : '−';
  button.setAttribute('aria-expanded', String(!collapsed));
  button.setAttribute('aria-label', `${collapsed ? 'Restore' : 'Minimize'} ${label}`);
  button.title = `${collapsed ? 'Restore' : 'Minimize'} ${label}`;
}

function enhancePanel(panel, key, label) {
  if (panel.dataset.minimizable === 'true') return;
  panel.dataset.minimizable = 'true';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'planet-panel-toggle';
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    const collapsed = !panel.classList.contains('is-collapsed');
    panelState[key] = collapsed;
    setPanelCollapsed(panel, key, label, collapsed);
    savePanelState();
  });
  panel.prepend(button);
  setPanelCollapsed(panel, key, label, Boolean(panelState[key]));
}

function enhancePanels(root = document) {
  for (const [selector, key, label] of PANEL_DEFINITIONS) {
    for (const panel of root.querySelectorAll(selector)) enhancePanel(panel, key, label);
  }
}

function scheduleCanvasFit() {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(fitCanvasWithoutStretching);
}

function observeCanvas(canvas) {
  if (fittedCanvas === canvas) return;
  canvasAttributeObserver?.disconnect();
  fittedCanvas = canvas;
  canvasAttributeObserver = new MutationObserver(scheduleCanvasFit);
  canvasAttributeObserver.observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] });
  scheduleCanvasFit();
}

function fitCanvasWithoutStretching() {
  resizeFrame = 0;
  const host = document.getElementById('world');
  const canvas = document.getElementById('lofiLivingCanvas');
  if (!host || !canvas) return;
  observeCanvas(canvas);

  const hostRect = host.getBoundingClientRect();
  const sourceWidth = Math.max(1, canvas.width || 1);
  const sourceHeight = Math.max(1, canvas.height || 1);
  if (!hostRect.width || !hostRect.height || !sourceWidth || !sourceHeight) return;

  const sourceAspect = sourceWidth / sourceHeight;
  const hostAspect = hostRect.width / hostRect.height;
  let width;
  let height;
  if (hostAspect > sourceAspect) {
    height = hostRect.height;
    width = height * sourceAspect;
  } else {
    width = hostRect.width;
    height = width / sourceAspect;
  }

  Object.assign(canvas.style, {
    inset: 'auto',
    left: '50%',
    top: '50%',
    right: 'auto',
    bottom: 'auto',
    width: `${Math.max(1, Math.round(width))}px`,
    height: `${Math.max(1, Math.round(height))}px`,
    transform: 'translate(-50%, -50%)',
    transformOrigin: 'center center',
  });
  canvas.dataset.aspectFitted = 'true';
}

function scan(root = document) {
  enhancePanels(root);
  const canvas = document.getElementById('lofiLivingCanvas');
  if (canvas) observeCanvas(canvas);
}

const world = document.getElementById('world') || document.body;
const observer = new MutationObserver(records => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) scan(node);
    }
  }
  scan();
});
observer.observe(world, { childList: true, subtree: true });

window.addEventListener('resize', scheduleCanvasFit, { passive: true });
window.visualViewport?.addEventListener('resize', scheduleCanvasFit, { passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleCanvasFit(); });
scan();
