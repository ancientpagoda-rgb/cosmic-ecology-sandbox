import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const LEGACY_FAUNA_EMISSIVE = 0x12202a;
const BUILD = 'v87-natural-fauna';
const html = document.documentElement;

function createNaturalFaunaGeometry() {
  const parts = [];
  const add = (geometry, position, rotation = [0, 0, 0], scale = [1, 1, 1]) => {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
      new THREE.Vector3(...scale),
    );
    geometry.applyMatrix4(matrix);
    geometry.deleteAttribute('uv');
    parts.push(geometry);
  };

  // Broad, low torso + shoulder/haunch masses keep the animal readable even
  // when it is walking directly toward or away from the camera.
  add(new THREE.CapsuleGeometry(0.42, 1.05, 5, 9), [0, 0.82, 0], [Math.PI / 2, 0, 0], [1.12, 1, 1]);
  add(new THREE.IcosahedronGeometry(0.42, 1), [0, 0.86, 0.44], [0, 0, 0], [1.18, 0.92, 1.08]);
  add(new THREE.IcosahedronGeometry(0.44, 1), [0, 0.83, -0.43], [0, 0, 0], [1.22, 0.9, 1.12]);

  // Neck and head angle forward rather than stacking vertically, avoiding the
  // accidental biped / stick-person silhouette of the old mesh.
  add(new THREE.CylinderGeometry(0.17, 0.22, 0.5, 7), [0, 1.02, 0.68], [Math.PI / 2.7, 0, 0]);
  add(new THREE.IcosahedronGeometry(0.35, 1), [0, 1.2, 1.02], [0, 0, 0], [1.0, 0.82, 1.18]);
  add(new THREE.CapsuleGeometry(0.16, 0.26, 4, 7), [0, 1.12, 1.34], [Math.PI / 2, 0, 0], [0.95, 0.9, 1]);

  // Ears are lateral and short. They add a clear head direction without making
  // every organism look like a horned goat.
  for (const side of [-1, 1]) {
    add(new THREE.ConeGeometry(0.09, 0.28, 5), [side * 0.28, 1.39, 1.03], [0, 0, side * 1.02], [1, 1, 0.72]);
  }

  // Four slightly splayed, jointed legs give a stable quadruped stance from
  // front, rear, and side angles. Feet terminate at y ~= 0 for ground contact.
  for (const x of [-0.31, 0.31]) {
    for (const z of [-0.46, 0.42]) {
      const outward = x < 0 ? -0.09 : 0.09;
      add(new THREE.CylinderGeometry(0.075, 0.095, 0.43, 6), [x, 0.48, z], [0, 0, outward]);
      add(new THREE.CylinderGeometry(0.06, 0.078, 0.35, 6), [x + outward * 0.8, 0.17, z + 0.035], [0.08, 0, -outward * 0.7]);
      add(new THREE.SphereGeometry(0.1, 7, 5), [x + outward * 1.1, 0.025, z + 0.075], [0, 0, 0], [1.05, 0.42, 1.45]);
    }
  }

  // A tapered tail extends back and slightly up so it remains visible without
  // reading as a fifth leg.
  add(new THREE.ConeGeometry(0.12, 0.7, 6), [0, 0.93, -1.08], [-Math.PI / 2.45, 0, 0], [0.86, 1, 0.86]);

  const merged = mergeGeometries(parts, false);
  if (!merged) return new THREE.IcosahedronGeometry(0.8, 1);
  for (const part of parts) part.dispose();
  merged.computeVertexNormals();
  return merged;
}

const polishedGeometry = createNaturalFaunaGeometry();
const nativeSceneAdd = THREE.Scene.prototype.add;
const workPosition = new THREE.Vector3();
const workQuaternion = new THREE.Quaternion();
const workScale = new THREE.Vector3();
const workMatrix = new THREE.Matrix4();
const tintTarget = new THREE.Color(0xe6efd7);

function hash01(index, salt = 0) {
  const x = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function isLegacyFauna(object) {
  return Boolean(
    object?.isInstancedMesh &&
    !object.userData?.faunaV87 &&
    object.material?.emissive?.getHex?.() === LEGACY_FAUNA_EMISSIVE
  );
}

function polishFauna(object) {
  if (!isLegacyFauna(object)) return false;

  const oldGeometry = object.geometry;
  object.geometry = polishedGeometry;
  if (oldGeometry && oldGeometry !== polishedGeometry) oldGeometry.dispose?.();
  object.name = 'surfaceFaunaV87NaturalQuadrupeds';
  object.userData.faunaV87 = BUILD;
  object.userData.presentation = 'natural-grounded-evolved-fauna';

  if (object.material) {
    object.material.roughness = 0.82;
    object.material.metalness = 0;
    object.material.flatShading = false;
    object.material.vertexColors = true;
    object.material.emissive?.setHex?.(0x0b1711);
    object.material.emissiveIntensity = 0.16;
    object.material.needsUpdate = true;
  }

  // Retain the renderer's entity positions and gait, but introduce subtle,
  // deterministic body proportions so a herd is not a row of cloned meshes.
  const nativeSetMatrixAt = object.setMatrixAt.bind(object);
  object.setMatrixAt = function setNaturalFaunaMatrix(index, matrix) {
    matrix.decompose(workPosition, workQuaternion, workScale);
    const width = 0.9 + hash01(index, 1) * 0.24;
    const height = 0.88 + hash01(index, 2) * 0.2;
    const length = 0.94 + hash01(index, 3) * 0.34;
    workScale.set(workScale.x * width, workScale.y * height, workScale.z * length);
    workMatrix.compose(workPosition, workQuaternion, workScale);
    return nativeSetMatrixAt(index, workMatrix);
  };

  // The old metallic/emissive treatment collapsed to black at distance. Blend
  // each existing role/species tint slightly toward daylight so silhouettes
  // remain colored without losing the simulation's inherited palette.
  const nativeSetColorAt = object.setColorAt.bind(object);
  object.setColorAt = function setNaturalFaunaColor(index, color) {
    const next = color?.clone?.() || new THREE.Color(color || 0x7fb68d);
    next.lerp(tintTarget, 0.12 + hash01(index, 4) * 0.06);
    next.offsetHSL((hash01(index, 5) - 0.5) * 0.025, -0.04, 0.035);
    return nativeSetColorAt(index, next);
  };

  html.dataset.surfaceFauna = BUILD;
  return true;
}

THREE.Scene.prototype.add = function faunaAwareSceneAdd(...objects) {
  // Polish before adding so the original renderer keeps ownership of the
  // movement loop while this module changes presentation only.
  for (const object of objects) polishFauna(object);
  return nativeSceneAdd.apply(this, objects);
};

window.realitySandboxSurfaceFaunaV87 = {
  installed: true,
  build: BUILD,
  presentation: 'natural-quadruped-fauna',
};
html.dataset.surfaceFaunaHook = BUILD;
