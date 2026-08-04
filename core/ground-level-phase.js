import { createGeologicalTime } from './geological-time.js';
import { createLocalSurfaceLayer } from './local-surface-layer.js';

const TAU = Math.PI * 2;

export function createGroundLevelPhase(container, globe, options = {}) {
  const mobile = options.mobile ?? matchMedia('(max-width: 720px), (pointer: coarse)').matches;
  const geologicalTime = createGeologicalTime({
    seed: options.seed || 90210,
    startAgeMyr: options.startAgeMyr ?? 0,
    millionYearsPerSecond: options.millionYearsPerSecond || 0.18,
  });

  const terrain = createLocalSurfaceLayer(container, geologicalTime, { mobile });
  const terrainCanvas = terrain.element;
  terrainCanvas.classList.add('ground-level-canvas');

  const navigation = {
    u: 0.5,
    v: 0.5,
    heading: 0,
    pitch: -0.08,
    cameraDistance: mobile ? 0.42 : 0.48,
    initialized: false,
    moving: false,
    blocked: false,
    grade: 0,
    speedScale: 1,
  };

  const hud = document.createElement('section');
  hud.className = 'ground-level-hud';
  hud.hidden = true;
  hud.setAttribute('aria-live', 'polite');
  hud.innerHTML = `
    <div class="ground-level-hud__title">
      <strong>GROUND LEVEL</strong>
      <div class="ground-level-hud__actions">
        <span data-ground-mode>DESCENDING</span>
        <button data-ground-view type="button" aria-label="Toggle first- or third-person view">3P</button>
      </div>
    </div>
    <div data-ground-place>Locating terrain…</div>
    <div class="ground-level-hud__meta" data-ground-meta>Preparing local tiles…</div>
    <div class="ground-level-hud__hint">WASD / joystick to move · drag to look · V changes view</div>
  `;
  document.body.append(hud);

  const reticle = document.createElement('div');
  reticle.className = 'ground-level-reticle';
  reticle.hidden = true;
  reticle.setAttribute('aria-hidden', 'true');
  document.body.append(reticle);

  const modeElement = hud.querySelector('[data-ground-mode]');
  const placeElement = hud.querySelector('[data-ground-place]');
  const metaElement = hud.querySelector('[data-ground-meta]');
  const viewButton = hud.querySelector('[data-ground-view]');

  let active = false;
  let destroyed = false;
  let lastReadout = -Infinity;
  let lookPointer = null;
  let lastLookX = 0;
  let lastLookY = 0;

  function initializeFromGlobe(cameraState) {
    if (navigation.initialized) return;
    navigation.u = wrap(-(cameraState?.rotationY ?? 0) / TAU + 0.5, 1);
    navigation.v = clamp((cameraState?.rotationX ?? 0) / Math.PI + 0.5, 0.02, 0.98);
    navigation.heading = 0;
    navigation.pitch = -0.08;
    navigation.initialized = true;
  }

  function setActive(nextActive, cameraState) {
    if (nextActive === active) return;
    active = nextActive;
    hud.hidden = !active;
    reticle.hidden = !active;
    document.body.classList.toggle('ground-level-active', active);

    if (active) {
      initializeFromGlobe(cameraState || globe.getCameraState());
      updateViewClasses();
      window.dispatchEvent(new CustomEvent('ground-level-change', {
        detail: { active: true, navigation: getNavigationState() },
      }));
      return;
    }

    navigation.moving = false;
    navigation.blocked = false;
    modeElement.textContent = 'DESCENDING';
    document.body.classList.remove('ground-first-person', 'ground-look-active', 'ground-movement-blocked');
    lookPointer = null;
  }

  function updateViewClasses() {
    const firstPerson = navigation.cameraDistance < 0.08;
    document.body.classList.toggle('ground-first-person', firstPerson);
    viewButton.textContent = firstPerson ? '1P' : '3P';
    viewButton.setAttribute('aria-pressed', String(firstPerson));
  }

  function toggleView() {
    navigation.cameraDistance = navigation.cameraDistance < 0.08
      ? (mobile ? 0.42 : 0.48)
      : 0.02;
    updateViewClasses();
    return navigation.cameraDistance < 0.08;
  }

  function rotate(yawDelta, pitchDelta) {
    if (!active) return;
    navigation.heading = wrapAngle(navigation.heading + yawDelta);
    navigation.pitch = clamp(navigation.pitch + pitchDelta, -0.52, 0.3);
  }

  function move(strafe, inputForward, amount) {
    if (!active || destroyed) return { moved: false, blocked: false };

    const magnitude = Math.min(1, Math.hypot(strafe, inputForward));
    if (magnitude < 0.001) {
      navigation.moving = false;
      return { moved: false, blocked: false };
    }

    const forward = -inputForward;
    const step = Math.max(0, amount) * (mobile ? 0.0055 : 0.0068);
    const latitude = (0.5 - navigation.v) * Math.PI;
    const longitudeScale = Math.max(0.22, Math.cos(latitude));

    const forwardU = Math.sin(navigation.heading);
    const forwardV = -Math.cos(navigation.heading);
    const rightU = Math.cos(navigation.heading);
    const rightV = Math.sin(navigation.heading);

    const directionU = forward * forwardU + strafe * rightU;
    const directionV = forward * forwardV + strafe * rightV;
    const current = terrain.getSurfaceSample(navigation.u, navigation.v);

    let candidateU = wrap(navigation.u + directionU * step / longitudeScale, 1);
    let candidateV = clamp(navigation.v + directionV * step, 0.02, 0.98);
    let candidate = terrain.getSurfaceSample(candidateU, candidateV);

    const tileLevel = terrain.getStats().level || 7;
    const visualDeltaU = shortestTurnDelta(candidateU, navigation.u) * longitudeScale;
    const visualDeltaV = candidateV - navigation.v;
    const visualDistance = Math.max(
      0.0001,
      Math.hypot(visualDeltaU, visualDeltaV) * 0.9 * (2 ** tileLevel),
    );
    const grade = Math.abs(candidate.floorY - current.floorY) / visualDistance;
    const waterSlowdown = candidate.waterStrength > 0.25 ? 0.34 : 1;
    const slopeSlowdown = 1 / (1 + Math.max(candidate.slope, grade) * 1.8);
    const speedScale = clamp(waterSlowdown * slopeSlowdown, 0.16, 1);
    const blocked = grade > 1.15 || candidate.slope > 1.7;

    if (!blocked && speedScale < 0.98) {
      candidateU = wrap(navigation.u + directionU * step * speedScale / longitudeScale, 1);
      candidateV = clamp(navigation.v + directionV * step * speedScale, 0.02, 0.98);
      candidate = terrain.getSurfaceSample(candidateU, candidateV);
    }

    navigation.blocked = blocked;
    navigation.grade = Math.max(grade, candidate.slope);
    navigation.speedScale = speedScale;
    navigation.moving = !blocked;
    document.body.classList.toggle('ground-movement-blocked', blocked);

    if (blocked) {
      return {
        moved: false,
        blocked: true,
        grade: navigation.grade,
        water: candidate.waterStrength > 0.25,
      };
    }

    navigation.u = candidateU;
    navigation.v = candidateV;
    window.dispatchEvent(new CustomEvent('ground-level-move', {
      detail: {
        u: navigation.u,
        v: navigation.v,
        grade: navigation.grade,
        water: candidate.waterStrength > 0.25,
        speedScale,
      },
    }));

    return {
      moved: true,
      blocked: false,
      grade: navigation.grade,
      water: candidate.waterStrength > 0.25,
      speedScale,
    };
  }

  function updateReadout() {
    const location = terrain.getSurfaceSample(navigation.u, navigation.v);
    const stats = terrain.getStats();
    const walking = globe.getCameraState().distance <= 1.32;

    let traversal = '';
    if (navigation.blocked) traversal = 'slope blocked';
    else if (location.waterStrength > 0.25) traversal = location.water ? 'wading' : 'shallow water';
    else if (navigation.moving && navigation.speedScale < 0.72) traversal = 'steep ground';

    modeElement.textContent = navigation.cameraDistance < 0.08
      ? 'FIRST PERSON'
      : walking
        ? 'WALK MODE'
        : 'LOCAL APPROACH';

    placeElement.textContent = [
      formatCoordinate((0.5 - navigation.v) * 180, 'N', 'S'),
      formatCoordinate((navigation.u - 0.5) * 360, 'E', 'W'),
      formatBiome(location.biome),
      describeWater(location),
      traversal,
    ].filter(Boolean).join(' · ');

    metaElement.textContent = [
      `tile L${stats.level}`,
      `${stats.patches} cached patches`,
      `${Math.round(location.temperature * 100)}% warmth`,
      `${Math.round(location.rainfall * 100)}% moisture`,
      `${Math.round(Math.atan(location.slope) * 180 / Math.PI)}° slope`,
      geologicalTime.getState().epoch,
    ].join(' · ');
  }

  function exit() {
    navigation.moving = false;
    for (let i = 0; i < 6; i++) globe.zoomOut?.();
  }

  terrainCanvas.addEventListener('pointerdown', event => {
    if (!active || event.button > 0) return;
    event.preventDefault();
    lookPointer = event.pointerId;
    lastLookX = event.clientX;
    lastLookY = event.clientY;
    terrainCanvas.setPointerCapture?.(event.pointerId);
    document.body.classList.add('ground-look-active');
  });

  terrainCanvas.addEventListener('pointermove', event => {
    if (event.pointerId !== lookPointer) return;
    event.preventDefault();
    const dx = event.clientX - lastLookX;
    const dy = event.clientY - lastLookY;
    lastLookX = event.clientX;
    lastLookY = event.clientY;
    rotate(dx * (mobile ? 0.0048 : 0.0038), -dy * (mobile ? 0.0038 : 0.003));
  }, { passive: false });

  const finishLook = event => {
    if (event.pointerId !== lookPointer) return;
    lookPointer = null;
    document.body.classList.remove('ground-look-active');
  };
  terrainCanvas.addEventListener('pointerup', finishLook);
  terrainCanvas.addEventListener('pointercancel', finishLook);

  terrainCanvas.addEventListener('wheel', event => {
    if (!active) return;
    event.preventDefault();
    navigation.cameraDistance = clamp(
      navigation.cameraDistance + Math.sign(event.deltaY) * 0.075,
      0.02,
      0.7,
    );
    if (navigation.cameraDistance < 0.08) navigation.cameraDistance = 0.02;
    updateViewClasses();
  }, { passive: false });

  terrainCanvas.addEventListener('dblclick', event => {
    if (!active) return;
    event.preventDefault();
    toggleView();
  });

  viewButton.addEventListener('click', event => {
    event.preventDefault();
    toggleView();
  });

  window.addEventListener('keydown', event => {
    if (!active || event.repeat) return;
    if (event.code === 'KeyV') {
      event.preventDefault();
      toggleView();
    } else if (event.code === 'KeyQ') {
      rotate(-0.12, 0);
    } else if (event.code === 'KeyE') {
      rotate(0.12, 0);
    }
  });

  const api = {
    id: 'terrain.ground-level',
    name: 'Ground-Level Terrain Phase',
    version: '2.0.0',
    execution: 'browser-webgl',
    source: 'Reality Sandbox local quadtree terrain',
    license: 'Project license',
    provides: ['terrain.local', 'terrain.evolution', 'geology.deep-time', 'exploration.ground-level'],
    requires: ['rendering.globe'],

    initialize({ provideCapability }) {
      provideCapability('terrain.local', terrain);
      provideCapability('terrain.evolution', geologicalTime);
      provideCapability('geology.deep-time', geologicalTime);
      provideCapability('exploration.ground-level', api);
    },

    step(dt) {
      geologicalTime.step(dt);
    },

    render(frame = {}) {
      if (destroyed) return;
      const cameraState = frame.globe?.getCameraState?.() || globe.getCameraState();
      const shouldActivate = cameraState.distance <= 1.48;
      setActive(shouldActivate, cameraState);
      terrain.render(cameraState, active ? navigation : {});

      const timestamp = frame.timestamp ?? performance.now();
      if (active && timestamp - lastReadout > 220) {
        lastReadout = timestamp;
        updateReadout();
      }
    },

    move,
    rotate,
    toggleView,
    exit,
    isActive: () => active,

    save() {
      return {
        geology: geologicalTime.save(),
        navigation: getNavigationState(),
      };
    },

    load(state) {
      geologicalTime.load(state?.geology || state);
      const savedNavigation = state?.navigation;
      if (savedNavigation) {
        for (const key of ['u', 'v', 'heading', 'pitch', 'cameraDistance']) {
          if (Number.isFinite(savedNavigation[key])) navigation[key] = savedNavigation[key];
        }
        navigation.u = wrap(navigation.u, 1);
        navigation.v = clamp(navigation.v, 0.02, 0.98);
        navigation.heading = wrapAngle(navigation.heading);
        navigation.pitch = clamp(navigation.pitch, -0.52, 0.3);
        navigation.cameraDistance = clamp(navigation.cameraDistance, 0.02, 0.7);
        navigation.initialized = true;
      }
      updateViewClasses();
    },

    getState() {
      return {
        active,
        navigation: getNavigationState(),
        terrain: terrain.getStats(),
        geology: geologicalTime.getState(),
      };
    },

    destroy() {
      destroyed = true;
      setActive(false);
      terrain.clear();
      terrainCanvas.remove();
      hud.remove();
      reticle.remove();
    },
  };

  function getNavigationState() {
    return {
      u: navigation.u,
      v: navigation.v,
      heading: navigation.heading,
      pitch: navigation.pitch,
      cameraDistance: navigation.cameraDistance,
      initialized: navigation.initialized,
      moving: navigation.moving,
      blocked: navigation.blocked,
      grade: navigation.grade,
      speedScale: navigation.speedScale,
    };
  }

  return api;
}

function describeWater(location) {
  if (location.water) return location.biome === 'deep-ocean' ? 'deep water' : 'coastal water';
  if (location.lake > 0.1) return 'lake basin';
  if (location.delta > 0.1) return 'river delta';
  if (location.river > 0.12) return 'river corridor';
  return '';
}

function formatBiome(value) {
  return String(value || 'unknown terrain').replaceAll('-', ' ');
}

function formatCoordinate(value, positive, negative) {
  const direction = value >= 0 ? positive : negative;
  return `${Math.abs(value).toFixed(2)}°${direction}`;
}

const wrap = (value, max) => ((value % max) + max) % max;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function shortestTurnDelta(value, center) {
  let delta = value - center;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  return delta;
}

function wrapAngle(value) {
  return ((value + Math.PI) % TAU + TAU) % TAU - Math.PI;
}
