import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const STORAGE_KEY = 'reality-v6-7-gpu-quality-v2';
const isMobile = innerWidth < 720 || (navigator.deviceMemory && navigator.deviceMemory <= 4);
const QUALITY_ORDER = isMobile
  ? ['pixel', 'adaptive', 'high']
  : ['pixel', 'adaptive', 'high', 'ultra', 'cinematic'];
const QUALITY = {
  pixel: {
    label: 'Pixel', pixelScale: 0.48, maxPixelRatio: 0.58, sphereSegments: 10,
    textureSize: 128, extraStars: 280, bloom: 0, fps: 24, pixelated: true,
  },
  adaptive: {
    label: 'Adaptive', pixelScale: 0.78, maxPixelRatio: 1.05, sphereSegments: 18,
    textureSize: 384, extraStars: 900, bloom: 0, fps: 30, pixelated: false,
  },
  high: {
    label: 'High', pixelScale: 1.0, maxPixelRatio: 1.65, sphereSegments: 36,
    textureSize: 768, extraStars: 2500, bloom: 0.32, fps: 60, pixelated: false,
  },
  ultra: {
    label: 'Ultra', pixelScale: 1.45, maxPixelRatio: 2.35, sphereSegments: 64,
    textureSize: 1280, extraStars: 6500, bloom: 0.68, fps: 60, pixelated: false,
  },
  cinematic: {
    label: 'Cinematic', pixelScale: 1.9, maxPixelRatio: 3.0, sphereSegments: 96,
    textureSize: 2048, extraStars: 12000, bloom: 0.9, fps: 60, pixelated: false,
  },
};

let desiredMode = loadMode();
let installed = false;
let qualityButton;
globalThis.REALITY_V67_QUALITY = desiredMode;

function loadMode() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (QUALITY_ORDER.includes(stored)) return stored;
  } catch (_) {}
  return 'pixel';
}

function saveMode(mode) {
  try { localStorage.setItem(STORAGE_KEY, mode); } catch (_) {}
}

function nextMode(mode) {
  const index = QUALITY_ORDER.indexOf(mode);
  return QUALITY_ORDER[(index + 1) % QUALITY_ORDER.length];
}

function updateButton() {
  if (!qualityButton) return;
  qualityButton.textContent = `GPU ${QUALITY[desiredMode].label}`;
  qualityButton.title = `${QUALITY[desiredMode].label} render quality`;
}

function injectButton() {
  if (qualityButton) return;
  const actions = document.querySelector('.system-actions');
  if (!actions) return;
  qualityButton = document.createElement('button');
  qualityButton.id = 'gpuQuality';
  qualityButton.type = 'button';
  qualityButton.addEventListener('click', () => {
    desiredMode = nextMode(desiredMode);
    globalThis.REALITY_V67_QUALITY = desiredMode;
    saveMode(desiredMode);
    updateButton();
    const universe = globalThis.realityV67?.universe;
    if (universe?.setGpuQuality) universe.setGpuQuality(desiredMode);
  });
  const autoScale = document.getElementById('autoScale');
  actions.insertBefore(qualityButton, autoScale || actions.firstChild);
  updateButton();
}

function seededRandom(seed) {
  let value = seed >>> 0 || 1;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 4294967296;
  };
}

function textSeed(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeStarField(count) {
  const random = seededRandom(0x4b1d932f);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();
  for (let index = 0; index < count; index += 1) {
    const radius = 780 + random() * 2100;
    const azimuth = random() * Math.PI * 2;
    const elevation = Math.asin(random() * 2 - 1);
    positions[index * 3] = Math.cos(elevation) * Math.cos(azimuth) * radius;
    positions[index * 3 + 1] = Math.sin(elevation) * radius;
    positions[index * 3 + 2] = Math.cos(elevation) * Math.sin(azimuth) * radius;
    color.setHSL(random() > 0.84 ? 0.09 : 0.55 + random() * 0.1, 0.2 + random() * 0.35, 0.7 + random() * 0.28);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 1.2,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'Quality star field';
  return points;
}

function makePlanetTexture(name, type, size, pixelated) {
  const width = size;
  const height = Math.max(64, Math.floor(size / 2));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const random = seededRandom(textSeed(`${name}:${type}:${size}`));

  const palettes = type === 2
    ? [['#092c50', '#174f79', '#287765'], ['#3b7d47', '#7d7445', '#dce8e8']]
    : type === 3
      ? [['#777d82', '#aeb5bc', '#d5d9dc'], ['#55595e', '#8b9197', '#c3c7cb']]
      : [['#3b4868', '#775947', '#a58860'], ['#52658b', '#8f6d55', '#c1a473']];
  context.fillStyle = palettes[0][type % palettes[0].length];
  context.fillRect(0, 0, width, height);

  const patchCount = pixelated ? 90 : Math.max(180, Math.floor(size * 0.35));
  for (let index = 0; index < patchCount; index += 1) {
    context.fillStyle = palettes[1][Math.floor(random() * palettes[1].length)];
    const x = Math.floor(random() * width);
    const y = Math.floor(random() * height);
    const patchWidth = Math.max(2, Math.floor(width * (0.01 + random() * 0.06)));
    const patchHeight = Math.max(2, Math.floor(height * (0.01 + random() * 0.05)));
    if (pixelated) context.fillRect(x, y, patchWidth, patchHeight);
    else {
      context.globalAlpha = 0.25 + random() * 0.5;
      context.beginPath();
      context.ellipse(x, y, patchWidth, patchHeight, random() * Math.PI, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 1;
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.magFilter = pixelated ? THREE.NearestFilter : THREE.LinearFilter;
  texture.minFilter = pixelated ? THREE.NearestMipmapNearestFilter : THREE.LinearMipmapLinearFilter;
  texture.anisotropy = pixelated ? 1 : 4;
  texture.needsUpdate = true;
  return texture;
}

function installQuality(universe) {
  if (installed || !universe) return;
  installed = true;

  const renderer = universe.renderer;
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(universe.scene, universe.camera);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0, 0.35, 0.75);
  const outputPass = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(outputPass);

  const stars = makeStarField(QUALITY.cinematic.extraStars);
  universe.scene.add(stars);

  const originalResize = universe.resize.bind(universe);
  const originalCreateBodyMesh = universe._createBodyMesh.bind(universe);
  const originalQualityLabel = universe.qualityLabel.bind(universe);
  let quality = QUALITY[desiredMode];
  let qualityName = desiredMode;
  let lastWidth = 0;
  let lastHeight = 0;

  function styleMesh(system, mesh, body) {
    if (!mesh || body.type === 0) return mesh;
    const oldGeometry = mesh.geometry;
    mesh.geometry = new THREE.SphereGeometry(
      1,
      quality.sphereSegments,
      Math.max(6, Math.floor(quality.sphereSegments * 0.62)),
    );
    oldGeometry?.dispose();

    if (mesh.material?.isMeshStandardMaterial) {
      mesh.material.map?.dispose();
      mesh.material.map = makePlanetTexture(body.name, body.type, quality.textureSize, quality.pixelated);
      mesh.material.flatShading = quality.pixelated;
      mesh.material.roughness = quality.pixelated ? 0.95 : (body.type === 2 ? 0.66 : 0.8);
      mesh.material.metalness = quality.pixelated ? 0 : 0.015;
      mesh.material.needsUpdate = true;
    }

    let atmosphere = mesh.getObjectByName('Atmosphere');
    if (body.type === 2 && !atmosphere) {
      atmosphere = new THREE.Mesh(
        new THREE.SphereGeometry(1.045, 24, 16),
        new THREE.MeshBasicMaterial({
          color: 0x7dc9ff,
          transparent: true,
          opacity: 0.09,
          blending: THREE.AdditiveBlending,
          side: THREE.BackSide,
          depthWrite: false,
        }),
      );
      atmosphere.name = 'Atmosphere';
      mesh.add(atmosphere);
    }
    if (atmosphere) atmosphere.visible = !quality.pixelated;
    return mesh;
  }

  universe._createBodyMesh = function patchedCreateBodyMesh(system, body) {
    return styleMesh(system, originalCreateBodyMesh(system, body), body);
  };

  function restyleExistingMeshes() {
    for (const system of universe.systems) {
      for (const mesh of system.meshes.values()) {
        styleMesh(system, mesh, {
          name: mesh.userData.bodyName,
          type: mesh.userData.bodyType,
        });
      }
    }
  }

  universe.resize = function qualityResize() {
    originalResize();
    const width = Math.max(1, universe.canvas.clientWidth);
    const height = Math.max(1, universe.canvas.clientHeight);
    if (width !== lastWidth || height !== lastHeight) {
      lastWidth = width;
      lastHeight = height;
      composer.setSize(width, height);
    }
  };

  universe.setGpuQuality = function setGpuQuality(mode) {
    if (!QUALITY[mode]) return;
    qualityName = mode;
    quality = QUALITY[mode];
    desiredMode = mode;
    globalThis.REALITY_V67_QUALITY = mode;
    saveMode(mode);

    const requestedRatio = (devicePixelRatio || 1) * quality.pixelScale;
    const pixelRatio = Math.min(quality.maxPixelRatio, requestedRatio);
    renderer.setPixelRatio(pixelRatio);
    if (typeof composer.setPixelRatio === 'function') composer.setPixelRatio(pixelRatio);
    renderer.domElement.style.imageRendering = quality.pixelated ? 'pixelated' : 'auto';
    renderer.toneMappingExposure = quality.pixelated ? 0.9 : 1.05;
    bloomPass.strength = quality.bloom;
    bloomPass.enabled = quality.bloom > 0;
    stars.geometry.setDrawRange(0, quality.extraStars);
    stars.visible = quality.extraStars > 0;
    if (universe.scene.fog) universe.scene.fog.density = quality.pixelated ? 0.00042 : 0.00025;

    restyleExistingMeshes();
    lastWidth = 0;
    lastHeight = 0;
    universe.resize();
    updateButton();
  };

  universe.qualityLabel = function qualityLabel() {
    const width = Math.round(universe.canvas.clientWidth * renderer.getPixelRatio());
    const height = Math.round(universe.canvas.clientHeight * renderer.getPixelRatio());
    return `${quality.label} ${width}×${height} · ${quality.fps} FPS · ${originalQualityLabel()}`;
  };

  universe._render = function qualityRender(time) {
    if (!this.active) return;
    const frameInterval = 1000 / quality.fps;
    if (time - this.lastRender < frameInterval) return;
    const delta = Math.min(0.1, this.clock.getDelta());
    this.lastRender = time;
    this.resize();
    this._updateFly(time);
    this.controls.update();
    this._updateAutomaticScales();
    this._updateFlashes(delta);
    if (bloomPass.enabled) composer.render(delta);
    else renderer.render(this.scene, this.camera);
  };

  universe.setGpuQuality(desiredMode);
  universe.ultraComposer = composer;
  universe.ultraBloom = bloomPass;
  globalThis.realityV67Ultra = {
    composer,
    bloomPass,
    get mode() { return qualityName; },
    setMode: (mode) => universe.setGpuQuality(mode),
  };
}

injectButton();
const timer = setInterval(() => {
  injectButton();
  const universe = globalThis.realityV67?.universe;
  if (!universe) return;
  clearInterval(timer);
  installQuality(universe);
}, 120);
