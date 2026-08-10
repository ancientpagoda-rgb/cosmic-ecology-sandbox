function hideFoundryPanel() {
  const panel = document.querySelector('.planet-foundry');
  if (!panel) return false;
  panel.hidden = true;
  panel.style.setProperty('display', 'none', 'important');
  panel.setAttribute('aria-hidden', 'true');
  document.body.dataset.foundryPanel = 'hidden';
  window.realitySandboxFoundryPanelHidden = true;
  return true;
}

if (!hideFoundryPanel()) {
  const observer = new MutationObserver(() => {
    if (hideFoundryPanel()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
}
