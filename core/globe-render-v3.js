import * as THREE from 'three';
import { samplePlanet, biomeColor } from './planet.js';
import { sampleHydrology, hydrologyColor } from './hydrology.js';

export function createGlobeRenderer(container, dynamics, onInspect) {
  const mobile = matchMedia('(max-width: 700px), (pointer: coarse)').matches;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x01030a);

  const camera = new THREE.PerspectiveCamera(mobile ? 48 : 42, 1, 0.08, 100);
  camera.position.set(0, 0.25, mobile ? 3.65 : 3.25);

  const renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.3 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.replaceChildren(renderer.domElement);

  const globe = new THREE.Group();
  globe.rotation.x = -0.12;
  scene.add(globe);

  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(1, mobile ? 56 : 112, mobile ? 36 : 72),
    new THREE.MeshStandardMaterial({ map: makePlanetTexture(mobile), roughness: 0.88, metalness: 0.015 }),
  );
  globe.add(planet);

  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(1.025, mobile ? 48 : 96, mobile ? 30 : 60),
    new THREE.MeshLambertMaterial({ map: makeCloudTexture(mobile), transparent: true, opacity: 0.48, depthWrite: false }),
  );
  globe.add(clouds);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.065, mobile ? 32 : 64, mobile ? 24 : 48),
    new THREE.MeshBasicMaterial({ color: 0x63aaff, transparent: true, opacity: 0.085, side: THREE.BackSide, blending: THREE.AdditiveBlending }),
  );
  globe.add(atmosphere);

  const entityLayer = new THREE.Group();
  const weatherLayer = new THREE.Group();
  const geologyLayer = new THREE.Group();
  globe.add(entityLayer, weatherLayer, geologyLayer);

  const ambient = new THREE.HemisphereLight(0x829dcc, 0x070b18, 0.52);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xfff3d6, 3.2);
  scene.add(sun);
  scene.add(makeStars(mobile ? 550 : 1500));

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const activePointers = new Map();
  let lastWorld = null;
  let targetDistance = mobile ? 3.65 : 3.25;
  let lastPinch = 0;
  let lastX = 0;
  let lastY = 0;
  let dragging = false;
  let pointerMoved = false;

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
    syncWeather(world);
    syncGeology(world);
  }

  function animate() {
    requestAnimationFrame(animate);
    const t = dynamics.getTime();
    const dayAngle = t * 0.018;
    sun.position.set(Math.cos(dayAngle) * 4, Math.sin(dayAngle * 0.37) * 1.8, Math.sin(dayAngle) * 4);
    clouds.rotation.y += mobile ? 0.00028 : 0.00048;
    clouds.rotation.z = Math.sin(t * 0.002) * 0.018;
    if (!dragging && !activePointers.size && targetDistance > 1.55) globe.rotation.y += mobile ? 0.00028 : 0.00055;
    camera.position.setLength(targetDistance);
    renderer.render(scene, camera);
  }
  animate();

  function syncEntities(world) {
    clearLayer(entityLayer);
    const c = world.ecs.components;
    for (const [id, resource] of c.resource.entries()) {
      const p = c.position.get(id);
      if (p && resource.amount > 0) addTree(p, world, resource.kind === 'pod' ? 0xdab65b : 0x4fc66f);
    }
    for (const [id] of c.agent.entries()) {
      const p = c.position.get(id);
      if (p) addAnimal(p, world, 0x75d9ff, 0.018);
    }
    for (const [id] of c.predator.entries()) {
      const p = c.position.get(id);
      if (p) addAnimal(p, world, 0xff705e, 0.024);
    }
    for (const [id] of c.apex.entries()) {
      const p = c.position.get(id);
      if (p) addAnimal(p, world, 0xd294ff, 0.031);
    }
  }

  function addTree(pos, world, color) {
    const group = new THREE.Group();
    const scale = targetDistance < 1.6 ? 0.72 : 1;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.003 * scale, 0.004 * scale, 0.018 * scale, 5), new THREE.MeshBasicMaterial({ color: 0x70502c }));
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.012 * scale, 0.034 * scale, 6), new THREE.MeshBasicMaterial({ color }));
    trunk.position.y = 0.009 * scale;
    crown.position.y = 0.032 * scale;
    group.add(trunk, crown);
    placeSurface(group, pos, world, 1.015);
    entityLayer.add(group);
  }

  function addAnimal(pos, world, color, size) {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(size * 0.45, size, 3, 6), new THREE.MeshBasicMaterial({ color }));
    placeSurface(mesh, pos, world, 1.018);
    entityLayer.add(mesh);
  }

  function syncWeather(world) {
    clearLayer(weatherLayer);
    for (const system of dynamics.getWeather()) {
      if (system.type === 'cloud') continue;
      const color = system.type === 'snow' ? 0xeaf7ff : system.type === 'storm' ? 0x8f82d8 : 0x64b9ff;
      const opacity = system.type === 'storm' ? 0.75 : 0.5;
      const marker = new THREE.Mesh(
        new THREE.RingGeometry(0.018, 0.026 + system.strength * 0.018, 12),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }),
      );
      placeSurface(marker, system, world, 1.032);
      weatherLayer.add(marker);
    }
  }

  function syncGeology(world) {
    clearLayer(geologyLayer);
    for (const site of dynamics.getGeology()) {
      if (site.type === 'volcano') {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.055, 7), new THREE.MeshBasicMaterial({ color: site.activity > 0.75 ? 0xff542e : 0x704c3b }));
        placeSurface(cone, site, world, 1.012);
        geologyLayer.add(cone);
      }
    }
  }

  function placeSurface(object, pos, world, radius) {
    const vector = worldToSphere(pos.x, pos.y, world.width, world.height, radius);
    object.position.copy(vector);
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vector.clone().normalize());
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
    pointerMoved = false;
    lastX = event.clientX;
    lastY = event.clientY;
    lastPinch = 0;
  });
  canvas.addEventListener('pointermove', event => {
    if (!activePointers.has(event.pointerId)) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...activePointers.values()];
    if (points.length >= 2) {
      const d = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      if (lastPinch) targetDistance = clamp(targetDistance - (d - lastPinch) * 0.008, 1.2, 6);
      lastPinch = d;
      return;
    }
    if (canvas.dataset.brush === 'on') return;
    if (Math.abs(event.clientX - lastX) + Math.abs(event.clientY - lastY) > 3) pointerMoved = true;
    globe.rotation.y += (event.clientX - lastX) * 0.006;
    globe.rotation.x = clamp(globe.rotation.x + (event.clientY - lastY) * 0.004, -1.2, 1.2);
    lastX = event.clientX;
    lastY = event.clientY;
  });
  function end(event) {
    const wasSingle = activePointers.size === 1;
    activePointers.delete(event.pointerId);
    if (!activePointers.size) {
      dragging = false;
      lastPinch = 0;
      if (wasSingle && !pointerMoved && canvas.dataset.brush !== 'on') {
        const point = pick(event.clientX, event.clientY);
        if (point) onInspect?.(dynamics.inspect(point.x, point.y));
      }
    }
  }
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    targetDistance = clamp(targetDistance + Math.sign(event.deltaY) * 0.25, 1.2, 6);
  }, { passive: false });

  window.addEventListener('resize', resize, { passive: true });

  return {
    render,
    zoomIn: () => { targetDistance = Math.max(1.2, targetDistance - 0.35); },
    zoomOut: () => { targetDistance = Math.min(6, targetDistance + 0.35); },
    deepZoom: () => { targetDistance = targetDistance < 1.6 ? (mobile ? 3.65 : 3.25) : 1.27; },
    pickWorldPoint: pick,
    get element() { return canvas; },
  };
}

function makePlanetTexture(mobile) {
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
      image.data[i] = r; image.data[i + 1] = g; image.data[i + 2] = b; image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

function makeCloudTexture(mobile) {
  const canvas = document.createElement('canvas');
  canvas.width = mobile ? 512 : 1024;
  canvas.height = mobile ? 256 : 512;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const n = layeredNoise(x / canvas.width, y / canvas.height);
      const latitude = Math.abs(y / canvas.height - 0.5) * 2;
      const alpha = clamp((n - 0.52) * 4.2, 0, 0.82) * (0.65 + latitude * 0.25);
      const i = (y * canvas.width + x) * 4;
      image.data[i] = 245; image.data[i + 1] = 250; image.data[i + 2] = 255; image.data[i + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

function layeredNoise(x, y) {
  return (Math.sin(x * 31 + Math.sin(y * 17)) + Math.sin(x * 67 - y * 23) * 0.5 + Math.sin((x + y) * 113) * 0.25 + 1.75) / 3.5;
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

function clearLayer(layer) {
  while (layer.children.length) {
    const child = layer.children.pop();
    child.geometry?.dispose();
    child.material?.dispose();
  }
}

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
