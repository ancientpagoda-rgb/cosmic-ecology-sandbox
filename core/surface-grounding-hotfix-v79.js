import * as THREE from 'three';

const BUILD = 'v81-stable-smooth-rivers-and-water';
const CORE_WATER_LOWERING = 0.08;
const RIVER_LOWERING = 0.20;
const html = document.documentElement;

const stats = {
  installed: true,
  waterMeshesPatched: 0,
  waterMaterialsPatched: 0,
  waterVerticesLowered: 0,
  waterMasksSmoothed: 0,
  skinnyWaterVerticesRemoved: 0,
  riverMeshesPatched: 0,
  riverTracesRebuilt: 0,
  riverVerticesRebuilt: 0,
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

      // Stronger morphological opening: broad ocean/lake areas survive, while
      // one- and two-cell river streaks disappear from this coarse grid. Rivers
      // are rendered by the dedicated resampled ribbon layer below.
      if (center < 0.78 && localMax < 0.96 && strongNeighbors <= 5) {
        if (center > 0.02) stats.skinnyWaterVerticesRemoved++;
        value = 0;
      } else {
        value = THREE.MathUtils.clamp((value - 0.045) * 1.10, 0, 1);
      }

      if (center >= 0.98 && strongNeighbors >= 5) value = Math.max(value, 0.94);
      next[index] = value;
    }
  }

  // A second light pass removes single-vertex corners left by the first pass.
  const filtered = new Float32Array(count);
  const readNext = (x, z) => next[Math.max(0, Math.min(side - 1, z)) * side + Math.max(0, Math.min(side - 1, x))];
  for (let z = 0; z < side; z++) {
    for (let x = 0; x < side; x++) {
      const index = z * side + x;
      const c = next[index];
      const average = (c * 4 + readNext(x - 1, z) + readNext(x + 1, z) + readNext(x, z - 1) + readNext(x, z + 1)) / 8;
      filtered[index] = c >= 0.92 ? Math.max(c, average) : average;
    }
  }

  for (let i = 0; i < count; i++) attribute.setX(i, filtered[i]);
  attribute.needsUpdate = true;
  stats.waterMasksSmoothed++;
}

function patchCoreWater(mesh) {
  if (!mesh?.isMesh || mesh.userData?.surfaceWaterV81) return false;
  const geometry = mesh.geometry;
  const material = mesh.material;
  const strengths = geometry?.getAttribute?.('waterStrength');
  const positions = geometry?.getAttribute?.('position');
  if (!strengths || !positions || !material?.isShaderMaterial) return false;
  if (!String(material.vertexShader || '').includes('attribute float waterStrength')) return false;

  mesh.userData.surfaceWaterV81 = true;
  smoothWaterMask(strengths);

  for (let i = 0; i < positions.count; i++) positions.setY(i, positions.getY(i) - CORE_WATER_LOWERING);
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  stats.waterVerticesLowered += positions.count;

  if (!material.userData.surfaceWaterV81) {
    material.userData.surfaceWaterV81 = true;
    material.transparent = false;
    material.depthWrite = true;
    material.depthTest = true;
    material.alphaTest = 0;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -0.35;
    material.polygonOffsetUnits = -0.35;
    material.vertexShader = `
      uniform float time;
      attribute float waterStrength;
      varying float vWater;
      varying float vWave;
      void main() {
        vec3 p = position;
        float wave = (sin((p.x + time * 4.6) * 0.15) + cos((p.z - time * 3.9) * 0.13)) * 0.018 * waterStrength;
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
        if (vWater < 0.24) discard;
        float strength = smoothstep(0.24, 0.90, vWater);
        float depthMix = clamp(0.17 + strength * 0.70 - vWave * 0.55, 0.0, 1.0);
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

function ribbonComponents(geometry) {
  const positions = geometry.getAttribute('position');
  const index = geometry.index;
  const pairCount = Math.floor((positions?.count || 0) / 2);
  if (!positions || !index || pairCount < 2) return [];

  const adjacency = Array.from({ length: pairCount }, () => new Set());
  const array = index.array;
  for (let i = 0; i + 5 < array.length; i += 6) {
    const pairs = [...new Set(Array.from(array.slice(i, i + 6), value => Math.floor(Number(value) / 2)))];
    for (let a = 0; a < pairs.length; a++) {
      for (let b = a + 1; b < pairs.length; b++) {
        if (pairs[a] === pairs[b]) continue;
        adjacency[pairs[a]]?.add(pairs[b]);
        adjacency[pairs[b]]?.add(pairs[a]);
      }
    }
  }

  const visited = new Uint8Array(pairCount);
  const components = [];
  for (let start = 0; start < pairCount; start++) {
    if (visited[start] || adjacency[start].size === 0) continue;
    const stack = [start];
    const component = [];
    visited[start] = 1;
    while (stack.length) {
      const current = stack.pop();
      component.push(current);
      for (const next of adjacency[current]) {
        if (visited[next]) continue;
        visited[next] = 1;
        stack.push(next);
      }
    }
    component.sort((a, b) => a - b);
    if (component.length >= 2) components.push(component);
  }
  return components;
}

function rebuildRiverRibbon(geometry) {
  const sourcePositions = geometry.getAttribute('position');
  const sourceStrength = geometry.getAttribute('riverStrength');
  const components = ribbonComponents(geometry);
  if (!sourcePositions || !components.length) return null;

  const positions = [];
  const colors = [];
  const indices = [];
  const shallow = new THREE.Color(0x2f86b7);
  const deep = new THREE.Color(0x15506f);
  const tangent = new THREE.Vector3();
  const perpendicular = new THREE.Vector3();
  let vertexBase = 0;

  for (const component of components) {
    const control = [];
    let strengthSum = 0;
    let widthSum = 0;

    for (const pair of component) {
      const left = pair * 2;
      const right = left + 1;
      if (right >= sourcePositions.count) continue;
      const lx = sourcePositions.getX(left);
      const ly = sourcePositions.getY(left);
      const lz = sourcePositions.getZ(left);
      const rx = sourcePositions.getX(right);
      const ry = sourcePositions.getY(right);
      const rz = sourcePositions.getZ(right);
      control.push(new THREE.Vector3((lx + rx) * 0.5, (ly + ry) * 0.5 - RIVER_LOWERING, (lz + rz) * 0.5));
      widthSum += Math.hypot(lx - rx, lz - rz);
      strengthSum += sourceStrength ? (sourceStrength.getX(left) + sourceStrength.getX(right)) * 0.5 : 0.5;
    }
    if (control.length < 2) continue;

    // Cap widths aggressively. The source renderer allows very wide flow-based
    // ribbons; close to the camera those become giant wedges. Preserve relative
    // river scale but constrain it to a believable visual range.
    const averageStrength = THREE.MathUtils.clamp(strengthSum / control.length, 0, 1);
    const sourceWidth = widthSum / control.length;
    const fullWidth = THREE.MathUtils.clamp(sourceWidth * 0.36 + averageStrength * 0.55, 0.42, 2.35);

    let curve;
    if (control.length >= 3) curve = new THREE.CatmullRomCurve3(control, false, 'centripetal', 0.45);
    const sampleCount = Math.min(120, Math.max(control.length * 4, 10));
    let distanceAlong = 0;
    let previous = null;

    for (let sample = 0; sample < sampleCount; sample++) {
      const t = sampleCount === 1 ? 0 : sample / (sampleCount - 1);
      const point = curve ? curve.getPoint(t) : control[0].clone().lerp(control[control.length - 1], t);
      if (curve) curve.getTangent(t, tangent);
      else tangent.copy(control[control.length - 1]).sub(control[0]).normalize();
      perpendicular.set(-tangent.z, 0, tangent.x);
      if (perpendicular.lengthSq() < 1e-8) perpendicular.set(1, 0, 0);
      perpendicular.normalize().multiplyScalar(fullWidth * 0.5);

      if (previous) distanceAlong += previous.distanceTo(point);
      previous = point.clone();

      const left = point.clone().add(perpendicular);
      const right = point.clone().sub(perpendicular);
      positions.push(left.x, left.y, left.z, right.x, right.y, right.z);

      const flowPulse = 0.10 * Math.sin(distanceAlong * 0.08);
      const color = shallow.clone().lerp(deep, THREE.MathUtils.clamp(0.24 + averageStrength * 0.62 + flowPulse, 0, 1));
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    }

    for (let sample = 0; sample < sampleCount - 1; sample++) {
      const a = vertexBase + sample * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }

    vertexBase += sampleCount * 2;
    stats.riverTracesRebuilt++;
  }

  if (!positions.length || !indices.length) return null;
  const rebuilt = new THREE.BufferGeometry();
  rebuilt.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  rebuilt.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  rebuilt.setIndex(indices);
  rebuilt.computeVertexNormals();
  rebuilt.computeBoundingBox();
  rebuilt.computeBoundingSphere();
  stats.riverVerticesRebuilt += positions.length / 3;
  return rebuilt;
}

function patchRiver(mesh) {
  if (!mesh?.isMesh || mesh.name !== 'surfaceRiversV41' || mesh.userData?.surfaceRiverV81) return false;
  const rebuilt = rebuildRiverRibbon(mesh.geometry);
  if (!rebuilt) return false;

  mesh.userData.surfaceRiverV81 = true;
  const oldGeometry = mesh.geometry;
  mesh.geometry = rebuilt;
  oldGeometry?.dispose?.();

  // A stable standard material avoids the old alpha/depth interactions while
  // vertex colors keep some visual variation along the stream.
  mesh.material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.34,
    metalness: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -0.65,
    polygonOffsetUnits: -0.65,
  });
  mesh.renderOrder = 3;
  mesh.frustumCulled = true;
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