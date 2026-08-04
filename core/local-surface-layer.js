import * as THREE from 'three';
import { samplePlanet, biomeColor } from './planet.js';
import { sampleHydrology, hydrologyColor } from './hydrology.js';

const PATCH_SIZE = 0.9;
const SAMPLE_WIDTH = 8192;
const SAMPLE_HEIGHT = 4096;

export function createLocalSurfaceLayer(container, geologicalTime, options = {}) {
  const mobile = options.mobile ?? matchMedia('(pointer: coarse)').matches;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x9fb3b5, mobile ? 0.2 : 0.14);

  const camera = new THREE.PerspectiveCamera(mobile ? 54 : 48, 1, 0.008, 14);
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: !mobile,
    powerPreference: mobile ? 'low-power' : 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:4;opacity:0;transition:opacity .16s ease';
  container.append(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xb7d3ff, 0x091018, 1.25));
  const sun = new THREE.DirectionalLight(0xfff0cf, 2.7);
  sun.position.set(3, 4, 2);
  scene.add(sun);

  const terrainRoot = new THREE.Group();
  scene.add(terrainRoot);

  const patchCache = new Map();
  const visible = new Set();
  const maxPatches = mobile ? 14 : 32;
  let frame = 0;
  let lastWidth = 0;
  let lastHeight = 0;
  let lastGeologyBucket = -1;
  let currentLevel = 6;
  let currentCenter = { u: 0.5, v: 0.5 };
  let currentSurface = null;

  function render(cameraState, navigation = {}) {
    resize();
    const distance = cameraState?.distance ?? 3;
    const amount = 1 - smoothstep(1.38, 1.72, distance);
    renderer.domElement.style.opacity = String(amount);
    if (amount < 0.01) return;

    const center = viewCenter(cameraState, navigation);
    currentCenter = center;

    // Rebuilding every few simulated seconds caused visible churn. Twelve
    // million-year buckets preserve deep-time evolution without constant tile
    // destruction while the player is walking.
    const geologyBucket = Math.floor(geologicalTime.getAgeMyr() / 12);
    if (geologyBucket !== lastGeologyBucket) {
      lastGeologyBucket = geologyBucket;
      clear();
    }

    updatePatches(center, distance);
    currentSurface = getSurfaceSample(center.u, center.v);
    terrainRoot.rotation.y = navigation.heading ?? 0;

    const pitch = clamp(navigation.pitch ?? -0.08, -0.55, 0.34);
    const cameraDistance = clamp(navigation.cameraDistance ?? 0.46, 0, 0.74);
    const floorY = currentSurface.floorY;
    const firstPerson = cameraDistance < 0.08;

    if (firstPerson) {
      const eyeY = floorY + 0.17;
      camera.position.set(0, eyeY, 0.018);
      camera.lookAt(
        0,
        eyeY + Math.sin(pitch) * 0.8,
        -Math.max(0.35, Math.cos(pitch)),
      );
    } else {
      const follow = 0.18 + cameraDistance;
      const eyeY = floorY + 0.24 + cameraDistance * 0.18;
      camera.position.set(0, eyeY, follow);
      camera.lookAt(0, floorY + 0.11 + pitch * 0.32, -0.2);
    }

    const time = performance.now() * 0.001;
    for (const patch of patchCache.values()) {
      if (patch.water?.material?.uniforms?.time) {
        patch.water.material.uniforms.time.value = time;
      }
    }

    renderer.render(scene, camera);
    frame++;
  }

  function updatePatches(center, distance) {
    visible.clear();
    currentLevel = distance < 1.25 ? 8 : distance < 1.34 ? 7 : 6;
    const tilesAcross = 2 ** currentLevel;
    const rawX = wrap(center.u, 1) * tilesAcross;
    const rawY = clamp(center.v, 0, 1 - Number.EPSILON) * tilesAcross;
    const cx = wrap(Math.floor(rawX), tilesAcross);
    const cy = clamp(Math.floor(rawY), 0, tilesAcross - 1);
    const fractionX = rawX - Math.floor(rawX);
    const fractionY = rawY - Math.floor(rawY);
    const radius = mobile ? 1 : 2;

    for (let dy = -radius; dy <= radius; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= tilesAcross) continue;

      for (let dx = -radius; dx <= radius; dx++) {
        const x = wrap(cx + dx, tilesAcross);
        const key = `${currentLevel}/${x}/${y}/${lastGeologyBucket}`;
        visible.add(key);

        let patch = patchCache.get(key);
        if (!patch) {
          patch = createPatch(currentLevel, x, y);
          patchCache.set(key, patch);
          terrainRoot.add(patch.group);
        }

        const relativeX = shortestWrappedDelta(x, cx, tilesAcross);
        patch.group.position.set(
          (relativeX + 0.5 - fractionX) * PATCH_SIZE,
          0,
          (y - cy + 0.5 - fractionY) * PATCH_SIZE,
        );
        patch.group.visible = true;
        patch.lastUsed = frame;
      }
    }

    for (const [key, patch] of patchCache) {
      if (!visible.has(key)) patch.group.visible = false;
    }
    evict();
  }

  function createPatch(level, x, y) {
    const tilesAcross = 2 ** level;
    const u0 = x / tilesAcross;
    const v0 = y / tilesAcross;
    const u1 = (x + 1) / tilesAcross;
    const v1 = (y + 1) / tilesAcross;
    const resolution = mobile ? 32 : 56;

    const geometry = new THREE.PlaneGeometry(PATCH_SIZE, PATCH_SIZE, resolution, resolution);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position;
    const colors = [];
    const waterMask = [];
    const waterHeights = [];
    const temp = new THREE.Vector3();

    for (let i = 0; i < positions.count; i++) {
      temp.fromBufferAttribute(positions, i);
      const localU = temp.x / PATCH_SIZE + 0.5;
      const localV = temp.z / PATCH_SIZE + 0.5;
      const u = lerp(u0, u1, localU);
      const v = lerp(v0, v1, localV);
      const sample = evolvedSample(u, v);

      positions.setY(i, sample.terrainY);
      colors.push(sample.color[0] / 255, sample.color[1] / 255, sample.color[2] / 255);
      waterMask.push(sample.waterStrength);
      waterHeights.push(sample.waterY);
    }

    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;

    const waterGeometry = new THREE.PlaneGeometry(PATCH_SIZE, PATCH_SIZE, resolution, resolution);
    waterGeometry.rotateX(-Math.PI / 2);
    const waterPositions = waterGeometry.attributes.position;
    for (let i = 0; i < waterPositions.count; i++) waterPositions.setY(i, waterHeights[i]);
    waterGeometry.setAttribute('water', new THREE.Float32BufferAttribute(waterMask, 1));

    const waterMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        deepColor: { value: new THREE.Color(0x0c355d) },
        shallowColor: { value: new THREE.Color(0x2788a8) },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: `
        uniform float time;
        attribute float water;
        varying float vWater;
        varying float vWave;
        void main() {
          vec3 p = position;
          float wave = (
            sin((p.x + time * 0.018) * 37.0) +
            cos((p.z - time * 0.014) * 31.0)
          ) * 0.0017 * water;
          p.y += wave;
          vWater = water;
          vWave = wave;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 deepColor;
        uniform vec3 shallowColor;
        varying float vWater;
        varying float vWave;
        void main() {
          if (vWater < 0.18) discard;
          float edge = smoothstep(0.18, 0.7, vWater);
          vec3 color = mix(deepColor, shallowColor, clamp(vWater + vWave * 70.0, 0.0, 1.0));
          gl_FragColor = vec4(color, 0.44 + edge * 0.34);
        }
      `,
    });
    const water = new THREE.Mesh(waterGeometry, waterMaterial);
    water.renderOrder = 4;

    const vegetation = createVegetation(u0, v0, u1, v1, mobile ? 62 : 165);
    const rocks = createRocks(u0, v0, u1, v1, mobile ? 22 : 62);

    const group = new THREE.Group();
    group.add(mesh, water, vegetation, rocks);
    return {
      group,
      geometry,
      material,
      water,
      vegetation,
      rocks,
      lastUsed: frame,
    };
  }

  function createVegetation(u0, v0, u1, v1, count) {
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
      if (
        sample.waterStrength > 0.18 ||
        sample.rainfall < 0.42 ||
        sample.temperature < 0.2 ||
        sample.ice > 0.35
      ) continue;

      const x = (rng() - 0.5) * PATCH_SIZE;
      const z = (rng() - 0.5) * PATCH_SIZE;
      const y = sample.terrainY + 0.035;
      const s = 0.55 + rng() * 1.55;
      matrix.compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2),
        new THREE.Vector3(s, s * (0.82 + rng() * 0.45), s),
      );
      mesh.setMatrixAt(used++, matrix);
    }

    mesh.count = used;
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  function createRocks(u0, v0, u1, v1, count) {
    const geometry = new THREE.DodecahedronGeometry(0.016, 0);
    const material = new THREE.MeshStandardMaterial({ color: 0x77756f, roughness: 1 });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const matrix = new THREE.Matrix4();
    const rng = mulberry32(Math.floor((u1 * 61_771 + v1 * 41_999) * 100000));

    for (let i = 0; i < count; i++) {
      const u = lerp(u0, u1, rng());
      const v = lerp(v0, v1, rng());
      const sample = evolvedSample(u, v);
      const x = (rng() - 0.5) * PATCH_SIZE;
      const z = (rng() - 0.5) * PATCH_SIZE;
      const y = sample.terrainY + 0.01;
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
    const x = u * SAMPLE_WIDTH;
    const y = v * SAMPLE_HEIGHT;
    const base = samplePlanet(x, y, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    const hydro = sampleHydrology(x, y, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    const geology = geologicalTime.sample(u, v);
    const height = base.elevation + geology.uplift - geology.rifting - geology.erosion;
    const seaLevel = geology.seaLevel;
    const water = height < 0.53 + seaLevel;
    const waterStrength = water
      ? 1
      : clamp(Math.max(hydro.lake, hydro.delta * 0.9, hydro.river * 0.78), 0, 1);

    let color = hydrologyColor(biomeColor(base), hydro);
    if (geology.volcanic > 0.45) color = mixColor(color, [92, 62, 49], geology.volcanic * 0.38);
    if (geology.ice > 0.1) color = mixColor(color, [226, 239, 247], geology.ice);
    if (water) color = [20, 87, 137];
    if (hydro.river > 0.08 && !water) color = mixColor(color, [37, 127, 167], hydro.river * 0.75);

    const terrainY = (height - seaLevel - 0.53) * 3.8;
    const waterY = water ? 0.006 : terrainY + 0.007;
    const floorY = waterStrength > 0.25 ? Math.max(terrainY, waterY) : terrainY;

    return {
      ...base,
      ...hydro,
      ...geology,
      height,
      seaLevel,
      water,
      waterStrength,
      color,
      terrainY,
      waterY,
      floorY,
    };
  }

  function getSurfaceSample(u, v) {
    const sample = evolvedSample(u, v);
    const delta = 1 / SAMPLE_WIDTH;
    const east = evolvedSample(u + delta, v);
    const west = evolvedSample(u - delta, v);
    const south = evolvedSample(u, v + delta);
    const north = evolvedSample(u, v - delta);
    const worldUnitsPerTurn = PATCH_SIZE * (2 ** currentLevel);
    const horizontal = Math.max(0.0001, delta * worldUnitsPerTurn * 2);
    const slopeX = (east.floorY - west.floorY) / horizontal;
    const slopeZ = (south.floorY - north.floorY) / horizontal;

    return {
      ...sample,
      slopeX,
      slopeZ,
      slope: Math.hypot(slopeX, slopeZ),
    };
  }

  function evict() {
    if (patchCache.size <= maxPatches) return;
    const candidates = [...patchCache.entries()]
      .filter(([key]) => !visible.has(key))
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

    while (patchCache.size > maxPatches && candidates.length) {
      const [key, patch] = candidates.shift();
      disposePatch(patch);
      patchCache.delete(key);
    }
  }

  function disposePatch(patch) {
    terrainRoot.remove(patch.group);
    patch.group.traverse(object => {
      object.geometry?.dispose?.();
      object.material?.dispose?.();
    });
  }

  function clear() {
    for (const patch of patchCache.values()) disposePatch(patch);
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

  return {
    render,
    clear,
    getSurfaceSample,
    getStats: () => ({
      patches: patchCache.size,
      level: currentLevel,
      center: { ...currentCenter },
      surface: currentSurface,
      geologicalAgeMyr: geologicalTime.getAgeMyr(),
    }),
    get element() {
      return renderer.domElement;
    },
  };
}

function viewCenter(cameraState, navigation) {
  if (Number.isFinite(navigation?.u) && Number.isFinite(navigation?.v)) {
    return { u: wrap(navigation.u, 1), v: clamp(navigation.v, 0, 1) };
  }

  const longitude = -(cameraState?.rotationY ?? 0) / (Math.PI * 2);
  const latitude = (cameraState?.rotationX ?? 0) / Math.PI;
  return { u: wrap(longitude + 0.5, 1), v: clamp(latitude + 0.5, 0, 1) };
}

function shortestWrappedDelta(value, center, max) {
  let delta = value - center;
  if (delta > max / 2) delta -= max;
  if (delta < -max / 2) delta += max;
  return delta;
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
