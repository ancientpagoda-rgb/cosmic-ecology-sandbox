import * as THREE from 'three';
import { biomeColor } from './planet.js';

const TAU = Math.PI * 2;
const SEA_LEVEL = 0.53;
const PLANET_RADIUS = 220;
const HEIGHT_SCALE = 14;
const MIN_ALTITUDE = 2.4;
const DEFAULT_ALTITUDE = 12;
const MAX_ALTITUDE = 3200;
const LOCAL_PATCH_RADIUS_WORLD = 148;
const LOCAL_PATCH_SEGMENTS = 112;
const LOCAL_PATCH_BUILD_ALTITUDE = 420;
const LOCAL_PATCH_FADE_START = 160;
const LOCAL_PATCH_FADE_END = 440;
const ORBIT_BLEND_START = 38;
const ORBIT_BLEND_END = 155;
const CAMERA_FOV = 68;
const GLOBAL_LOD_TIERS = [
  { name: 'ground', maxAltitude: 70, widthSegments: 192, heightSegments: 120 },
  { name: 'regional', maxAltitude: 260, widthSegments: 144, heightSegments: 90 },
  { name: 'orbit', maxAltitude: 900, widthSegments: 112, heightSegments: 70 },
  { name: 'cosmic', maxAltitude: Infinity, widthSegments: 72, heightSegments: 46 },
];
const DESKTOP_DPR_CAP = 2.5;
const MOBILE_DPR_CAP = 1.6;
const MIN_RENDER_DPR = 1;
const DPR_ADJUST_INTERVAL_MS = 1600;
const FAUNA_REFRESH_MS = 180;
const GLOBAL_REFRESH_TICKS = 720;
const PATCH_MOVE_THRESHOLD = 18;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrap = (value, max) => ((value % max) + max) % max;
const wrap01 = value => ((value % 1) + 1) % 1;
const smoothstep = (a, b, value) => {
  const t = clamp((value - a) / Math.max(1e-9, b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

async function waitForRuntime() {
  for (let attempt = 0; attempt < 360; attempt++) {
    if (window.realitySandboxReady?.then) {
      try { await window.realitySandboxReady; } catch { return null; }
    }
    const runtime = window.realitySandboxUnified;
    const planet = window.realitySandboxPlanet;
    const host = document.getElementById('world');
    if (runtime?.getCamera && runtime?.setCamera && planet?.world?.ecs && planet?.living?.sampleDynamicPlanet && planet?.waterCycle?.sample && host) {
      return { runtime, planet, host };
    }
    await new Promise(resolve => setTimeout(resolve, 35));
  }
  return null;
}

function worldPoint(world, x, y, radius = PLANET_RADIUS) {
  const lon = (wrap(x, world.width) / world.width - 0.5) * TAU;
  const lat = (0.5 - clamp(y, 0, world.height) / world.height) * Math.PI;
  const cosLat = Math.cos(lat);
  return new THREE.Vector3(
    Math.cos(lon) * cosLat * radius,
    Math.sin(lat) * radius,
    Math.sin(lon) * cosLat * radius,
  );
}

function vectorToWorld(world, vector) {
  const n = vector.clone().normalize();
  const lat = Math.asin(clamp(n.y, -1, 1));
  const lon = Math.atan2(n.z, n.x);
  return {
    x: wrap01(lon / TAU + 0.5) * world.width,
    y: clamp(0.5 - lat / Math.PI, 0, 1) * world.height,
  };
}

function sampleRadius(living, x, y) {
  const terrain = living.sampleDynamicPlanet(x, y);
  const elevation = terrain?.land ? finite(terrain.elevation, SEA_LEVEL) : SEA_LEVEL - 0.006;
  return PLANET_RADIUS + (elevation - SEA_LEVEL) * HEIGHT_SCALE;
}

function sampleColor(living, waterCycle, x, y) {
  const terrain = living.sampleDynamicPlanet(x, y);
  const water = waterCycle.sample(x, y);
  if (!terrain?.land) {
    const depth = clamp((SEA_LEVEL - finite(terrain?.elevation, SEA_LEVEL - 0.02)) * 8, 0, 1);
    return mixColor([31, 132, 164], [7, 39, 83], depth);
  }
  let rgb = biomeColor(terrain);
  const lake = clamp(finite(water?.lake, 0), 0, 1);
  const river = clamp(finite(water?.river, 0), 0, 1);
  const snow = clamp(Math.max(finite(water?.snow, 0), finite(water?.snowpack, 0)), 0, 1);
  const drought = clamp(finite(water?.drought, 0), 0, 1);
  if (lake > 0.08) rgb = mixRgb(rgb, [38, 122, 165], 0.35 + lake * 0.45);
  else if (river > 0.12) rgb = mixRgb(rgb, [49, 139, 178], 0.22 + river * 0.38);
  if (snow > 0.12) rgb = mixRgb(rgb, [226, 239, 241], snow * 0.62);
  if (drought > 0.22) rgb = mixRgb(rgb, [157, 119, 70], drought * 0.36);
  return rgb;
}

function install({ runtime, planet, host }) {
  if (window.realitySandboxSingleSphericalRenderer?.installed) return window.realitySandboxSingleSphericalRenderer;

  try { window.realitySandboxWorldView?.destroy?.(); } catch {}

  const { world, living, waterCycle, biosphere } = planet;
  const previousRunInvariants = runtime.runInvariants?.bind(runtime);
  const previousGetSnapshot = runtime.getSnapshot?.bind(runtime);
  const previousSetPresentationSuspended = runtime.setPresentationSuspended?.bind(runtime);
  const previousSurfaceApi = window.realitySandboxSurfaceMode;

  const style = document.createElement('style');
  style.id = 'eidolon-single-spherical-world-style';
  style.textContent = `
    #lofiLivingCanvas{opacity:0!important;visibility:hidden!important;pointer-events:none!important}
    #surfaceModeLayer,#enterSurfaceMode{display:none!important;visibility:hidden!important;pointer-events:none!important}
    #eidolonSingleWorldCanvas{display:block!important;visibility:visible!important;opacity:1!important}
  `;
  document.head.append(style);

  const canvas = document.createElement('canvas');
  canvas.id = 'eidolonSingleWorldCanvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', 'Eidolon continuous spherical world. Drag to move around the planet, scroll to travel continuously between ground and orbit, and use WASD near the surface.');
  Object.assign(canvas.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%', zIndex: '1',
    touchAction: 'none', cursor: 'grab', outline: 'none',
  });
  host.prepend(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  const mobileLike = matchMedia?.('(pointer: coarse)')?.matches || Math.min(innerWidth, innerHeight) < 700;
  const deviceDpr = Math.max(1, Number(globalThis.devicePixelRatio) || 1);
  const renderDprCap = Math.min(deviceDpr, mobileLike ? MOBILE_DPR_CAP : DESKTOP_DPR_CAP);
  let renderPixelRatio = renderDprCap;
  renderer.setPixelRatio(renderPixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;

  const scene = new THREE.Scene();
  const groundSky = new THREE.Color(0x789fac);
  const spaceSky = new THREE.Color(0x020605);
  scene.background = spaceSky.clone();

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.05, 12000);
  const hemi = new THREE.HemisphereLight(0xd8edff, 0x203229, 1.45);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffefd1, 2.25);
  sun.position.set(800, 520, 420);
  scene.add(sun);

  const planetMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0.01 });
  let globalLod = selectGlobalLod(DEFAULT_ALTITUDE);
  let planetGeometry = new THREE.SphereGeometry(PLANET_RADIUS, globalLod.widthSegments, globalLod.heightSegments);
  const planetMesh = new THREE.Mesh(planetGeometry, planetMaterial);
  planetMesh.frustumCulled = false;
  scene.add(planetMesh);

  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(PLANET_RADIUS + 4.2, 64, 40),
    new THREE.MeshBasicMaterial({ color: 0x80b9c3, transparent: true, opacity: 0.12, side: THREE.BackSide, depthWrite: false }),
  );
  scene.add(atmosphere);

  const starGeometry = new THREE.BufferGeometry();
  const starPositions = new Float32Array(1200 * 3);
  let seed = hashText(String(world.seed || planet.seed || 'eidolon'));
  for (let i = 0; i < 1200; i++) {
    seed = xorshift(seed); const u = seed / 4294967295;
    seed = xorshift(seed); const v = seed / 4294967295;
    seed = xorshift(seed); const rj = seed / 4294967295;
    const theta = u * TAU;
    const phi = Math.acos(2 * v - 1);
    const radius = 2600 + rj * 3200;
    starPositions[i * 3] = Math.sin(phi) * Math.cos(theta) * radius;
    starPositions[i * 3 + 1] = Math.cos(phi) * radius;
    starPositions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;
  }
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xcfe4df, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.72, depthWrite: false }));
  scene.add(stars);

  const patchMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, transparent: true, opacity: 1, depthWrite: true });
  let patchMesh = null;
  let patchCenterX = NaN;
  let patchCenterY = NaN;
  let patchBuilds = 0;
  let globalBuilds = 0;
  let lastGlobalRefreshTick = -Infinity;

  const faunaGeometry = createFaunaGeometry();
  const faunaMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.08, flatShading: true });
  let faunaCapacity = 0;
  let fauna = null;
  let faunaEntityIds = [];
  let lastFaunaRefresh = -Infinity;
  let faunaRefreshes = 0;

  const state = {
    x: runtime.getCamera().centerX * world.width,
    y: runtime.getCamera().centerY * world.height,
    yaw: 0,
    pitch: 0.02,
    altitude: DEFAULT_ALTITUDE,
  };
  const keys = new Set();
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  let destroyed = false;
  let lastFrame = performance.now();
  let frames = 0;
  let averageFrameMs = 16.7;
  let lastDprAdjustment = performance.now();
  let externalCameraCenter = runtime.getCamera();
  let manualCameraWrite = false;

  buildGlobalPlanet();
  buildPatch();
  previousSetPresentationSuspended?.(true);

  function selectGlobalLod(altitude) {
    return GLOBAL_LOD_TIERS.find(tier => altitude <= tier.maxAltitude) || GLOBAL_LOD_TIERS.at(-1);
  }

  function ensureGlobalLod() {
    const nextLod = selectGlobalLod(state.altitude);
    if (nextLod.name === globalLod.name) return false;
    const previousGeometry = planetGeometry;
    globalLod = nextLod;
    planetGeometry = new THREE.SphereGeometry(PLANET_RADIUS, globalLod.widthSegments, globalLod.heightSegments);
    planetMesh.geometry = planetGeometry;
    previousGeometry.dispose();
    buildGlobalPlanet();
    document.documentElement.dataset.sphericalGlobalLod = globalLod.name;
    return true;
  }

  function buildGlobalPlanet() {
    const positions = planetGeometry.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    const uv = planetGeometry.attributes.uv;
    for (let i = 0; i < positions.count; i++) {
      const wx = wrap01(uv.getX(i)) * world.width;
      const wy = clamp(1 - uv.getY(i), 0, 1) * world.height;
      const radius = sampleRadius(living, wx, wy);
      const n = new THREE.Vector3(positions.getX(i), positions.getY(i), positions.getZ(i)).normalize().multiplyScalar(radius);
      positions.setXYZ(i, n.x, n.y, n.z);
      const rgb = sampleColor(living, waterCycle, wx, wy);
      colors[i * 3] = rgb[0] / 255;
      colors[i * 3 + 1] = rgb[1] / 255;
      colors[i * 3 + 2] = rgb[2] / 255;
    }
    planetGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    planetGeometry.computeVertexNormals();
    positions.needsUpdate = true;
    globalBuilds++;
    lastGlobalRefreshTick = world.tick;
    document.documentElement.dataset.sphericalGlobalLod = globalLod.name;
  }

  function needsPatchBuild() {
    if (state.altitude > LOCAL_PATCH_BUILD_ALTITUDE) return false;
    if (!patchMesh || !Number.isFinite(patchCenterX)) return true;
    const dx = shortestWrappedDelta(state.x, patchCenterX, world.width);
    const dy = state.y - patchCenterY;
    return Math.hypot(dx, dy) > PATCH_MOVE_THRESHOLD;
  }

  function buildPatch() {
    const segments = LOCAL_PATCH_SEGMENTS;
    const side = segments + 1;
    const vertices = new Float32Array(side * side * 3);
    const colors = new Float32Array(side * side * 3);
    const indices = new Uint32Array(segments * segments * 6);
    let vi = 0;
    for (let row = 0; row <= segments; row++) {
      const oy = (row / segments * 2 - 1) * LOCAL_PATCH_RADIUS_WORLD;
      for (let col = 0; col <= segments; col++) {
        const ox = (col / segments * 2 - 1) * LOCAL_PATCH_RADIUS_WORLD;
        const wx = wrap(state.x + ox, world.width);
        const wy = clamp(state.y + oy, 0, world.height);
        const radius = sampleRadius(living, wx, wy) + 0.08;
        const p = worldPoint(world, wx, wy, radius);
        vertices[vi * 3] = p.x;
        vertices[vi * 3 + 1] = p.y;
        vertices[vi * 3 + 2] = p.z;
        const rgb = sampleColor(living, waterCycle, wx, wy);
        colors[vi * 3] = rgb[0] / 255;
        colors[vi * 3 + 1] = rgb[1] / 255;
        colors[vi * 3 + 2] = rgb[2] / 255;
        vi++;
      }
    }
    let ii = 0;
    for (let row = 0; row < segments; row++) {
      for (let col = 0; col < segments; col++) {
        const a = row * side + col;
        const b = a + 1;
        const c = a + side;
        const d = c + 1;
        indices[ii++] = a; indices[ii++] = c; indices[ii++] = b;
        indices[ii++] = b; indices[ii++] = c; indices[ii++] = d;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    if (patchMesh) {
      scene.remove(patchMesh);
      patchMesh.geometry.dispose();
    }
    patchMesh = new THREE.Mesh(geometry, patchMaterial);
    patchMesh.renderOrder = 2;
    scene.add(patchMesh);
    patchCenterX = state.x;
    patchCenterY = state.y;
    patchBuilds++;
  }

  function createOrResizeFauna(capacity) {
    const nextCapacity = Math.max(16, nextPowerOfTwo(capacity));
    if (fauna && nextCapacity <= faunaCapacity) return;
    if (fauna) scene.remove(fauna);
    faunaCapacity = nextCapacity;
    fauna = new THREE.InstancedMesh(faunaGeometry, faunaMaterial, faunaCapacity);
    fauna.frustumCulled = false;
    fauna.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(faunaCapacity * 3), 3);
    scene.add(fauna);
  }

  function refreshFauna(now) {
    if (now - lastFaunaRefresh < FAUNA_REFRESH_MS) return;
    lastFaunaRefresh = now;
    const c = world.ecs.components;
    const livingIds = [];
    for (const [id] of c.agent || []) livingIds.push(id);
    for (const [id] of c.predator || []) livingIds.push(id);
    for (const [id] of c.apex || []) livingIds.push(id);
    createOrResizeFauna(livingIds.length);
    faunaEntityIds = [];
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();
    const position3 = new THREE.Vector3();
    const zAxis = new THREE.Vector3(0, 0, 1);
    const up = new THREE.Vector3();
    let count = 0;
    for (const id of livingIds) {
      const pos = c.position?.get(id);
      if (!pos) continue;
      const organism = c.agent?.get(id) || c.predator?.get(id) || c.apex?.get(id);
      if (!organism) continue;
      const role = c.apex?.has(id) ? 'apex' : c.predator?.has(id) ? 'predator' : 'grazer';
      const radius = sampleRadius(living, pos.x, pos.y) + (role === 'apex' ? 1.3 : role === 'predator' ? 1.05 : 0.85);
      position3.copy(worldPoint(world, pos.x, pos.y, radius));
      up.copy(position3).normalize();
      quaternion.setFromUnitVectors(zAxis, up);
      const base = role === 'apex' ? 1.55 : role === 'predator' ? 1.25 : 0.96;
      const visualScale = base * clamp(1 + state.altitude / 420, 1, 2.8);
      scale.setScalar(visualScale);
      matrix.compose(position3, quaternion, scale);
      fauna.setMatrixAt(count, matrix);
      const species = biosphere?.getSpeciesForEntity?.(id);
      color.setHex(species?.color ?? (role === 'apex' ? 0xcf8dff : role === 'predator' ? 0xff705e : 0x69d8ff));
      fauna.setColorAt(count, color);
      faunaEntityIds[count] = id;
      count++;
    }
    fauna.count = count;
    fauna.instanceMatrix.needsUpdate = true;
    if (fauna.instanceColor) fauna.instanceColor.needsUpdate = true;
    faunaRefreshes++;
    document.documentElement.dataset.unifiedVisibleCreatures = String(count);
  }

  function basisAt(x, y) {
    const up = worldPoint(world, x, y, 1).normalize();
    const lon = (wrap(x, world.width) / world.width - 0.5) * TAU;
    const lat = (0.5 - clamp(y, 0, world.height) / world.height) * Math.PI;
    const east = new THREE.Vector3(-Math.sin(lon), 0, Math.cos(lon)).normalize();
    const north = new THREE.Vector3(-Math.sin(lat) * Math.cos(lon), Math.cos(lat), -Math.sin(lat) * Math.sin(lon)).normalize();
    return { up, east, north };
  }

  function updateCamera() {
    const surfaceRadius = sampleRadius(living, state.x, state.y);
    const { up, east, north } = basisAt(state.x, state.y);
    const tangentForward = north.clone().multiplyScalar(Math.cos(state.yaw)).addScaledVector(east, Math.sin(state.yaw)).normalize();
    const localForward = tangentForward.clone().multiplyScalar(Math.cos(state.pitch)).addScaledVector(up, Math.sin(state.pitch)).normalize();
    const orbitBlend = smoothstep(ORBIT_BLEND_START, ORBIT_BLEND_END, state.altitude);
    const forward = localForward.clone().multiplyScalar(1 - orbitBlend).addScaledVector(up, -orbitBlend).normalize();
    const viewUp = up.clone().multiplyScalar(1 - orbitBlend).addScaledVector(north, orbitBlend).normalize();
    camera.position.copy(up).multiplyScalar(surfaceRadius + state.altitude);
    camera.up.copy(viewUp);
    camera.lookAt(camera.position.clone().addScaledVector(forward, Math.max(35, state.altitude * 1.25)));

    const atmosphereBlend = 1 - smoothstep(28, 190, state.altitude);
    scene.background.copy(spaceSky).lerp(groundSky, atmosphereBlend);
    hemi.intensity = 0.55 + atmosphereBlend * 1.1;
    atmosphere.material.opacity = 0.055 + atmosphereBlend * 0.10;
    stars.material.opacity = clamp(1 - atmosphereBlend * 0.94, 0.04, 0.78);
    patchMaterial.opacity = 1 - smoothstep(LOCAL_PATCH_FADE_START, LOCAL_PATCH_FADE_END, state.altitude);
    if (patchMesh) patchMesh.visible = patchMaterial.opacity > 0.015;

    const tier = state.altitude < 9 ? 'ground' : state.altitude < 55 ? 'aerial' : state.altitude < 520 ? 'orbit' : 'cosmic';
    document.documentElement.dataset.planetCameraTier = tier;
    document.documentElement.dataset.worldViewAltitude = state.altitude.toFixed(2);
  }

  function syncRuntimeCamera() {
    const zoom = clamp(11.8 * Math.pow(45 / Math.max(45, state.altitude), 0.38), 0.7, 11.8);
    manualCameraWrite = true;
    externalCameraCenter = runtime.setCamera({ centerX: wrap(state.x, world.width) / world.width, centerY: clamp(state.y / world.height, 0.01, 0.99), zoom });
    manualCameraWrite = false;
  }

  function syncFromExternalRuntimeCamera() {
    if (manualCameraWrite || drag || pinch) return;
    const current = runtime.getCamera();
    if (!externalCameraCenter) externalCameraCenter = current;
    const dx = unitCircleDistance(current.centerX, externalCameraCenter.centerX);
    const dy = Math.abs(current.centerY - externalCameraCenter.centerY);
    if (dx > 0.0008 || dy > 0.0008) {
      state.x = wrap(current.centerX, 1) * world.width;
      state.y = clamp(current.centerY, 0, 1) * world.height;
      externalCameraCenter = current;
    }
  }

  function updateMovement(dt) {
    if (state.altitude > 80) return;
    let forward = 0;
    let strafe = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) forward += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) forward -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) strafe += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) strafe -= 1;
    const magnitude = Math.hypot(forward, strafe) || 1;
    const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 24 : 8;
    forward /= magnitude;
    strafe /= magnitude;
    const fx = Math.sin(state.yaw);
    const fy = -Math.cos(state.yaw);
    const rx = Math.cos(state.yaw);
    const ry = Math.sin(state.yaw);
    state.x += (fx * forward + rx * strafe) * speed * dt;
    state.y += (fy * forward + ry * strafe) * speed * dt;
    applySphereTopology();
    if (keys.has('Space')) state.altitude = clamp(state.altitude + 18 * dt, MIN_ALTITUDE, MAX_ALTITUDE);
    if (keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC')) state.altitude = clamp(state.altitude - 18 * dt, MIN_ALTITUDE, MAX_ALTITUDE);
  }

  function applySphereTopology() {
    while (state.y < 0 || state.y > world.height) {
      if (state.y < 0) {
        state.y = -state.y;
        state.x += world.width * 0.5;
        state.yaw += Math.PI;
      } else if (state.y > world.height) {
        state.y = world.height - (state.y - world.height);
        state.x += world.width * 0.5;
        state.yaw += Math.PI;
      }
    }
    state.x = wrap(state.x, world.width);
    state.yaw = wrapAngle(state.yaw);
  }

  function resize() {
    const rect = host.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || innerWidth));
    const height = Math.max(1, Math.round(rect.height || innerHeight));
    const size = renderer.getSize(new THREE.Vector2());
    if (size.x === width && size.y === height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function updateAdaptiveDpr(dt, now) {
    averageFrameMs = averageFrameMs * 0.92 + dt * 1000 * 0.08;
    if (now - lastDprAdjustment < DPR_ADJUST_INTERVAL_MS) return;
    lastDprAdjustment = now;
    let next = renderPixelRatio;
    if (averageFrameMs > 25) next = Math.max(MIN_RENDER_DPR, renderPixelRatio - 0.2);
    else if (averageFrameMs < 17.2) next = Math.min(renderDprCap, renderPixelRatio + 0.1);
    next = Math.round(next * 100) / 100;
    if (Math.abs(next - renderPixelRatio) < 0.01) return;
    renderPixelRatio = next;
    renderer.setPixelRatio(renderPixelRatio);
    const rect = host.getBoundingClientRect();
    renderer.setSize(Math.max(1, Math.round(rect.width || innerWidth)), Math.max(1, Math.round(rect.height || innerHeight)), false);
    document.documentElement.dataset.sphericalRenderDpr = renderPixelRatio.toFixed(2);
  }

  function onWheel(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * innerHeight : event.deltaY;
    const previous = state.altitude;
    state.altitude = clamp(state.altitude * Math.exp(delta * 0.00165), MIN_ALTITUDE, MAX_ALTITUDE);
    if (state.altitude !== previous) syncRuntimeCamera();
  }

  function onPointerDown(event) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size >= 2) beginPinch();
    else {
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: state.x, startY: state.y, startYaw: state.yaw, startPitch: state.pitch, moved: 0 };
      canvas.style.cursor = 'grabbing';
    }
  }

  function onPointerMove(event) {
    if (!pointers.has(event.pointerId)) return;
    event.preventDefault();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size >= 2) {
      const pair = [...pointers.values()].slice(0, 2);
      const distance = Math.max(1, Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y));
      if (!pinch) beginPinch();
      state.altitude = clamp(pinch.altitude * pinch.distance / distance, MIN_ALTITUDE, MAX_ALTITUDE);
      syncRuntimeCamera();
      return;
    }
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
    const rect = canvas.getBoundingClientRect();
    if (state.altitude > 70) {
      const sensitivity = clamp(state.altitude / 700, 0.22, 1.7);
      state.x = wrap(drag.startX - dx / Math.max(1, rect.width) * world.width * sensitivity, world.width);
      state.y = clamp(drag.startY + dy / Math.max(1, rect.height) * world.height * sensitivity, 0.01, world.height - 0.01);
      syncRuntimeCamera();
    } else {
      state.yaw = wrapAngle(drag.startYaw + dx * 0.005);
      state.pitch = clamp(drag.startPitch - dy * 0.004, -0.72, 0.72);
    }
  }

  function onPointerUp(event) {
    if (!pointers.has(event.pointerId)) return;
    const wasClick = pointers.size === 1 && drag?.id === event.pointerId && drag.moved < 6;
    pointers.delete(event.pointerId);
    try { canvas.releasePointerCapture?.(event.pointerId); } catch {}
    if (wasClick) selectCreatureAt(event.clientX, event.clientY);
    if (pointers.size >= 2) beginPinch();
    else { pinch = null; drag = null; canvas.style.cursor = 'grab'; }
  }

  function beginPinch() {
    const pair = [...pointers.values()].slice(0, 2);
    if (pair.length < 2) return;
    pinch = { distance: Math.max(1, Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y)), altitude: state.altitude };
    drag = null;
  }

  function selectCreatureAt(clientX, clientY) {
    if (!fauna || !window.realitySandboxCreatureInspector?.select) return false;
    const rect = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2((clientX - rect.left) / rect.width * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(fauna, false)[0];
    const id = hit && Number.isFinite(hit.instanceId) ? faunaEntityIds[hit.instanceId] : null;
    return Number.isFinite(id) ? Boolean(window.realitySandboxCreatureInspector.select(id)) : false;
  }

  function onDoubleClick(event) {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(planetMesh, false)[0];
    if (!hit) return;
    const point = vectorToWorld(world, hit.point);
    state.x = point.x;
    state.y = point.y;
    state.altitude = Math.min(state.altitude, 18);
    syncRuntimeCamera();
  }

  function onKeyDown(event) {
    if (event.code === 'Home' || event.code === 'Digit0') {
      state.altitude = DEFAULT_ALTITUDE;
      state.pitch = 0.02;
      syncRuntimeCamera();
      event.preventDefault();
      return;
    }
    if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ControlLeft','ControlRight','KeyC','ShiftLeft','ShiftRight'].includes(event.code)) {
      keys.add(event.code);
      event.preventDefault();
    }
  }

  function onKeyUp(event) { keys.delete(event.code); }

  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('dblclick', onDoubleClick);
  window.addEventListener('keydown', onKeyDown, { passive: false });
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => keys.clear());

  function frame(now) {
    if (destroyed) return;
    requestAnimationFrame(frame);
    const dt = clamp((now - lastFrame) / 1000, 0, 0.05);
    lastFrame = now;
    syncFromExternalRuntimeCamera();
    updateMovement(dt);
    const lodChanged = ensureGlobalLod();
    if (needsPatchBuild()) buildPatch();
    if (!lodChanged && world.tick - lastGlobalRefreshTick >= GLOBAL_REFRESH_TICKS && state.altitude > 90) buildGlobalPlanet();
    refreshFauna(now);
    resize();
    updateAdaptiveDpr(dt, now);
    updateCamera();
    renderer.render(scene, camera);
    frames++;
  }
  requestAnimationFrame(frame);

  runtime.runInvariants = () => {
    const base = previousRunInvariants?.() || { ok: true, failures: [] };
    const failures = (base.failures || []).filter(message => !String(message).includes('exactly one visible simulation canvas'));
    const visibleCanvases = [...document.querySelectorAll('canvas')].filter(element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
    });
    if (visibleCanvases.length !== 1 || visibleCanvases[0] !== canvas) failures.push('The unified world view must expose exactly one visible Three.js canvas.');
    return { ok: failures.length === 0, failures };
  };

  runtime.getSnapshot = () => {
    const base = previousGetSnapshot?.() || {};
    return {
      ...base,
      presentation: {
        ...(base.presentation || {}),
        renderer: 'three-single-spherical-world-scene',
        geometry: 'distance-adaptive-displaced-sphere-with-local-spherical-lod',
        projection: 'perspective',
        spherical: true,
        visibleCanvasId: canvas.id,
        navigationSystems: 1,
        camera: getState(),
      },
    };
  };

  function getState() {
    return {
      version: 3,
      model: 'single-three-scene-single-camera-spherical-lod',
      x: state.x,
      y: state.y,
      longitude: state.x / world.width * 360 - 180,
      latitude: 90 - state.y / world.height * 180,
      yaw: state.yaw,
      pitch: state.pitch,
      altitude: state.altitude,
      tier: document.documentElement.dataset.planetCameraTier || 'aerial',
      canvasId: canvas.id,
      renderer: 'Three.WebGLRenderer',
      visibleCanvases: 1,
      globalLod: globalLod.name,
      globalSegments: [globalLod.widthSegments, globalLod.heightSegments],
      localPatchSegments: LOCAL_PATCH_SEGMENTS,
      localPatchBuildAltitude: LOCAL_PATCH_BUILD_ALTITUDE,
      renderPixelRatio,
      renderDprCap,
      averageFrameMs,
      globalBuilds,
      patchBuilds,
      faunaRefreshes,
      faunaCapacity,
      faunaVisible: fauna?.count || 0,
      frames,
      oneScene: true,
      oneCamera: true,
      rendererSwaps: 0,
      canvasSwaps: 0,
    };
  }

  function setLocation(x, y) {
    state.x = wrap(Number(x) || 0, world.width);
    state.y = clamp(Number(y) || 0, 0, world.height);
    syncRuntimeCamera();
    return getState();
  }

  function setAltitude(value) {
    state.altitude = clamp(Number(value) || MIN_ALTITUDE, MIN_ALTITUDE, MAX_ALTITUDE);
    syncRuntimeCamera();
    return getState();
  }

  function setOrientation(yaw, pitch = state.pitch) {
    state.yaw = wrapAngle(Number(yaw) || 0);
    state.pitch = clamp(Number(pitch) || 0, -0.72, 0.72);
    return getState();
  }

  function destroy() {
    destroyed = true;
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('dblclick', onDoubleClick);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    previousSetPresentationSuspended?.(false);
    renderer.dispose();
    patchMesh?.geometry.dispose();
    planetGeometry.dispose();
    atmosphere.geometry.dispose();
    starGeometry.dispose();
    faunaGeometry.dispose();
    canvas.remove();
    style.remove();
  }

  const api = {
    installed: true,
    version: 3,
    model: 'single-three-scene-single-camera-spherical-lod',
    getState,
    getSnapshot: getState,
    setLocation,
    setAltitude,
    setOrientation,
    selectCreatureAt,
    destroy,
  };

  window.realitySandboxSingleSphericalRenderer = api;
  window.realitySandboxWorldView = api;
  planet.worldView = api;
  document.body.dataset.worldViewSystem = 'single-three-spherical-camera';
  document.documentElement.dataset.worldViewReady = 'true';
  document.documentElement.dataset.worldViewRegime = 'ground';
  document.documentElement.dataset.sphericalRenderDpr = renderPixelRatio.toFixed(2);
  document.documentElement.dataset.sphericalGlobalLod = globalLod.name;
  window.dispatchEvent(new CustomEvent('eidolon-world-view-ready', { detail: getState() }));
  return api;
}

function createFaunaGeometry() {
  const parts = [];
  const add = (geometry, position, rotation = [0, 0, 0], scale = [1, 1, 1]) => {
    const transform = new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
      new THREE.Vector3(...scale),
    );
    geometry.applyMatrix4(transform);
    parts.push(geometry);
  };
  add(new THREE.CapsuleGeometry(0.26, 0.72, 3, 6), [0, 0, 0], [Math.PI / 2, 0, 0]);
  add(new THREE.IcosahedronGeometry(0.28, 1), [0, 0, 0.72], [0, 0, 0], [0.92, 0.9, 1.08]);
  add(new THREE.ConeGeometry(0.13, 0.34, 5), [0, 0, 1.05], [Math.PI / 2, 0, 0]);
  for (const side of [-1, 1]) {
    add(new THREE.ConeGeometry(0.065, 0.22, 4), [side * 0.2, 0.24, 0.72], [0, 0, side * 0.42]);
  }
  for (const side of [-1, 1]) {
    for (const fore of [-0.34, 0.33]) {
      add(new THREE.CylinderGeometry(0.045, 0.055, 0.42, 5), [side * 0.2, -0.32, fore], [0, 0, 0]);
    }
  }
  add(new THREE.ConeGeometry(0.1, 0.48, 5), [0, 0, -0.82], [-Math.PI / 2, 0, 0]);
  const merged = mergeSimpleGeometries(parts);
  for (const geometry of parts) if (geometry !== merged) geometry.dispose?.();
  return merged;
}

function mergeSimpleGeometries(geometries) {
  const vertices = [];
  const normals = [];
  const indices = [];
  let offset = 0;
  for (const geometry of geometries) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const p = g.attributes.position;
    const n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      vertices.push(p.getX(i), p.getY(i), p.getZ(i));
      if (n) normals.push(n.getX(i), n.getY(i), n.getZ(i));
      else normals.push(0, 1, 0);
      indices.push(offset++);
    }
    if (g !== geometry) g.dispose();
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  result.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  result.setIndex(indices);
  return result;
}

function shortestWrappedDelta(value, origin, size) {
  let delta = value - origin;
  if (delta > size * 0.5) delta -= size;
  else if (delta < -size * 0.5) delta += size;
  return delta;
}
function mixRgb(a, b, t) { const s = clamp(t, 0, 1); return a.map((v, i) => Math.round(v + (b[i] - v) * s)); }
function mixColor(a, b, t) { return mixRgb(a, b, t); }
function finite(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function wrapAngle(value) { return ((value + Math.PI) % TAU + TAU) % TAU - Math.PI; }
function unitCircleDistance(a, b) { const d = Math.abs(a - b) % 1; return Math.min(d, 1 - d); }
function nextPowerOfTwo(value) { let n = 1; while (n < Math.max(1, value)) n <<= 1; return n; }
function hashText(value) { let hash = 2166136261; for (const ch of String(value)) { hash ^= ch.charCodeAt(0); hash = Math.imul(hash, 16777619); } return hash >>> 0 || 1; }
function xorshift(value) { let x = value >>> 0 || 1; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return x >>> 0; }

async function boot() {
  const dependencies = await waitForRuntime();
  if (!dependencies) {
    document.documentElement.dataset.worldViewReady = 'false';
    return;
  }
  try {
    install(dependencies);
  } catch (error) {
    console.warn('[single-spherical-world-renderer] disabled:', error);
    document.documentElement.dataset.worldViewReady = 'false';
  }
}

boot();
