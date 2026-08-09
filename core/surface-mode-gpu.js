import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrap = (value, max) => ((value % max) + max) % max;

function shortestWrappedDelta(value, origin, size) {
  let delta = value - origin;
  if (delta > size * 0.5) delta -= size;
  else if (delta < -size * 0.5) delta += size;
  return delta;
}

function colorFromRgb(rgb) {
  return new THREE.Color(
    clamp((rgb?.[0] ?? 90) / 255, 0, 1),
    clamp((rgb?.[1] ?? 128) / 255, 0, 1),
    clamp((rgb?.[2] ?? 108) / 255, 0, 1),
  );
}

/**
 * GPU presentation for Surface Mode. Simulation data remains authoritative on
 * the CPU; a small local terrain chunk and instanced life are uploaded only
 * when the player crosses a chunk boundary. WebGPURenderer selects WebGPU and
 * automatically falls back to WebGL2 when WebGPU is unavailable.
 */
export async function createGpuSurfaceRenderer({
  canvas,
  world,
  terrainAt,
  waterAt,
  colorAt,
  biomassAt,
  getCreatures,
  seed = 1,
  seaLevel = 0.53,
  zScale = 62,
}) {
  let renderer;
  try {
    renderer = new WebGPURenderer({ canvas, alpha: false, antialias: true, depth: true });
    await renderer.init();
  } catch (error) {
    // A hardware/browser WebGPU failure should still keep Surface Mode on the GPU via WebGL2.
    renderer?.dispose?.();
    renderer = new WebGPURenderer({ canvas, alpha: false, antialias: true, depth: true, forceWebGL: true });
    await renderer.init();
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#6f9695');
  scene.fog = new THREE.Fog('#6f9695', 62, 230);

  const camera = new THREE.PerspectiveCamera(66, 1, 0.1, 290);
  const hemi = new THREE.HemisphereLight('#b7d8e8', '#21372b', 2.2);
  const sun = new THREE.DirectionalLight('#fff0d6', 2.7);
  sun.position.set(-90, 120, 55);
  scene.add(hemi, sun);

  const chunkSize = 232;
  const chunkSegments = 96;
  const geometry = new THREE.PlaneGeometry(chunkSize, chunkSize, chunkSegments, chunkSegments);
  geometry.rotateX(-Math.PI * 0.5);
  const positions = geometry.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const terrainMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const terrainMesh = new THREE.Mesh(geometry, terrainMaterial);
  scene.add(terrainMesh);

  const treeCount = 1200;
  const treeGeometry = new THREE.ConeGeometry(0.92, 4.9, 5);
  treeGeometry.translate(0, 2.45, 0);
  const treeMaterial = new THREE.MeshLambertMaterial({ color: '#336b3b', vertexColors: true });
  const trees = new THREE.InstancedMesh(treeGeometry, treeMaterial, treeCount);
  trees.count = 0;
  trees.frustumCulled = false;
  trees.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(treeCount * 3), 3);
  scene.add(trees);

  const creatureCapacity = 320;
  const creatureGeometry = new THREE.IcosahedronGeometry(0.72, 1);
  const creatureMaterial = new THREE.MeshLambertMaterial({ color: '#dfbf86', vertexColors: true });
  const creatures = new THREE.InstancedMesh(creatureGeometry, creatureMaterial, creatureCapacity);
  creatures.count = 0;
  creatures.frustumCulled = false;
  creatures.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(creatureCapacity * 3), 3);
  scene.add(creatures);

  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const color = new THREE.Color();
  const origin = { x: 0, y: 0 };
  let ready = false;
  let lastBuildX = Infinity;
  let lastBuildY = Infinity;
  let treeInstances = 0;

  function seededNoise(x, y, salt = 0) {
    const value = Math.sin((x * 127.1 + y * 311.7 + seed * 0.017 + salt * 71.3)) * 43758.5453123;
    return value - Math.floor(value);
  }

  function localSample(localX, localZ) {
    const x = wrap(origin.x + localX, world.width);
    const y = clamp(origin.y - localZ, 0, world.height);
    const terrain = terrainAt(x, y);
    const water = waterAt(x, y);
    return { x, y, terrain, water };
  }

  function rebuildTerrain(center) {
    origin.x = center.x;
    origin.y = center.y;
    for (let index = 0; index < positions.count; index++) {
      const x = positions.getX(index);
      const z = positions.getZ(index);
      const sample = localSample(x, z);
      const elevation = sample.terrain?.land ? sample.terrain.elevation : seaLevel;
      positions.setY(index, elevation * zScale);
      const rgb = colorAt(sample.terrain, sample.water, Math.hypot(x, z));
      colorFromRgb(rgb).toArray(colors, index * 3);
    }
    positions.needsUpdate = true;
    geometry.getAttribute('color').needsUpdate = true;
    geometry.computeVertexNormals();

    treeInstances = 0;
    const spacing = 7;
    const range = Math.floor(chunkSize / (spacing * 2));
    for (let gy = -range; gy <= range && treeInstances < treeCount; gy++) {
      for (let gx = -range; gx <= range && treeInstances < treeCount; gx++) {
        const jitterX = (seededNoise(gx, gy, 1) - 0.5) * spacing;
        const jitterZ = (seededNoise(gx, gy, 2) - 0.5) * spacing;
        const localX = gx * spacing + jitterX;
        const localZ = gy * spacing + jitterZ;
        const sample = localSample(localX, localZ);
        const biome = sample.terrain?.biome;
        if (!sample.terrain?.land || !['forest', 'rainforest', 'grassland', 'steppe'].includes(biome)) continue;
        const biomass = typeof biomassAt === 'function' ? biomassAt(sample.x, sample.y) : 0.4;
        const chance = biome === 'rainforest' ? 0.84 : biome === 'forest' ? 0.62 : 0.16;
        if (biomass < 0.03 || seededNoise(gx, gy, 3) > chance * clamp(biomass * 1.55, 0.18, 1)) continue;
        const height = biome === 'rainforest' ? 1.35 : biome === 'forest' ? 1 : 0.28;
        position.set(localX, sample.terrain.elevation * zScale, localZ);
        scale.setScalar(height * (0.7 + seededNoise(gx, gy, 4) * 0.65));
        matrix.compose(position, quaternion, scale);
        trees.setMatrixAt(treeInstances, matrix);
        color.set(biome === 'rainforest' ? '#216b3d' : biome === 'forest' ? '#407a45' : '#86a94e');
        trees.setColorAt(treeInstances, color);
        treeInstances++;
      }
    }
    trees.count = treeInstances;
    trees.instanceMatrix.needsUpdate = true;
    if (trees.instanceColor) trees.instanceColor.needsUpdate = true;
    lastBuildX = center.x;
    lastBuildY = center.y;
    ready = true;
  }

  function updateCreatures() {
    const entries = getCreatures?.() || [];
    let count = 0;
    for (const entry of entries) {
      if (count >= creatureCapacity) break;
      const dx = shortestWrappedDelta(entry.x, origin.x, world.width);
      const dz = -(entry.y - origin.y);
      if (dx * dx + dz * dz > 165 * 165) continue;
      const terrain = terrainAt(entry.x, entry.y);
      if (!terrain?.land) continue;
      position.set(dx, terrain.elevation * zScale + entry.size * 0.55, dz);
      scale.setScalar(entry.size);
      matrix.compose(position, quaternion, scale);
      creatures.setMatrixAt(count, matrix);
      color.set(entry.color);
      creatures.setColorAt(count, color);
      count++;
    }
    creatures.count = count;
    creatures.instanceMatrix.needsUpdate = true;
    if (creatures.instanceColor) creatures.instanceColor.needsUpdate = true;
    return count;
  }

  function resize(width, height, dpr = 1) {
    renderer.setPixelRatio(Math.min(1.5, dpr));
    renderer.setSize(Math.max(1, width), Math.max(1, height), false);
    camera.aspect = Math.max(1, width) / Math.max(1, height);
    camera.updateProjectionMatrix();
  }

  function render(player, { cloud = 0, rain = 0 } = {}) {
    if (!ready || Math.abs(shortestWrappedDelta(player.x, lastBuildX, world.width)) > 13 || Math.abs(player.y - lastBuildY) > 13) {
      rebuildTerrain(player);
    }
    const localX = shortestWrappedDelta(player.x, origin.x, world.width);
    const localZ = -(player.y - origin.y);
    const ground = terrainAt(player.x, player.y);
    const eyeY = (ground?.land ? ground.elevation : seaLevel) * zScale + player.altitude;
    camera.position.set(localX, eyeY, localZ);
    const forward = 24;
    camera.lookAt(
      localX + Math.cos(player.yaw) * forward,
      eyeY - Math.sin(player.pitch) * forward,
      localZ - Math.sin(player.yaw) * forward,
    );
    const weather = clamp(cloud * 0.58 + rain * 2.4, 0, 1);
    scene.background.setRGB(0.43 - weather * 0.14, 0.59 - weather * 0.18, 0.58 - weather * 0.16);
    scene.fog.color.copy(scene.background);
    scene.fog.near = 55 - weather * 18;
    scene.fog.far = 230 - weather * 85;
    sun.intensity = 2.7 - weather * 1.25;
    const visible = updateCreatures();
    renderer.render(scene, camera);
    return { visibleCreatures: visible, backend: renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2' };
  }

  return {
    resize,
    render,
    dispose() {
      geometry.dispose();
      treeGeometry.dispose();
      creatureGeometry.dispose();
      terrainMaterial.dispose();
      treeMaterial.dispose();
      creatureMaterial.dispose();
      renderer.dispose();
    },
  };
}
