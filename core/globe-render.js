import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

export function createGlobeRenderer(container) {
  const mobile = matchMedia('(max-width: 700px), (pointer: coarse)').matches;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02040a);

  const camera = new THREE.PerspectiveCamera(mobile ? 48 : 42, 1, 0.1, 100);
  camera.position.set(0, 0.25, mobile ? 3.65 : 3.25);

  const renderer = new THREE.WebGLRenderer({ antialias: !mobile, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.35 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.replaceChildren(renderer.domElement);

  const globeGroup = new THREE.Group();
  globeGroup.rotation.x = -0.12;
  scene.add(globeGroup);

  const radius = 1;
  const segments = mobile ? 48 : 96;
  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(radius, segments, mobile ? 32 : 64),
    new THREE.MeshStandardMaterial({ map: makePlanetTexture(mobile), roughness: 0.86, metalness: 0.02 }),
  );
  globeGroup.add(planet);

  const grid = new THREE.LineSegments(
    new THREE.WireframeGeometry(new THREE.SphereGeometry(radius * 1.002, mobile ? 16 : 24, mobile ? 10 : 16)),
    new THREE.LineBasicMaterial({ color: 0x8bb7ff, transparent: true, opacity: 0.09 }),
  );
  globeGroup.add(grid);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.055, mobile ? 32 : 64, mobile ? 24 : 48),
    new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0.075, side: THREE.BackSide, blending: THREE.AdditiveBlending }),
  );
  globeGroup.add(atmosphere);

  const entityGroup = new THREE.Group();
  globeGroup.add(entityGroup);

  scene.add(new THREE.HemisphereLight(0x9fc7ff, 0x102030, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.position.set(3.5, 2.2, 4);
  scene.add(sun);
  scene.add(makeStars(mobile ? 550 : 1400));

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const activePointers = new Map();
  let lastWorld = null;
  let targetDistance = mobile ? 3.65 : 3.25;
  let lastPinchDistance = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function resize() {
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
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
    if (!dragging && activePointers.size === 0) globeGroup.rotation.y += mobile ? 0.00035 : 0.0007;
    camera.position.setLength(targetDistance);
    renderer.render(scene, camera);
  }
  animate();

  function syncEntities(world) {
    entityGroup.clear();
    const { position, agent, predator, apex, resource, forceField } = world.ecs.components;
    for (const [id, res] of resource.entries()) {
      const pos = position.get(id);
      if (pos && res.amount > 0) addMarker(pos, world, res.kind === 'pod' ? 0xffd166 : 0x55dd88, mobile ? 0.018 : 0.014);
    }
    for (const [id] of agent.entries()) {
      const pos = position.get(id);
      if (pos) addMarker(pos, world, 0x5fd7ff, mobile ? 0.030 : 0.022);
    }
    for (const [id] of predator.entries()) {
      const pos = position.get(id);
      if (pos) addMarker(pos, world, 0xff5c67, mobile ? 0.038 : 0.030);
    }
    for (const [id] of apex.entries()) {
      const pos = position.get(id);
      if (pos) addMarker(pos, world, 0xc890ff, mobile ? 0.050 : 0.042);
    }
    for (const [id, field] of forceField.entries()) {
      const pos = position.get(id);
      if (pos) addMarker(pos, world, field.strength < 0 ? 0xff8844 : 0x66ffff, mobile ? 0.040 : 0.028, true);
    }
  }

  function addMarker(pos, world, color, size, glow = false) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(size, mobile ? 6 : 10, mobile ? 5 : 8),
      new THREE.MeshBasicMaterial({ color, transparent: glow, opacity: glow ? 0.72 : 1 }),
    );
    mesh.position.copy(worldToSphere(pos.x, pos.y, world.width, world.height, radius + 0.018));
    entityGroup.add(mesh);
  }

  function pickWorldPoint(clientX, clientY) {
    if (!lastWorld) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(planet, false)[0];
    if (!hit) return null;
    const local = globeGroup.worldToLocal(hit.point.clone()).normalize();
    const lat = Math.asin(local.y);
    const lon = Math.atan2(local.z, local.x);
    return {
      x: ((lon / (Math.PI * 2)) + 0.5) * lastWorld.width,
      y: (0.5 - lat / Math.PI) * lastWorld.height,
    };
  }

  function zoomIn() { targetDistance = Math.max(1.75, targetDistance - 0.35); }
  function zoomOut() { targetDistance = Math.min(6, targetDistance + 0.35); }

  const canvas = renderer.domElement;
  canvas.style.touchAction = 'none';

  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture?.(event.pointerId);
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    lastPinchDistance = 0;
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!activePointers.has(event.pointerId)) return;
    event.preventDefault();
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const points = [...activePointers.values()];
    if (points.length >= 2) {
      const dx = points[0].x - points[1].x;
      const dy = points[0].y - points[1].y;
      const distance = Math.hypot(dx, dy);
      if (lastPinchDistance) {
        targetDistance = Math.max(1.75, Math.min(6, targetDistance - (distance - lastPinchDistance) * 0.008));
      }
      lastPinchDistance = distance;
      return;
    }

    if (canvas.dataset.brush === 'on') return;
    globeGroup.rotation.y += (event.clientX - lastX) * 0.006;
    globeGroup.rotation.x += (event.clientY - lastY) * 0.004;
    globeGroup.rotation.x = Math.max(-1.2, Math.min(1.2, globeGroup.rotation.x));
    lastX = event.clientX;
    lastY = event.clientY;
  }, { passive: false });

  function endPointer(event) {
    activePointers.delete(event.pointerId);
    if (activePointers.size === 0) {
      dragging = false;
      lastPinchDistance = 0;
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('lostpointercapture', endPointer);

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    targetDistance = Math.max(1.75, Math.min(6, targetDistance + Math.sign(event.deltaY) * 0.25));
  }, { passive: false });

  window.addEventListener('resize', resize, { passive: true });
  window.visualViewport?.addEventListener('resize', resize, { passive: true });

  return { render, zoomIn, zoomOut, pickWorldPoint, get element() { return canvas; } };
}

function worldToSphere(x, y, width, height, radius) {
  const lon = (x / width - 0.5) * Math.PI * 2;
  const lat = (0.5 - y / height) * Math.PI;
  const cosLat = Math.cos(lat);
  return new THREE.Vector3(radius * cosLat * Math.cos(lon), radius * Math.sin(lat), radius * cosLat * Math.sin(lon));
}

function makePlanetTexture(mobile) {
  const canvas = document.createElement('canvas');
  canvas.width = mobile ? 512 : 1024;
  canvas.height = mobile ? 256 : 512;
  const ctx = canvas.getContext('2d');
  const ocean = ctx.createLinearGradient(0, 0, 0, canvas.height);
  ocean.addColorStop(0, '#18365f');
  ocean.addColorStop(0.5, '#0c5b79');
  ocean.addColorStop(1, '#102b52');
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const rng = mulberry32(734221);
  for (let continent = 0; continent < 24; continent++) {
    const cx = rng() * canvas.width;
    const cy = 35 + rng() * (canvas.height - 70);
    const base = (18 + rng() * 52) * (canvas.width / 512);
    ctx.fillStyle = rng() > 0.3 ? '#3f7d4d' : '#7b8f54';
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const angle = i / 16 * Math.PI * 2;
      const px = cx + Math.cos(angle) * base * (0.55 + rng() * 0.75);
      const py = cy + Math.sin(angle) * base * (0.45 + rng() * 0.45);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = 'rgba(235,245,255,0.82)';
  const cap = Math.max(18, canvas.height * 0.065);
  ctx.fillRect(0, 0, canvas.width, cap);
  ctx.fillRect(0, canvas.height - cap, canvas.width, cap);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
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

function mulberry32(seed) {
  return function random() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
