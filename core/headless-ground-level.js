import { createGeologicalTime } from './geological-time.js';
import { samplePlanet } from './planet.js';
import { sampleHydrology } from './hydrology.js';

const SAMPLE_WIDTH = 8192;
const SAMPLE_HEIGHT = 4096;

export function createHeadlessGroundLevel(options = {}) {
  const geologicalTime = createGeologicalTime({
    seed: options.seed || 90210,
    startAgeMyr: options.startAgeMyr ?? 0,
    millionYearsPerSecond: options.millionYearsPerSecond || 0.18,
  });
  const navigation = {
    u: 0.5, v: 0.5, heading: 0, pitch: 0, cameraDistance: 1,
    initialized: true, moving: false, blocked: false, grade: 0, speedScale: 1,
  };

  function sampleSurface(u, v) {
    u = wrap(u, 1);
    v = clamp(v, 0, 1);
    const base = samplePlanet(u * SAMPLE_WIDTH, v * SAMPLE_HEIGHT, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    const hydro = sampleHydrology(u * SAMPLE_WIDTH, v * SAMPLE_HEIGHT, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    const geological = geologicalTime.sample(u, v);
    const height = base.elevation + geological.uplift - geological.rifting - geological.erosion;
    const seaLevel = geological.seaLevel;
    const water = height < 0.53 + seaLevel;
    const waterStrength = water ? 1 : clamp(Math.max(hydro.lake, hydro.delta * 0.9, hydro.river * 0.78), 0, 1);
    const terrainY = (height - seaLevel - 0.53) * 3.8;
    const waterY = water ? 0.006 : terrainY + 0.007;
    return { ...base, ...hydro, ...geological, height, seaLevel, water, waterStrength, terrainY, waterY, floorY: waterStrength > 0.25 ? Math.max(terrainY, waterY) : terrainY };
  }

  const terrain = {
    element: null,
    getSurfaceSample: sampleSurface,
    getStats: () => ({ level: 0, patches: 0, mode: 'headless' }),
    render() {},
  };

  function getState() {
    return {
      active: false,
      mode: 'headless',
      navigation: { ...navigation },
      geology: geologicalTime.save?.() || geologicalTime.getState?.() || {},
      terrain: { level: 0, patches: 0, surface: sampleSurface(navigation.u, navigation.v) },
    };
  }

  const api = {
    id: 'terrain.headless-surface',
    name: 'Headless Planet Surface',
    version: '1.0.0',
    execution: 'browser-headless-deterministic',
    source: 'Reality Sandbox geological and hydrological sampling without a 3D renderer',
    license: 'Project license',
    provides: ['terrain.local', 'terrain.evolution', 'geology.deep-time', 'exploration.ground-level'],
    requires: [],
    initialize({ provideCapability }) {
      provideCapability('terrain.local', terrain);
      provideCapability('terrain.evolution', geologicalTime);
      provideCapability('geology.deep-time', geologicalTime);
      provideCapability('exploration.ground-level', api);
    },
    step(dt) { geologicalTime.step(dt); },
    render() {},
    getState,
    getSurfaceSample: sampleSurface,
    move: () => ({ moved: false, blocked: false }),
    rotate() {},
    toggleView: () => false,
    exit() {},
    isActive: () => false,
    save() { return { geology: geologicalTime.save?.() || {}, navigation: { ...navigation } }; },
    load(state = {}) {
      geologicalTime.load?.(state.geology || state);
      for (const key of ['u', 'v', 'heading', 'pitch', 'cameraDistance']) if (Number.isFinite(state.navigation?.[key])) navigation[key] = state.navigation[key];
      navigation.u = wrap(navigation.u, 1);
      navigation.v = clamp(navigation.v, 0, 1);
    },
    destroy() {},
  };

  return api;
}

const wrap = (value, max) => ((value % max) + max) % max;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));