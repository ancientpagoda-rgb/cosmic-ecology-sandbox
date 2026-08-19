import * as THREE from 'three';

const BUILD = 'v82-clipped-shores-primary-rivers';
const CORE_WATER_LOWERING = 0.08;
const WATER_ISO = 0.24;
const RIVER_LOWERING = 0.20;
const MAX_PRIMARY_RIVERS = 56;
const html = document.documentElement;

const stats = {
  installed: true,
  waterMeshesPatched: 0,
  waterMaterialsPatched: 0,
  waterMasksSmoothed: 0,
  waterSourceVertices: 0,
  waterClippedVertices: 0,
  skinnyWaterVerticesRemoved: 0,
  riverMeshesPatched: 0,
  riverTracesConsidered: 0,
  riverTracesRendered: 0,
  riverTracesFiltered: 0,
  riverVerticesRebuilt: 0,
  renderPassesInspected: 0,
};

function smoothWaterMask(attribute) {
  const count = attribute?.count || 0;
  const side = Math.round(Math.sqrt(count));
  if (!count || side * side !== count) return;

  const raw = new Float32Array(count);
  for (let i = 0; i < count; i++) raw[i] = attribute.getX(i);
  const opened = new Float32Array(count);
  const read = (x, z) => raw[Math.max(0, Math.min(side - 1, z)) * side + Math.max(0, Math.min(side - 1, x))];

  for (let z = 0; z < side; z++) {
    for (let x = 0; x < side; x++) {
      const index = z * side + x;
      const center = raw[index];
      let weighted = 0;
      let weightTotal = 0;
      let strong = 0;
      let localMax = 0;

      for (let oz = -1; oz <= 1; oz++) {
        for (let ox = -1; ox <= 1; ox++) {
          const value = read(x + ox, z + oz);
          const weight = ox === 0 && oz === 0 ? 4 : (ox === 0 || oz === 0 ? 2 : 1);
          weighted += value * weight;
          weightTotal += weight;
          if (value >= 0.20) strong++;
          localMax = Math.max(localMax, value);
        }
      }

      let value = weighted / Math.max(1, weightTotal);
      // Remove thread-thin inland water from this coarse grid. Dedicated river
      // geometry renders those channels much more cleanly.
      if (center < 0.80 && localMax < 0.97 && strong <= 5) {
        if (center > 0.02) stats.skinnyWaterVerticesRemoved++;
        value = 0;
      } else {
        value = THREE.MathUtils.clamp((value - 0.035) * 1.10, 0, 1);
      }
      if (center >= 0.98 && strong >= 5) value = Math.max(value, 0.95);
      opened[index] = value;
    }
  }

  // Small cross blur removes isolated corners without spreading water far onto
  // land. This becomes the scalar field used for the clipped shoreline below.
  const smooth = new Float32Array(count);
  const readOpened = (x, z) => opened[Math.max(0, Math.min(side - 1, z)) * side + Math.max(0, Math.min(side - 1, x))];
  for (let z = 0; z < side; z++) {
    for (let x = 0; x < side; x++) {
      const index = z * side + x;
      const c = opened[index];
      smooth[index] = (c * 6 + readOpened(x - 1, z) + readOpened(x + 1, z) + readOpened(x, z - 1) + readOpened(x, z + 1)) / 10;
    }
  }

  for (let i = 0; i < count; i++) attribute.setX(i, smooth[i]);
  attribute.needsUpdate = true;
  stats.waterMasksSmoothed++;
}

function interpolateVertex(a, b, threshold) {
  const denominator = b.s - a.s;
  const t = Math.abs(denominator) < 1e-8 ? 0.5 : THREE.MathUtils.clamp((threshold - a.s) / denominator, 0, 1);
  return {
    x: THREE.MathUtils.lerp(a.x, b.x, t),
    y: THREE.MathUtils.lerp(a.y, b.y, t),
    z: THREE.MathUtils.lerp(a.z, b.z, t),
    s: threshold,
  };
}

function clipPolygonByStrength(input, threshold) {
  const output = [];
  if (!input.length) return output;
  let previous = input[input.length - 1];
  let previousInside = previous.s >= threshold;

  for (const current of input) {
    const currentInside = current.s >= threshold;
    if (currentInside !== previousInside) output.push(interpolateVertex(previous, current, threshold));
    if (currentInside) output.push(current);
    previous = current;
    previousInside = currentInside;
  }
  return output;
}

function clippedWaterGeometry(source) {
  const positions = source.getAttribute('position');
  const strengths = source.getAttribute('waterStrength');
  const sourceIndex = source.index?.array;
  if (!positions || !strengths) return null;

  const triangles = [];
  if (sourceIndex?.length) {
    for (let i = 0; i + 2 < sourceIndex.length; i += 3) triangles.push([sourceIndex[i], sourceIndex[i + 1], sourceIndex[i + 2]]);
  } else {
    for (let i = 0; i + 2 < positions.count; i += 3) triangles.push([i, i + 1, i + 2]);
  }

  const outPositions = [];
  const outStrengths = [];
  const outIndices = [];

  const readVertex = index => ({
    x: positions.getX(index),
    y: positions.getY(index) - CORE_WATER_LOWERING,
    z: positions.getZ(index),
    s: strengths.getX(index),
  });

  for (const triangle of triangles) {
    const polygon = clipPolygonByStrength(triangle.map(readVertex), WATER_ISO);
    if (polygon.length < 3) continue;
    const base = outPositions.length / 3;
    for (const vertex of polygon) {
      outPositions.push(vertex.x, vertex.y, vertex.z);
      outStrengths.push(vertex.s);
    }
    for (let i = 1; i < polygon.length - 1; i++) outIndices.push(base, base + i, base + i + 1);
  }

  if (!outPositions.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(outPositions, 3));
  geometry.setAttribute('waterStrength', new THREE.Float32BufferAttribute(outStrengths, 1));
  geometry.setIndex(outIndices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  stats.waterClippedVertices += outPositions.length / 3;
  return geometry;
}

function patchCoreWater(mesh) {
  if (!mesh?.isMesh || mesh.userData?.surfaceWaterV82) return false;
  const source = mesh.geometry;
  const material = mesh.material;
  const strengths = source?.getAttribute?.('waterStrength');
  if (!strengths || !source?.getAttribute?.('position') || !material?.isShaderMaterial) return false;
  if (!String(material.vertexShader || '').includes('attribute float waterStrength')) return false;

  mesh.userData.surfaceWaterV82 = true;
  stats.waterSourceVertices += source.getAttribute('position').count;
  smoothWaterMask(strengths);
  const clipped = clippedWaterGeometry(source);
  if (!clipped) {
    mesh.visible = false;
    return true;
  }
  mesh.geometry = clipped;
  source.dispose?.();

  if (!material.userData.surfaceWaterV82) {
    material.userData.surfaceWaterV82 = true;
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
        float wave = (sin((p.x + time * 4.2) * 0.15) + cos((p.z - time * 3.6) * 0.13)) * 0.015 * waterStrength;
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
        float strength = smoothstep(${WATER_ISO.toFixed(2)}, 0.92, vWater);
        float depthMix = clamp(0.15 + strength * 0.72 - vWave * 0.45, 0.0, 1.0);
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
  const index = geometry.index?.array;
  const pairCount = Math.floor((positions?.count || 0) / 2);
  if (!positions || !index || pairCount < 2) return [];

  const adjacency = Array.from({ length: pairCount }, () => new Set());
  for (let i = 0; i + 5 < index.length; i += 6) {
    const unique = new Set();
    for (let j = 0; j < 6; j++) unique.add(Math.floor(Number(index[i + j]) / 2));
    const pairs = [...unique];
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

function riverCandidates(geometry) {
  const sourcePositions = geometry.getAttribute('position');
  const sourceStrength = geometry.getAttribute('riverStrength');
  const components = ribbonComponents(geometry);
  if (!sourcePositions || !components.length) return [];

  const candidates = [];
  for (const component of components) {
    const control = [];
    let strengthSum = 0;
    let widthSum = 0;
    let pathLength = 0;
    let previous = null;

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
      const point = new THREE.Vector3((lx + rx) * 0.5, (ly + ry) * 0.5 - RIVER_LOWERING, (lz + rz) * 0.5);
      if (previous) pathLength += previous.distanceTo(point);
      previous = point;
      control.push(point);
      widthSum += Math.hypot(lx - rx, lz - rz);
      strengthSum += sourceStrength ? (sourceStrength.getX(left) + sourceStrength.getX(right)) * 0.5 : 0.5;
    }
    if (control.length < 3 || pathLength < 5) continue;

    const averageStrength = THREE.MathUtils.clamp(strengthSum / control.length, 0, 1);
    const sourceWidth = widthSum / control.length;
    const score = pathLength * Math.pow(Math.max(0.05, averageStrength), 1.7) * Math.sqrt(Math.max(0.25, sourceWidth));
    candidates.push({ control, averageStrength, sourceWidth, pathLength, score });
  }
  return candidates;
}

function rebuildPrimaryRivers(source) {
  const candidates = riverCandidates(source);
  stats.riverTracesConsidered += candidates.length;
  candidates.sort((a, b) => b.score - a.score);

  // The previous renderer drew 700+ drainage traces in the same field. Keep a
  // compact hierarchy of the strongest/longest channels instead.
  const selected = candidates
    .filter(candidate => candidate.averageStrength >= 0.22 || candidate.pathLength >= 34)
    .slice(0, MAX_PRIMARY_RIVERS);
  stats.riverTracesRendered += selected.length;
  stats.riverTracesFiltered += Math.max(0, candidates.length - selected.length);
  if (!selected.length) return null;

  const positions = [];
  const colors = [];
  const indices = [];
  const shallow = new THREE.Color(0x2f86b7);
  const deep = new THREE.Color(0x15506f);
  const tangent = new THREE.Vector3();
  const perpendicular = new THREE.Vector3();
  let vertexBase = 0;

  for (const candidate of selected) {
    const { control, averageStrength, sourceWidth } = candidate;
    const fullWidth = THREE.MathUtils.clamp(sourceWidth * 0.24 + averageStrength * 0.60, 0.38, 1.55);
    const curve = new THREE.CatmullRomCurve3(control, false, 'centripetal', 0.45);
    const sampleCount = Math.min(100, Math.max(control.length * 3, 12));
    let distanceAlong = 0;
    let previous = null;

    for (let sample = 0; sample < sampleCount; sample++) {
      const t = sample / (sampleCount - 1);
      const point = curve.getPoint(t);
      curve.getTangent(t, tangent);
      perpendicular.set(-tangent.z, 0, tangent.x);
      if (perpendicular.lengthSq() < 1e-8) perpendicular.set(1, 0, 0);
      perpendicular.normalize().multiplyScalar(fullWidth * 0.5);

      if (previous) distanceAlong += previous.distanceTo(point);
      previous = point.clone();
      const left = point.clone().add(perpendicular);
      const right = point.clone().sub(perpendicular);
      positions.push(left.x, left.y, left.z, right.x, right.y, right.z);

      const color = shallow.clone().lerp(deep, THREE.MathUtils.clamp(0.20 + averageStrength * 0.70 + Math.sin(distanceAlong * 0.07) * 0.035, 0, 1));
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
  }

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
  if (!mesh?.isMesh || mesh.name !== 'surfaceRiversV41' || mesh.userData?.surfaceRiverV82) return false;
  mesh.userData.surfaceRiverV82 = true;
  const rebuilt = rebuildPrimaryRivers(mesh.geometry);
  if (!rebuilt) {
    mesh.visible = false;
    return true;
  }

  const oldGeometry = mesh.geometry;
  mesh.geometry = rebuilt;
  oldGeometry?.dispose?.();
  mesh.material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.38,
    metalness: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -0.55,
    polygonOffsetUnits: -0.55,
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
THREE.WebGLRenderer.prototype.render = function clippedShoreRender(scene, camera) {
  stats.renderPassesInspected++;
  inspectScene(scene);
  return nativeRender.call(this, scene, camera);
};

const nativeSceneAdd = THREE.Scene.prototype.add;
THREE.Scene.prototype.add = function clippedShoreSceneAdd(...objects) {
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