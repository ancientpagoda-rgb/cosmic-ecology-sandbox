import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const STORAGE_KEY = 'reality-v6-7-gpu-quality';
const isMobile = innerWidth < 720 || (navigator.deviceMemory && navigator.deviceMemory <= 4);
const QUALITY_ORDER = isMobile ? ['adaptive', 'high'] : ['high', 'ultra', 'cinematic'];
const QUALITY = {
  adaptive: {
    label: 'Adaptive', pixelScale: 0.9, maxPixelRatio: 1.15, sphereSegments: 18,
    textureSize: 384, extraStars: 0, bloom: 0, fps: 30,
  },
  high: {
    label: 'High', pixelScale: 1.05, maxPixelRatio: 1.75, sphereSegments: 36,
    textureSize: 768, extraStars: 2500, bloom: 0.38, fps: 60,
  },
  ultra: {
    label: 'Ultra', pixelScale: 1.6, maxPixelRatio: 2.6, sphereSegments: 64,
    textureSize: 1280, extraStars: 6500, bloom: 0.72, fps: 60,
  },
  cinematic: {
    label: 'Cinematic', pixelScale: 2.15, maxPixelRatio: 3.25, sphereSegments: 96,
    textureSize: 2048, extraStars: 12000, bloom: 0.92, fps: 60,
  },
};

let desiredMode = loadMode();
let installed = false;
let qualityButton;

function loadMode() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (QUALITY_ORDER.includes(stored)) return stored;
  } catch (_) {}
  return isMobile ? 'adaptive' : 'ultra';
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
    saveMode(desiredMode);
    updateButton();
    const universe = window.realityV67?.universe;
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

function makeDenseStars(count) {
  const random = seededRandom(0x4b1d932f);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const color = new THREE.Color();
  for (let index = 0; index < count; index += 1) {
    const radius = 780 + random() * 2100;
    const azimuth = random() * Math.PI * 2;
    const elevation = Math.asin(random() * 2 - 1);
    positions[index * 3] = Math.cos(elevation) * Math.cos(azimuth) * radius;
    positions[index * 3 + 1] = Math.sin(elevation) * radius;
    positions[index * 3 + 2] = Math.cos(elevation) * Math.sin(azimuth) * radius;
    const warm = random();
    color.setHSL(warm > 0.82 ? 0.09 : 0.56 + random() * 0.09, 0.2 + random() * 0.42, 0.72 + random() * 0.27);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
    sizes[index] = 0.7 + random() * 1.6;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  const material = new THREE.PointsMaterial({
    size: 1.25,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'Ultra star field';
  return points;
}

function makePlanetTexture(name, type, size, anisotropy) {
  const width = size;
  const height = Math.max(192, Math.floor(size / 2));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const random = seededRandom(textSeed(`${name}:${type}:${size}`));

  if (type === 2) {
    const ocean = context.createLinearGradient(0, 0, 0, height);
    ocean.addColorStop(0, '#194f80');
    ocean.addColorStop(0.5, '#0c3764');
    ocean.addColorStop(1, '#082644');
    context.fillStyle = ocean;
    context.fillRect(0, 0, width, height);
    for (let index = 0; index < 260; index += 1) {
      const x = random() * width;
      const y = random() * height;
      const radiusX = width * (0.008 + random() * 0.045);
      const radiusY = height * (0.006 + random() * 0.04);
      const latitude = Math.abs(y / height - 0.5) * 2;
      context.fillStyle = latitude > 0.78
        ? `rgba(225,239,244,${0.35 + random() * 0.45})`
        : random() > 0.34
          ? `rgba(${35 + Math.floor(random() * 45)},${92 + Math.floor(random() * 75)},${45 + Math.floor(random() * 42)},${0.55 + random() * 0.32})`
          : `rgba(141,112,68,${0.38 + random() * 0.34})`;
      context.beginPath();
      context.ellipse(x, y, radiusX, radiusY, random() * Math.PI, 0, Math.PI * 2);
      context.fill();
    }
    for (let index = 0; index < 150; index += 1) {
      context.fillStyle = `rgba(245,250,255,${0.025 + random() * 0.11})`;
      context.beginPath();
      context.ellipse(random() * width, random() * height, width * (0.01 + random() * 0.035), height * (0.004 + random() * 0.015), random() * Math.PI, 0, Math.PI * 2);
      context.fill();
    }
  } else if (type === 3) {
    context.fillStyle = '#aeb5bc';
    context.fillRect(0, 0, width, height);
    for (let index = 0; index < 420; index += 1) {
      const radius = 1 + random() * width * 0.018;
      const shade = 75 + Math.floor(random() * 90);
      context.fillStyle = `rgba(${shade},${shade},${shade},${0.08 + random() * 0.28})`;
      context.beginPath();
      context.arc(random() * width, random() * height, radius, 0, Math.PI * 2);
      context.fill();
    }
  } else {
    const hue = (textSeed(name) % 360) / 360;
    const base = new THREE.Color().setHSL(hue, 0.34, 0.48);
    context.fillStyle = `#${base.getHexString()}`;
    context.fillRect(0, 0, width, height);
    for (let band = 0; band < 34; band += 1) {
      const y = band / 34 * height;
      const bandColor = new THREE.Color().setHSL((hue + (random() - 0.5) * 0.08 + 1) % 1, 0.25 + random() * 0.35, 0.32 + random() * 0.38);
      context.fillStyle = `rgba(${Math.round(bandColor.r * 255)},${Math.round(bandColor.g * 255)},${Math.round(bandColor.b * 255)},${0.18 + random() * 0.5})`;
      context.fillRect(0, y, width, height / 34 + 2);
    }
    for (let index = 0; index < 55; index += 1) {
      context.fillStyle = `rgba(255,255,255,${0.015 + random() * 0.055})`;
      context.beginPath();
      context.ellipse(random() * width, random() * height, width * (0.008 + random() * 0.035), height * (0.005 + random() * 0.02), 0, 0, Math.PI * 2);
      context.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.wrapS = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function installUltraQuality(universe) {
  if (installed || !universe) return;
  installed = true;

  const renderer = universe.renderer;
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(universe.scene, universe.camera);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.72, 0.42, 0.72);
  const outputPass = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(outputPass);

  const denseStars = makeDenseStars(QUALITY.cinematic.extraStars);
  universe.scene.add(denseStars);

  const originalResize = universe.resize.bind(universe);
  const originalCreateBodyMesh = universe._createBodyMesh.bind(universe);
  const originalQualityLabel = universe.qualityLabel.bind(universe);
  let lastWidth = 0;
  let lastHeight = 0;
  let quality = QUALITY[desiredMode];
  let qualityName = desiredMode;
  let sharedSphereGeometry = null;
  let lastGeometrySegments = 0;

  function rebuildSphereGeometry() {
    if (lastGeometrySegments === quality.sphereSegments && sharedSphereGeometry) return;
    sharedSphereGeometry?.dispose();
    sharedSphereGeometry = new THREE.SphereGeometry(
      1,
      quality.sphereSegments,
      Math.max(14, Math.floor(quality.sphereSegments * 0.66)),
    );
    lastGeometrySegments = quality.sphereSegments;
  }

  function enhanceMesh(system, mesh, body) {
    if (!mesh || body.type === 0) return mesh;
    rebuildSphereGeometry();
    if (mesh.geometry !== sharedSphereGeometry) {
      mesh.geometry?.dispose();
      mesh.geometry = sharedSphereGeometry;
    }
    if (system.index === 0 && mesh.material?.isMeshStandardMaterial) {
      mesh.material.map?.dispose();
      mesh.material.map = makePlanetTexture(body.name, body.type, quality.textureSize, maxAnisotropy);
      mesh.material.roughness = body.type === 2 ? 0.66 : 0.78;
      mesh.material.metalness = 0.015;
      mesh.material.needsUpdate = true;
      if (body.type === 2 && !mesh.getObjectByName('Atmosphere')) {
        const atmosphere = new THREE.Mesh(
          new THREE.SphereGeometry(1.045, Math.max(24, Math.floor(quality.sphereSegments * 0.75)), Math.max(16, Math.floor(quality.sphereSegments * 0.48))),
          new THREE.MeshBasicMaterial({
            color: 0x7dc9ff,
            transparent: true,
            opacity: 0.095,
            blending: THREE.AdditiveBlending,
            side: THREE.BackSide,
            depthWrite: false,
          }),
        );
        atmosphere.name = 'Atmosphere';
        mesh.add(atmosphere);
      }
    }
    return mesh;
  }

  universe._createBodyMesh = function patchedCreateBodyMesh(system, body) {
    const mesh = originalCreateBodyMesh(system, body);
    return enhanceMesh(system, mesh, body);
  };

  function enhanceExistingMeshes() {
    for (const system of universe.systems) {
      for (const mesh of system.meshes.values()) {
        enhanceMesh(system, mesh, {
          name: mesh.userData.bodyName,
          type: mesh.userData.bodyType,
        });
      }
    }
  }

  universe.resize = function ultraResize() {
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
    saveMode(mode);
    const requestedRatio = (devicePixelRatio || 1) * quality.pixelScale;
    const pixelRatio = Math.min(quality.maxPixelRatio, requestedRatio);
    renderer.setPixelRatio(pixelRatio);
    if (typeof composer.setPixelRatio === 'function') composer.setPixelRatio(pixelRatio);
    bloomPass.strength = quality.bloom;
    bloomPass.enabled = quality.bloom > 0;
    denseStars.geometry.setDrawRange(0, quality.extraStars);
    denseStars.visible = quality.extraStars > 0;
    lastGeometrySegments = 0;
    enhanceExistingMeshes();
    lastWidth = 0;
    lastHeight = 0;
    universe.resize();
    updateButton();
  };

  universe.qualityLabel = function ultraQualityLabel() {
    const base = originalQualityLabel();
    const width = Math.round(universe.canvas.clientWidth * renderer.getPixelRatio());
    const height = Math.round(universe.canvas.clientHeight * renderer.getPixelRatio());
    return `${quality.label} ${width}×${height} · bloom ${quality.bloom > 0 ? 'on' : 'off'} · ${base}`;
  };

  universe._render = function ultraRender(time) {
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
  window.realityV67Ultra = {
    composer,
    bloomPass,
    get mode() { return qualityName; },
    setMode: (mode) => universe.setGpuQuality(mode),
  };
}

injectButton();
const timer = setInterval(() => {
  injectButton();
  const universe = window.realityV67?.universe;
  if (!universe) return;
  clearInterval(timer);
  installUltraQuality(universe);
}, 120);
