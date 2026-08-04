export const integrationCatalog = [
  entry('terrain.landlab', 'Terrain evolution', ['Landlab'], 'server', 'planned', ['terrain', 'erosion', 'sediment']),
  entry('terrain.gospl', 'Global landscape evolution', ['goSPL'], 'server', 'planned', ['terrain', 'erosion', 'tectonic-topography']),
  entry('tectonics.gplates', 'Plate tectonics and reconstructions', ['GPlates concepts', 'GPlates datasets'], 'server', 'planned', ['plates', 'rotations', 'boundaries']),
  entry('hydrology.parflow', 'Groundwater and surface hydrology', ['ParFlow concepts'], 'server', 'planned', ['groundwater', 'runoff', 'soil-water']),
  entry('ecosystem.rhessys', 'Ecohydrology and vegetation feedback', ['RHESSys concepts'], 'server', 'planned', ['vegetation', 'watersheds', 'carbon']),
  entry('climate.plasim', 'Atmospheric circulation', ['PlaSim concepts', 'ExoPlaSim concepts'], 'server', 'planned', ['atmosphere', 'climate', 'radiation']),

  entry('orbit.rebound', 'Orbital mechanics and N-body gravity', ['REBOUND 5.0.0'], 'wasm-and-browser-adapter', 'active', ['orbits', 'n-body', 'collisions']),
  entry('orbit.astronomy', 'Ephemerides and orbital-climate coupling', ['Astronomy Engine 2.1.19'], 'legacy-v6.9-browser', 'active', ['ephemerides', 'seasons', 'eclipses', 'tides']),
  entry('gis.gdal', 'GIS raster and vector processing', ['GDAL3.js 2.8.1', 'GDAL'], 'lazy-wasm-worker', 'active', ['gis', 'raster', 'vector', 'projection']),
  entry('render.three', '3D globe and spatial rendering', ['Three.js 0.184.0'], 'browser', 'active', ['rendering', 'webgl', 'globe']),
  entry('render.pixi', 'Fixed-timestep pixel presentation', ['PixiJS 8.19.0'], 'legacy-v6.9-browser', 'active', ['rendering', 'pixel-presentation', 'overlays']),
  entry('render.cesium', 'Planet-scale globe presentation', ['CesiumJS 1.143.0'], 'legacy-v6.9-browser', 'active', ['tiles', 'lod', 'geospatial-camera']),
  entry('audio.howler', 'Deterministic generative soundscape', ['Howler.js 2.2.4'], 'legacy-v6.9-browser', 'active', ['audio', 'spatial-audio', 'soundscape']),
  entry('ai.yuka', 'Embodied creature steering', ['Yuka 0.7.8'], 'browser-with-cdn-fallback', 'active', ['steering', 'agents', 'navigation']),
  entry('graph.graphology', 'Civilization and settlement networks', ['Graphology 0.26.0'], 'browser-with-internal-fallback', 'active', ['graphs', 'trade', 'alliances']),
  entry('state.xstate', 'Institutional state machines', ['XState 5.32.5'], 'browser-with-internal-fallback', 'active', ['state-machines', 'institutions', 'crises']),
  entry('physics.rapier', 'Rigid-body physics', ['Rapier 0.19.3'], 'lazy-wasm', 'active', ['physics', 'collisions', 'constraints']),
  entry('debug.playwright', 'Deterministic browser diagnostics', ['Playwright 1.62.0'], 'ci', 'active', ['testing', 'trace', 'video']),
  entry('debug.spector', 'On-demand WebGL capture', ['Spector.js 0.9.30'], 'browser-on-demand', 'active', ['webgl-debug', 'shaders', 'capture']),

  entry('vegetation.procedural', 'Procedural vegetation', ['Open procedural tree generators', 'SpeedTree-inspired concepts'], 'browser-worker', 'prototype', ['vegetation', 'lod', 'instancing']),
  entry('navigation.recast', 'Navigation meshes and crowd pathfinding', ['Recast & Detour'], 'wasm', 'planned', ['navmesh', 'pathfinding', 'crowds']),
  entry('physics.jolt', 'Large-scale rigid-body physics option', ['Jolt Physics'], 'wasm', 'research', ['physics', 'collisions']),
  entry('fluids.gpu', 'GPU fluid simulation', ['Open WebGL/WebGPU fluid solvers'], 'browser-gpu', 'prototype', ['fluids', 'advection', 'pressure']),
  entry('clouds.volumetric', 'Volumetric cloud rendering', ['Open WebGL/WebGPU cloud renderers'], 'browser-gpu', 'prototype', ['clouds', 'raymarching', 'weather']),
];

function entry(id, name, upstream, execution, status, capabilities) {
  return { id, name, upstream, execution, status, capabilities };
}

export function catalogByStatus(status) {
  return integrationCatalog.filter(item => item.status === status);
}

export function catalogByCapability(capability) {
  return integrationCatalog.filter(item => item.capabilities.includes(capability));
}
