export const integrationCatalog = [
  entry('terrain.landlab', 'Terrain evolution', ['Landlab'], 'server', 'planned', ['terrain', 'erosion', 'sediment']),
  entry('terrain.gospl', 'Global landscape evolution', ['goSPL'], 'server', 'planned', ['terrain', 'erosion', 'tectonic-topography']),
  entry('tectonics.gplates', 'Plate tectonics and reconstructions', ['GPlates concepts', 'GPlates datasets'], 'server', 'planned', ['plates', 'rotations', 'boundaries']),
  entry('hydrology.parflow', 'Groundwater and surface hydrology', ['ParFlow concepts'], 'server', 'planned', ['groundwater', 'runoff', 'soil-water']),
  entry('ecosystem.rhessys', 'Ecohydrology and vegetation feedback', ['RHESSys concepts'], 'server', 'planned', ['vegetation', 'watersheds', 'carbon']),
  entry('climate.plasim', 'Atmospheric circulation', ['PlaSim concepts', 'ExoPlaSim concepts'], 'server', 'planned', ['atmosphere', 'climate', 'radiation']),
  entry('orbit.rebound', 'Orbital mechanics and N-body gravity', ['REBOUND'], 'wasm-or-server', 'planned', ['orbits', 'n-body', 'collisions']),
  entry('gis.gdal', 'GIS raster and vector processing', ['GDAL'], 'wasm-or-server', 'planned', ['gis', 'raster', 'vector', 'projection']),
  entry('render.three', '3D globe rendering', ['Three.js'], 'browser', 'active', ['rendering', 'webgl', 'globe']),
  entry('render.cesium', 'Planet-scale spatial concepts', ['CesiumJS concepts'], 'browser', 'planned', ['tiles', 'lod', 'geospatial-camera']),
  entry('vegetation.procedural', 'Procedural vegetation', ['Open procedural tree generators', 'SpeedTree-inspired concepts'], 'browser-worker', 'prototype', ['vegetation', 'lod', 'instancing']),
  entry('navigation.recast', 'Navigation meshes and crowd pathfinding', ['Recast & Detour'], 'wasm', 'planned', ['navmesh', 'pathfinding', 'crowds']),
  entry('physics.rapier', 'Rigid-body physics', ['Rapier'], 'wasm', 'planned', ['physics', 'collisions', 'constraints']),
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
