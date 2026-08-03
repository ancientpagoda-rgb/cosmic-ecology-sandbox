import * as THREE from 'three';
import { samplePlanet, biomeColor } from './planet.js';
import { sampleHydrology, hydrologyColor } from './hydrology.js';

export function createGlobeRenderer(container, dynamics, onInspect, options = {}) {
  const requestedQuality = options.quality || 'auto';
  const autoMobile = matchMedia('(max-width: 700px), (pointer: coarse)').matches;
  const mobile = requestedQuality === 'mobile' || (requestedQuality === 'auto' && autoMobile);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x01030a);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: mobile ? 'low-power' : 'high-performance', failIfMajorPerformanceCaveat: false });
  } catch (error) {
    options.onError?.(error);
    throw error;
  }

  const camera = new THREE.PerspectiveCamera(mobile ? 48 : 42, 1, 0.08, 100);
  const homeDistance = mobile ? 3.8 : 3.35;
  camera.position.set(0, 0.2, homeDistance);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.replaceChildren(renderer.domElement);

  const globe = new THREE.Group();
  scene.add(globe);
  const initialCamera = options.cameraState;
  globe.rotation.set(initialCamera?.rotationX ?? -0.12, initialCamera?.rotationY ?? 0, 0);

  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(1, mobile ? 40 : 96, mobile ? 26 : 60),
    new THREE.MeshStandardMaterial({ map: makePlanetTexture(mobile), roughness: 0.88, metalness: 0.015 }),
  );
  globe.add(planet);

  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(1.025, mobile ? 32 : 72, mobile ? 20 : 44),
    new THREE.MeshLambertMaterial({ map: makeCloudTexture(mobile), transparent: true, opacity: mobile ? 0.34 : 0.48, depthWrite: false }),
  );
  globe.add(clouds);

  globe.add(new THREE.Mesh(
    new THREE.SphereGeometry(1.06, mobile ? 24 : 48, mobile ? 16 : 32),
    new THREE.MeshBasicMaterial({ color: 0x63aaff, transparent: true, opacity: 0.08, side: THREE.BackSide, blending: THREE.AdditiveBlending }),
  ));

  const entityLayer = new THREE.Group();
  const weatherLayer = new THREE.Group();
  const geologyLayer = new THREE.Group();
  globe.add(entityLayer, weatherLayer, geologyLayer);

  scene.add(new THREE.HemisphereLight(0x829dcc, 0x070b18, 0.52));
  const sun = new THREE.DirectionalLight(0xfff3d6, 3.2);
  scene.add(sun);
  scene.add(makeStars(mobile ? 300 : 1100));

  const shared = createShared(mobile);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const activePointers = new Map();
  const up = new THREE.Vector3(0, 1, 0);
  let lastWorld = null;
  let targetDistance = clamp(initialCamera?.distance ?? homeDistance, 1.25, 6);
  let lastPinch = 0;
  let lastX = 0;
  let lastY = 0;
  let dragging = false;
  let pointerMoved = false;
  let lastSync = 0;
  let lastFrame = 0;
  let lastWidth = 0;
  let lastHeight = 0;
  let firstFrameSent = false;
  let active = true;

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

  function render(world) {
    lastWorld = world;
    resize();
    const now = performance.now();
    if (now - lastSync >= (mobile ? 300 : 120)) {
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
    sun.position.set(Math.cos(dayAngle) * 4, Math.sin(dayAngle * 0.37) * 1.8, Math.sin(dayAngle) * 4);
    clouds.rotation.y += mobile ? 0.00035 : 0.00048;
    if (!dragging && !activePointers.size && targetDistance > 1.55) globe.rotation.y += mobile ? 0.00035 : 0.00055;
    camera.position.setLength(targetDistance);
    renderer.render(scene, camera);
    if (!firstFrameSent) {
      firstFrameSent = true;
      options.onReady?.();
    }
  }
  requestAnimationFrame(animate);

  function syncEntities(world) {
    entityLayer.clear();
    const c = world.ecs.components;
    let plants = 0;
    for (const [id, resource] of c.resource.entries()) {
      if (plants++ >= (mobile ? 90 : 220)) break;
      const p = c.position.get(id);
      if (!p || resource.amount <= 0) continue;
      const mesh = new THREE.Mesh(shared.plantGeometry, resource.kind === 'pod' ? shared.podMaterial : shared.plantMaterial);
      placeSurface(mesh, p, world, 1.016);
      entityLayer.add(mesh);
    }
    addGroup(c.agent, shared.grazerGeometry, shared.grazerMaterial, mobile ? 80 : 180, world);
    addGroup(c.predator, shared.predatorGeometry, shared.predatorMaterial, mobile ? 35 : 80, world);
    addGroup(c.apex, shared.apexGeometry, shared.apexMaterial, mobile ? 15 : 35, world);
  }

  function addGroup(component, geometry, material, limit, world) {
    let count = 0;
    for (const [id] of component.entries()) {
      if (count++ >= limit) break;
      const p = world.ecs.components.position.get(id);
      if (!p) continue;
      const mesh = new THREE.Mesh(geometry, material);
      placeSurface(mesh, p, world, 1.019);
      entityLayer.add(mesh);
    }
  }

  function syncWeather(world) {
    weatherLayer.clear();
    let count = 0;
    for (const system of dynamics.getWeather()) {
      if (system.type === 'cloud' || count++ >= (mobile ? 10 : 18)) continue;
      const material = system.type === 'snow' ? shared.snowMaterial : system.type === 'storm' ? shared.stormMaterial : shared.rainMaterial;
      const mesh = new THREE.Mesh(shared.weatherGeometry, material);
      mesh.scale.setScalar(0.75 + system.strength * 0.7);
      placeSurface(mesh, system, world, 1.033);
      weatherLayer.add(mesh);
    }
  }

  function syncGeology(world) {
    geologyLayer.clear();
    let count = 0;
    for (const site of dynamics.getGeology()) {
      if (site.type !== 'volcano' || count++ >= (mobile ? 8 : 16)) continue;
      const mesh = new THREE.Mesh(shared.volcanoGeometry, site.activity > 0.75 ? shared.activeVolcanoMaterial : shared.volcanoMaterial);
      placeSurface(mesh, site, world, 1.013);
      geologyLayer.add(mesh);
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
    const hit = raycaster.intersectObject(planet, false)[0];
    if (!hit) return null;
    const local = globe.worldToLocal(hit.point.clone()).normalize();
    return {
      x: ((Math.atan2(local.z, local.x) / (Math.PI * 2)) + 0.5) * lastWorld.width,
      y: (0.5 - Math.asin(local.y) / Math.PI) * lastWorld.height,
    };
  }

  const canvas = renderer.domElement;
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', event => {
    event.preventDefault();
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture?.(event.pointerId);
    dragging = true;
    pointerMoved = false;
    lastX = event.clientX;
    lastY = event.clientY;
    lastPinch = 0;
  });
  canvas.addEventListener('pointermove', event => {
    if (!activePointers.has(event.pointerId)) return;
    event.preventDefault();
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...activePointers.values()];
    if (points.length >= 2) {
      const d = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      if (lastPinch) targetDistance = clamp(targetDistance - (d - lastPinch) * 0.008, 1.25, 6);
      lastPinch = d;
      return;
    }
    if (canvas.dataset.brush === 'on') return;
    if (Math.abs(event.clientX - lastX) + Math.abs(event.clientY - lastY) > 3) pointerMoved = true;
    globe.rotation.y += (event.clientX - lastX) * 0.006;
    globe.rotation.x = clamp(globe.rotation.x + (event.clientY - lastY) * 0.004, -1.2, 1.2);
    lastX = event.clientX;
    lastY = event.clientY;
  }, { passive: false });

  function end(event) {
    const wasSingle = activePointers.size === 1;
    activePointers.delete(event.pointerId);
    if (!activePointers.size) {
      dragging = false;
      lastPinch = 0;
      options.onCameraChange?.(getCameraState());
      if (wasSingle && !pointerMoved && canvas.dataset.brush !== 'on') {
        const point = pick(event.clientX, event.clientY);
        if (point) onInspect?.(dynamics.inspect(point.x, point.y));
      }
    }
  }
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('lostpointercapture', end);
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    active = false;
    options.onError?.(new Error('WebGL context was lost. Reload or switch to Mobile quality.'));
  });
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    targetDistance = clamp(targetDistance + Math.sign(event.deltaY) * 0.25, 1.25, 6);
    options.onCameraChange?.(getCameraState());
  }, { passive: false });

  document.addEventListener('visibilitychange', () => { active = !document.hidden; });
  window.addEventListener('resize', resize, { passive: true });

  function getCameraState() {
    return { distance: targetDistance, rotationX: globe.rotation.x, rotationY: globe.rotation.y };
  }

  function resetView() {
    targetDistance = homeDistance;
    globe.rotation.set(-0.12, 0, 0);
    options.onCameraChange?.(getCameraState());
  }

  return {
    render,
    zoomIn: () => { targetDistance = Math.max(1.25, targetDistance - 0.35); options.onCameraChange?.(getCameraState()); },
    zoomOut: () => { targetDistance = Math.min(6, targetDistance + 0.35); options.onCameraChange?.(getCameraState()); },
    deepZoom: () => { targetDistance = targetDistance < 1.65 ? homeDistance : 1.45; options.onCameraChange?.(getCameraState()); },
    resetView,
    getCameraState,
    pickWorldPoint: pick,
    get element() { return canvas; },
  };
}

function createShared(mobile) {
  return {
    plantGeometry: new THREE.ConeGeometry(mobile ? 0.011 : 0.013, mobile ? 0.029 : 0.036, mobile ? 4 : 6),
    grazerGeometry: new THREE.SphereGeometry(mobile ? 0.015 : 0.019, 6, 4),
    predatorGeometry: new THREE.SphereGeometry(mobile ? 0.019 : 0.024, 6, 4),
    apexGeometry: new THREE.SphereGeometry(mobile ? 0.024 : 0.031, 7, 5),
    weatherGeometry: new THREE.RingGeometry(0.018, 0.035, 10),
    volcanoGeometry: new THREE.ConeGeometry(0.018, 0.055, 6),
    plantMaterial: new THREE.MeshBasicMaterial({ color: 0x4fc66f }),
    podMaterial: new THREE.MeshBasicMaterial({ color: 0xdab65b }),
    grazerMaterial: new THREE.MeshBasicMaterial({ color: 0x75d9ff }),
    predatorMaterial: new THREE.MeshBasicMaterial({ color: 0xff705e }),
    apexMaterial: new THREE.MeshBasicMaterial({ color: 0xd294ff }),
    rainMaterial: new THREE.MeshBasicMaterial({ color: 0x64b9ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
    snowMaterial: new THREE.MeshBasicMaterial({ color: 0xeaf7ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
    stormMaterial: new THREE.MeshBasicMaterial({ color: 0x8f82d8, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false }),
    volcanoMaterial: new THREE.MeshBasicMaterial({ color: 0x704c3b }),
    activeVolcanoMaterial: new THREE.MeshBasicMaterial({ color: 0xff542e }),
  };
}

function makePlanetTexture(mobile) {
  const canvas = document.createElement('canvas');
  canvas.width = mobile ? 384 : 1024;
  canvas.height = mobile ? 192 : 512;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const [r, g, b] = hydrologyColor(biomeColor(samplePlanet(x, y, canvas.width, canvas.height)), sampleHydrology(x, y, canvas.width, canvas.height));
    const i = (y * canvas.width + x) * 4;
    image.data[i] = r; image.data[i + 1] = g; image.data[i + 2] = b; image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

function makeCloudTexture(mobile) {
  const canvas = document.createElement('canvas');
  canvas.width = mobile ? 256 : 768;
  canvas.height = mobile ? 128 : 384;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const n = (Math.sin(x / canvas.width * 31 + Math.sin(y / canvas.height * 17)) + Math.sin(x / canvas.width * 67 - y / canvas.height * 23) * 0.5 + Math.sin((x / canvas.width + y / canvas.height) * 113) * 0.25 + 1.75) / 3.5;
    const i = (y * canvas.width + x) * 4;
    image.data[i] = 245; image.data[i + 1] = 250; image.data[i + 2] = 255; image.data[i + 3] = Math.round(clamp((n - 0.52) * 4.2, 0, mobile ? 0.62 : 0.82) * 255);
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

function worldToSphere(x, y, width, height, radius) {
  const lon = (x / width - 0.5) * Math.PI * 2;
  const lat = (0.5 - y / height) * Math.PI;
  const cos = Math.cos(lat);
  return new THREE.Vector3(radius * cos * Math.cos(lon), radius * Math.sin(lat), radius * cos * Math.sin(lon));
}

function makeStars(count) {
  const geometry = new THREE.BufferGeometry();
  const values = [];
  for (let i = 0; i < count; i++) {
    const r = 12 + Math.random() * 18;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    values.push(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(values, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xffffff, size: 0.035, transparent: true, opacity: 0.82 }));
}

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
