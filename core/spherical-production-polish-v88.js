import * as THREE from 'three';

const BUILD = 'v88-default-spherical-fauna-seam';
const PATCH_SIDE = 113;
const PATCH_VERTEX_COUNT = PATCH_SIDE * PATCH_SIDE;
const PATCH_FEATHER_ROWS = 10;
const PATCH_EDGE_DROP = 1.05;
const CREATURE_READABILITY_SCALE = 1.32;
const html = document.documentElement;

const stats = {
  installed: true,
  faunaMeshesPolished: 0,
  faunaMatrixWrites: 0,
  faunaColorWrites: 0,
  patchMeshesFeathered: 0,
  patchVerticesFeathered: 0,
};

function hash01(index, salt = 0) {
  const x = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function mergeParts(parts) {
  const vertices = [];
  const normals = [];
  const indices = [];
  let offset = 0;
  for (const geometry of parts) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const p = g.attributes.position;
    const n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      vertices.push(p.getX(i), p.getY(i), p.getZ(i));
      if (n) normals.push(n.getX(i), n.getY(i), n.getZ(i));
      else normals.push(0, 1, 0);
      indices.push(offset++);
    }
    if (g !== geometry) g.dispose();
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  result.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  result.setIndex(indices);
  result.computeBoundingBox();
  result.computeBoundingSphere();
  return result;
}

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

  // Build the animal in a conventional local frame: +Y is up, +Z is forward.
  // A final 90-degree X rotation converts +Y into +Z because the production
  // spherical renderer aligns its local +Z axis with the planet normal.
  add(new THREE.CapsuleGeometry(0.34, 0.94, 5, 8), [0, 0.73, 0], [Math.PI / 2, 0, 0], [1.06, 1, 1]);
  add(new THREE.IcosahedronGeometry(0.31, 1), [0, 0.79, 0.46], [0, 0, 0], [1.12, 0.92, 1.08]);
  add(new THREE.IcosahedronGeometry(0.34, 1), [0, 0.76, -0.43], [0, 0, 0], [1.14, 0.9, 1.12]);

  add(new THREE.CylinderGeometry(0.13, 0.18, 0.48, 7), [0, 0.96, 0.67], [Math.PI / 2.8, 0, 0]);
  add(new THREE.IcosahedronGeometry(0.29, 1), [0, 1.10, 0.98], [0, 0, 0], [1.0, 0.86, 1.16]);
  add(new THREE.CapsuleGeometry(0.12, 0.24, 4, 7), [0, 1.02, 1.26], [Math.PI / 2, 0, 0], [0.92, 0.88, 1]);

  for (const side of [-1, 1]) {
    add(new THREE.ConeGeometry(0.07, 0.24, 5), [side * 0.23, 1.28, 0.98], [0, 0, side * 1.02], [1, 1, 0.72]);
  }

  // Jointed legs end at y=0 so the later radial grounding correction can place
  // every animal cleanly on the sampled surface instead of on its nose.
  for (const x of [-0.25, 0.25]) {
    for (const z of [-0.39, 0.37]) {
      const outward = x < 0 ? -0.07 : 0.07;
      add(new THREE.CylinderGeometry(0.055, 0.073, 0.38, 6), [x, 0.43, z], [0, 0, outward]);
      add(new THREE.CylinderGeometry(0.045, 0.058, 0.31, 6), [x + outward * 0.7, 0.14, z + 0.025], [0.08, 0, -outward * 0.65]);
      add(new THREE.SphereGeometry(0.075, 6, 4), [x + outward, 0.018, z + 0.07], [0, 0, 0], [1.12, 0.38, 1.48]);
    }
  }

  add(new THREE.ConeGeometry(0.09, 0.58, 6), [0, 0.82, -0.92], [-Math.PI / 2.5, 0, 0], [0.82, 1, 0.82]);

  const merged = mergeParts(parts);
  for (const part of parts) part.dispose?.();
  merged.rotateX(Math.PI / 2);
  merged.computeVertexNormals();
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

const naturalFaunaGeometry = createNaturalFaunaGeometry();
const nativeSceneAdd = THREE.Scene.prototype.add;
const workPosition = new THREE.Vector3();
const workQuaternion = new THREE.Quaternion();
const workScale = new THREE.Vector3();
const workMatrix = new THREE.Matrix4();
const localYaw = new THREE.Quaternion();
const radial = new THREE.Vector3();
const tintTarget = new THREE.Color(0xd9ead6);
const zAxis = new THREE.Vector3(0, 0, 1);

function looksLikeDefaultFauna(object) {
  const material = object?.material;
  const originalSignature = Boolean(
    material?.isMeshStandardMaterial &&
    material.flatShading === true &&
    Math.abs(Number(material.roughness) - 0.45) < 0.08 &&
    Math.abs(Number(material.metalness) - 0.08) < 0.08
  );
  const reusedPolishedMaterial = material?.userData?.sphericalFaunaV88Material === BUILD;
  return Boolean(
    object?.isInstancedMesh &&
    !object.userData?.sphericalFaunaV88 &&
    material?.isMeshStandardMaterial &&
    (originalSignature || reusedPolishedMaterial)
  );
}

function polishFauna(object) {
  if (!looksLikeDefaultFauna(object)) return false;
  object.geometry = naturalFaunaGeometry;
  object.name = 'eidolonSphericalFaunaV88NaturalQuadrupeds';
  object.userData.sphericalFaunaV88 = BUILD;

  if (object.material) {
    object.material.userData.sphericalFaunaV88Material = BUILD;
    object.material.roughness = 0.86;
    object.material.metalness = 0;
    object.material.flatShading = false;
    object.material.emissive?.setHex?.(0x07110b);
    object.material.emissiveIntensity = 0.08;
    object.material.needsUpdate = true;
  }

  const nativeSetMatrixAt = object.setMatrixAt.bind(object);
  object.setMatrixAt = function setNaturalSphericalFaunaMatrix(index, matrix) {
    matrix.decompose(workPosition, workQuaternion, workScale);

    // The renderer's original radial offsets are closely proportional to its
    // role scale. Pull the origin back to the ground before applying the larger
    // readable body dimensions.
    const baseScale = Math.max(0.001, workScale.x);
    radial.copy(workPosition).normalize();
    workPosition.addScaledVector(radial, -baseScale * 0.86);

    // Give each individual a stable tangent heading. The production renderer
    // only aligns one axis to the planet normal, so without this correction the
    // old animal geometry appeared to stand upright like a tiny person.
    localYaw.setFromAxisAngle(zAxis, hash01(index, 9) * Math.PI * 2);
    workQuaternion.multiply(localYaw);

    const width = 0.9 + hash01(index, 1) * 0.22;
    const length = 0.94 + hash01(index, 2) * 0.32;
    const height = 0.9 + hash01(index, 3) * 0.18;
    const s = baseScale * CREATURE_READABILITY_SCALE;
    // After the geometry's axis conversion, X=width, Y=body length, Z=height.
    workScale.set(s * width, s * length, s * height);
    workMatrix.compose(workPosition, workQuaternion, workScale);
    stats.faunaMatrixWrites++;
    return nativeSetMatrixAt(index, workMatrix);
  };

  const nativeSetColorAt = object.setColorAt.bind(object);
  object.setColorAt = function setNaturalSphericalFaunaColor(index, color) {
    const next = color?.clone?.() || new THREE.Color(color || 0x7fb68d);
    next.lerp(tintTarget, 0.10 + hash01(index, 4) * 0.06);
    next.offsetHSL((hash01(index, 5) - 0.5) * 0.03, -0.03, 0.045);
    stats.faunaColorWrites++;
    return nativeSetColorAt(index, next);
  };

  stats.faunaMeshesPolished++;
  html.dataset.sphericalFaunaV88 = 'natural-grounded-quadrupeds';
  return true;
}

function looksLikeLocalPatch(object) {
  const positions = object?.geometry?.getAttribute?.('position');
  return Boolean(
    object?.isMesh &&
    !object.isInstancedMesh &&
    !object.userData?.sphericalPatchV88 &&
    positions?.count === PATCH_VERTEX_COUNT &&
    object.material?.isMeshStandardMaterial &&
    object.material?.transparent === true &&
    object.renderOrder === 2
  );
}

function featherLocalPatch(object) {
  if (!looksLikeLocalPatch(object)) return false;
  const positions = object.geometry.getAttribute('position');
  for (let row = 0; row < PATCH_SIDE; row++) {
    for (let col = 0; col < PATCH_SIDE; col++) {
      const edge = Math.min(row, col, PATCH_SIDE - 1 - row, PATCH_SIDE - 1 - col);
      if (edge >= PATCH_FEATHER_ROWS) continue;
      const t = 1 - edge / PATCH_FEATHER_ROWS;
      const drop = PATCH_EDGE_DROP * t * t;
      const index = row * PATCH_SIDE + col;
      const x = positions.getX(index);
      const y = positions.getY(index);
      const z = positions.getZ(index);
      const radius = Math.hypot(x, y, z);
      if (radius <= drop + 0.001) continue;
      const factor = (radius - drop) / radius;
      positions.setXYZ(index, x * factor, y * factor, z * factor);
      stats.patchVerticesFeathered++;
    }
  }
  positions.needsUpdate = true;
  object.geometry.computeVertexNormals();
  object.geometry.computeBoundingBox();
  object.geometry.computeBoundingSphere();
  object.material.polygonOffset = true;
  object.material.polygonOffsetFactor = -0.6;
  object.material.polygonOffsetUnits = -0.6;
  object.material.needsUpdate = true;
  object.name = 'eidolonLocalSphericalPatchV88Feathered';
  object.userData.sphericalPatchV88 = BUILD;
  stats.patchMeshesFeathered++;
  html.dataset.sphericalPatchV88 = 'feathered-under-global-sphere';
  return true;
}

function sphericalProductionPolishAdd(...objects) {
  for (const object of objects) {
    polishFauna(object);
    featherLocalPatch(object);
  }
  return nativeSceneAdd.apply(this, objects);
}

THREE.Scene.prototype.add = sphericalProductionPolishAdd;

window.realitySandboxSphericalPolishV88 = {
  installed: true,
  build: BUILD,
  getStats: () => ({ ...stats }),
};
html.dataset.sphericalProductionPolish = BUILD;

window.addEventListener('pagehide', () => {
  // Restore only when this module still owns the wrapper. Page teardown usually
  // follows immediately, but this keeps hot reload and diagnostics predictable.
  if (THREE.Scene.prototype.add === sphericalProductionPolishAdd) THREE.Scene.prototype.add = nativeSceneAdd;
  naturalFaunaGeometry.dispose?.();
}, { once: true });
