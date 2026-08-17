import * as THREE from 'three';

const BUILD = 'v80-water-geometry-stabilization';
const CORE_WATER_LOWERING = 0.08;
const RIVER_LOWERING = 0.20;
const RIVER_WIDTH_SCALE = 0.84;
const html = document.documentElement;

const stats = {
  installed: true,
  waterMeshesPatched: 0,
  waterMaterialsPatched: 0,
  waterVerticesLowered: 0,
  waterMasksSmoothed: 0,
  skinnyWaterVerticesRemoved: 0,
  riverMeshesPatched: 0,
  riverVerticesLowered: 0,
  riverVerticesNarrowed: 0,
  renderPassesInspected: 0,
};

function smoothWaterMask(attribute) {
  const count = attribute?.count || 0;
  const side = Math.round(Math.sqrt(count));
  if (!count || side * side !== count) return;

  const raw = new Float32Array(count);
  for (let i = 0; i < count; i++) raw[i] = attribute.getX(i);
  const next = new Float32Array(count);

  const read = (x, z) => raw[Math.max(0, Math.min(side - 1, z)) * side + Math.max(0, Math.min(side - 1, x))];

  for (let z = 0; z < side; z++) {
    for (let x = 0; x < side; x++) {
      const index = z * side + x;
      let weighted = 0;
      let weightTotal = 0;
      let strongNeighbors = 0;
      let localMax = 0;

      for (let oz = -1; oz <= 1; oz++) {
        for (let ox = -1; ox <= 1; ox++) {
          const value = read(x + ox, z + oz);
          const weight = ox === 0 && oz === 0 ? 4 : (ox === 0 || oz === 0 ? 2 : 1);
          weighted += value * weight;
          weightTotal += weight;
          if (value >= 0.20) strongNeighbors++;
          localMax = Math.max(localMax, value);
        }
      }

      const center = raw[index];
      let value = weighted / Math.max(1, weightTotal);

      // The base terrain-water mesh used to carry very thin river samples. At
      // coarse tessellation those become giant triangular spikes. Keep broad
      // lakes/ocean here and leave narrow rivers to surface-rivers-v41.
      if (center < 0.72 && localMax < 0.92 && strongNeighbors <= 3) {
        if (center > 0.02) stats.skinnyWaterVerticesRemoved++;
        value = 0;
      } else {
        value = THREE.MathUtils.clamp((value - 0.025) * 1.08, 0, 1);
      }

      // Preserve deep open water while still smoothing its boundary.
      if (center >= 0.98 && strongNeighbors >= 5) value = Math.max(value, 0.92);
      next[index] = value;
    }
  }

  for (let i = 0; i < count; i++) attribute.setX(i, next[i]);
  attribute.needsUpdate = true;
  stats.waterMasksSmoothed++;
}

function patchCoreWater(mesh) {
  if (!mesh?.isMesh || mesh.userData?.surfaceWaterV80) return false;
  const geometry = mesh.geometry;
  const material = mesh.material;
  const strengths = geometry?.getAttribute?.('waterStrength');
  const positions = geometry?.getAttribute?.('position');
  if (!strengths || !positions || !material?.isShaderMaterial) return false;
  if (!String(material.vertexShader || '').includes('attribute float waterStrength')) return false;

  mesh.userData.surfaceWaterV80 = true;
  smoothWaterMask(strengths);

  // Pull both ocean and inland water closer to the terrain. The authoritative
  // renderer deliberately lifted it for visibility, but the old offset made
  // shorelines look like raised sheets.
  for (let i = 0; i < positions.count; i++) {
    positions.setY(i, positions.getY(i) - CORE_WATER_LOWERING);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  stats.waterVerticesLowered += positions.count;

  // Do not use partial transparency for this coarse grid. Alpha interpolation
  // revealed whole triangles as long dark wedges. Instead use a smoothed mask
  // with an opaque depth-writing cutoff, which is visually much more stable.
  if (!material.userData.surfaceWaterV80) {
    material.userData.surfaceWaterV80 = true;
    material.transparent = false;
    material.depthWrite = true;
    material.depthTest = true;
    material.alphaTest = 0;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -0.45;
    material.polygonOffsetUnits = -0.45;
    material.vertexShader = `
      uniform float time;
      attribute float waterStrength;
      varying float vWater;
      varying float vWave;
      void main() {
        vec3 p = position;
        float wave = (sin((p.x + time * 4.6) * 0.15) + cos((p.z - time * 3.9) * 0.13)) * 0.022 * waterStrength;
        p.y += wave;
        vWater = waterStrength;
        vWave = wave;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `;
    material.fragmentShader = `
      uniform vec3 deepColor;
      uniform vec3 shallowColor;
      varying float vWater;
      varying float vWave;
      void main() {
        if (vWater < 0.18) discard;
        float strength = smoothstep(0.18, 0.88, vWater);
        float depthMix = clamp(0.18 + strength * 0.70 - vWave * 0.65, 0.0, 1.0);
        vec3 color = mix(shallowColor, deepColor, depthMix);
        gl_FragColor = vec4(color, 1.0);
      }
    `;
    material.needsUpdate = true;
    stats.waterMaterialsPatched++;
  }

  mesh.renderOrder = 2;
  stats.waterMeshesPatched++;
  return true;
}

function patchRiver(mesh) {
  if (!mesh?.isMesh || mesh.name !== 'surfaceRiversV41' || mesh.userData?.surfaceRiverV80) return false;
  const geometry = mesh.geometry;
  const material = mesh.material;
  const positions = geometry?.getAttribute?.('position');
  if (!positions || !material?.isShaderMaterial) return false;

  mesh.userData.surfaceRiverV80 = true;

  // v41 emits each cross-section as a left/right pair. Lower the whole ribbon
  // and pull both sides toward their midpoint. This removes the raised lip and
  // the occasional wide triangular-looking bend without changing the path.
  for (let i = 0; i + 1 < positions.count; i += 2) {
    const lx = positions.getX(i);
    const ly = positions.getY(i);
    const lz = positions.getZ(i);
    const rx = positions.getX(i + 1);
    const ry = positions.getY(i + 1);
    const rz = positions.getZ(i + 1);
    const cx = (lx + rx) * 0.5;
    const cz = (lz + rz) * 0.5;

    positions.setXYZ(i, cx + (lx - cx) * RIVER_WIDTH_SCALE, ly - RIVER_LOWERING, cz + (lz - cz) * RIVER_WIDTH_SCALE);
    positions.setXYZ(i + 1, cx + (rx - cx) * RIVER_WIDTH_SCALE, ry - RIVER_LOWERING, cz + (rz - cz) * RIVER_WIDTH_SCALE);
    stats.riverVerticesLowered += 2;
    stats.riverVerticesNarrowed += 2;
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  // Keep river geometry opaque too. The path already has two Chaikin smoothing
  // passes; transparency at the bank was introducing more artifacts than it
  // removed. The edge shade gives a softer visual border without depth issues.
  const edge = new Float32Array(positions.count);
  for (let i = 0; i < positions.count; i++) edge[i] = i % 2 === 0 ? -1 : 1;
  geometry.setAttribute('riverEdge', new THREE.BufferAttribute(edge, 1));

  material.transparent = false;
  material.depthWrite = true;
  material.depthTest = true;
  material.alphaTest = 0;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -0.7;
  material.polygonOffsetUnits = -0.7;
  material.vertexShader = `
    attribute float riverStrength;
    attribute float riverCoord;
    attribute float riverEdge;
    varying float vStrength;
    varying float vCoord;
    varying float vEdge;
    varying vec3 vWorld;
    void main() {
      vStrength = riverStrength;
      vCoord = riverCoord;
      vEdge = riverEdge;
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `;
  material.fragmentShader = `
    uniform float time;
    uniform vec3 shallowColor;
    uniform vec3 deepColor;
    varying float vStrength;
    varying float vCoord;
    varying float vEdge;
    varying vec3 vWorld;
    void main() {
      float flowBand = sin(vCoord * 0.085 - time * (1.25 + vStrength * 1.55));
      float crossRipple = sin((vWorld.x + vWorld.z) * 0.09 + time * 0.95);
      float shimmer = flowBand * 0.026 + crossRipple * 0.009;
      float bank = smoothstep(1.0, 0.0, abs(vEdge));
      vec3 color = mix(shallowColor, deepColor, clamp(0.18 + vStrength * 0.68 - shimmer, 0.0, 1.0));
      color = mix(color * 0.94, color * 1.035, bank);
      gl_FragColor = vec4(color, 1.0);
    }
  `;
  material.needsUpdate = true;
  mesh.renderOrder = 3;
  stats.riverMeshesPatched++;
  return true;
}

function inspectScene(scene) {
  if (!scene?.traverse) return;
  scene.traverse(object => {
    patchCoreWater(object);
    patchRiver(object);
  });
}

const nativeRender = THREE.WebGLRenderer.prototype.render;
THREE.WebGLRenderer.prototype.render = function stableWaterGroundingRender(scene, camera) {
  stats.renderPassesInspected++;
  inspectScene(scene);
  return nativeRender.call(this, scene, camera);
};

const nativeSceneAdd = THREE.Scene.prototype.add;
THREE.Scene.prototype.add = function stableWaterGroundingSceneAdd(...objects) {
  const result = nativeSceneAdd.apply(this, objects);
  for (const object of objects) {
    patchCoreWater(object);
    patchRiver(object);
  }
  return result;
};

const api = {
  installed: true,
  build: BUILD,
  getStats: () => ({ ...stats }),
};
window.realitySandboxSurfaceGroundingV79 = api;
html.dataset.surfaceGroundingV79 = BUILD;

const previousDiagnostics = window.realitySandboxPresentationDiagnostics;
window.realitySandboxPresentationDiagnostics = () => ({
  ...(typeof previousDiagnostics === 'function' ? previousDiagnostics() : {}),
  surfaceGroundingV79: api.getStats(),
});