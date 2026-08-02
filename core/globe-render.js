import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

export function createGlobeRenderer(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02040a);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0.35, 3.25);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.replaceChildren(renderer.domElement);

  const globeGroup = new THREE.Group();
  globeGroup.rotation.x = -0.12;
  scene.add(globeGroup);

  const radius = 1;
  const texture = makePlanetTexture();
  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 96, 64),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.86, metalness: 0.02 }),
  );
  globeGroup.add(planet);

  const grid = new THREE.LineSegments(
    new THREE.WireframeGeometry(new THREE.SphereGeometry(radius * 1.002, 24, 16)),
    new THREE.LineBasicMaterial({ color: 0x8bb7ff, transparent: true, opacity: 0.10 }),
  );
  globeGroup.add(grid);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.055, 64, 48),
    new THREE.MeshBasicMaterial({
      color: 0x66aaff,
      transparent: true,
      opacity: 0.075,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  globeGroup.add(atmosphere);

  const entityGroup = new THREE.Group();
  globeGroup.add(entityGroup);

  scene.add(new THREE.HemisphereLight(0x9fc7ff, 0x102030, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.position.set(3.5, 2.2, 4);
  scene.add(sun);

  const stars = makeStars();
  scene.add(stars);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let lastWorld = null;
  let targetDistance = 3.25;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function resize() {
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
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
    if (!dragging) globeGroup.rotation.y += 0.0007;
    renderer.render(scene, camera);
  }
  animate();

  function syncEntities(world) {
    entityGroup.clear();
    const { position, agent, predator, apex, resource, forceField } = world.ecs.components;

    for (const [id, res] of resource.entries()) {
      const pos = position.get(id);
      if (!pos || res.amount <= 0) continue;
      addMarker(pos, world, res.kind === 'pod' ? 0xffd166 : 0x55dd88, 0.010 + res.amount * 0.006);
    }
    for (const [id] of agent.entries()) {
      const pos = position.get(id);
      if (pos) addMarker(pos, world, 0x5fd7ff, 0.022);
    }
    for (const [id] of predator.entries()) {
      const pos = position.get(id);
      if (pos) addMarker(pos, world, 0xff5c67, 0.030);
    }
    for (const [id] of apex.entries()) {
      const pos = position.get(id);
      if (pos) addMarker(pos, world, 0xc890ff, 0.042);
    }
    for (const [id, field] of forceField.entries()) {
      const pos = position.get(id);
      if (pos) addMarker(pos, world, field.strength < 0 ? 0xff8844 : 0x66ffff, 0.028, true);
    }
  }

  function addMarker(pos, world, color, size, glow = false) {
    const p = worldToSphere(pos.x, pos.y, world.width, world.height, radius + 0.018);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(size, 10, 8),
      new THREE.MeshBasicMaterial({ color, transparent: glow, opacity: glow ? 0.72 : 1 }),
    );
    mesh.position.copy(p);
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

  function zoomIn() {
    targetDistance = Math.max(1.7, targetDistance - 0.35);
  }

  function zoomOut() {
    targetDistance = Math.min(6, targetDistance + 0.35);
  }

  renderer.domElement.addEventListener('pointerdown', (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    renderer.domElement.setPointerCapture?.(event.pointerId);
  });
  renderer.domElement.addEventListener('pointermove', (event) => {
    if (!dragging || renderer.domElement.dataset.brush === 'on') return;
    globeGroup.rotation.y += (event.clientX - lastX) * 0.006;
    globeGroup.rotation.x += (event.clientY - lastY) * 0.004;
    globeGroup.rotation.x = Math.max(-1.2, Math.min(1.2, globeGroup.rotation.x));
    lastX = event.clientX;
    lastY = event.clientY;
  });
  window.addEventListener('pointerup', () => { dragging = false; });
  renderer.domElement.addEventListener('wheel', (event) => {
    event.preventDefault();
    targetDistance = Math.max(1.7, Math.min(6, targetDistance + Math.sign(event.deltaY) * 0.25));
  }, { passive: false });

  return {
    render,
    zoomIn,
    zoomOut,
    pickWorldPoint,
    get element() { return renderer.domElement; },
  };
}

function worldToSphere(x, y, width, height, radius) {
  const lon = (x / width - 0.5) * Math.PI * 2;
  const lat = (0.5 - y / height) * Math.PI;
  const cosLat = Math.cos(lat);
  return new THREE.Vector3(
    radius * cosLat * Math.cos(lon),
    radius * Math.sin(lat),
    radius * cosLat * Math.sin(lon),
  );
}

function makePlanetTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  const ocean = ctx.createLinearGradient(0, 0, 0, canvas.height);
  ocean.addColorStop(0, '#18365f');
  ocean.addColorStop(0.5, '#0c5b79');
  ocean.addColorStop(1, '#102b52');
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const rng = mulberry32(734221);
  for (let continent = 0; continent < 28; continent++) {
    const cx = rng() * canvas.width;
    const cy = 70 + rng() * (canvas.height - 140);
    const base = 34 + rng() * 95;
    ctx.fillStyle = rng() > 0.3 ? '#3f7d4d' : '#7b8f54';
    ctx.beginPath();
    for (let i = 0; i < 18; i++) {
      const angle = i / 18 * Math.PI * 2;
      const wobble = 0.55 + rng() * 0.75;
      const rx = base * wobble;
      const ry = base * (0.45 + rng() * 0.45);
      const px = cx + Math.cos(angle) * rx;
      const py = cy + Math.sin(angle) * ry;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = 'rgba(235,245,255,0.82)';
  ctx.fillRect(0, 0, canvas.width, 34);
  ctx.fillRect(0, canvas.height - 34, canvas.width, 34);

  for (let i = 0; i < 1800; i++) {
    const x = rng() * canvas.width;
    const y = rng() * canvas.height;
    ctx.fillStyle = `rgba(255,255,255,${rng() * 0.06})`;
    ctx.fillRect(x, y, 1, 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

function makeStars() {
  const geometry = new THREE.BufferGeometry();
  const values = [];
  for (let i = 0; i < 1400; i++) {
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
