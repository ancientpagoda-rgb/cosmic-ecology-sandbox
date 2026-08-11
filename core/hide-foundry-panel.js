const PANELS = [
  {
    selector: '.planet-foundry',
    datasetKey: 'foundryPanel',
    globalKey: 'realitySandboxFoundryPanelHidden',
  },
  {
    selector: '.planet-pulse',
    datasetKey: 'planetPulsePanel',
    globalKey: 'realitySandboxPlanetPulseHidden',
  },
  {
    selector: '#enterSurfaceMode',
    datasetKey: 'legacySurfaceEnter',
    globalKey: 'realitySandboxLegacySurfaceEnterHidden',
  },
  {
    selector: '#surfaceModeHud button',
    datasetKey: 'legacySurfaceExit',
    globalKey: 'realitySandboxLegacySurfaceExitHidden',
  },
];

function hidePanel({ selector, datasetKey, globalKey }) {
  const panel = document.querySelector(selector);
  if (!panel) return false;
  panel.hidden = true;
  panel.style.setProperty('display', 'none', 'important');
  panel.setAttribute('aria-hidden', 'true');
  document.body.dataset[datasetKey] = 'hidden';
  window[globalKey] = true;
  return true;
}

function hideInterfacePanels() {
  return PANELS.map(hidePanel).every(Boolean);
}

if (!hideInterfacePanels()) {
  const observer = new MutationObserver(() => {
    if (hideInterfacePanels()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
}
