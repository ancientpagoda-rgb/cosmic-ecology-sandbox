const hud = document.querySelector('.hud');
const toggle = document.getElementById('hudToggle');
const speed = document.getElementById('speed');
const speedOut = document.getElementById('speedOut');
const STORAGE_KEY = 'reality-v6-7-controls-collapsed';

function setCollapsed(collapsed, persist = true) {
  if (!hud || !toggle) return;
  hud.classList.toggle('controls-collapsed', collapsed);
  toggle.textContent = collapsed ? 'Show controls' : 'Hide controls';
  toggle.setAttribute('aria-expanded', String(!collapsed));
  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0'); } catch {}
  }
}

function initialCollapsed() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return stored === '1';
  } catch {}
  return matchMedia('(max-width: 650px), (max-height: 700px)').matches;
}

toggle?.addEventListener('click', () => {
  setCollapsed(!hud.classList.contains('controls-collapsed'));
});

function isTyping(target) {
  return target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(target.tagName));
}

function setWorldSpeed(value) {
  if (!speed) return;
  speed.value = String(value);
  speed.dispatchEvent(new Event('input', { bubbles: true }));
  speed.dispatchEvent(new Event('change', { bubbles: true }));
}

let priorSpeed = 1;
addEventListener('keydown', (event) => {
  if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;

  if (event.key.toLowerCase() === 'h') {
    event.preventDefault();
    toggle?.click();
  } else if (event.code === 'Space' && !document.body.classList.contains('system-active')) {
    event.preventDefault();
    const current = Number(speed?.value || 0);
    if (current > 0) {
      priorSpeed = current;
      setWorldSpeed(0);
    } else {
      setWorldSpeed(Math.max(1, priorSpeed));
    }
  } else if (event.key === 'Escape' && document.body.classList.contains('system-active')) {
    event.preventDefault();
    document.getElementById('returnSurface')?.click();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) document.documentElement.dataset.realityHidden = 'true';
  else delete document.documentElement.dataset.realityHidden;
});

setCollapsed(initialCollapsed(), false);
toggle?.setAttribute('title', 'Toggle controls (H) · Space pauses/plays world · Esc returns to planet');
speedOut?.setAttribute('aria-live', 'polite');
