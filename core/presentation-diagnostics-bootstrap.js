const diagnosticState = {
  bootstrapLoaded: true,
  bootstrapTime: new Date().toISOString(),
  presentationError: '',
  rejection: '',
};

window.addEventListener('error', event => {
  const source = String(event.filename || '');
  if (/presentation-layer-fix|morphology-genetics|high-resolution-renderer/.test(source)) {
    diagnosticState.presentationError = `${event.message || 'error'} @ ${source}:${event.lineno || 0}:${event.colno || 0}`;
  }
});

window.addEventListener('unhandledrejection', event => {
  const message = String(event.reason?.stack || event.reason?.message || event.reason || 'unhandled rejection');
  if (/presentation|morphology|svg|webgl|pixi/i.test(message)) diagnosticState.rejection = message;
});

window.realitySandboxPresentationDiagnostics = () => {
  const canvas = document.getElementById('lofiLivingCanvas');
  const morphology = document.getElementById('morphologyOverlay');
  const weatherCanvas = document.getElementById('weatherPresentationCanvas');
  const visibleAnimalGroups = morphology
    ? [...morphology.querySelectorAll(':scope > g')].filter(group => getComputedStyle(group).display !== 'none').length
    : 0;

  return {
    bootstrapLoaded: diagnosticState.bootstrapLoaded,
    presentationFixInstalled: document.documentElement.dataset.presentationLayerFix || 'no',
    presentationError: diagnosticState.presentationError,
    rejection: diagnosticState.rejection,
    webglContext: document.documentElement.dataset.webglContext || 'unknown',
    totalWeatherCells: Number(document.documentElement.dataset.totalWeatherCells || 0),
    visibleWeatherCells: Number(document.documentElement.dataset.visibleWeatherCells || 0),
    visibleAnimalMorphology: Number(document.documentElement.dataset.visibleAnimalMorphology || visibleAnimalGroups || 0),
    morphologyPresent: Boolean(morphology),
    morphologyChildren: morphology?.children.length || 0,
    weatherCanvasPresent: Boolean(weatherCanvas),
    renderResolution: canvas ? `${canvas.width}x${canvas.height}` : 'no canvas',
    internalResolutionScale: document.documentElement.dataset.internalResolutionScale || 'unknown',
    runtimeReady: Boolean(window.realitySandboxUnified),
    planetReady: Boolean(window.realitySandboxPlanet),
  };
};

document.documentElement.dataset.presentationDiagnosticsBootstrap = 'active';
