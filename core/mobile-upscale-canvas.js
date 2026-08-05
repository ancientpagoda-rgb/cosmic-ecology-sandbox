const MOBILE_QUERY = '(max-width: 720px), (pointer: coarse)';
const DISPLAY_SIZE = { width: 768, height: 432 };
let attempts = 0;

function bootMobileUpscale() {
  if (window.realitySandboxMobileUpscale?.ready) return;

  const mobile = matchMedia(MOBILE_QUERY).matches;
  if (!mobile) {
    window.realitySandboxMobileUpscale = { ready: true, active: false };
    return;
  }

  const unified = window.realitySandboxUnified;
  const hifi = window.realitySandboxHifi;
  const clouds = window.realitySandboxLilacClouds;
  const rain = window.realitySandboxRainRunoff;
  const source = document.getElementById('lofiLivingCanvas');
  if (!unified || !hifi?.ready || !clouds?.ready || !rain?.ready || !source) {
    if (attempts++ < 240) setTimeout(bootMobileUpscale, 25);
    return;
  }

  const internalSize = { width: source.width, height: source.height };
  source.id = 'lofiLivingCanvasLowRes';
  source.tabIndex = -1;
  source.setAttribute('aria-hidden', 'true');
  source.style.position = 'fixed';
  source.style.left = '-10000px';
  source.style.top = '-10000px';
  source.style.width = '1px';
  source.style.height = '1px';
  source.style.opacity = '0';
  source.style.pointerEvents = 'none';

  const display = document.createElement('canvas');
  display.id = 'lofiLivingCanvas';
  display.className = source.className;
  display.width = DISPLAY_SIZE.width;
  display.height = DISPLAY_SIZE.height;
  display.tabIndex = 0;
  display.setAttribute('role', 'application');
  display.setAttribute('aria-label', 'Scientific Earth model with direct touch rotation and pinch zoom.');
  source.after(display);

  const context = display.getContext('2d', { alpha: false, desynchronized: true });
  context.imageSmoothingEnabled = true;
  let copyQueued = false;

  function copyFrame() {
    copyQueued = false;
    context.clearRect(0, 0, display.width, display.height);
    context.drawImage(source, 0, 0, display.width, display.height);
  }

  function queueCopy() {
    if (copyQueued) return;
    copyQueued = true;
    requestAnimationFrame(copyFrame);
  }

  const originalUnifiedRender = unified.render.bind(unified);
  unified.render = frame => {
    originalUnifiedRender(frame);
    queueCopy();
  };

  const originalHifiRender = hifi.render.bind(hifi);
  hifi.render = () => {
    originalHifiRender();
    copyFrame();
  };

  const originalCloudRender = clouds.render.bind(clouds);
  clouds.render = () => {
    originalCloudRender();
    copyFrame();
  };

  const originalRainRender = rain.render.bind(rain);
  rain.render = () => {
    originalRainRender();
    copyFrame();
  };

  const originalGetState = hifi.getState.bind(hifi);
  hifi.getState = () => ({
    ...originalGetState(),
    width: display.width,
    height: display.height,
    internalWidth: internalSize.width,
    internalHeight: internalSize.height,
    mobileUpscale: true,
  });
  hifi.canvas = display;
  hifi.buffer = {
    width: display.width,
    height: display.height,
    internalWidth: internalSize.width,
    internalHeight: internalSize.height,
  };

  window.realitySandboxMobileUpscale = {
    ready: true,
    active: true,
    source,
    canvas: display,
    internalSize,
    displaySize: { ...DISPLAY_SIZE },
    copyFrame,
    getState: () => ({
      ready: true,
      active: true,
      internalSize: { ...internalSize },
      displaySize: { ...DISPLAY_SIZE },
    }),
  };

  copyFrame();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootMobileUpscale, { once: true });
} else {
  bootMobileUpscale();
}
