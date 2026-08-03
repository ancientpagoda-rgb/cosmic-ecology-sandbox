import * as THREE from 'three';
import { samplePlanet, biomeColor } from './planet.js';
import { sampleHydrology, hydrologyColor } from './hydrology.js';

export function createLocalSurfaceLayer(container, geologicalTime, options = {}) {
  const mobile = options.mobile ?? matchMedia('(pointer: coarse)').matches;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(mobile ? 52 : 48, 1, 0.01, 12);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: !mobile, powerPreference: mobile ? 'low-power' : 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4;opacity:0;transition:opacity .16s ease';
  container.append(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xb7d3ff, 0x091018, 1.2));
  const sun = new THREE.DirectionalLight(0xfff0cf, 2.6);
  sun.position.set(3, 4, 2);
  scene.add(sun);

  const terrainRoot = new THREE.Group();
  scene.add(terrainRoot);
  const patchCache = new Map();
  const visible = new Set();
  const maxPatches = mobile ? 10 : 20;
  let frame = 0;
  let lastWidth = 0;
  let lastHeight = 0;
  let lastGeologyBucket = -1;

  function render(cameraState) {
    resize();
    const distance = cameraState?.distance ?? 3;
    const amount = 1 - smoothstep(1.38, 1.72, distance);
    renderer.domElement.style.opacity = String(amount);
    if (amount < 0.01) return;

    const center = viewCenter(cameraState);
    const geologyBucket = Math.floor(geologicalTime.getAgeMyr() * 0.5);
    if (geologyBucket !== lastGeologyBucket) {
      lastGeologyBucket = geologyBucket;
      clear();
    }

    updatePatches(center, distance);
    camera.position.set(0, 0.2 + (distance - 1.18) * 1.8, 0.55 + (distance - 1.18) * 3.4);
    camera.lookAt(0, 0, -0.15);
    renderer.render(scene, camera);
    frame++;
  }

  function updatePatches(center, distance) {
    visible.clear();
    const level = distance < 1.25 ? 8 : distance < 1.34 ? 7 : 6;
    const tilesAcross = 2 ** level;
    const cx = wrap(Math.floor(center.u * tilesAcross), tilesAcross);
    const cy = clamp(Math.floor(center.v * tilesAcross), 0, tilesAcross - 1);
    const radius = mobile ? 1 : 2;

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = wrap(cx + dx, tilesAcross);
        const y = clamp(cy + dy, 0, tilesAcross - 1);
        const key = `${level}/${x}/${y}/${lastGeologyBucket}`;
        visible.add(key);
        let patch = patchCache.get(key);
        if (!patch) {
          patch = createPatch(level, x, y, cx, cy);
          patchCache.set(key, patch);
          terrainRoot.add(patch.group);
        }
        patch.group.visible = true;
        patch.lastUsed = frame;
      }
    }

    for (const [key, patch] of patchCache) {
      if (!visible.has(key)) patch.group.visible = false;
    }
    evict();
  }

  function createPatch(level, x, y, centerX, centerY) {
    const tilesAcross = 2 ** level;
    const u0 = x / tilesAcross;
    const v0 = y / tilesAcross;
    const u1 = (x + 1) / tilesAcross;
    const v1 = (y + 1) / tilesAcross;
    const resolution = mobile ? 34 : 58;
    const size = 0.9;
    const geometry = new THREE.PlaneGeometry(size, size, resolution, resolution);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position;
    const colors = [];
    const temp = new THREE.Vector3();

    for (let i = 0; i < positions.count; i++) {
      temp.fromBufferAttribute(positions, i);
      const localU = temp.x / size + 0.5;
      const localV = temp.z / size + 0.5;
      const u = lerp(u0, u1, localU);
      const v = lerp(v0, v1, localV);
      const sample = evolvedSample(u, v);
      const height = (sample.height - sample.seaLevel - 0.53) * 3.8;
      positions.setY(i, height);
      colors.push(sample.color[0] / 255, sample.color[1] / 255, sample.color[2] / 255);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.x = (x - centerX) * size;
    mesh.position.z = (y - centerY) * size;

    const vegetation = createVegetation(u0, v0, u1, v1, size, mobile ? 70 : 180);
    vegetation.position.copy(mesh.position);
    const rocks = createRocks(u0, v0, u1, v1, size, mobile ? 25 : 70);
    rocks.position.copy(mesh.position);

    const group = new THREE.Group();
    group.add(mesh, vegetation, rocks);
    return { group, geometry, material, vegetation, rocks, lastUsed: frame };
  }

  function createVegetation(u0, v0, u1, v1, size, count) {
    const geometry = new THREE.ConeGeometry(0.012, 0.07, 5);
    const material = new THREE.MeshStandardMaterial({ color: 0x2f8f45, roughness: 1 });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const matrix = new THREE.Matrix4();
    const rng = mulberry32(Math.floor((u0 * 91_113 + v0 * 71_777) * 100000));
    let used = 0;
    for (let i = 0; i < count * 4 && used < count; i++) {
      const u = lerp(u0, u1, rng());
      const v = lerp(v0, v1, rng());
      const sample = evolvedSample(u, v);
      if (sample.water || sample.rainfall < 0.45 || sample.temperature < 0.2 || sample.ice > 0.35) continue;
      const x = (rng() - 0.5) * size;
      const z = (rng() - 0.5) * size;
      const y = (sample.height - sample.seaLevel - 0.53) * 3.8 + 0.035;
      const s = 0.6 + rng() * 1.5;
      matrix.makeScale(s, s, s);
      matrix.setPosition(x, y, z);
      mesh.setMatrixAt(used++, matrix);
    }
    mesh.count = used;
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  function createRocks(u0, v0, u1, v1, size, count) {
    const geometry = new THREE.DodecahedronGeometry(0.016, 0);
    const material = new THREE.MeshStandardMaterial({ color: 0x77756f, roughness: 1 });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const matrix = new THREE.Matrix4();
    const rng = mulberry32(Math.floor((u1 * 61_771 + v1 * 41_999) * 100000));
    for (let i = 0; i < count; i++) {
      const u = lerp(u0, u1, rng());
      const v = lerp(v0, v1, rng());
      const sample = evolvedSample(u, v);
      const x = (rng() - 0.5) * size;
      const z = (rng() - 0.5) * size;
      const y = (sample.height - sample.seaLevel - 0.53) * 3.8 + 0.01;
      const s = 0.45 + rng() * 1.9;
      matrix.compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 2, rng() * 2, rng() * 2)),
        new THREE.Vector3(s, s * (0.6 + rng() * 0.7), s),
      );
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  function evolvedSample(u, v) {
    u = wrap(u, 1);
    v = clamp(v, 0, 1);
    const x = u * 8192;
    const y = v * 4096;
    const base = samplePlanet(x, y, 8192, 4096);
    const hydro = sampleHydrology(x, y, 8192, 4096);
    const geology = geologicalTime.sample(u, v);
    let height = base.elevation + geology.uplift - geology.rifting - geology.erosion;
    const seaLevel = geology.seaLevel;
    const water = height < 0.53 + seaLevel;
    let color = hydrologyColor(biomeColor(base), hydro);
    if (geology.volcanic > 0.45) color = mixColor(color, [92, 62, 49], geology.volcanic * 0.38);
    if (geology.ice > 0.1) color = mixColor(color, [226, 239, 247], geology.ice);
    if (water) color = [20, 87, 137];
    if (hydro.river > 0.08 && !water) color = [37, 127, 167];
    return { ...base, ...geology, height, seaLevel, water, color };
  }

  function evict() {
    if (patchCache.size <= maxPatches) return;
    const candidates = [...patchCache.entries()]
      .filter(([key]) => !visible.has(key))
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    while (patchCache.size > maxPatches && candidates.length) {
      const [key, patch] = candidates.shift();
      terrainRoot.remove(patch.group);
      patch.group.traverse(object => {
        object.geometry?.dispose?.();
        object.material?.dispose?.();
      });
      patchCache.delete(key);
    }
  }

  function clear() {
    for (const patch of patchCache.values()) {
      terrainRoot.remove(patch.group);
      patch.group.traverse(object => {
        object.geometry?.dispose?.();
        object.material?.dispose?.();
      });
    }
    patchCache.clear();
  }

  function resize() {
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width;
    lastHeight = height;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  return { render, clear, getStats: () => ({ patches: patchCache.size, geologicalAgeMyr: geologicalTime.getAgeMyr() }) };
}

function viewCenter(cameraState) {
  const longitude = -(cameraState?.rotationY ?? 0) / (Math.PI * 2);
  const latitude = (cameraState?.rotationX ?? 0) / Math.PI;
  return { u: wrap(longitude + 0.5, 1), v: clamp(latitude + 0.5, 0, 1) };
}
function mixColor(a, b, t) {
  return a.map((value, index) => Math.round(value + (b[index] - value) * clamp(t, 0, 1)));
}
function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}
const lerp = (a, b, t) => a + (b - a) * t;
const wrap = (value, max) => ((value % max) + max) % max;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function smoothstep(edge0, edge1, value) {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}
