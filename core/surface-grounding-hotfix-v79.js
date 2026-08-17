import * as THREE from 'three';

const BUILD = 'v79-grounded-flora-smooth-water';
const RIVER_LOWERING = 0.20;
const html = document.documentElement;

const stats = {
  installed: true,
  waterMaterialsPatched: 0,
  riverMeshesPatched: 0,
  riverVerticesLowered: 0,
  renderPassesInspected: 0,
};

function patchCoreWater(mesh) {
  if (!mesh?.isMesh || mesh.userData?.surfaceWaterV79) return false;
  const geometry = mesh.geometry;
  const material = mesh.material;
  if (!geometry?.getAttribute?.('waterStrength') || !material?.isShaderMaterial) return false;
  if (!String(material.vertexShader || '').includes('attribute float waterStrength')) return false;

  mesh.userData.surfaceWaterV79 = true;

  // The old fragment shader hard-discarded water at one exact threshold. The
  // interpolated alpha band below makes shorelines visually continuous instead
  // of exposing the underlying terrain grid as a staircase.
  material.transparent = true;
  material.depthWrite = false;
  material.alphaTest = 0.015;
  material.vertexShader = String(material.vertexShader)
    .replace('* 0.075 * waterStrength', '* 0.028 * waterStrength');
  material.fragmentShader = `
    uniform vec3 deepColor;
    uniform vec3 shallowColor;
    varying float vWater;
    varying float vWave;
    void main() {
      float alpha = smoothstep(0.085, 0.245, vWater);
      if (alpha < 0.015) discard;
      float strength = smoothstep(0.12, 0.9, vWater);
      float depthMix = clamp(0.18 + strength * 0.68 - vWave * 0.9, 0.0, 1.0);
      vec3 color = mix(shallowColor, deepColor, depthMix);
      gl_FragColor = vec4(color, alpha);
    }
  `;
  material.needsUpdate = true;
  stats.waterMaterialsPatched++;
  return true;
}

function patchRiver(mesh) {
  if (!mesh?.isMesh || mesh.name !== 'surfaceRiversV41' || mesh.userData?.surfaceRiverV79) return false;
  const geometry = mesh.geometry;
  const material = mesh.material;
  const positions = geometry?.getAttribute?.('position');
  if (!positions || !material?.isShaderMaterial) return false;

  mesh.userData.surfaceRiverV79 = true;

  // v41 intentionally lifted river ribbons 0.24 units to avoid z-fighting.
  // That is visibly too high at shallow banks. Keep only ~0.04 units of lift.
  for (let i = 0; i < positions.count; i++) {
    positions.setY(i, positions.getY(i) - RIVER_LOWERING);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  stats.riverVerticesLowered += positions.count;

  // Ribbon vertices are emitted left/right in alternating pairs. Interpolating
  // this coordinate lets the fragment shader feather both banks instead of
  // drawing a hard polygon edge, which is what made bends look saw-toothed.
  const edge = new Float32Array(positions.count);
  for (let i = 0; i < positions.count; i++) edge[i] = i % 2 === 0 ? -1 : 1;
  geometry.setAttribute('riverEdge', new THREE.BufferAttribute(edge, 1));

  material.transparent = true;
  material.depthWrite = false;
  material.alphaTest = 0.02;
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
      float flowBand = sin(vCoord * 0.085 - time * (1.4 + vStrength * 1.8));
      float crossRipple = sin((vWorld.x + vWorld.z) * 0.10 + time * 1.1);
      float shimmer = flowBand * 0.035 + crossRipple * 0.012;
      vec3 color = mix(shallowColor, deepColor, clamp(0.20 + vStrength * 0.72 - shimmer, 0.0, 1.0));
      color += vec3(0.02, 0.032, 0.04) * max(0.0, shimmer);
      float bank = 1.0 - smoothstep(0.72, 1.0, abs(vEdge));
      float alpha = bank * smoothstep(0.05, 0.22, vStrength);
      if (alpha < 0.02) discard;
      gl_FragColor = vec4(color, alpha);
    }
  `;
  material.needsUpdate = true;
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
THREE.WebGLRenderer.prototype.render = function smoothWaterGroundingRender(scene, camera) {
  stats.renderPassesInspected++;
  inspectScene(scene);
  return nativeRender.call(this, scene, camera);
};

const nativeSceneAdd = THREE.Scene.prototype.add;
THREE.Scene.prototype.add = function smoothWaterGroundingSceneAdd(...objects) {
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
