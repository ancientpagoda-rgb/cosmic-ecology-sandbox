import * as THREE from 'three';

const BUILD = 'v85-stable-sea-level-water';
const SEA_LEVEL = 0.53;
const Z_SCALE = 62;
const WATER_LIFT = 0.14;
const html = document.documentElement;
const nativeAdd = THREE.Scene.prototype.add;

const stats = {
  installed: true,
  meshesRepaired: 0,
  verticesFlattened: 0,
  scans: 0,
};

function looksLikeSurfaceWater(object) {
  const material = object?.material;
  const geometry = object?.geometry;
  return Boolean(
    object?.isMesh &&
    material?.isShaderMaterial &&
    material.uniforms?.time &&
    material.uniforms?.deepColor &&
    material.uniforms?.shallowColor &&
    geometry?.getAttribute?.('position') &&
    geometry?.getAttribute?.('waterStrength')
  );
}

function sphereSag(x, z, radius) {
  const d2 = x * x + z * z;
  const r2 = radius * radius;
  return radius - Math.sqrt(Math.max(1, r2 - Math.min(d2, r2 - 1)));
}

function repairWaterMesh(mesh) {
  if (!looksLikeSurfaceWater(mesh)) return false;
  if (mesh.userData?.surfaceWaterRepairV85) return true;

  const geometry = mesh.geometry;
  const positions = geometry.getAttribute('position');
  const strengths = geometry.getAttribute('waterStrength');
  const radius = Number(window.realitySandboxSurfaceSphereV37?.getStats?.().curvatureRadius) || 2640;
  const offsetX = Number(mesh.position?.x) || 0;
  const offsetZ = Number(mesh.position?.z) || 0;
  const seaY = SEA_LEVEL * Z_SCALE + WATER_LIFT;

  // The old mesh put inland water at terrain height + 0.10. On coarse cells
  // that turns shorelines into wedges and sloped sheets. Surface water is now
  // one continuous spherical sea-level shell. Terrain depth naturally hides
  // the shell beneath dry land; the dedicated river renderer remains in charge
  // of above-sea-level channels.
  for (let i = 0; i < positions.count; i++) {
    const tangentX = offsetX + positions.getX(i);
    const tangentZ = offsetZ + positions.getZ(i);
    positions.setY(i, seaY - sphereSag(tangentX, tangentZ, radius));
    strengths.setX(i, 1);
  }

  positions.needsUpdate = true;
  strengths.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  mesh.userData.surfaceWaterRepairV85 = true;
  mesh.renderOrder = 3;

  const material = mesh.material;
  material.transparent = false;
  material.depthWrite = true;
  material.depthTest = true;
  material.side = THREE.FrontSide;
  material.needsUpdate = true;

  stats.meshesRepaired++;
  stats.verticesFlattened += positions.count;
  html.dataset.surfaceWaterRepairV85 = BUILD;
  return true;
}

THREE.Scene.prototype.add = function surfaceWaterRepairAdd(...objects) {
  for (const object of objects) repairWaterMesh(object);
  return nativeAdd.apply(this, objects);
};

function scanExisting() {
  stats.scans++;
  const scene = window.realitySandboxSurfaceLightHookV36?.getObjects?.()?.scene;
  if (!scene?.traverse) return false;
  let repaired = false;
  scene.traverse(object => {
    if (repairWaterMesh(object)) repaired = true;
  });
  return repaired;
}

let attempts = 0;
function waitForScene() {
  attempts++;
  scanExisting();
  if (attempts < 240 && stats.meshesRepaired === 0) setTimeout(waitForScene, 100);
}

window.realitySandboxSurfaceWaterRepairV85 = {
  installed: true,
  build: BUILD,
  getStats: () => ({ ...stats }),
  rescan: scanExisting,
};
html.dataset.surfaceWaterRepairV85 = 'waiting';
waitForScene();

const previousDiagnostics = window.realitySandboxPresentationDiagnostics;
window.realitySandboxPresentationDiagnostics = () => ({
  ...(typeof previousDiagnostics === 'function' ? previousDiagnostics() : {}),
  surfaceWaterRepairV85: window.realitySandboxSurfaceWaterRepairV85.getStats(),
});
