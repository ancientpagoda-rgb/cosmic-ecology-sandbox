import * as THREE from 'three';

// Make the production globe physically ten times broader without making
// creatures, terrain relief, or the near-surface camera ten times taller.
// The simulation grid remains unchanged; only its embedding radius expands.
const BUILD = 'v90-ten-x-planet-radius';
const SCALE = 10;
const BASE_RADIUS = 220;
const TARGET_RADIUS = BASE_RADIUS * SCALE;
const TERRAIN_SPLIT_RADIUS = (BASE_RADIUS + TARGET_RADIUS) * 0.5;
const STAR_SCALE = SCALE;
const FAR_PLANE = 120000;
const PATCH_VERTEX_COUNT = 113 * 113;
const PATCH_INDEX_COUNT = 112 * 112 * 6;
const html = document.documentElement;

const stats = {
  installed: true,
  geometryRemaps: 0,
  vertexRemaps: 0,
  faunaMeshes: 0,
  faunaMatrixRemaps: 0,
  cameraRemaps: 0,
  atmospheresScaled: 0,
  starFieldsScaled: 0,
  lightsScaled: 0,
};

function remapRadius(radius) {
  return TARGET_RADIUS + (radius - BASE_RADIUS);
}

function isTerrainSphere(geometry) {
  return Boolean(
    geometry?.isBufferGeometry &&
    geometry.type === 'SphereGeometry' &&
    Math.abs(Number(geometry.parameters?.radius) - BASE_RADIUS) < 0.01 &&
    geometry.getAttribute?.('color')
  );
}

function isLocalTerrainPatch(geometry) {
  const positions = geometry?.getAttribute?.('position');
  const colors = geometry?.getAttribute?.('color');
  return Boolean(
    geometry?.isBufferGeometry &&
    geometry.type === 'BufferGeometry' &&
    positions?.count === PATCH_VERTEX_COUNT &&
    colors?.count === PATCH_VERTEX_COUNT &&
    geometry.index?.count === PATCH_INDEX_COUNT
  );
}

function geometryNeedsRadialRemap(geometry) {
  const positions = geometry?.getAttribute?.('position');
  if (!positions?.count) return false;
  const samples = [0, Math.floor(positions.count * 0.37), Math.floor(positions.count * 0.73), positions.count - 1];
  let radius = 0;
  let count = 0;
  for (const index of samples) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    const r = Math.hypot(x, y, z);
    if (!Number.isFinite(r) || r <= 0) continue;
    radius += r;
    count += 1;
  }
  return count > 0 && radius / count < TERRAIN_SPLIT_RADIUS;
}

function remapGeometry(geometry) {
  if (!(isTerrainSphere(geometry) || isLocalTerrainPatch(geometry))) return false;
  if (!geometryNeedsRadialRemap(geometry)) return false;

  const positions = geometry.getAttribute('position');
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    const radius = Math.hypot(x, y, z);
    if (!Number.isFinite(radius) || radius <= 0.001) continue;
    const target = remapRadius(radius);
    const factor = target / radius;
    positions.setXYZ(index, x * factor, y * factor, z * factor);
    stats.vertexRemaps += 1;
  }
  positions.needsUpdate = true;
  geometry.computeBoundingBox?.();
  geometry.computeBoundingSphere?.();
  geometry.userData.sphericalPlanetScaleV90 = BUILD;
  stats.geometryRemaps += 1;
  return true;
}

const nativeComputeVertexNormals = THREE.BufferGeometry.prototype.computeVertexNormals;
THREE.BufferGeometry.prototype.computeVertexNormals = function tenXComputeVertexNormals(...args) {
  remapGeometry(this);
  return nativeComputeVertexNormals.apply(this, args);
};

const nativeSceneAdd = THREE.Scene.prototype.add;
const workPosition = new THREE.Vector3();
const workQuaternion = new THREE.Quaternion();
const workScale = new THREE.Vector3();
const workMatrix = new THREE.Matrix4();

function remapFaunaMesh(object) {
  if (!object?.isInstancedMesh || object.userData?.sphericalPlanetScaleV90) return false;
  if (!object.userData?.sphericalFaunaV88 && !/Fauna|Quadruped|Creature/i.test(String(object.name || ''))) return false;

  const priorSetMatrixAt = object.setMatrixAt.bind(object);
  object.setMatrixAt = function tenXSetMatrixAt(index, matrix) {
    matrix.decompose(workPosition, workQuaternion, workScale);
    const radius = workPosition.length();
    if (radius > 0.001 && radius < TERRAIN_SPLIT_RADIUS) {
      workPosition.multiplyScalar(remapRadius(radius) / radius);
      workMatrix.compose(workPosition, workQuaternion, workScale);
      stats.faunaMatrixRemaps += 1;
      return priorSetMatrixAt(index, workMatrix);
    }
    return priorSetMatrixAt(index, matrix);
  };
  object.userData.sphericalPlanetScaleV90 = BUILD;
  stats.faunaMeshes += 1;
  return true;
}

function scaleAtmosphere(object) {
  if (!object?.isMesh || object.userData?.sphericalPlanetScaleV90) return false;
  const radius = Number(object.geometry?.parameters?.radius);
  if (!object.material?.isMeshBasicMaterial || object.material.side !== THREE.BackSide) return false;
  if (!Number.isFinite(radius) || radius < BASE_RADIUS || radius > BASE_RADIUS + 20) return false;
  object.scale.multiplyScalar(SCALE);
  object.userData.sphericalPlanetScaleV90 = BUILD;
  stats.atmospheresScaled += 1;
  return true;
}

function scaleStars(object) {
  if (!object?.isPoints || object.userData?.sphericalPlanetScaleV90) return false;
  const count = object.geometry?.getAttribute?.('position')?.count;
  if (count !== 1200) return false;
  object.scale.multiplyScalar(STAR_SCALE);
  object.userData.sphericalPlanetScaleV90 = BUILD;
  stats.starFieldsScaled += 1;
  return true;
}

function scaleDirectionalLight(object) {
  if (!object?.isDirectionalLight || object.userData?.sphericalPlanetScaleV90) return false;
  object.position.multiplyScalar(SCALE);
  object.userData.sphericalPlanetScaleV90 = BUILD;
  stats.lightsScaled += 1;
  return true;
}

THREE.Scene.prototype.add = function tenXSphericalSceneAdd(...objects) {
  // Let the existing fauna/seam polish install first; then wrap its final fauna
  // matrix writer so the animal stays normal-sized but moves to the larger globe.
  const result = nativeSceneAdd.apply(this, objects);
  for (const object of objects) {
    remapFaunaMesh(object);
    scaleAtmosphere(object);
    scaleStars(object);
    scaleDirectionalLight(object);
  }
  return result;
};

const nativeRender = THREE.WebGLRenderer.prototype.render;
THREE.WebGLRenderer.prototype.render = function tenXSphericalRender(scene, camera, ...args) {
  if (camera?.isPerspectiveCamera) {
    const radius = camera.position.length();
    const altitude = Number(window.realitySandboxSingleSphericalRenderer?.getState?.().altitude);
    if (Number.isFinite(radius) && radius > 0.001 && Number.isFinite(altitude)) {
      const unscaledExpected = BASE_RADIUS + altitude;
      const scaledExpected = TARGET_RADIUS + altitude;
      if (Math.abs(radius - unscaledExpected) < Math.abs(radius - scaledExpected)) {
        camera.position.multiplyScalar(remapRadius(radius) / radius);
        stats.cameraRemaps += 1;
      }
    } else if (Number.isFinite(radius) && radius > 0.001 && radius < TERRAIN_SPLIT_RADIUS) {
      camera.position.multiplyScalar(remapRadius(radius) / radius);
      stats.cameraRemaps += 1;
    }
    if (camera.far < FAR_PLANE) {
      camera.far = FAR_PLANE;
      camera.updateProjectionMatrix();
    }
  }
  return nativeRender.call(this, scene, camera, ...args);
};

window.realitySandboxSphericalPlanetScaleV90 = {
  installed: true,
  build: BUILD,
  scale: SCALE,
  baseRadius: BASE_RADIUS,
  radius: TARGET_RADIUS,
  preservesLocalReliefScale: true,
  preservesCreatureScale: true,
  getStats: () => ({ ...stats }),
};
html.dataset.sphericalPlanetScale = String(SCALE);
html.dataset.sphericalPlanetRadius = String(TARGET_RADIUS);
