import * as THREE from 'three';
import { samplePlanet, biomeColor } from './planet.js';
import { sampleHydrology, hydrologyColor } from './hydrology.js';

export function createGlobeRenderer(container, dynamics, onInspect, options = {}) {
  const requested = options.quality || 'auto';
  const coarse = matchMedia('(max-width: 700px), (pointer: coarse)').matches;
  const tier = requested === 'mobile' ? 'mobile' : requested === 'desktop' ? 'desktop' : coarse ? 'mobile' : 'desktop';
  const mobile = tier === 'mobile';
  const settings = mobile
    ? { segments: 72, textureW: 768, textureH: 384, cloudW: 384, cloudH: 192, stars: 420, pixelRatio: 1, home: 3.2 }
    : { segments: 192, textureW: 2048, textureH: 1024, cloudW: 1024, cloudH: 512, stars: 1800, pixelRatio: 2, home: 2.85 };

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: mobile ? 'low-power' : 'high-performance' });
  } catch (error) {
    options.onError?.(error);
    throw error;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, settings.pixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.replaceChildren(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x01030a);
  const camera = new THREE.PerspectiveCamera(mobile ? 46 : 40, 1, 0.05, 100);
  const savedCamera = options.cameraState;
  let targetDistance = clamp(savedCamera?.distance ?? settings.home, 1.18, 6);
  camera.position.set(0, 0.15, targetDistance);

  const globe = new THREE.Group();
  globe.rotation.set(savedCamera?.rotationX ?? -0.12, savedCamera?.rotationY ?? 0, 0);
  scene.add(globe);

  const terrainGeometry = createDisplacedSphere(settings.segments, mobile ? 0.042 : 0.06);
  const terrainMaterial = new THREE.MeshStandardMaterial({
    map: createSurfaceTexture(settings.textureW, settings.textureH),
    roughness: 0.82,
    metalness: 0.01,
    bumpMap: createReliefTexture(mobile ? 512 : 1024, mobile ? 256 : 512),
    bumpScale: mobile ? 0.012 : 0.02,
  });
  const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
  globe.add(terrain);

  const oceanUniforms = { time: { value: 0 }, sunDirection: { value: new THREE.Vector3(1, 0, 1).normalize() } };
  const ocean = new THREE.Mesh(
    new THREE.SphereGeometry(1.004, mobile ? 64 : 144, mobile ? 40 : 90),
    new THREE.ShaderMaterial({
      uniforms: oceanUniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: `
        varying vec3 vNormalW; varying vec3 vPositionW; varying float vWave;
        uniform float time;
        void main(){
          vec3 p=position;
          float w=sin(p.x*42.0+time*0.8)*sin(p.z*37.0-time*0.55)*0.0013;
          p+=normal*w;
          vec4 wp=modelMatrix*vec4(p,1.0);
          vPositionW=wp.xyz; vNormalW=normalize(mat3(modelMatrix)*normal); vWave=w;
          gl_Position=projectionMatrix*viewMatrix*wp;
        }`,
      fragmentShader: `
        varying vec3 vNormalW; varying vec3 vPositionW; varying float vWave;
        uniform vec3 sunDirection;
        void main(){
          vec3 V=normalize(cameraPosition-vPositionW);
          float fresnel=pow(1.0-max(dot(V,normalize(vNormalW)),0.0),3.0);
          float glint=pow(max(dot(reflect(-sunDirection,normalize(vNormalW)),V),0.0),42.0);
          vec3 deep=vec3(0.015,0.09,0.20); vec3 shallow=vec3(0.02,0.27,0.40);
          vec3 color=mix(deep,shallow,0.32+vWave*80.0)+glint*vec3(1.0,0.86,0.62);
          gl_FragColor=vec4(mix(color,vec3(0.20,0.55,0.82),fresnel*0.7),0.74+fresnel*0.18);
        }`,
    }),
  );
  globe.add(ocean);

  const cloudsLow = makeCloudLayer(1.026, settings.cloudW, settings.cloudH, mobile ? 0.34 : 0.44, 0);
  const cloudsHigh = makeCloudLayer(1.041, Math.floor(settings.cloudW / 2), Math.floor(settings.cloudH / 2), mobile ? 0.12 : 0.2, 1.8);
  globe.add(cloudsLow, cloudsHigh);

  const atmosphereInner = new THREE.Mesh(
    new THREE.SphereGeometry(1.062, mobile ? 40 : 96, mobile ? 26 : 60),
    new THREE.MeshBasicMaterial({ color: 0x4c9cff, transparent: true, opacity: 0.07, side: THREE.BackSide, blending: THREE.AdditiveBlending }),
  );
  const atmosphereOuter = new THREE.Mesh(
    new THREE.SphereGeometry(1.105, mobile ? 32 : 72, mobile ? 20 : 46),
    new THREE.MeshBasicMaterial({ color: 0x236dff, transparent: true, opacity: 0.045, side: THREE.BackSide, blending: THREE.AdditiveBlending }),
  );
  globe.add(atmosphereInner, atmosphereOuter);

  const farLife = new THREE.Group();
  const nearLife = new THREE.Group();
  const weatherLayer = new THREE.Group();
  const geologyLayer = new THREE.Group();
  globe.add(farLife, nearLife, weatherLayer, geologyLayer);

  scene.add(new THREE.HemisphereLight(0x9bbdff, 0x050713, 0.52));
  const sun = new THREE.DirectionalLight(0xfff0d2, 3.8);
  scene.add(sun);
  scene.add(makeStars(settings.stars));

  const shared = createShared(mobile);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const activePointers = new Map();
  const up = new THREE.Vector3(0, 1, 0);
  let lastWorld = null;
  let lastPinch = 0;
  let lastX = 0;
  let lastY = 0;
  let dragging = false;
  let pointerMoved = false;
  let lastSync = 0;
  let lastFrame = 0;
  let lastWidth = 0;
  let lastHeight = 0;
  let active = true;
  let readySent = false;

  function resize() {
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width; lastHeight = height;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function render(world) {
    lastWorld = world;
    resize();
    const now = performance.now();
    if (now - lastSync >= (mobile ? 320 : 140)) {
      lastSync = now;
      syncEntities(world);
      syncWeather(world);
      syncGeology(world);
    }
  }

  function animate(timestamp) {
    requestAnimationFrame(animate);
    if (!active || (mobile && timestamp - lastFrame < 33)) return;
    lastFrame = timestamp;
    const t = dynamics.getTime();
    const dayAngle = t * 0.018;
    const sunPos = new THREE.Vector3(Math.cos(dayAngle) * 5, Math.sin(dayAngle * 0.37) * 2.1, Math.sin(dayAngle) * 5);
    sun.position.copy(sunPos);
    oceanUniforms.time.value = t;
    oceanUniforms.sunDirection.value.copy(sunPos).normalize();
    cloudsLow.rotation.y += mobile ? 0.00032 : 0.00048;
    cloudsHigh.rotation.y -= mobile ? 0.00012 : 0.0002;
    cloudsHigh.rotation.z = Math.sin(t * 0.003) * 0.015;
    if (!dragging && !activePointers.size && targetDistance > 1.48) globe.rotation.y += mobile ? 0.0003 : 0.00048;
    camera.position.setLength(targetDistance);
    const near = targetDistance < 1.85;
    nearLife.visible = near;
    farLife.visible = !near;
    terrainMaterial.bumpScale = near ? (mobile ? 0.019 : 0.032) : (mobile ? 0.009 : 0.016);
    renderer.render(scene, camera);
    if (!readySent) { readySent = true; options.onReady?.(); }
  }
  requestAnimationFrame(animate);

  function syncEntities(world) {
    farLife.clear(); nearLife.clear();
    const c = world.ecs.components;
    let plants = 0;
    for (const [id, resource] of c.resource.entries()) {
      if (plants++ >= (mobile ? 110 : 300)) break;
      const p = c.position.get(id);
      if (!p || resource.amount <= 0) continue;
      const dot = new THREE.Mesh(shared.farPlantGeometry, resource.kind === 'pod' ? shared.podMaterial : shared.plantMaterial);
      placeSurface(dot, p, world, 1.045); farLife.add(dot);
      const tree = makeTree(resource.kind === 'pod' ? shared.podMaterial : shared.plantMaterial, shared);
      placeSurface(tree, p, world, 1.052); nearLife.add(tree);
    }
    addAnimals(c.agent, shared.grazerMaterial, mobile ? 90 : 220, world);
    addAnimals(c.predator, shared.predatorMaterial, mobile ? 40 : 100, world);
    addAnimals(c.apex, shared.apexMaterial, mobile ? 18 : 45, world, 1.35);
  }

  function addAnimals(component, material, limit, world, scale = 1) {
    let count = 0;
    for (const [id] of component.entries()) {
      if (count++ >= limit) break;
      const p = world.ecs.components.position.get(id);
      if (!p) continue;
      const dot = new THREE.Mesh(shared.farAnimalGeometry, material); dot.scale.setScalar(scale);
      placeSurface(dot, p, world, 1.047); farLife.add(dot);
      const animal = new THREE.Mesh(shared.nearAnimalGeometry, material); animal.scale.setScalar(scale);
      placeSurface(animal, p, world, 1.055); nearLife.add(animal);
    }
  }

  function syncWeather(world) {
    weatherLayer.clear();
    let count = 0;
    for (const system of dynamics.getWeather()) {
      if (system.type === 'cloud' || count++ >= (mobile ? 12 : 22)) continue;
      const mat = system.type === 'snow' ? shared.snowMaterial : system.type === 'storm' ? shared.stormMaterial : shared.rainMaterial;
      const mesh = new THREE.Mesh(shared.weatherGeometry, mat);
      mesh.scale.setScalar(0.7 + system.strength * 0.85);
      placeSurface(mesh, system, world, 1.071); weatherLayer.add(mesh);
    }
  }

  function syncGeology(world) {
    geologyLayer.clear();
    let count = 0;
    for (const site of dynamics.getGeology()) {
      if (site.type !== 'volcano' || count++ >= (mobile ? 10 : 22)) continue;
      const mesh = new THREE.Mesh(shared.volcanoGeometry, site.activity > 0.75 ? shared.activeVolcanoMaterial : shared.volcanoMaterial);
      placeSurface(mesh, site, world, 1.05); geologyLayer.add(mesh);
    }
  }

  function placeSurface(object, pos, world, radius) {
    const vector = worldToSphere(pos.x, pos.y, world.width, world.height, radius);
    object.position.copy(vector);
    object.quaternion.setFromUnitVectors(up, vector.clone().normalize());
  }

  function pick(clientX, clientY) {
    if (!lastWorld) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(terrain, false)[0];
    if (!hit) return null;
    const local = globe.worldToLocal(hit.point.clone()).normalize();
    return { x: ((Math.atan2(local.z, local.x) / (Math.PI * 2)) + 0.5) * lastWorld.width, y: (0.5 - Math.asin(local.y) / Math.PI) * lastWorld.height };
  }

  const canvas = renderer.domElement;
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', event => {
    event.preventDefault(); activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture?.(event.pointerId); dragging = true; pointerMoved = false;
    lastX = event.clientX; lastY = event.clientY; lastPinch = 0;
  });
  canvas.addEventListener('pointermove', event => {
    if (!activePointers.has(event.pointerId)) return;
    event.preventDefault(); activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...activePointers.values()];
    if (points.length >= 2) {
      const d = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      if (lastPinch) targetDistance = clamp(targetDistance - (d - lastPinch) * 0.008, 1.18, 6);
      lastPinch = d; return;
    }
    if (canvas.dataset.brush === 'on') return;
    if (Math.abs(event.clientX - lastX) + Math.abs(event.clientY - lastY) > 3) pointerMoved = true;
    globe.rotation.y += (event.clientX - lastX) * 0.006;
    globe.rotation.x = clamp(globe.rotation.x + (event.clientY - lastY) * 0.004, -1.2, 1.2);
    lastX = event.clientX; lastY = event.clientY;
  }, { passive: false });
  function end(event) {
    const single = activePointers.size === 1;
    activePointers.delete(event.pointerId);
    if (!activePointers.size) {
      dragging = false; lastPinch = 0; options.onCameraChange?.(getCameraState());
      if (single && !pointerMoved && canvas.dataset.brush !== 'on') {
        const point = pick(event.clientX, event.clientY); if (point) onInspect?.(dynamics.inspect(point.x, point.y));
      }
    }
  }
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('lostpointercapture', end);
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); active = false; options.onError?.(new Error('WebGL context was lost. Switch to Mobile quality and retry.')); });
  canvas.addEventListener('wheel', event => { event.preventDefault(); targetDistance = clamp(targetDistance + Math.sign(event.deltaY) * 0.22, 1.18, 6); options.onCameraChange?.(getCameraState()); }, { passive: false });
  document.addEventListener('visibilitychange', () => { active = !document.hidden; });
  window.addEventListener('resize', resize, { passive: true });

  function getCameraState() { return { distance: targetDistance, rotationX: globe.rotation.x, rotationY: globe.rotation.y }; }
  function resetView() { targetDistance = settings.home; globe.rotation.set(-0.12, 0, 0); options.onCameraChange?.(getCameraState()); }

  return {
    render,
    zoomIn: () => { targetDistance = Math.max(1.18, targetDistance - 0.28); options.onCameraChange?.(getCameraState()); },
    zoomOut: () => { targetDistance = Math.min(6, targetDistance + 0.28); options.onCameraChange?.(getCameraState()); },
    deepZoom: () => { targetDistance = targetDistance < 1.75 ? settings.home : 1.34; options.onCameraChange?.(getCameraState()); },
    resetView,
    getCameraState,
    pickWorldPoint: pick,
    get element() { return canvas; },
  };
}

function createDisplacedSphere(segments, amplitude) {
  const geometry = new THREE.SphereGeometry(1, segments, Math.floor(segments * 0.62));
  const positions = geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    v.fromBufferAttribute(positions, i).normalize();
    const lat = Math.asin(v.y);
    const lon = Math.atan2(v.z, v.x);
    const x = ((lon / (Math.PI * 2)) + 0.5) * 1200;
    const y = (0.5 - lat / Math.PI) * 720;
    const p = samplePlanet(x, y, 1200, 720);
    const displacement = p.land ? Math.max(0, p.elevation - 0.53) * amplitude : Math.max(-0.012, (p.elevation - 0.53) * amplitude * 0.18);
    v.multiplyScalar(1 + displacement);
    positions.setXYZ(i, v.x, v.y, v.z);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function createSurfaceTexture(width, height) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'); const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = samplePlanet(x, y, width, height); const h = sampleHydrology(x, y, width, height);
    let [r, g, b] = hydrologyColor(biomeColor(p), h);
    if (!p.land) { r *= 0.3; g *= 0.42; b *= 0.55; }
    const i = (y * width + x) * 4; image.data[i] = r; image.data[i + 1] = g; image.data[i + 2] = b; image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0); const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

function createReliefTexture(width, height) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'); const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = samplePlanet(x, y, width, height); const h = sampleHydrology(x, y, width, height);
    const value = clamp((p.elevation * 0.78 + p.plateBoundary * 0.18 - h.erosion * 0.12) * 255, 0, 255);
    const i = (y * width + x) * 4; image.data[i] = image.data[i + 1] = image.data[i + 2] = value; image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0); const texture = new THREE.CanvasTexture(canvas); texture.wrapS = THREE.RepeatWrapping; return texture;
}

function makeCloudLayer(radius, width, height, opacity, phase) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'); const image = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const nx = x / width, ny = y / height;
    const n = (Math.sin(nx * 31 + Math.sin(ny * 17 + phase)) + Math.sin(nx * 67 - ny * 23 + phase) * 0.5 + Math.sin((nx + ny) * 113 - phase) * 0.25 + 1.75) / 3.5;
    const a = clamp((n - 0.5) * 4.1, 0, 1) * opacity;
    const i = (y * width + x) * 4; image.data[i] = 247; image.data[i + 1] = 251; image.data[i + 2] = 255; image.data[i + 3] = Math.round(a * 255);
  }
  ctx.putImageData(image, 0, 0); const texture = new THREE.CanvasTexture(canvas); texture.wrapS = THREE.RepeatWrapping;
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 40), new THREE.MeshLambertMaterial({ map: texture, transparent: true, opacity: 1, depthWrite: false }));
}

function makeTree(material, shared) {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(shared.trunkGeometry, shared.trunkMaterial); trunk.position.y = 0.012;
  const crown = new THREE.Mesh(shared.crownGeometry, material); crown.position.y = 0.036;
  group.add(trunk, crown); return group;
}

function createShared(mobile) {
  return {
    farPlantGeometry: new THREE.SphereGeometry(0.011, 5, 4), farAnimalGeometry: new THREE.SphereGeometry(0.015, 6, 4),
    nearAnimalGeometry: new THREE.CapsuleGeometry(0.008, 0.025, 3, 6), trunkGeometry: new THREE.CylinderGeometry(0.003, 0.004, 0.024, 5),
    crownGeometry: new THREE.ConeGeometry(0.014, 0.042, mobile ? 5 : 7), weatherGeometry: new THREE.RingGeometry(0.018, 0.038, 12),
    volcanoGeometry: new THREE.ConeGeometry(0.02, 0.065, 8), plantMaterial: new THREE.MeshBasicMaterial({ color: 0x46c56a }),
    podMaterial: new THREE.MeshBasicMaterial({ color: 0xdab65b }), trunkMaterial: new THREE.MeshBasicMaterial({ color: 0x68472a }),
    grazerMaterial: new THREE.MeshBasicMaterial({ color: 0x75d9ff }), predatorMaterial: new THREE.MeshBasicMaterial({ color: 0xff705e }),
    apexMaterial: new THREE.MeshBasicMaterial({ color: 0xd294ff }), rainMaterial: new THREE.MeshBasicMaterial({ color: 0x64b9ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
    snowMaterial: new THREE.MeshBasicMaterial({ color: 0xeaf7ff, transparent: true, opacity: 0.56, side: THREE.DoubleSide, depthWrite: false }),
    stormMaterial: new THREE.MeshBasicMaterial({ color: 0x8f82d8, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }),
    volcanoMaterial: new THREE.MeshBasicMaterial({ color: 0x704c3b }), activeVolcanoMaterial: new THREE.MeshBasicMaterial({ color: 0xff542e }),
  };
}

function worldToSphere(x, y, width, height, radius) {
  const lon = (x / width - 0.5) * Math.PI * 2; const lat = (0.5 - y / height) * Math.PI; const cos = Math.cos(lat);
  return new THREE.Vector3(radius * cos * Math.cos(lon), radius * Math.sin(lat), radius * cos * Math.sin(lon));
}

function makeStars(count) {
  const geometry = new THREE.BufferGeometry(); const values = [];
  for (let i = 0; i < count; i++) { const r = 12 + Math.random() * 18, theta = Math.random() * Math.PI * 2, phi = Math.acos(2 * Math.random() - 1); values.push(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)); }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(values, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xffffff, size: 0.035, transparent: true, opacity: 0.84 }));
}

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
