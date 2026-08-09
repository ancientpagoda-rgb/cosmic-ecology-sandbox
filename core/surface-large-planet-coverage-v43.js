import * as THREE from 'three';
import { biomeColor } from './planet.js';

const Z_SCALE = 62;
const BUILD_ALTITUDE = 115;
const SHOW_ALTITUDE = 180;
const MACRO_RADIUS = 18500;
const RADIAL_RINGS = 28;
const ANGULAR_SEGMENTS = 96;
const SAMPLE_SLICE = 72;
const REBUILD_DISTANCE = 420;
const CACHE_LIMIT = 3;
const UNDERLAY_DROP = 2.8;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (v, max) => ((v % max) + max) % max;

function shortestWrappedDelta(value, origin, size) {
  let delta = value - origin;
  if (delta > size * 0.5) delta -= size;
  else if (delta < -size * 0.5) delta += size;
  return delta;
}

function normalizeSphereSample(x, y, world) {
  let sx = x;
  let sy = y;
  while (sy < 0 || sy > world.height) {
    if (sy < 0) { sy = -sy; sx += world.width * 0.5; }
    else { sy = world.height - (sy - world.height); sx += world.width * 0.5; }
  }
  return { x: wrap(sx, world.width), y: clamp(sy, 0, world.height) };
}

function scheduleIdle(fn, timeout = 260) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout });
  else setTimeout(() => fn({ timeRemaining: () => 4, didTimeout: true }), 0);
}

async function waitForRuntime() {
  for (let i = 0; i < 360; i++) {
    const planet = window.realitySandboxPlanet;
    const mode = window.realitySandboxSurfaceMode;
    const surface = window.realitySandboxSurfaceSphereV37;
    const objects = window.realitySandboxSurfaceLightHookV36?.getObjects?.();
    if (planet?.world && planet?.living?.sampleDynamicPlanet && mode?.getPlayer && surface?.getStats && objects?.scene && objects?.camera) {
      return { planet, mode, surface, scene: objects.scene, camera: objects.camera };
    }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  return null;
}

function install({ planet, mode, surface, scene, camera }) {
  if (window.realitySandboxSurfaceLargePlanetCoverageV43?.installed) return;
  const { world, living } = planet;
  const cache = new Map();
  let active = null;
  let requestedKey = '';
  let generation = 0;
  let lastSurfaceActive = false;

  const stats = {
    buildsStarted: 0,
    buildsCompleted: 0,
    buildsCancelled: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheEvictions: 0,
    terrainSamples: 0,
    vertices: 0,
    triangles: 0,
    visibleFrames: 0,
    deferredLowAltitudeFrames: 0,
    renderLoopProceduralSamples: 0,
  };

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const surfaceActive = () => Boolean(mode.isActive?.() && document.documentElement.dataset.surfaceMode === 'active');
  const curvatureRadius = Number(surface.getStats().curvatureRadius) || 26400;

  function sphereSag(x, z) {
    const d2 = x * x + z * z;
    const r2 = curvatureRadius * curvatureRadius;
    return curvatureRadius - Math.sqrt(Math.max(1, r2 - Math.min(d2, r2 - 1)));
  }

  function surfaceAnchor() {
    const s = surface.getStats();
    const parts = String(s.activeChunkKey || '').split(':').map(Number);
    if (parts.length !== 2 || !parts.every(Number.isFinite)) return null;
    return {
      x: wrap((parts[0] + 0.5) * s.chunkStride, world.width),
      y: clamp((parts[1] + 0.5) * s.chunkStride, 0, world.height),
    };
  }

  function macroAnchor(player) {
    const x = wrap(Math.round(player.x / REBUILD_DISTANCE) * REBUILD_DISTANCE, world.width);
    const y = clamp(Math.round(player.y / REBUILD_DISTANCE) * REBUILD_DISTANCE, 0, world.height);
    return { key: `${Math.round(x)}:${Math.round(y)}`, x, y };
  }

  function colorFor(t) {
    if (!t?.land) return [0.035, 0.17, 0.31];
    const c = biomeColor(t);
    return [c[0] / 255, c[1] / 255, c[2] / 255];
  }

  function disposeEntry(entry) {
    if (!entry) return;
    scene.remove(entry.mesh);
    entry.mesh.geometry.dispose();
  }

  function activate(entry) {
    if (active && active !== entry) scene.remove(active.mesh);
    active = entry;
    if (!entry.mesh.parent) scene.add(entry.mesh);
  }

  function build(anchor) {
    const buildGeneration = ++generation;
    requestedKey = anchor.key;
    stats.buildsStarted++;

    const tasks = [{ x: 0, z: 0 }];
    for (let r = 1; r <= RADIAL_RINGS; r++) {
      const radius = MACRO_RADIUS * Math.pow(r / RADIAL_RINGS, 1.16);
      for (let a = 0; a < ANGULAR_SEGMENTS; a++) {
        const angle = a / ANGULAR_SEGMENTS * Math.PI * 2;
        tasks.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
      }
    }

    const positions = new Float32Array(tasks.length * 3);
    const colors = new Float32Array(tasks.length * 3);
    const indices = [];
    for (let a = 0; a < ANGULAR_SEGMENTS; a++) {
      const next = (a + 1) % ANGULAR_SEGMENTS;
      indices.push(0, 1 + next, 1 + a);
    }
    for (let r = 1; r < RADIAL_RINGS; r++) {
      const inner = 1 + (r - 1) * ANGULAR_SEGMENTS;
      const outer = 1 + r * ANGULAR_SEGMENTS;
      for (let a = 0; a < ANGULAR_SEGMENTS; a++) {
        const next = (a + 1) % ANGULAR_SEGMENTS;
        const i0 = inner + a, i1 = inner + next, o0 = outer + a, o1 = outer + next;
        indices.push(i0, o1, o0, i0, i1, o1);
      }
    }

    let index = 0;
    function slice(deadline) {
      if (buildGeneration !== generation || !surfaceActive()) {
        stats.buildsCancelled++;
        return;
      }
      let worked = 0;
      while (index < tasks.length) {
        const task = tasks[index];
        const p = normalizeSphereSample(anchor.x + task.x, anchor.y + task.z, world);
        const terrain = living.sampleDynamicPlanet(p.x, p.y, 'surface-large-planet-v43');
        stats.terrainSamples++;
        const elevation = terrain?.land ? clamp(Number(terrain.elevation) || 0.53, 0, 1) : 0.525;
        positions[index * 3] = task.x;
        positions[index * 3 + 1] = elevation * Z_SCALE - sphereSag(task.x, task.z) - UNDERLAY_DROP;
        positions[index * 3 + 2] = task.z;
        const c = colorFor(terrain);
        colors[index * 3] = c[0]; colors[index * 3 + 1] = c[1]; colors[index * 3 + 2] = c[2];
        index++;
        worked++;
        if (worked >= SAMPLE_SLICE) break;
        if (deadline?.timeRemaining && deadline.timeRemaining() < 1.0) break;
      }
      if (index < tasks.length) {
        scheduleIdle(slice, 340);
        return;
      }
      if (buildGeneration !== generation || !surfaceActive()) {
        stats.buildsCancelled++;
        return;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'surfaceLargePlanetMacroCoverageV43';
      mesh.frustumCulled = true;
      mesh.renderOrder = -4;
      const entry = { key: anchor.key, x: anchor.x, y: anchor.y, mesh };
      cache.set(anchor.key, entry);
      while (cache.size > CACHE_LIMIT) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey === anchor.key) break;
        const oldest = cache.get(oldestKey);
        cache.delete(oldestKey);
        if (oldest !== active) disposeEntry(oldest);
        stats.cacheEvictions++;
      }
      requestedKey = '';
      activate(entry);
      stats.buildsCompleted++;
      stats.vertices = tasks.length;
      stats.triangles = indices.length / 3;
      document.documentElement.dataset.surfaceLargePlanetCoverageV43 = 'ready';
    }
    scheduleIdle(slice, 320);
  }

  function ensureFor(player) {
    const anchor = macroAnchor(player);
    if (active?.key === anchor.key || requestedKey === anchor.key) return;
    const cached = cache.get(anchor.key);
    if (cached) {
      cache.delete(anchor.key);
      cache.set(anchor.key, cached);
      activate(cached);
      stats.cacheHits++;
      return;
    }
    stats.cacheMisses++;
    build(anchor);
  }

  function loop() {
    requestAnimationFrame(loop);
    if (!surfaceActive()) {
      if (lastSurfaceActive) {
        lastSurfaceActive = false;
        generation++;
        requestedKey = '';
        if (active) active.mesh.visible = false;
      }
      return;
    }
    lastSurfaceActive = true;
    const player = mode.getPlayer();
    if (player.altitude >= BUILD_ALTITUDE) ensureFor(player);
    else stats.deferredLowAltitudeFrames++;

    const sAnchor = surfaceAnchor();
    if (active && sAnchor) {
      active.mesh.position.set(shortestWrappedDelta(active.x, sAnchor.x, world.width), 0, active.y - sAnchor.y);
      active.mesh.visible = player.altitude >= SHOW_ALTITUDE;
      if (active.mesh.visible) stats.visibleFrames++;
    }

    if (camera.far < 42000) {
      camera.far = 42000;
      camera.updateProjectionMatrix();
    }
    if (scene.fog && player.altitude > SHOW_ALTITUDE) {
      const t = clamp((player.altitude - SHOW_ALTITUDE) / (4200 - SHOW_ALTITUDE), 0, 1);
      scene.fog.near = Math.max(scene.fog.near, 250 + t * 1200);
      scene.fog.far = Math.max(scene.fog.far, 3500 + t * 25000);
    }
  }
  requestAnimationFrame(loop);

  const api = {
    installed: true,
    getStats: () => ({
      ...stats,
      active: surfaceActive(),
      visible: Boolean(active?.mesh.visible),
      curvatureRadius,
      macroRadius: MACRO_RADIUS,
      buildAltitude: BUILD_ALTITUDE,
      showAltitude: SHOW_ALTITUDE,
      radialRings: RADIAL_RINGS,
      angularSegments: ANGULAR_SEGMENTS,
      cacheLimit: CACHE_LIMIT,
      cacheSize: cache.size,
      circularCoverage: true,
      mergedSingleMesh: true,
      idleBuilt: true,
      lowAltitudeBuildDeferred: true,
      proceduralSamplingInRenderLoop: false,
      cameraFar: camera.far,
    }),
  };

  window.realitySandboxSurfaceLargePlanetCoverageV43 = api;
  document.documentElement.dataset.surfaceLargePlanetCoverageV43 = 'installed';
  const prev = window.realitySandboxPresentationDiagnostics;
  window.realitySandboxPresentationDiagnostics = () => ({
    ...(typeof prev === 'function' ? prev() : {}),
    surfaceLargePlanetCoverageV43: api.getStats(),
  });
}

waitForRuntime().then(state => {
  if (!state) {
    document.documentElement.dataset.surfaceLargePlanetCoverageV43 = 'unavailable';
    return;
  }
  install(state);
});
