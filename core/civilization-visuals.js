import * as THREE from 'three';

const PATCH_SIZE = 0.9;

export function createCivilizationVisuals(container, groundLevel, civilization, options = {}) {
  const mobile = Boolean(options.mobile);
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
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = 'civilization-spatial-layer';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.domElement.style.cssText = 'position:fixed;inset:0;z-index:7;width:100%;height:100%;pointer-events:none;opacity:0;transition:opacity .25s ease';
  document.body.append(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xc6dfff, 0x0b1115, 1.1));
  const sun = new THREE.DirectionalLight(0xffe9bf, 2.2);
  sun.position.set(3, 4, 2);
  scene.add(sun);

  const root = new THREE.Group();
  const communityRoot = new THREE.Group();
  const routeRoot = new THREE.Group();
  const signalRoot = new THREE.Group();
  root.add(routeRoot, communityRoot, signalRoot);
  scene.add(root);

  const communityMeshes = new Map();
  const routeMeshes = new Map();
  const signalMeshes = [];
  let lastWidth = 0;
  let lastHeight = 0;
  let lastSync = -Infinity;
  let active = false;

  function render(frame = {}) {
    const ground = groundLevel.getState();
    active = Boolean(ground.active && civilization.getState().communities > 0);
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
    const selectedCommunities = new Set();
    const selectedRoutes = new Set();
    const radius = mobile ? 3.2 : 4.8;
    const communityCap = mobile ? 10 : 28;

    const nearby = communities
      .map(community => ({ community, local: geoToLocal(community, navigation, level) }))
      .filter(item => Math.hypot(item.local.x, item.local.z) < radius)
      .sort((a, b) => Math.hypot(a.local.x, a.local.z) - Math.hypot(b.local.x, b.local.z))
      .slice(0, communityCap);

    for (const { community, local } of nearby) {
      selectedCommunities.add(community.id);
      let mesh = communityMeshes.get(community.id);
      if (!mesh) {
        mesh = buildCommunity(community, mobile);
        communityMeshes.set(community.id, mesh);
        communityRoot.add(mesh);
      }
      updateCommunity(mesh, community);
      mesh.position.set(local.x, groundHeight(community, ground), local.z);
    }

    for (const [id, mesh] of communityMeshes.entries()) {
      if (selectedCommunities.has(id)) continue;
      communityRoot.remove(mesh);
      disposeObject(mesh);
      communityMeshes.delete(id);
    }

    const communityById = new Map(nearby.map(item => [item.community.id, item]));
    for (const route of routes) {
      const from = communityById.get(route.from);
      const to = communityById.get(route.to);
      if (!from || !to) continue;
      const id = route.id;
      selectedRoutes.add(id);
      let line = routeMeshes.get(id);
      if (!line) {
        line = buildRoute(route);
        routeMeshes.set(id, line);
        routeRoot.add(line);
      }
      updateRoute(line, route, from.local, to.local, ground);
    }

    for (const [id, mesh] of routeMeshes.entries()) {
      if (selectedRoutes.has(id)) continue;
      routeRoot.remove(mesh);
      disposeObject(mesh);
      routeMeshes.delete(id);
    }

    synchronizeSignals(nearby, ground);
  }

  function synchronizeSignals(nearby, ground) {
    while (signalMeshes.length > (mobile ? 10 : 28)) {
      const mesh = signalMeshes.pop();
      signalRoot.remove(mesh);
      disposeObject(mesh);
    }
    for (let index = signalMeshes.length; index < Math.min(nearby.length, mobile ? 10 : 28); index++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.028, 0.031, mobile ? 18 : 30),
        new THREE.MeshBasicMaterial({
          color: 0x9fffe1,
          transparent: true,
          opacity: 0.18,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI * 0.5;
      signalMeshes.push(ring);
      signalRoot.add(ring);
    }
    for (let index = 0; index < signalMeshes.length; index++) {
      const mesh = signalMeshes[index];
      const item = nearby[index];
      if (!item) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = item.community.languageComplexity > 0.12;
      mesh.position.set(item.local.x, groundHeight(item.community, ground) + 0.008, item.local.z);
      mesh.userData.strength = clamp(item.community.languageComplexity * 0.7 + item.community.trade * 0.3, 0, 1);
    }
  }

  function animate(time) {
    for (const mesh of communityMeshes.values()) {
      const hearth = mesh.userData.hearth;
      if (hearth) {
        const pulse = 0.82 + Math.sin(time * 5.2 + mesh.userData.phase) * 0.18;
        hearth.scale.setScalar(pulse);
        hearth.material.opacity = 0.52 + pulse * 0.28;
      }
      const flags = mesh.userData.flags || [];
      for (let index = 0; index < flags.length; index++) {
        flags[index].rotation.y = Math.sin(time * 2.1 + index) * 0.12;
      }
    }
    for (const line of routeMeshes.values()) {
      const material = line.material;
      material.opacity = 0.2 + Math.sin(time * 1.4 + line.userData.phase) * 0.06 + line.userData.flow * 0.24;
    }
    for (let index = 0; index < signalMeshes.length; index++) {
      const mesh = signalMeshes[index];
      const strength = mesh.userData.strength || 0;
      const cycle = (time * (0.18 + strength * 0.24) + index * 0.17) % 1;
      mesh.scale.setScalar(0.75 + cycle * (1.7 + strength));
      mesh.material.opacity = (1 - cycle) * (0.05 + strength * 0.22);
    }
  }

  function buildCommunity(community, isMobile) {
    const group = new THREE.Group();
    const hue = hashString(community.cultureId || community.id) % 360;
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(`hsl(${hue} 35% 46%)`),
      roughness: 0.94,
      metalness: 0,
    });
    const roofMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(`hsl(${wrap(hue + 48, 360)} 50% 55%)`),
      roughness: 0.84,
      metalness: 0,
    });
    const pathMaterial = new THREE.MeshStandardMaterial({ color: 0x8a7657, roughness: 1 });
    const fieldMaterial = new THREE.MeshStandardMaterial({ color: 0x738d3f, roughness: 1 });
    const waterMaterial = new THREE.MeshStandardMaterial({ color: 0x477b91, roughness: 0.42 });
    const flags = [];

    const pathCount = isMobile ? 2 : 4;
    for (let index = 0; index < pathCount; index++) {
      const path = new THREE.Mesh(new THREE.PlaneGeometry(0.025, 0.32 + index * 0.04), pathMaterial);
      path.rotation.x = -Math.PI * 0.5;
      path.rotation.z = index / pathCount * Math.PI;
      path.position.y = 0.002;
      group.add(path);
    }

    const maxBuildings = isMobile ? 5 : 12;
    for (let index = 0; index < maxBuildings; index++) {
      const angle = index * 2.399963 + (hashString(community.id) % 30) * 0.01;
      const ring = 0.065 + Math.sqrt(index) * 0.045;
      const building = new THREE.Group();
      building.name = `building-${index}`;
      building.position.set(Math.cos(angle) * ring, 0, Math.sin(angle) * ring);
      building.rotation.y = -angle + Math.PI * 0.5;

      const wall = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.029, 0.05, isMobile ? 6 : 9),
        wallMaterial,
      );
      wall.position.y = 0.026;
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(0.039, 0.042, isMobile ? 6 : 9),
        roofMaterial,
      );
      roof.position.y = 0.07;
      building.add(wall, roof);
      group.add(building);
    }

    const granary = new THREE.Group();
    granary.name = 'granary';
    const granaryBody = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.055, 0.05), wallMaterial);
    granaryBody.position.y = 0.034;
    const granaryRoof = new THREE.Mesh(new THREE.ConeGeometry(0.052, 0.035, 4), roofMaterial);
    granaryRoof.rotation.y = Math.PI * 0.25;
    granaryRoof.position.y = 0.078;
    granary.add(granaryBody, granaryRoof);
    granary.position.set(-0.11, 0, 0.07);
    group.add(granary);

    const field = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1), fieldMaterial);
    field.rotation.x = -Math.PI * 0.5;
    field.position.set(0.15, 0.003, 0.09);
    field.name = 'field';
    group.add(field);

    const reservoir = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.008, 18), waterMaterial);
    reservoir.position.set(0.13, 0.006, -0.1);
    reservoir.name = 'reservoir';
    group.add(reservoir);

    const hearthMaterial = new THREE.MeshBasicMaterial({ color: 0xffa74d, transparent: true, opacity: 0.8 });
    const hearth = new THREE.Mesh(new THREE.SphereGeometry(0.014, 7, 5), hearthMaterial);
    hearth.position.y = 0.016;
    group.add(hearth);

    for (let index = 0; index < (isMobile ? 1 : 3); index++) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.003, 0.09, 5), wallMaterial);
      pole.position.set(-0.08 + index * 0.08, 0.045, -0.12);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.018), roofMaterial);
      flag.position.set(0.017, 0.03, 0);
      pole.add(flag);
      flags.push(flag);
      group.add(pole);
    }

    group.userData = {
      buildings: group.children.filter(child => child.name?.startsWith('building-')),
      granary,
      field,
      reservoir,
      hearth,
      flags,
      phase: (hashString(community.id) % 1000) / 100,
    };
    group.traverse(object => {
      if (object.isMesh) object.castShadow = true;
    });
    return group;
  }

  function updateCommunity(mesh, community) {
    const populationScale = clamp(Math.sqrt(Math.max(1, community.population)) / 4, 0.55, 1.5);
    mesh.scale.setScalar(populationScale * (0.7 + community.stability * 0.3));
    const visibleBuildings = Math.max(1, Math.min(mesh.userData.buildings.length, Math.ceil(community.population / 2)));
    mesh.userData.buildings.forEach((building, index) => {
      building.visible = index < visibleBuildings;
    });
    mesh.userData.granary.visible = community.technologies.includes('storage');
    mesh.userData.field.visible = community.technologies.includes('agriculture');
    mesh.userData.reservoir.visible = community.technologies.includes('sanitation') || community.technologies.includes('irrigation');
    mesh.userData.hearth.visible = community.technologies.includes('fire');
    mesh.userData.flags.forEach(flag => {
      flag.visible = community.polityId != null;
    });
  }

  function buildRoute(route) {
    const material = new THREE.LineBasicMaterial({
      color: route.kind === 'conflict' ? 0xff715f : route.kind === 'alliance' ? 0x92b7ff : 0xe6c66c,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    const geometry = new THREE.BufferGeometry();
    const line = new THREE.Line(geometry, material);
    line.userData.phase = (hashString(route.id) % 1000) / 90;
    line.userData.flow = route.flow || 0;
    return line;
  }

  function updateRoute(line, route, from, to, ground) {
    const midpoint = new THREE.Vector3(
      (from.x + to.x) * 0.5,
      Math.max(groundHeight({ x: 0, y: 0 }, ground), 0) + 0.05 + Math.hypot(to.x - from.x, to.z - from.z) * 0.08,
      (from.z + to.z) * 0.5,
    );
    const start = new THREE.Vector3(from.x, 0.014, from.z);
    const end = new THREE.Vector3(to.x, 0.014, to.z);
    const curve = new THREE.QuadraticBezierCurve3(start, midpoint, end);
    const points = curve.getPoints(mobile ? 10 : 20);
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry().setFromPoints(points);
    line.userData.flow = route.flow || 0;
    line.material.color.set(route.kind === 'conflict' ? 0xff715f : route.kind === 'alliance' ? 0x92b7ff : 0xe6c66c);
  }

  function configureCamera(ground) {
    const navigation = ground.navigation;
    const surface = ground.terrain.surface || {};
    const pitch = clamp(navigation.pitch ?? -0.08, -0.55, 0.34);
    const cameraDistance = clamp(navigation.cameraDistance ?? 0.46, 0, 0.74);
    const floorY = surface.floorY || 0;
    root.rotation.y = navigation.heading ?? 0;

    if (cameraDistance < 0.08) {
      const eyeY = floorY + 0.17;
      camera.position.set(0, eyeY, 0.018);
      camera.lookAt(0, eyeY + Math.sin(pitch) * 0.8, -Math.max(0.35, Math.cos(pitch)));
    } else {
      const follow = 0.18 + cameraDistance;
      const eyeY = floorY + 0.24 + cameraDistance * 0.18;
      camera.position.set(0, eyeY, follow);
      camera.lookAt(0, floorY + 0.11 + pitch * 0.32, -0.2);
    }
  }

  function groundHeight(community, ground) {
    const center = ground.terrain.center || { u: ground.navigation.u, v: ground.navigation.v };
    const local = geoToLocal(community, ground.navigation, ground.terrain.level || 7);
    const surface = ground.terrain.surface || {};
    const slopeX = surface.slopeX || 0;
    const slopeZ = surface.slopeZ || 0;
    return (surface.floorY || 0) + local.x * slopeX + local.z * slopeZ + (center.u ? 0 : 0);
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
    for (const mesh of signalMeshes) disposeObject(mesh);
    communityMeshes.clear();
    routeMeshes.clear();
    signalMeshes.length = 0;
    renderer.dispose();
    renderer.domElement.remove();
  }

  return { render, destroy };
}

function geoToLocal(point, navigation, level) {
  const u = wrap((point.x ?? point.centroidX ?? 0) / 8192, 1);
  const v = clamp((point.y ?? point.centroidY ?? 0) / 4096, 0, 1);
  const units = PATCH_SIZE * (2 ** level);
  return {
    x: turnDelta(u, navigation.u) * units,
    z: (v - navigation.v) * units,
  };
}

function turnDelta(value, reference) {
  let delta = value - reference;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  return delta;
}

function disposeObject(root) {
  root.traverse?.(object => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach(material => material.dispose?.());
    else object.material?.dispose?.();
  });
}

function hashString(text) {
  let hash = 2166136261;
  for (let index = 0; index < String(text).length; index++) {
    hash ^= String(text).charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const wrap = (value, max) => ((value % max) + max) % max;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
