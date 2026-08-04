import { createGeologicalTime } from './geological-time.js';
import { createLocalSurfaceLayer } from './local-surface-layer.js';
import { samplePlanet } from './planet.js';
import { sampleHydrology } from './hydrology.js';

const TAU = Math.PI * 2;

export function createGroundLevelPhase(container, globe, options = {}) {
  const mobile = options.mobile ?? matchMedia('(max-width: 720px), (pointer: coarse)').matches;
  const geologicalTime = createGeologicalTime({
    seed: options.seed || 90210,
    startAgeMyr: options.startAgeMyr ?? 0,
    millionYearsPerSecond: options.millionYearsPerSecond || 0.18,
  });

  const existingCanvases = new Set(container.querySelectorAll('canvas'));
  const terrain = createLocalSurfaceLayer(container, geologicalTime, { mobile });
  const terrainCanvas = [...container.querySelectorAll('canvas')]
    .find(canvas => !existingCanvases.has(canvas));
  terrainCanvas?.classList.add('ground-level-canvas');

  const hud = document.createElement('section');
  hud.className = 'ground-level-hud';
  hud.hidden = true;
  hud.setAttribute('aria-live', 'polite');
  hud.innerHTML = `
    <div class="ground-level-hud__title">
      <strong>GROUND LEVEL</strong>
      <span data-ground-mode>DESCENDING</span>
    </div>
    <div data-ground-place>Locating terrain…</div>
    <div class="ground-level-hud__meta" data-ground-meta>Preparing local tiles…</div>
  `;
  document.body.append(hud);

  const modeElement = hud.querySelector('[data-ground-mode]');
  const placeElement = hud.querySelector('[data-ground-place]');
  const metaElement = hud.querySelector('[data-ground-meta]');

  let active = false;
  let destroyed = false;
  let lastReadout = -Infinity;

  function setActive(nextActive) {
    if (nextActive === active) return;
    active = nextActive;
    hud.hidden = !active;
    document.body.classList.toggle('ground-level-active', active);
    if (!active) {
      modeElement.textContent = 'DESCENDING';
      return;
    }
    window.dispatchEvent(new CustomEvent('ground-level-change', {
      detail: { active: true },
    }));
  }

  function updateReadout(cameraState) {
    const location = sampleLocation(cameraState, geologicalTime);
    const stats = terrain.getStats();
    const walking = cameraState.distance <= 1.32;
    const tileLevel = cameraState.distance < 1.25 ? 8 : cameraState.distance < 1.34 ? 7 : 6;

    modeElement.textContent = walking ? 'WALK MODE' : 'LOCAL APPROACH';
    placeElement.textContent = [
      formatCoordinate(location.latitude, 'N', 'S'),
      formatCoordinate(location.longitude, 'E', 'W'),
      formatBiome(location.biome),
      location.waterway,
    ].filter(Boolean).join(' · ');
    metaElement.textContent = [
      `tile L${tileLevel}`,
      `${stats.patches} cached patches`,
      `${Math.round(location.temperature * 100)}% warmth`,
      `${Math.round(location.rainfall * 100)}% moisture`,
      geologicalTime.getState().epoch,
    ].join(' · ');
  }

  return {
    id: 'terrain.ground-level',
    name: 'Ground-Level Terrain Phase',
    version: '1.0.0',
    execution: 'browser-webgl',
    source: 'Reality Sandbox local quadtree terrain',
    license: 'Project license',
    provides: ['terrain.local', 'terrain.evolution', 'geology.deep-time', 'exploration.ground-level'],
    requires: ['rendering.globe'],

    initialize({ provideCapability }) {
      provideCapability('terrain.local', terrain);
      provideCapability('terrain.evolution', geologicalTime);
      provideCapability('geology.deep-time', geologicalTime);
      provideCapability('exploration.ground-level', this);
    },

    step(dt) {
      geologicalTime.step(dt);
    },

    render(frame = {}) {
      if (destroyed) return;
      const cameraState = frame.globe?.getCameraState?.() || globe.getCameraState();
      terrain.render(cameraState);
      setActive(cameraState.distance <= 1.48);

      const timestamp = frame.timestamp ?? performance.now();
      if (active && timestamp - lastReadout > 280) {
        lastReadout = timestamp;
        updateReadout(cameraState);
      }
    },

    save() {
      return { geology: geologicalTime.save() };
    },

    load(state) {
      geologicalTime.load(state?.geology || state);
    },

    getState() {
      return {
        active,
        terrain: terrain.getStats(),
        geology: geologicalTime.getState(),
      };
    },

    destroy() {
      destroyed = true;
      setActive(false);
      terrain.clear();
      terrainCanvas?.remove();
      hud.remove();
    },
  };
}

function sampleLocation(cameraState, geologicalTime) {
  const longitudeTurns = -(cameraState?.rotationY ?? 0) / TAU;
  const latitudeTurns = (cameraState?.rotationX ?? 0) / Math.PI;
  const u = wrap(longitudeTurns + 0.5, 1);
  const v = clamp(latitudeTurns + 0.5, 0, 1);
  const x = u * 8192;
  const y = v * 4096;
  const planet = samplePlanet(x, y, 8192, 4096);
  const hydrology = sampleHydrology(x, y, 8192, 4096);
  const geology = geologicalTime.sample(u, v);
  const height = planet.elevation + geology.uplift - geology.rifting - geology.erosion;
  const water = height < 0.53 + geology.seaLevel;

  let waterway = '';
  if (water) waterway = planet.biome === 'deep-ocean' ? 'deep water' : 'coastal water';
  else if (hydrology.lake > 0.1) waterway = 'lake basin';
  else if (hydrology.river > 0.12) waterway = 'river corridor';
  else if (hydrology.delta > 0.1) waterway = 'river delta';

  return {
    longitude: (u - 0.5) * 360,
    latitude: (0.5 - v) * 180,
    biome: water ? planet.biome : planet.biome,
    temperature: planet.temperature,
    rainfall: planet.rainfall,
    waterway,
  };
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
