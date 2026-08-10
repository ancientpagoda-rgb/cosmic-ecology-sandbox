const CONTROL_ID = 'eidolon-creature-follow';
const STYLE_ID = 'eidolon-creature-follow-style';
const FOLLOW_INTERVAL_MS = 80;
const MIN_FOLLOW_ZOOM = 2.15;

async function start() {
  try {
    await domReady();
    await waitForInspectionStack();
    const planet = window.realitySandboxPlanet;
    const runtime = window.realitySandboxUnified;
    const inspector = window.realitySandboxCreatureInspector;
    if (!planet?.world?.ecs || !runtime?.setCamera || !runtime?.getCamera || !inspector) {
      throw new Error('Creature follow dependencies are unavailable.');
    }

    const api = installCreatureFollow({ planet, runtime, inspector });
    planet.creatureFollow = api;
    window.realitySandboxCreatureFollow = api;
    window.dispatchEvent(new CustomEvent('eidolon-creature-follow-ready', { detail: api.getSnapshot() }));
    window.addEventListener('pagehide', api.destroy, { once: true });
  } catch (error) {
    console.warn('[creature-follow] disabled:', error);
  }
}

function domReady() {
  if (document.readyState !== 'loading') return Promise.resolve();
  return new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
}

function waitForInspectionStack() {
  if (window.realitySandboxCreatureInspector && window.realitySandboxUnified?.setCamera) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const poll = () => {
      if (window.realitySandboxCreatureInspector && window.realitySandboxUnified?.setCamera) return resolve();
      if (performance.now() - started > 12000) return reject(new Error('Creature inspector did not become ready.'));
      setTimeout(poll, 25);
    };
    poll();
  });
}

export function installCreatureFollow({ planet, runtime, inspector }) {
  if (window.realitySandboxCreatureFollow) return window.realitySandboxCreatureFollow;
  injectStyles();

  const panel = document.getElementById('eidolon-creature-inspector');
  const header = panel?.querySelector('.eidolon-creature-inspector__header');
  const close = panel?.querySelector('.eidolon-creature-inspector__close');
  const canvas = document.getElementById('lofiLivingCanvas');
  if (!panel || !header || !close || !canvas) throw new Error('Creature follow interface is unavailable.');

  const button = document.createElement('button');
  button.id = CONTROL_ID;
  button.type = 'button';
  button.className = 'eidolon-creature-follow';
  button.setAttribute('aria-pressed', 'false');
  button.textContent = 'Follow';
  button.title = 'Keep the camera centered on this creature';
  header.insertBefore(button, close);

  let active = true;
  let following = false;
  let followedEntityId = null;
  let followUpdates = 0;
  let manualCancellations = 0;
  let lostTargetCancellations = 0;
  let lastPosition = null;
  let lastCamera = null;

  function currentSelectedId() {
    const raw = inspector.getSnapshot?.().selectedEntityId;
    if (raw == null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  function setFollowing(value, source = 'api') {
    const selectedId = currentSelectedId();
    const next = Boolean(value && selectedId != null);
    following = next;
    followedEntityId = next ? selectedId : null;
    updateButton();
    if (next) updateCamera(true);
    window.dispatchEvent(new CustomEvent('eidolon-creature-follow-changed', {
      detail: { following, entityId: followedEntityId, source },
    }));
    return following;
  }

  function toggle() {
    return setFollowing(!following, 'button');
  }

  function updateButton() {
    const selectedId = currentSelectedId();
    button.hidden = selectedId == null;
    button.dataset.following = following ? 'true' : 'false';
    button.setAttribute('aria-pressed', following ? 'true' : 'false');
    button.textContent = following ? 'Following' : 'Follow';
  }

  function findPosition(id) {
    if (id == null) return null;
    const c = planet.world.ecs.components;
    const position = c.position?.get(id);
    const living = c.agent?.has(id) || c.predator?.has(id) || c.apex?.has(id);
    return living && position ? position : null;
  }

  function updateCamera(forceZoom = false) {
    if (!following || followedEntityId == null) return false;
    const selectedId = currentSelectedId();
    if (selectedId !== followedEntityId) {
      setFollowing(false, 'selection-changed');
      return false;
    }
    const position = findPosition(followedEntityId);
    if (!position) {
      lostTargetCancellations += 1;
      setFollowing(false, 'target-lost');
      return false;
    }
    const camera = runtime.getCamera();
    const zoom = forceZoom ? Math.max(Number(camera.zoom) || 1, MIN_FOLLOW_ZOOM) : camera.zoom;
    lastCamera = runtime.setCamera({
      centerX: position.x / planet.world.width,
      centerY: position.y / planet.world.height,
      zoom,
    });
    lastPosition = { x: position.x, y: position.y };
    followUpdates += 1;
    return true;
  }

  function cancelForManualInteraction(event) {
    if (!following || !eventInsideGlobe(event)) return;
    manualCancellations += 1;
    setFollowing(false, 'manual-camera');
  }

  function eventInsideGlobe(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('#eidolon-creature-inspector, #eidolon-time-controls, .eidolon-creature')) return false;
    const x = Number(event.clientX);
    const y = Number(event.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return target === canvas;
    const rect = canvas.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function onSelected() {
    if (following) setFollowing(false, 'new-selection');
    updateButton();
  }

  function onCleared() {
    if (following) setFollowing(false, 'selection-cleared');
    updateButton();
  }

  button.addEventListener('click', toggle);
  window.addEventListener('eidolon-creature-selected', onSelected);
  window.addEventListener('eidolon-creature-selection-cleared', onCleared);
  document.addEventListener('pointerdown', cancelForManualInteraction, true);
  document.addEventListener('wheel', cancelForManualInteraction, { capture: true, passive: true });

  const timer = window.setInterval(() => {
    if (!active) return;
    updateButton();
    if (following) updateCamera(false);
  }, FOLLOW_INTERVAL_MS);
  updateButton();

  function getSnapshot() {
    return {
      version: 2,
      model: 'selected-ecs-entity-camera-follow-with-coordinate-manual-override',
      following,
      followedEntityId,
      followUpdates,
      manualCancellations,
      lostTargetCancellations,
      minFollowZoom: MIN_FOLLOW_ZOOM,
      lastPosition: lastPosition ? { ...lastPosition } : null,
      lastCamera: lastCamera ? { ...lastCamera } : null,
      controlId: CONTROL_ID,
    };
  }

  function destroy() {
    active = false;
    window.clearInterval(timer);
    button.removeEventListener('click', toggle);
    window.removeEventListener('eidolon-creature-selected', onSelected);
    window.removeEventListener('eidolon-creature-selection-cleared', onCleared);
    document.removeEventListener('pointerdown', cancelForManualInteraction, true);
    document.removeEventListener('wheel', cancelForManualInteraction, true);
    button.remove();
  }

  return {
    follow: () => setFollowing(true, 'api'),
    stop: () => setFollowing(false, 'api'),
    toggle,
    update: () => updateCamera(false),
    getSnapshot,
    destroy,
  };
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .eidolon-creature-follow{
      margin-left:auto;align-self:flex-start;padding:5px 8px;border:1px solid rgb(190 255 225/.22);border-radius:999px;
      background:rgb(8 28 23/.76);color:#dff6eb;font:600 10px/1 system-ui,sans-serif;letter-spacing:.025em;cursor:pointer
    }
    .eidolon-creature-follow[hidden]{display:none!important}
    .eidolon-creature-follow[data-following="true"]{border-color:rgb(255 232 158/.48);background:rgb(45 34 10/.88);color:#fff4c8}
    .eidolon-creature-follow:focus-visible{outline:2px solid rgb(185 255 225/.88);outline-offset:2px}
    @media(max-width:720px),(pointer:coarse){.eidolon-creature-follow{min-height:32px;padding:7px 10px;font-size:11px}}
  `;
  document.head.append(style);
}

if (typeof window !== 'undefined') start();
