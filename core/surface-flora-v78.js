import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const LEGACY_FAUNA_EMISSIVE = 0x12202a;
const FLORA_BUILD = 'v79-native-grounded-surface-flora';
const Z_SCALE = 62;
const SEA_LEVEL = 0.53;
const ROOT_Y = -0.58;
const WET_PLANT_THRESHOLD = 0.12;
const html = document.documentElement;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrap = (value, max) => ((value % max) + max) % max;

function createPlantGeometry() {
  const parts = [];
  const add = (geometry, position, rotation = [0, 0, 0], scale = [1, 1, 1], color = 0x6f9b51) => {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
      new THREE.Vector3(...scale),
    );
    geometry.applyMatrix4(matrix);
    geometry.deleteAttribute('uv');
    const plantColor = new THREE.Color(color);
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let index = 0; index < geometry.attributes.position.count; index += 1) {
      colors[index * 3] = plantColor.r;
      colors[index * 3 + 1] = plantColor.g;
      colors[index * 3 + 2] = plantColor.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(geometry);
  };

  // Root geometry begins below the legacy fauna origin. v79 additionally
  // replaces the old walking/bobbing matrix with a fixed terrain-grounded one,
  // so the root remains planted even on uneven terrain.
  add(new THREE.CylinderGeometry(0.12, 0.21, 1.72, 7), [0, 0.28, 0], [0, 0, 0], [1, 1, 1], 0x78583a);
  add(new THREE.IcosahedronGeometry(0.24, 1), [0, -0.48, 0], [0, 0, 0], [1.25, 0.65, 1.25], 0x5f6f38);

  for (let index = 0; index < 7; index += 1) {
    const angle = index / 7 * Math.PI * 2 + 0.21;
    const radius = 0.57;
    const y = 0.40 + (index % 3) * 0.27;
    add(
      new THREE.CylinderGeometry(0.035, 0.065, 0.92, 5),
      [Math.cos(angle) * radius * 0.48, y, Math.sin(angle) * radius * 0.48],
      [Math.sin(angle) * 0.72, angle, -Math.cos(angle) * 0.72],
      [1, 1, 1],
      0x6e5736,
    );
    add(
      new THREE.IcosahedronGeometry(0.34, 1),
      [Math.cos(angle) * radius, y + 0.36, Math.sin(angle) * radius],
      [0, angle, 0],
      [1.34, 0.55, 0.82],
      index % 2 ? 0x5e9f55 : 0x78aa59,
    );
  }

  add(new THREE.IcosahedronGeometry(0.66, 1), [0, 1.20, 0], [0, 0, 0], [1.18, 0.68, 1.08], 0x5d9650);
  add(new THREE.IcosahedronGeometry(0.44, 1), [0.38, 1.42, 0.18], [0, 0.4, 0], [1.08, 0.62, 0.92], 0x79a95a);
  add(new THREE.IcosahedronGeometry(0.42, 1), [-0.36, 1.38, -0.21], [0, -0.5, 0], [1.10, 0.61, 0.94], 0x6ba054);

  for (let index = 0; index < 6; index += 1) {
    const angle = index / 6 * Math.PI * 2;
    add(
      new THREE.OctahedronGeometry(0.15, 0),
      [Math.cos(angle) * 0.27, 1.92, Math.sin(angle) * 0.27],
      [0, angle, 0],
      [1, 1.35, 1],
      index % 2 ? 0xdcb66d : 0xd88985,
    );
  }
  add(new THREE.IcosahedronGeometry(0.19, 1), [0, 1.98, 0], [0, 0, 0], [1, 1.25, 1], 0xe5c46f);

  const merged = mergeGeometries(parts, false);
  if (merged) {
    for (const part of parts) part.dispose();
    merged.computeVertexNormals();
    return merged;
  }
  return new THREE.ConeGeometry(0.55, 2.5, 7);
}

const state = {
  installed: true,
  convertedMeshes: 0,
  mesh: null,
  scene: null,
  legacyExpedition: null,
  visiblePlants: 0,
  scans: 0,
  lastScan: null,
  roots: new Map(),
  rootAnchorKey: '',
  groundedMatrixWrites: 0,
  terrainSamples: 0,
  waterSamples: 0,
  wetPlantsSuppressed: new Set(),
};

const plantGeometry = createPlantGeometry();
const nativeSceneAdd = THREE.Scene.prototype.add;

function normalizeSphereSample(x, y, world) {
  let sx = x;
  let sy = y;
  while (sy < 0 || sy > world.height) {
    if (sy < 0) {
      sy = -sy;
      sx += world.width * 0.5;
    } else if (sy > world.height) {
      sy = world.height - (sy - world.height);
      sx += world.width * 0.5;
    }
  }
  return { x: wrap(sx, world.width), y: clamp(sy, 0, world.height) };
}

function surfaceAnchor() {
  const surface = window.realitySandboxSurfaceSphereV37?.getStats?.();
  const planet = window.realitySandboxPlanet;
  const world = planet?.world;
  if (!surface || !world) return null;
  const parts = String(surface.activeChunkKey || '').split(':').map(Number);
  const stride = Number(surface.chunkStride);
  if (parts.length !== 2 || !parts.every(Number.isFinite) || !Number.isFinite(stride)) return null;
  return {
    key: surface.activeChunkKey,
    x: wrap((parts[0] + 0.5) * stride, world.width),
    y: clamp((parts[1] + 0.5) * stride, 0, world.height),
    curvatureRadius: Number(surface.curvatureRadius) || Math.max(world.width, world.height) * 22,
    world,
    planet,
  };
}

function sphereSag(localX, localZ, radius) {
  const d2 = localX * localX + localZ * localZ;
  const r2 = radius * radius;
  return radius - Math.sqrt(Math.max(1, r2 - Math.min(d2, r2 - 1)));
}

function rootFor(index, localX, localZ, uniformScale, yaw) {
  const anchor = surfaceAnchor();
  if (!anchor) return null;

  if (state.rootAnchorKey !== anchor.key) {
    state.rootAnchorKey = anchor.key;
    state.roots.clear();
    state.wetPlantsSuppressed.clear();
  }

  const cached = state.roots.get(index);
  if (cached) return cached;

  const samplePoint = normalizeSphereSample(anchor.x + localX, anchor.y + localZ, anchor.world);
  // Passing a third argument intentionally bypasses the Surface HUD cache in
  // the v37 wrappers and reaches the authoritative terrain/water samplers.
  const terrain = anchor.planet.living?.sampleDynamicPlanet?.(samplePoint.x, samplePoint.y, 'flora-root-v79');
  const water = anchor.planet.waterCycle?.sample?.(samplePoint.x, samplePoint.y, 'flora-root-v79');
  state.terrainSamples++;
  state.waterSamples++;

  const elevation = terrain?.land ? clamp(Number(terrain.elevation ?? SEA_LEVEL), 0, 1) : SEA_LEVEL;
  const groundY = elevation * Z_SCALE - sphereSag(localX, localZ, anchor.curvatureRadius);
  const wetness = Math.max(
    Number(water?.river || 0),
    Number(water?.lake || 0),
    Number(water?.delta || 0),
    Number(water?.surface || 0),
  );
  const wet = terrain?.land === false || wetness > WET_PLANT_THRESHOLD;

  const root = {
    localX,
    localZ,
    groundY,
    uniformScale,
    yaw,
    wet,
  };
  state.roots.set(index, root);
  if (wet) state.wetPlantsSuppressed.add(index);
  return root;
}

function convertLegacyFaunaMesh(scene, object) {
  if (!object?.isInstancedMesh || object.userData?.floraV78) return false;
  if (object.material?.emissive?.getHex?.() !== LEGACY_FAUNA_EMISSIVE) return false;

  const oldGeometry = object.geometry;
  object.geometry = plantGeometry;
  oldGeometry?.dispose?.();
  object.name = 'surfaceFloraV78NativePlants';
  object.userData.floraV78 = true;
  object.userData.presentation = 'fixed-root-procedural-plant-individuals';

  if (object.material) {
    object.material.roughness = 0.88;
    object.material.metalness = 0;
    object.material.emissive?.setHex?.(0x07160b);
    object.material.emissiveIntensity = 0.08;
    object.material.flatShading = false;
    object.material.vertexColors = true;
    object.material.needsUpdate = true;
  }

  const nativeSetColorAt = object.setColorAt.bind(object);
  object.setColorAt = function setPlantColorAt(index, color) {
    const tint = color?.clone?.() || new THREE.Color(color || 0x6f9b51);
    tint.lerp(new THREE.Color(index % 3 === 0 ? 0x658f4d : 0x75a557), 0.58);
    tint.offsetHSL(((index % 7) - 3) * 0.008, 0.035, ((index % 5) - 2) * 0.012);
    return nativeSetColorAt(index, tint);
  };

  // The authoritative renderer still emits animal walk/bob transforms. Capture
  // the first location for each instance in the current terrain chunk, sample
  // the real ground once, and thereafter keep that plant fixed at its root.
  const nativeSetMatrixAt = object.setMatrixAt.bind(object);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  object.setMatrixAt = function setGroundedPlantMatrixAt(index, matrix) {
    matrix.decompose(position, quaternion, scale);
    euler.setFromQuaternion(quaternion, 'XYZ');
    const uniformScale = Math.max(0.001, Number(scale.x) || 1);
    const root = rootFor(index, position.x, position.z, uniformScale, euler.y);
    if (root) {
      position.x = root.localX;
      position.z = root.localZ;
      position.y = root.groundY - ROOT_Y * root.uniformScale + 0.012;
      quaternion.setFromEuler(new THREE.Euler(0, root.yaw, 0));
      if (root.wet) scale.set(0.001, 0.001, 0.001);
      else scale.set(root.uniformScale, root.uniformScale, root.uniformScale);
      matrix.compose(position, quaternion, scale);
      state.groundedMatrixWrites++;
    }
    return nativeSetMatrixAt(index, matrix);
  };

  state.mesh = object;
  state.scene = scene;
  state.convertedMeshes += 1;
  html.dataset.surfaceFloraV78 = 'native-gpu-instanced-grounded-3d-plants';
  return true;
}

THREE.Scene.prototype.add = function floraAwareSceneAdd(...objects) {
  const result = nativeSceneAdd.apply(this, objects);
  for (const object of objects) convertLegacyFaunaMesh(this, object);
  return result;
};

function plantCount() {
  const legacyCount = Number(state.legacyExpedition?.getVisibleFauna?.());
  if (Number.isFinite(legacyCount)) return Math.max(0, legacyCount - state.wetPlantsSuppressed.size);
  return Math.max(0, Number(state.mesh?.count || 0) - state.wetPlantsSuppressed.size);
}

function rewriteBotanyNote() {
  const note = document.getElementById('surfaceFieldNote');
  if (!note) return;
  note.textContent = String(note.textContent || '')
    .replace(/FIELD SCAN/g, 'BOTANY SCAN')
    .replace(/no organism/gi, 'no plant')
    .replace(/bright motion/gi, 'bright foliage')
    .replace(/grazer organism/gi, 'rosette flora')
    .replace(/predator organism/gi, 'branching flora')
    .replace(/apex organism/gi, 'crown flora')
    .replace(/\borganism\b/gi, 'plant')
    .replace(/\bspeed\b/gi, 'growth')
    .replace(/\bsense\b/gi, 'tropism');
}

function scanNearestPlant() {
  const result = state.legacyExpedition?.scan?.() || null;
  rewriteBotanyNote();
  state.scans += 1;
  state.lastScan = result ? { ...result, presentation: 'plant' } : null;
  return state.lastScan;
}

function patchExpeditionApi() {
  const current = window.realitySandboxSurfaceExpedition;
  if (!current || current === state.publicExpedition || state.legacyExpedition) return;
  if (typeof current.getVisibleFauna !== 'function') return;
  state.legacyExpedition = current;
  state.publicExpedition = {
    scan: scanNearestPlant,
    getVisibleFlora: plantCount,
  };
  window.realitySandboxSurfaceExpedition = state.publicExpedition;
}

function updatePresentationUi() {
  patchExpeditionApi();
  state.visiblePlants = plantCount();
  html.dataset.surfaceModeVisiblePlants = String(state.visiblePlants);

  const info = document.querySelector('#surfaceModeHud > div:first-child');
  if (info?.innerHTML) {
    info.innerHTML = info.innerHTML.replace(/nearby life\s+\d+/i, `nearby plants ${state.visiblePlants}`);
  }
  const help = [...document.querySelectorAll('#surfaceModeHud > div')].find(node => /E scan life/i.test(node.textContent || ''));
  if (help) help.textContent = help.textContent.replace(/E scan life/i, 'E scan plants');
}

const creatureDatasetObserver = new MutationObserver(() => {
  const value = Number(html.dataset.surfaceModeVisibleCreatures || 0);
  if (value > 0) {
    state.visiblePlants = Math.max(0, value - state.wetPlantsSuppressed.size);
    html.dataset.surfaceModeVisiblePlants = String(state.visiblePlants);
    html.dataset.surfaceModeVisibleCreatures = '0';
  }
});
creatureDatasetObserver.observe(html, { attributes: true, attributeFilter: ['data-surface-mode-visible-creatures'] });

window.addEventListener('keydown', event => {
  if (event.code !== 'KeyE' || html.dataset.surfaceMode !== 'active') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  scanNearestPlant();
}, { capture: true, passive: false });

setInterval(updatePresentationUi, 90);

const api = {
  installed: true,
  build: FLORA_BUILD,
  getStats: () => ({
    installed: true,
    active: html.dataset.surfaceMode === 'active',
    presentation: 'procedural-3d-plants',
    rendererIntegration: 'authoritative-surface-instanced-mesh-replacement',
    gpuInstancing: true,
    rootedToTerrain: true,
    movementSuppressed: true,
    wetPlacementSuppressed: true,
    swayAnimation: false,
    morphologies: ['rosette', 'branching', 'crown'],
    convertedMeshes: state.convertedMeshes,
    hiddenLegacyFauna: state.convertedMeshes,
    legacyFaunaVisible: false,
    visiblePlants: plantCount(),
    wetPlantsSuppressed: state.wetPlantsSuppressed.size,
    groundedMatrixWrites: state.groundedMatrixWrites,
    terrainSamples: state.terrainSamples,
    waterSamples: state.waterSamples,
    scans: state.scans,
    nativeMeshName: state.mesh?.name || null,
  }),
};
window.realitySandboxSurfaceFloraV78 = api;
html.dataset.surfaceFloraV78 = 'waiting-for-authoritative-surface-mesh';

const previousDiagnostics = window.realitySandboxPresentationDiagnostics;
window.realitySandboxPresentationDiagnostics = () => ({
  ...(typeof previousDiagnostics === 'function' ? previousDiagnostics() : {}),
  surfaceFloraV78: api.getStats(),
});
