import '../reality-v6-8/bootstrap.js';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const badge = document.querySelector('.badge');
const loading = document.getElementById('loading');
const buildStatus = document.getElementById('systemBuildStatus');
const hud = document.getElementById('hud');
const hudToggle = document.getElementById('hudToggle');
const worldSpeed = document.getElementById('speed');
const HUD_COLLAPSED_KEY = 'reality-v6-9-hud-collapsed';
let lastWorldSpeed = '1';

function loadHudPreference() {
  try {
    const stored = localStorage.getItem(HUD_COLLAPSED_KEY);
    if (stored !== null) return stored === 'true';
  } catch (_) {}
  return matchMedia('(max-width: 720px), (max-height: 700px)').matches;
}

function setHudCollapsed(collapsed, persist = true) {
  hud?.classList.toggle('is-collapsed', collapsed);
  if (hudToggle) {
    hudToggle.textContent = collapsed ? 'Show controls' : 'Hide controls';
    hudToggle.setAttribute('aria-expanded', String(!collapsed));
  }
  if (persist) {
    try { localStorage.setItem(HUD_COLLAPSED_KEY, String(collapsed)); } catch (_) {}
  }
}

function interactiveControlFocused() {
  const tagName = document.activeElement?.tagName;
  return tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA'
    || tagName === 'BUTTON' || tagName === 'A'
    || document.activeElement?.isContentEditable;
}

setHudCollapsed(loadHudPreference(), false);
hudToggle?.addEventListener('click', () => {
  setHudCollapsed(!hud?.classList.contains('is-collapsed'));
});
document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || interactiveControlFocused()) return;
  if (event.code === 'KeyH') {
    event.preventDefault();
    setHudCollapsed(!hud?.classList.contains('is-collapsed'));
  } else if (event.code === 'Space' && !document.body.classList.contains('system-active')) {
    event.preventDefault();
    if (!worldSpeed) return;
    if (worldSpeed.value === '0') worldSpeed.value = lastWorldSpeed;
    else {
      lastWorldSpeed = worldSpeed.value;
      worldSpeed.value = '0';
    }
    worldSpeed.dispatchEvent(new Event('input', { bubbles: true }));
    worldSpeed.dispatchEvent(new Event('change', { bubbles: true }));
  }
});

try {
  if (localStorage.getItem('reality-v6-9-audio-volume') === null) {
    localStorage.setItem('reality-v6-9-audio-volume', '0.58');
  }
  if (localStorage.getItem('reality-v6-9-audio-muted') === null) {
    localStorage.setItem('reality-v6-9-audio-muted', 'false');
  }
} catch (_) {}

async function waitForPresentation() {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (
      globalThis.realityV6?.viewer &&
      globalThis.realityV61?.weather &&
      globalThis.realityV65?.coupling &&
      globalThis.realityV68?.presentation
    ) return globalThis.realityV68;
    await sleep(100);
  }
  throw new Error('The V6.8 PixiJS world did not become ready for Howler.js.');
}

function showFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[Reality V6.9 Howler.js]', error);
  const inspect = document.getElementById('inspect');
  if (inspect) inspect.textContent = `The visual simulation is running; audio failed: ${message}`;
  for (const id of ['audioStatus', 'audioStatusSystem']) {
    const element = document.getElementById(id);
    if (element) element.textContent = `Audio unavailable · ${message}`;
  }
}

try {
  await waitForPresentation();
  if (badge) badge.textContent = 'ENGINE V6.9 · HOWLER.JS GENERATIVE SOUNDSCAPE';
  if (buildStatus) buildStatus.textContent = 'PixiJS ready · preparing optional deterministic audio controls…';
  const { createHowlerSoundscape } = await import('./soundscape.js');
  const soundscape = await createHowlerSoundscape();
  if (loading?.isConnected) loading.remove();
  if (buildStatus) buildStatus.textContent = 'Howler.js 2.2.4 · audio unlocks on user input · Three.js and REBOUND remain on demand';
  const inspect = document.getElementById('inspect');
  if (inspect) inspect.textContent = 'Click Sound start for deterministic weather, settlement, tide, seasonal, impact, orbital, and travel audio.';
  globalThis.realityV69 = {
    soundscape,
    start: () => soundscape.start(),
    mute: (muted = true) => soundscape.setMuted(muted),
    setVolume: (volume) => soundscape.setVolume(volume),
  };
} catch (error) {
  showFailure(error);
}
