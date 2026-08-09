import * as THREE from 'three';
import { biomeColor } from './planet.js';

const Z_SCALE = 62;
const TILE_SIZE = 420;
const TILE_HALF = TILE_SIZE / 2;
const RING = 3;
const SEGMENTS = 4;
const OVERLAP = 1.003;
const SHOW_ALTITUDE = 92;
const SAMPLES_PER_SLICE = 46;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (v, max) => ((v % max) + max) % max;

function shortestWrappedDelta(value, origin, size) {
  let delta = value - origin;
  if (delta > size * 0.5) delta -= size;
  else if (delta < -size * 0.5) delta += size;
  return delta;
}

async function waitForRuntime() {
  for (let i = 0; i < 320; i++) {
    const planet = window.realitySandboxPlanet;
    const mode = window.realitySandboxSurfaceMode;
    const surface = window.realitySandboxSurfaceSphereV37;
    const objects = window.realitySandboxSurfaceLightHookV36?.getObjects?.();
    if (planet?.world && planet?.living?.sampleDynamicPlanet && mode?.getPlayer && surface?.getStats && objects?.scene) {
      return { planet, mode, surface, scene: objects.scene };
    }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  return null;
}

function install({ planet, mode, surface, scene }) {
  if (window.realitySandboxSurfaceHorizonV38?.installed) return;
  const { world, living } = planet;
  const curvatureRadius = surface.getStats().curvatureRadius;
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  let mesh = null;
  let meshAnchor = null;
  let requestedKey = '';
  let generation = 0;
  let lastSurfaceActive = false;
  const stats = { buildsStarted: 0, buildsCompleted: 0, buildsCancelled: 0, terrainSamples: 0, vertices: 0, triangles: 0, renderLoopProceduralSamples: 0 };

  const surfaceActive = () => mode.isActive?.() && document.documentElement.dataset.surfaceMode === 'active';

  function normalizeSphereSample(x, y) {
    let sx = x, sy = y;
    while (sy < 0 || sy > world.height) {
      if (sy < 0) { sy = -sy; sx += world.width * 0.5; }
      else { sy = world.height - (sy - world.height); sx += world.width * 0.5; }
    }
    return { x: wrap(sx, world.width), y: clamp(sy, 0, world.height) };
  }

  function sphereSag(x, z) {
    const d2 = x*x + z*z, r2 = curvatureRadius*curvatureRadius;
    return curvatureRadius - Math.sqrt(Math.max(1, r2 - Math.min(d2, r2 - 1)));
  }

  function anchorFromSurface(s) {
    const parts = String(s.activeChunkKey || '').split(':').map(Number);
    if (parts.length !== 2 || !parts.every(Number.isFinite)) return null;
    return { key: s.activeChunkKey, x: wrap((parts[0]+0.5)*s.chunkStride, world.width), y: clamp((parts[1]+0.5)*s.chunkStride, 0, world.height) };
  }

  function ringOffsets() {
    const out = [];
    for (let z=-RING; z<=RING; z++) for (let x=-RING; x<=RING; x++) if (Math.max(Math.abs(x),Math.abs(z))===RING) out.push({x,z});
    return out;
  }

  function colorFor(t) {
    if (!t?.land) return [0.04, 0.23, 0.38];
    const c = biomeColor(t);
    return [c[0]/255, c[1]/255, c[2]/255];
  }

  function disposeMesh() {
    if (!mesh) return;
    scene.remove(mesh); mesh.geometry.dispose(); mesh = null; meshAnchor = null;
  }

  function build(anchor) {
    const buildGeneration = ++generation;
    requestedKey = anchor.key;
    stats.buildsStarted++;
    const side = SEGMENTS + 1;
    const offsets = ringOffsets();
    const tasks = [];
    const indices = [];
    let vertexBase = 0;
    for (const tile of offsets) {
      const ox = tile.x*TILE_SIZE, oz = tile.z*TILE_SIZE;
      for (let j=0; j<side; j++) {
        for (let i=0; i<side; i++) {
          const lx = ox + (-TILE_HALF + (i/SEGMENTS)*TILE_SIZE)*OVERLAP;
          const lz = oz + (-TILE_HALF + (j/SEGMENTS)*TILE_SIZE)*OVERLAP;
          tasks.push({ lx, lz });
        }
      }
      for (let j=0; j<SEGMENTS; j++) for (let i=0; i<SEGMENTS; i++) {
        const a = vertexBase + j*side+i, b=a+1, c=a+side, d=c+1;
        indices.push(a,c,b,b,c,d);
      }
      vertexBase += side*side;
    }

    const positions = new Float32Array(tasks.length*3);
    const colors = new Float32Array(tasks.length*3);
    let index = 0;

    function process(deadline) {
      if (buildGeneration !== generation || !surfaceActive()) { stats.buildsCancelled++; return; }
      let worked = 0;
      while (index < tasks.length) {
        const task = tasks[index];
        const p = normalizeSphereSample(anchor.x+task.lx, anchor.y+task.lz);
        const t = living.sampleDynamicPlanet(p.x, p.y, 'horizon-v38');
        stats.terrainSamples++; worked++;
        const elevation = t?.land ? clamp(t.elevation ?? 0.53,0,1) : 0.525;
        const y = elevation*Z_SCALE - sphereSag(task.lx, task.lz) - 0.55;
        positions[index*3] = task.lx; positions[index*3+1] = y; positions[index*3+2] = task.lz;
        const color = colorFor(t);
        colors[index*3] = color[0]; colors[index*3+1] = color[1]; colors[index*3+2] = color[2];
        index++;
        if (worked >= SAMPLES_PER_SLICE) break;
        if (deadline?.timeRemaining && deadline.timeRemaining() < 1.0) break;
      }
      if (index < tasks.length) { requestIdleCallback(process, { timeout: 320 }); return; }
      if (buildGeneration !== generation || !surfaceActive()) { stats.buildsCancelled++; return; }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions,3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors,3));
      geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
      const next = new THREE.Mesh(geometry, material); next.name = 'surfaceHighAltitudeHorizonV38'; next.frustumCulled = true;
      if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
      mesh = next; meshAnchor = anchor; scene.add(mesh); requestedKey = '';
      stats.buildsCompleted++; stats.vertices = tasks.length; stats.triangles = indices.length/3;
      document.documentElement.dataset.surfaceHorizonV38 = 'ready';
    }
    requestIdleCallback(process, { timeout: 320 });
  }

  function loop() {
    requestAnimationFrame(loop);
    const active = surfaceActive();
    if (!active) {
      if (lastSurfaceActive) { lastSurfaceActive=false; generation++; requestedKey=''; disposeMesh(); }
      return;
    }
    lastSurfaceActive=true;
    const player = mode.getPlayer();
    const s = surface.getStats();
    const anchor = anchorFromSurface(s);
    if (mesh) mesh.visible = player.altitude >= SHOW_ALTITUDE;
    if (!anchor || player.altitude < SHOW_ALTITUDE) return;
    if (meshAnchor) mesh.position.set(shortestWrappedDelta(meshAnchor.x, anchor.x, world.width), 0, meshAnchor.y-anchor.y);
    if (anchor.key !== meshAnchor?.key && anchor.key !== requestedKey && s.distantTilesVisible >= 8) build(anchor);
  }
  requestAnimationFrame(loop);

  const api = {
    installed: true,
    getStats: () => ({ ...stats, active: surfaceActive(), visible: Boolean(mesh?.visible), ring: RING, segments: SEGMENTS, showAltitude: SHOW_ALTITUDE, mergedSingleMesh: true, activeChunkKey: meshAnchor?.key || '', requestedKey }),
  };
  window.realitySandboxSurfaceHorizonV38 = api;
  document.documentElement.dataset.surfaceHorizonV38 = 'installed';
  const prev = window.realitySandboxPresentationDiagnostics;
  window.realitySandboxPresentationDiagnostics = () => ({ ...(typeof prev === 'function' ? prev() : {}), surfaceHorizonV38: api.getStats() });
}

waitForRuntime().then(state => {
  if (!state) { document.documentElement.dataset.surfaceHorizonV38='unavailable'; return; }
  install(state);
});

