import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
import { samplePlanet, biomeColor } from './planet.js';
import { sampleHydrology, hydrologyColor } from './hydrology.js';

export function createGlobeRenderer(container) {
  const mobile = matchMedia('(max-width: 700px), (pointer: coarse)').matches;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02040a);

  const camera = new THREE.PerspectiveCamera(mobile ? 48 : 42, 1, 0.1, 100);
  camera.position.set(0, 0.25, mobile ? 3.65 : 3.25);

  const renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.35 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.replaceChildren(renderer.domElement);

  const globe = new THREE.Group();
  globe.rotation.x = -0.12;
  scene.add(globe);

  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(1, mobile ? 56 : 112, mobile ? 36 : 72),
    new THREE.MeshStandardMaterial({ map: makeBiomeTexture(mobile), roughness: 0.9, metalness: 0.01 }),
  );
  globe.add(planet);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.055, mobile ? 32 : 64, mobile ? 24 : 48),
    new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0.075, side: THREE.BackSide, blending: THREE.AdditiveBlending }),
  );
  globe.add(atmosphere);

  const entities = new THREE.Group();
  globe.add(entities);

  scene.add(new THREE.HemisphereLight(0xa9d0ff, 0x10182a, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 2.7);
  sun.position.set(3.5, 2.1, 4.2);
  scene.add(sun);
  scene.add(makeStars(mobile ? 500 : 1300));

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const activePointers = new Map();
  let lastWorld = null;
  let targetDistance = mobile ? 3.65 : 3.25;
  let lastPinch = 0;
  let lastX = 0;
  let lastY = 0;
  let dragging = false;

  function resize() {
    const rect = container.getBoundingClientRect();
    renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
    camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
    camera.updateProjectionMatrix();
  }

  function render(world) {
    lastWorld = world;
    resize();
    syncEntities(world);
    camera.position.setLength(targetDistance);
    renderer.render(scene, camera);
  }

  function animate() {
    requestAnimationFrame(animate);
    if (!dragging && activePointers.size === 0 && targetDistance > 1.55) globe.rotation.y += mobile ? 0.00035 : 0.0007;
    camera.position.setLength(targetDistance);
    renderer.render(scene, camera);
  }
  animate();

  function syncEntities(world) {
    entities.clear();
    const { position, agent, predator, apex, resource, forceField } = world.ecs.components;
    for (const [id, res] of resource.entries()) {
      const p = position.get(id);
      if (p && res.amount > 0) marker(p, world, res.kind === 'pod' ? 0xffd166 : 0x66e08d, mobile ? 0.018 : 0.014);
    }
    for (const [id] of agent.entries()) {
      const p = position.get(id);
      if (p) marker(p, world, 0x5fd7ff, mobile ? 0.030 : 0.022);
    }
    for (const [id] of predator.entries()) {
      const p = position.get(id);
      if (p) marker(p, world, 0xff5c67, mobile ? 0.038 : 0.030);
    }
    for (const [id] of apex.entries()) {
      const p = position.get(id);
      if (p) marker(p, world, 0xc890ff, mobile ? 0.050 : 0.042);
    }
    for (const [id, field] of forceField.entries()) {
      const p = position.get(id);
      if (p) marker(p, world, field.strength < 0 ? 0xff8844 : 0x66ffff, mobile ? 0.040 : 0.028, true);
    }
  }

  function marker(pos, world, color, size, glow = false) {
    const closeScale = targetDistance < 1.6 ? 0.72 : 1;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(size * closeScale, mobile ? 6 : 10, mobile ? 5 : 8),
      new THREE.MeshBasicMaterial({ color, transparent: glow, opacity: glow ? 0.72 : 1 }),
    );
    mesh.position.copy(worldToSphere(pos.x, pos.y, world.width, world.height, 1.018));
    entities.add(mesh);
  }

  function pickWorldPoint(clientX, clientY) {
    if (!lastWorld) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(planet, false)[0];
    if (!hit) return null;
    const local = globe.worldToLocal(hit.point.clone()).normalize();
    const lat = Math.asin(local.y);
    const lon = Math.atan2(local.z, local.x);
    return { x: ((lon / (Math.PI * 2)) + 0.5) * lastWorld.width, y: (0.5 - lat / Math.PI) * lastWorld.height };
  }

  const canvas = renderer.domElement;
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', event => {
    event.preventDefault();
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture?.(event.pointerId);
    dragging = true;
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
      if (lastPinch) targetDistance = clamp(targetDistance - (d - lastPinch) * 0.008, 1.22, 6);
      lastPinch = d;
      return;
    }
    if (canvas.dataset.brush === 'on') return;
    globe.rotation.y += (event.clientX - lastX) * 0.006;
    globe.rotation.x = clamp(globe.rotation.x + (event.clientY - lastY) * 0.004, -1.2, 1.2);
    lastX = event.clientX;
    lastY = event.clientY;
  }, { passive: false });

  function end(event) {
    activePointers.delete(event.pointerId);
    if (!activePointers.size) { dragging = false; lastPinch = 0; }
  }
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('lostpointercapture', end);
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    targetDistance = clamp(targetDistance + Math.sign(event.deltaY) * 0.25, 1.22, 6);
  }, { passive: false });

  window.addEventListener('resize', resize, { passive: true });
  window.visualViewport?.addEventListener('resize', resize, { passive: true });

  return {
    render,
    zoomIn: () => { targetDistance = Math.max(1.22, targetDistance - 0.35); },
    zoomOut: () => { targetDistance = Math.min(6, targetDistance + 0.35); },
    deepZoom: () => { targetDistance = targetDistance < 1.6 ? (mobile ? 3.65 : 3.25) : 1.28; },
    pickWorldPoint,
    get element() { return canvas; },
  };
}

function makeBiomeTexture(mobile) {
  const canvas = document.createElement('canvas');
  canvas.width = mobile ? 512 : 1024;
  canvas.height = mobile ? 256 : 512;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const planet = samplePlanet(x, y, canvas.width, canvas.height);
      const hydro = sampleHydrology(x, y, canvas.width, canvas.height);
      const [r, g, b] = hydrologyColor(biomeColor(planet), hydro);
      const i = (y * canvas.width + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = mobile ? 2 : 8;
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
  return new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xffffff, size: 0.035, transparent: true, opacity: 0.8 }));
}

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
