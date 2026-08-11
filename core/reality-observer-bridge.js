const CAMERA_OBSERVER = 'eidolon:camera';
const INSPECTOR_OBSERVER = 'eidolon:inspector';

const CAMERA_REGION_ZOOM = 1.25;
const CAMERA_PATCH_ZOOM = 3.5;
const CAMERA_ENTITY_ZOOM = 8;

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function levelForZoom(zoom) {
  if (zoom >= CAMERA_ENTITY_ZOOM) return 'entity';
  if (zoom >= CAMERA_PATCH_ZOOM) return 'patch';
  if (zoom > CAMERA_REGION_ZOOM) return 'region';
  return 'planet';
}

function inspectorLevelForZoom(zoom) {
  if (zoom >= CAMERA_ENTITY_ZOOM) return 'entity';
  if (zoom > CAMERA_REGION_ZOOM) return 'patch';
  return 'region';
}

function scaleForLevel(level, scales) {
  if (level === 'entity') return Math.min(...Object.values(scales.entityMetres || { resource: 0.5 })) * 0.5;
  if (level === 'patch') return scales.patchMetres;
  if (level === 'region') return scales.regionMetres;
  return scales.planetMetres;
}

function temporalScaleForLevel(level) {
  if (level === 'entity') return 0.06;
  if (level === 'patch') return 60;
  if (level === 'region') return 3600;
  return Infinity;
}

function locationKey(level, location) {
  if (!location) return `${level}:none`;
  if (level === 'entity') return `${level}:${location.patchId}:${Math.round(location.x)}:${Math.round(location.y)}`;
  if (level === 'patch') return `${level}:${location.patchId}`;
  if (level === 'region') return `${level}:${location.regionId}`;
  return level;
}

export function getCameraResolutionLevel(zoom) {
  return levelForZoom(finite(zoom, 1));
}

export function getInspectorResolutionLevel(zoom) {
  return inspectorLevelForZoom(finite(zoom, 1));
}

export function installRealityObserverBridge({ runtime, world, kernelApi, canvas = document.getElementById('lofiLivingCanvas') } = {}) {
  if (!runtime?.getCamera || !runtime?.inspectSelected) throw new Error('Reality observer bridge requires the authoritative presentation runtime.');
  if (!world || !kernelApi?.requestAt || !kernelApi?.releaseObserver || !kernelApi?.locate) throw new Error('Reality observer bridge requires the authoritative world and kernel adapter API.');
  if (!canvas) throw new Error('Reality observer bridge could not find the living-planet canvas.');

  const scales = kernelApi.getScales();
  const observerState = new Map();
  const listeners = [];
  const methodHooks = [];
  let destroyed = false;
  let inspectorActivated = false;
  let lastCamera = runtime.getCamera();
  let lastInspection = runtime.inspectSelected();

  function requestObserver(observerId, level, x, y) {
    if (destroyed) return null;
    if (level === 'planet') {
      if (observerState.has(observerId)) kernelApi.releaseObserver(observerId);
      observerState.delete(observerId);
      return null;
    }

    const location = kernelApi.locate(x, y);
    const key = locationKey(level, location);
    const previous = observerState.get(observerId);
    if (previous?.key === key) return previous.result;

    // A same-location move from fine -> coarse must explicitly release the old
    // observation first; changing only spatialScale is not enough to archive
    // already-active descendants.
    if (previous && previous.level !== level) kernelApi.releaseObserver(observerId);

    const result = kernelApi.requestAt({
      observerId,
      x,
      y,
      spatialScale: scaleForLevel(level, scales),
      temporalScale: temporalScaleForLevel(level),
    });
    observerState.set(observerId, { level, key, result });
    return result;
  }

  function syncCamera() {
    const camera = runtime.getCamera();
    lastCamera = camera;
    const level = levelForZoom(camera.zoom);
    const x = finite(camera.centerX, 0.5) * world.width;
    const y = finite(camera.centerY, 0.5) * world.height;
    return requestObserver(CAMERA_OBSERVER, level, x, y);
  }

  function syncInspector({ activate = false } = {}) {
    if (activate) inspectorActivated = true;
    const inspection = runtime.inspectSelected();
    lastInspection = inspection;
    if (!inspectorActivated) return null;
    if (!Number.isFinite(inspection?.x) || !Number.isFinite(inspection?.y)) return null;
    const level = inspectorLevelForZoom(runtime.getCamera().zoom);
    return requestObserver(INSPECTOR_OBSERVER, level, inspection.x, inspection.y);
  }

  function syncAll() {
    const cameraResult = syncCamera();
    const inspectorResult = syncInspector();
    return { camera: cameraResult, inspector: inspectorResult };
  }

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  }

  // The living runtime registered its handlers before this bridge is installed,
  // so these listeners observe camera state after each user mutation.
  for (const type of ['wheel', 'pointermove', 'pointerup', 'pointercancel', 'dblclick', 'keydown']) {
    listen(canvas, type, () => syncAll());
  }
  // A real click/tap is the point at which the default inspector becomes an
  // explicit observation. Browser click fires after the runtime's pointer-up
  // selection handler has updated selectedPoint.
  listen(canvas, 'click', () => syncInspector({ activate: true }));

  function hookRuntimeMethod(name, sync) {
    const original = runtime[name];
    if (typeof original !== 'function') return;
    const wrapped = function (...args) {
      const result = original.apply(runtime, args);
      sync();
      return result;
    };
    runtime[name] = wrapped;
    methodHooks.push(() => {
      if (runtime[name] === wrapped) runtime[name] = original;
    });
  }

  // Programmatic camera/inspection controls do not emit DOM input events.
  hookRuntimeMethod('setCamera', syncAll);
  hookRuntimeMethod('resetCamera', syncAll);
  hookRuntimeMethod('selectAtClientPoint', () => syncInspector({ activate: true }));

  // At the normal 1× overview the camera remains planet-only and the default
  // center-point inspector is not treated as an observation until selected.
  syncCamera();

  const api = {
    version: 1,
    cameraObserverId: CAMERA_OBSERVER,
    inspectorObserverId: INSPECTOR_OBSERVER,
    thresholds: {
      regionZoom: CAMERA_REGION_ZOOM,
      patchZoom: CAMERA_PATCH_ZOOM,
      entityZoom: CAMERA_ENTITY_ZOOM,
    },
    syncCamera,
    syncInspector,
    syncAll,
    snapshot() {
      return {
        version: 1,
        camera: { ...lastCamera, level: levelForZoom(lastCamera?.zoom) },
        inspector: {
          active: inspectorActivated,
          x: lastInspection?.x ?? null,
          y: lastInspection?.y ?? null,
          title: lastInspection?.title ?? null,
          level: inspectorActivated ? inspectorLevelForZoom(lastCamera?.zoom) : 'inactive',
        },
        observers: Object.fromEntries([...observerState.entries()].map(([id, state]) => [id, {
          level: state.level,
          key: state.key,
          resolvedNodeId: state.result?.resolvedNodeId || null,
          resolvedScale: state.result?.resolvedScale || null,
        }])),
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const remove of listeners.splice(0)) remove();
      for (const restore of methodHooks.splice(0)) restore();
      kernelApi.releaseObserver(CAMERA_OBSERVER);
      kernelApi.releaseObserver(INSPECTOR_OBSERVER);
      observerState.clear();
    },
  };

  return api;
}
