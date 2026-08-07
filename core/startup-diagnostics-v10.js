const startupState = {
  loaded: true,
  loadedAt: new Date().toISOString(),
  lastError: '',
  lastErrorSource: '',
  rejection: '',
  readyStateAtLoad: document.readyState,
};

window.addEventListener('error', event => {
  startupState.lastError = String(event.message || event.error?.message || 'window error');
  startupState.lastErrorSource = `${event.filename || 'unknown'}:${event.lineno || 0}:${event.colno || 0}`;
}, true);

window.addEventListener('unhandledrejection', event => {
  startupState.rejection = String(event.reason?.stack || event.reason?.message || event.reason || 'unhandled rejection');
}, true);

function inspectReadyPromise() {
  return {
    present: Boolean(window.realitySandboxReady),
    type: typeof window.realitySandboxReady,
  };
}

window.realitySandboxPresentationDiagnostics = () => {
  const canvas = document.getElementById('lofiLivingCanvas');
  const morphology = document.getElementById('morphologyOverlay');
  const weatherCanvas = document.getElementById('weatherPresentationCanvas');
  const errorPanel = document.getElementById('errorState');
  const visibleAnimalGroups = morphology
    ? [...morphology.children].filter(group => group.tagName?.toLowerCase() === 'g' && getComputedStyle(group).display !== 'none').length
    : 0;

  return {
    diagnosticsVersion: 10,
    bootstrapLoaded: true,
    documentReadyState: document.readyState,
    readyStateAtBootstrap: startupState.readyStateAtLoad,
    readyPromise: inspectReadyPromise(),
    runtimeReady: Boolean(window.realitySandboxUnified),
    planetReady: Boolean(window.realitySandboxPlanet),
    debugApiReady: Boolean(window.realitySandboxDebug),
    canvasPresent: Boolean(canvas),
    renderResolution: canvas ? `${canvas.width}x${canvas.height}` : 'no canvas',
    internalResolutionScale: document.documentElement.dataset.internalResolutionScale || 'unknown',
    morphologyPresent: Boolean(morphology),
    morphologyChildren: morphology?.children.length || 0,
    visibleAnimalMorphology: Number(document.documentElement.dataset.visibleAnimalMorphology || visibleAnimalGroups || 0),
    weatherCanvasPresent: Boolean(weatherCanvas),
    totalWeatherCells: Number(document.documentElement.dataset.totalWeatherCells || 0),
    visibleWeatherCells: Number(document.documentElement.dataset.visibleWeatherCells || 0),
    presentationFixInstalled: document.documentElement.dataset.presentationLayerFix || 'no',
    webglContext: document.documentElement.dataset.webglContext || 'unknown',
    pageErrorVisible: Boolean(errorPanel && !errorPanel.hidden),
    pageErrorText: errorPanel?.textContent || '',
    lastError: startupState.lastError,
    lastErrorSource: startupState.lastErrorSource,
    rejection: startupState.rejection,
  };
};

document.documentElement.dataset.startupDiagnostics = 'v10';
