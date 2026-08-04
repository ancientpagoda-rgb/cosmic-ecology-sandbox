import * as THREE from 'three';

const PATCH_SIZE = 0.9;

export function createCivilizationVisuals(container, groundLevel, civilization, options = {}) {
  const mobile = Boolean(options.mobile);
  const worldWidth = options.worldWidth || 1200;
  const worldHeight = options.worldHeight || 720;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x9fb3b5, mobile ? 0.205 : 0.145);
  const camera = new THREE.PerspectiveCamera(mobile ? 54 : 48, 1, 0.008, 15);
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: !mobile,
    powerPreference: mobile ? 'low-power' : 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1 : 1.4));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = 'civilization-spatial-layer';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.domElement.style.cssText = 'position:fixed;inset:0;z-index:7;width:100%;height:100%;pointer-events:none;opacity:0;transition:opacity .25s ease';
  document.body.append(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xc6dfff, 0x0b1115, 1.1));
  const sun = new THREE.DirectionalLight(0xffe9bf, 2.15);
  sun.position.set(3, 4, 2);
  scene.add(sun);

  const root = new THREE.Group();
  const communityRoot = new THREE.Group();
  const routeRoot = new THREE.Group();
  root.add(routeRoot, communityRoot);
  scene.add(root);

  const communityMeshes = new Map();
  const routeMeshes = new Map();
  let lastWidth = 0;
  let lastHeight = 0;
  let lastSync = -Infinity;

  function render(frame = {}) {
    const ground = groundLevel.getState();
    const active = Boolean(ground.active && civilization.getState().communities > 0);
    renderer.domElement.style.opacity = active ? '1' : '0';
    if (!active) return;

    const timestamp = frame.timestamp ?? performance.now();
    if (timestamp - lastSync > (mobile ? 900 : 520)) {
      lastSync = timestamp;
      synchronize(ground);
    }
    animate(timestamp * 0.001);
    resize();
    configureCamera(ground);
    renderer.render(scene, camera);
  }

  function synchronize(ground) {
    const level = ground.terrain.level || 7;
    const navigation = ground.navigation;
    const communities = civilization.getCommunities();
    const routes = civilization.getRoutes();
    const radius = mobile ? 3.15 : 4.7;
    const cap = mobile ? 10 : 28;
    const nearby = communities
      .filter(community => community.status !== 'abandoned')
      .map(community => ({ community, local: geoToLocal(community, navigation, level, worldWidth, worldHeight) }))
      .filter(item => Math.hypot(item.local.x, item.local.z) < radius)
      .sort((a, b) => Math.hypot(a.local.x, a.local.z) - Math.hypot(b.local.x, b.local.z))
      .slice(0, cap);
    const selected = new Set();

    for (const { community, local } of nearby) {
      selected.add(community.id);
      let mesh = communityMeshes.get(community.id);
      if (!mesh) {
        mesh = buildCommunity(community, mobile);
        communityMeshes.set(community.id, mesh);
        communityRoot.add(mesh);
      }
      updateCommunity(mesh, community);
      mesh.position.set(local.x, localGroundY(local, ground), local.z);
    }
    for (const [id, mesh] of communityMeshes) {
      if (selected.has(id)) continue;
      communityRoot.remove(mesh);
      disposeObject(mesh);
      communityMeshes.delete(id);
    }

    const byId = new Map(nearby.map(item => [item.community.id, item]));
    const routeSelected = new Set();
    for (const route of routes) {
      const from = byId.get(route.from);
      const to = byId.get(route.to);
      if (!from || !to) continue;
      routeSelected.add(route.id);
      let line = routeMeshes.get(route.id);
      if (!line) {
        line = new THREE.Line(
          new THREE.BufferGeometry(),
          new THREE.LineBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false }),
        );
        line.userData.phase = (hashString(route.id) % 1000) / 100;
        routeMeshes.set(route.id, line);
        routeRoot.add(line);
      }
      updateRoute(line, route, from.local, to.local, ground);
    }
    for (const [id, line] of routeMeshes) {
      if (routeSelected.has(id)) continue;
      routeRoot.remove(line);
      disposeObject(line);
      routeMeshes.delete(id);
    }
  }

  function buildCommunity(community, isMobile) {
    const group = new THREE.Group();
    const hue = hashString(community.cultureId || community.id) % 360;
    const wall = new THREE.MeshStandardMaterial({ color: new THREE.Color(`hsl(${hue} 34% 45%)`), roughness: 0.94 });
    const roof = new THREE.MeshStandardMaterial({ color: new THREE.Color(`hsl(${wrap(hue + 48, 360)} 52% 57%)`), roughness: 0.84 });
    const earth = new THREE.MeshStandardMaterial({ color: 0x8a7657, roughness: 1 });
    const crop = new THREE.MeshStandardMaterial({ color: 0x718d3d, roughness: 1 });
    const water = new THREE.MeshStandardMaterial({ color: 0x477b91, roughness: 0.42 });
    const buildings = [];

    for (let index = 0; index < (isMobile ? 2 : 4); index++) {
      const path = new THREE.Mesh(new THREE.PlaneGeometry(0.025, 0.34), earth);
      path.rotation.x = -Math.PI * 0.5;
      path.rotation.z = index / (isMobile ? 2 : 4) * Math.PI;
      path.position.y = 0.002;
      group.add(path);
    }

    const maxBuildings = isMobile ? 5 : 12;
    for (let index = 0; index < maxBuildings; index++) {
      const angle = index * 2.399963;
      const radius = 0.055 + Math.sqrt(index) * 0.045;
      const building = new THREE.Group();
      building.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.029, 0.05, isMobile ? 6 : 9), wall);
      body.position.y = 0.026;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.039, 0.042, isMobile ? 6 : 9), roof);
      cap.position.y = 0.07;
      building.add(body, cap);
      buildings.push(building);
      group.add(building);
    }

    const granary = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.064, 0.055, 0.05), wall);
    box.position.y = 0.034;
    const granaryRoof = new THREE.Mesh(new THREE.ConeGeometry(0.052, 0.035, 4), roof);
    granaryRoof.rotation.y = Math.PI * 0.25;
    granaryRoof.position.y = 0.078;
    granary.add(box, granaryRoof);
    granary.position.set(-0.11, 0, 0.07);
    group.add(granary);

    const field = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1), crop);
    field.rotation.x = -Math.PI * 0.5;
    field.position.set(0.15, 0.003, 0.09);
    group.add(field);

    const reservoir = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.008, 18), water);
    reservoir.position.set(0.13, 0.006, -0.1);
    group.add(reservoir);

    const hearth = new THREE.Mesh(
      new THREE.SphereGeometry(0.014, 7, 5),
      new THREE.MeshBasicMaterial({ color: 0xffa74d, transparent: true, opacity: 0.8 }),
    );
    hearth.position.y = 0.016;
    group.add(hearth);

    group.userData = {
      buildings,
      granary,
      field,
      reservoir,
      hearth,
      phase: (hashString(community.id) % 1000) / 100,
    };
    group.traverse(object => { if (object.isMesh) object.castShadow = true; });
    return group;
  }

  function updateCommunity(mesh, community) {
    const scale = clamp(Math.sqrt(Math.max(1, community.population)) / 4, 0.55, 1.5) * (0.72 + community.stability * 0.28);
    mesh.scale.setScalar(scale);
    const count = Math.max(1, Math.min(mesh.userData.buildings.length, Math.ceil(community.population / 2)));
    mesh.userData.buildings.forEach((building, index) => { building.visible = index < count; });
    mesh.userData.granary.visible = community.technologies.includes('storage');
    mesh.userData.field.visible = community.technologies.includes('agriculture');
    mesh.userData.reservoir.visible = community.technologies.includes('sanitation') || community.technologies.includes('irrigation');
    mesh.userData.hearth.visible = community.technologies.includes('fire');
  }

  function updateRoute(line, route, from, to, ground) {
    const start = new THREE.Vector3(from.x, localGroundY(from, ground) + 0.012, from.z);
    const end = new THREE.Vector3(to.x, localGroundY(to, ground) + 0.012, to.z);
    const middle = new THREE.Vector3(
      (from.x + to.x) * 0.5,
      Math.max(start.y, end.y) + 0.035 + Math.hypot(to.x - from.x, to.z - from.z) * 0.06,
      (from.z + to.z) * 0.5,
    );
    const curve = new THREE.QuadraticBezierCurve3(start, middle, end);
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(mobile ? 10 : 20));
    line.userData.flow = route.flow || 0;
    line.material.color.set(route.kind === 'conflict' ? 0xff715f : route.kind === 'alliance' ? 0x92b7ff : 0xe6c66c);
  }

  function animate(time) {
    for (const mesh of communityMeshes.values()) {
      const pulse = 0.82 + Math.sin(time * 5.2 + mesh.userData.phase) * 0.18;
      mesh.userData.hearth.scale.setScalar(pulse);
      mesh.userData.hearth.material.opacity = 0.48 + pulse * 0.3;
    }
    for (const line of routeMeshes.values()) {
      line.material.opacity = 0.18 + (line.userData.flow || 0) * 0.26 + Math.sin(time * 1.5 + line.userData.phase) * 0.05;
    }
  }

  function configureCamera(ground) {
    const navigation = ground.navigation;
    const floorY = ground.terrain.surface?.floorY || 0;
    const pitch = clamp(navigation.pitch ?? -0.08, -0.55, 0.34);
    const cameraDistance = clamp(navigation.cameraDistance ?? 0.46, 0, 0.74);
    root.rotation.y = navigation.heading ?? 0;
    if (cameraDistance < 0.08) {
      const eyeY = floorY + 0.17;
      camera.position.set(0, eyeY, 0.018);
      camera.lookAt(0, eyeY + Math.sin(pitch) * 0.8, -Math.max(0.35, Math.cos(pitch)));
    } else {
      camera.position.set(0, floorY + 0.24 + cameraDistance * 0.18, 0.18 + cameraDistance);
      camera.lookAt(0, floorY + 0.11 + pitch * 0.32, -0.2);
    }
  }

  function localGroundY(local, ground) {
    const surface = ground.terrain.surface || {};
    return (surface.floorY || 0) + local.x * (surface.slopeX || 0) + local.z * (surface.slopeZ || 0) + 0.004;
  }

  function resize() {
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width || innerWidth));
    const height = Math.max(1, Math.floor(rect.height || innerHeight));
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width;
    lastHeight = height;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function destroy() {
    for (const mesh of communityMeshes.values()) disposeObject(mesh);
    for (const mesh of routeMeshes.values()) disposeObject(mesh);
    renderer.dispose();
    renderer.domElement.remove();
  }

  return { render, destroy };
}

function geoToLocal(point, navigation, level, worldWidth, worldHeight) {
  const u = wrap((point.x ?? 0) / worldWidth, 1);
  const v = clamp((point.y ?? 0) / worldHeight, 0, 1);
  const units = PATCH_SIZE * (2 ** level);
  return { x: turnDelta(u, navigation.u) * units, z: (v - navigation.v) * units };
}
function turnDelta(value, reference) { let delta = value - reference; if (delta > 0.5) delta -= 1; if (delta < -0.5) delta += 1; return delta; }
function disposeObject(root) { root.traverse?.(object => { object.geometry?.dispose?.(); if (Array.isArray(object.material)) object.material.forEach(material => material.dispose?.()); else object.material?.dispose?.(); }); }
function hashString(text) { let hash = 2166136261; for (const char of String(text)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return hash >>> 0; }
const wrap = (value, max) => ((value % max) + max) % max;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
