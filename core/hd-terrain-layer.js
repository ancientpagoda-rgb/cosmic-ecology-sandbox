import * as THREE from 'three';
import { samplePlanet, biomeColor } from './planet.js';
import { sampleHydrology, hydrologyColor } from './hydrology.js';

export function createHdTerrainLayer(container, options = {}) {
  const mobile = options.mobile ?? matchMedia('(pointer: coarse)').matches;
  const maxTiles = mobile ? 20 : 48;
  const tileResolution = mobile ? 24 : 40;
  const textureSize = mobile ? 192 : 320;
  const maxLevel = mobile ? 4 : 6;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(mobile ? 46 : 40, 1, 0.04, 20);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: !mobile, powerPreference: mobile ? 'low-power' : 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3;opacity:0;transition:opacity .18s ease';
  container.append(renderer.domElement);

  const root = new THREE.Group();
  scene.add(root);
  scene.add(new THREE.HemisphereLight(0xa8c7ff, 0x07101d, 1.05));
  const sunlight = new THREE.DirectionalLight(0xfff2d5, 2.2);
  sunlight.position.set(4, 2, 5);
  scene.add(sunlight);

  const tiles = new Map();
  const visibleKeys = new Set();
  let lastWidth = 0;
  let lastHeight = 0;
  let frame = 0;

  function render(cameraState) {
    resize();
    const distance = cameraState?.distance ?? 3;
    const amount = 1 - smoothstep(2.15, 2.85, distance);
    renderer.domElement.style.opacity = String(amount);
    if (amount < 0.01) return;

    root.rotation.set(cameraState?.rotationX ?? -0.12, cameraState?.rotationY ?? 0, -23.44 * Math.PI / 180);
    camera.position.set(0, distance * 0.055, distance);
    camera.lookAt(0, 0, 0);

    const level = clamp(Math.floor((2.85 - distance) * 3.2) + 2, 2, maxLevel);
    updateTiles(level, cameraState);
    renderer.render(scene, camera);
    frame++;
  }

  function updateTiles(level, cameraState) {
    visibleKeys.clear();
    const center = viewCenter(cameraState);
    const spanX = level <= 2 ? 2 : 1;
    const spanY = 1;
    const tilesAcross = 2 ** level;
    const centerX = wrap(Math.floor(center.u * tilesAcross), tilesAcross);
    const centerY = clamp(Math.floor(center.v * tilesAcross), 0, tilesAcross - 1);

    for (let dy = -spanY; dy <= spanY; dy++) {
      for (let dx = -spanX; dx <= spanX; dx++) {
        const x = wrap(centerX + dx, tilesAcross);
        const y = clamp(centerY + dy, 0, tilesAcross - 1);
        const key = `${level}/${x}/${y}`;
        visibleKeys.add(key);
        let tile = tiles.get(key);
        if (!tile) {
          tile = createTile(level, x, y);
          tiles.set(key, tile);
          root.add(tile.group);
        }
        tile.lastUsed = frame;
        tile.group.visible = true;
      }
    }

    for (const [key, tile] of tiles) {
      if (!visibleKeys.has(key)) tile.group.visible = false;
    }
    evictTiles();
  }

  function createTile(level, x, y) {
    const tilesAcross = 2 ** level;
    const u0 = x / tilesAcross;
    const v0 = y / tilesAcross;
    const u1 = (x + 1) / tilesAcross;
    const v1 = (y + 1) / tilesAcross;
    const geometry = createTileGeometry(u0, v0, u1, v1, tileResolution);
    const maps = createTileMaps(u0, v0, u1, v1, textureSize);
    const material = new THREE.MeshStandardMaterial({
      map: maps.color,
      normalMap: maps.normal,
      roughnessMap: maps.roughness,
      roughness: 0.86,
      metalness: 0.01,
    });
    const mesh = new THREE.Mesh(geometry, material);
    const trees = createVegetation(u0, v0, u1, v1, mobile ? 45 : 120);
    const group = new THREE.Group();
    group.add(mesh, trees);
    return { group, maps, geometry, material, lastUsed: frame };
  }

  function createTileGeometry(u0, v0, u1, v1, resolution) {
    const vertices = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    for (let iy = 0; iy <= resolution; iy++) {
      const v = lerp(v0, v1, iy / resolution);
      for (let ix = 0; ix <= resolution; ix++) {
        const u = lerp(u0, u1, ix / resolution);
        const p = planetPoint(u, v, true);
        vertices.push(p.x, p.y, p.z);
        const n = new THREE.Vector3(p.x, p.y, p.z).normalize();
        normals.push(n.x, n.y, n.z);
        uvs.push(ix / resolution, 1 - iy / resolution);
      }
    }
    for (let iy = 0; iy < resolution; iy++) {
      for (let ix = 0; ix < resolution; ix++) {
        const a = iy * (resolution + 1) + ix;
        const b = a + 1;
        const c = a + resolution + 1;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  function createTileMaps(u0, v0, u1, v1, size) {
    const colorCanvas = document.createElement('canvas');
    const normalCanvas = document.createElement('canvas');
    const roughCanvas = document.createElement('canvas');
    colorCanvas.width = colorCanvas.height = size;
    normalCanvas.width = normalCanvas.height = size;
    roughCanvas.width = roughCanvas.height = size;
    const colorCtx = colorCanvas.getContext('2d');
    const normalCtx = normalCanvas.getContext('2d');
    const roughCtx = roughCanvas.getContext('2d');
    const colorImage = colorCtx.createImageData(size, size);
    const normalImage = normalCtx.createImageData(size, size);
    const roughImage = roughCtx.createImageData(size, size);

    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const u = lerp(u0, u1, px / (size - 1));
        const v = lerp(v0, v1, py / (size - 1));
        const sample = sampleAt(u, v);
        const left = sampleAt(u - (u1 - u0) / size, v).height;
        const right = sampleAt(u + (u1 - u0) / size, v).height;
        const down = sampleAt(u, v - (v1 - v0) / size).height;
        const up = sampleAt(u, v + (v1 - v0) / size).height;
        const normal = new THREE.Vector3((left - right) * 16, 2, (down - up) * 16).normalize();
        const index = (py * size + px) * 4;

        colorImage.data[index] = sample.color[0];
        colorImage.data[index + 1] = sample.color[1];
        colorImage.data[index + 2] = sample.color[2];
        colorImage.data[index + 3] = 255;
        normalImage.data[index] = Math.round((normal.x * 0.5 + 0.5) * 255);
        normalImage.data[index + 1] = Math.round((normal.y * 0.5 + 0.5) * 255);
        normalImage.data[index + 2] = Math.round((normal.z * 0.5 + 0.5) * 255);
        normalImage.data[index + 3] = 255;
        const roughness = sample.water ? 85 : sample.river ? 120 : 205;
        roughImage.data[index] = roughImage.data[index + 1] = roughImage.data[index + 2] = roughness;
        roughImage.data[index + 3] = 255;
      }
    }
    colorCtx.putImageData(colorImage, 0, 0);
    normalCtx.putImageData(normalImage, 0, 0);
    roughCtx.putImageData(roughImage, 0, 0);
    return {
      color: texture(colorCanvas, true),
      normal: texture(normalCanvas, false),
      roughness: texture(roughCanvas, false),
    };
  }

  function createVegetation(u0, v0, u1, v1, count) {
    const geometry = new THREE.ConeGeometry(0.0028, 0.014, 5);
    const material = new THREE.MeshStandardMaterial({ color: 0x2d8f49, roughness: 1 });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    let used = 0;
    const seed = Math.floor((u0 * 100003 + v0 * 70001) * 100000);
    const rng = mulberry32(seed);

    for (let i = 0; i < count * 5 && used < count; i++) {
      const u = lerp(u0, u1, rng());
      const v = lerp(v0, v1, rng());
      const sample = sampleAt(u, v);
      if (sample.water || sample.rainfall < 0.42 || sample.temperature < 0.22) continue;
      const p = planetPoint(u, v, true, 0.006);
      position.set(p.x, p.y, p.z);
      quaternion.setFromUnitVectors(up, position.clone().normalize());
      const s = 0.7 + rng() * 1.5;
      scale.set(s, s, s);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(used++, matrix);
    }
    mesh.count = used;
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  function evictTiles() {
    if (tiles.size <= maxTiles) return;
    const candidates = [...tiles.entries()]
      .filter(([key]) => !visibleKeys.has(key))
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    while (tiles.size > maxTiles && candidates.length) {
      const [key, tile] = candidates.shift();
      root.remove(tile.group);
      tile.geometry.dispose();
      tile.material.dispose();
      tile.maps.color.dispose();
      tile.maps.normal.dispose();
      tile.maps.roughness.dispose();
      tile.group.traverse(object => {
        object.geometry?.dispose?.();
        if (object.material && object.material !== tile.material) object.material.dispose?.();
      });
      tiles.delete(key);
    }
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
    getStats: () => ({ loadedTiles: tiles.size, visibleTiles: visibleKeys.size, maxTiles, maxLevel }),
    clear() {
      for (const tile of tiles.values()) {
        root.remove(tile.group);
        tile.geometry.dispose();
        tile.material.dispose();
        Object.values(tile.maps).forEach(map => map.dispose());
      }
      tiles.clear();
    },
  };
}

function viewCenter(cameraState) {
  const longitude = -(cameraState?.rotationY ?? 0) / (Math.PI * 2);
  const latitude = (cameraState?.rotationX ?? 0) / Math.PI;
  return { u: wrap(longitude + 0.5, 1), v: clamp(latitude + 0.5, 0, 1) };
}

function sampleAt(u, v) {
  u = wrap(u, 1);
  v = clamp(v, 0, 1);
  const x = u * 4096;
  const y = v * 2048;
  const p = samplePlanet(x, y, 4096, 2048);
  const h = sampleHydrology(x, y, 4096, 2048);
  let color = hydrologyColor(biomeColor(p), h);
  const coastline = Math.abs(p.elevation - 0.53) < 0.012;
  const river = h.river > 0.08;
  if (coastline && p.land) color = color.map((value, index) => index === 2 ? Math.min(255, value + 24) : Math.min(255, value + 10));
  if (river) color = [32, 117, 158];
  return {
    color,
    height: p.elevation,
    rainfall: p.rainfall,
    temperature: p.temperature,
    water: !p.land,
    river,
  };
}

function planetPoint(u, v, displaced = false, extra = 0) {
  const longitude = (u - 0.5) * Math.PI * 2;
  const latitude = (0.5 - v) * Math.PI;
  const sample = sampleAt(u, v);
  const relief = displaced ? (sample.height - 0.53) * 0.085 : 0;
  const radius = 1.002 + relief + extra;
  const cos = Math.cos(latitude);
  return new THREE.Vector3(
    radius * cos * Math.cos(longitude),
    radius * Math.sin(latitude),
    radius * cos * Math.sin(longitude),
  );
}

function texture(canvas, srgb) {
  const value = new THREE.CanvasTexture(canvas);
  if (srgb) value.colorSpace = THREE.SRGBColorSpace;
  value.minFilter = THREE.LinearMipmapLinearFilter;
  value.magFilter = THREE.LinearFilter;
  value.generateMipmaps = true;
  return value;
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
