import * as THREE from 'three';
import { getHydrology } from './hydrology.js';

const Z_SCALE = 62;
const FLOW_THRESHOLD = 2.35;
const FIELD_RADIUS = 900;
const FIELD_RADIUS_SQ = FIELD_RADIUS * FIELD_RADIUS;
const CACHE_LIMIT = 4;
const Y_OFFSET = 0.24;
const MAX_TRACE_STEPS = 420;
const CHAIKIN_PASSES = 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (v, max) => ((v % max) + max) % max;

function shortestWrappedDelta(value, origin, size) {
  let delta = value - origin;
  if (delta > size * 0.5) delta -= size;
  else if (delta < -size * 0.5) delta += size;
  return delta;
}

function scheduleIdle(fn, timeout = 220) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout });
  else setTimeout(() => fn({ timeRemaining: () => 4, didTimeout: true }), 0);
}

async function waitForRuntime() {
  for (let i = 0; i < 360; i++) {
    const planet = window.realitySandboxPlanet;
    const mode = window.realitySandboxSurfaceMode;
    const surface = window.realitySandboxSurfaceSphereV37;
    const objects = window.realitySandboxSurfaceLightHookV36?.getObjects?.();
    if (planet?.world && mode?.getPlayer && mode?.isActive && surface?.getStats && objects?.scene) {
      return { planet, mode, surface, scene: objects.scene };
    }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  return null;
}

function buildRiverGraph(hydro) {
  const count = hydro.width * hydro.height;
  const active = new Uint8Array(count);
  const upstream = new Uint16Array(count);
  for (let i = 0; i < count; i++) {
    if (!hydro.land[i]) continue;
    if (hydro.flow[i] >= FLOW_THRESHOLD || hydro.river[i] > 0.01 || hydro.delta[i] > 0.06) active[i] = 1;
  }
  for (let i = 0; i < count; i++) {
    if (!active[i]) continue;
    const d = hydro.downstream[i];
    if (d >= 0 && active[d]) upstream[d]++;
  }

  const sources = [];
  for (let i = 0; i < count; i++) {
    if (active[i] && upstream[i] === 0) sources.push(i);
  }
  sources.sort((a, b) => hydro.flow[b] - hydro.flow[a]);

  const usedEdges = new Set();
  const traces = [];
  for (const source of sources) {
    const points = [];
    let current = source;
    const seen = new Set();
    for (let step = 0; step < MAX_TRACE_STEPS && current >= 0; step++) {
      if (seen.has(current)) break;
      seen.add(current);
      const x = current % hydro.width;
      const y = Math.floor(current / hydro.width);
      points.push({
        index: current,
        gx: x,
        gy: y,
        elevation: hydro.elevation[current],
        flow: hydro.flow[current],
        river: hydro.river[current],
        delta: hydro.delta[current],
      });

      const d = hydro.downstream[current];
      if (d < 0) break;
      const edge = `${current}:${d}`;
      if (usedEdges.has(edge)) break;
      usedEdges.add(edge);

      if (!hydro.land[d]) {
        const dx = d % hydro.width;
        const dy = Math.floor(d / hydro.width);
        points.push({
          index: d,
          gx: dx,
          gy: dy,
          elevation: hydro.elevation[d],
          flow: hydro.flow[current],
          river: 1,
          delta: Math.max(hydro.delta[current], 0.4),
        });
        break;
      }
      if (!active[d] && hydro.flow[d] < FLOW_THRESHOLD * 0.82) break;
      current = d;
    }
    if (points.length >= 3) traces.push(points);
  }

  return { traces, sources: sources.length, activeCells: active.reduce((sum, v) => sum + v, 0), edges: usedEdges.size };
}

function chaikin(points, passes = 1) {
  let out = points;
  for (let pass = 0; pass < passes; pass++) {
    if (out.length < 3) break;
    const next = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i];
      const b = out[i + 1];
      next.push(mixPoint(a, b, 0.25), mixPoint(a, b, 0.75));
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

function mixPoint(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    elevation: a.elevation + (b.elevation - a.elevation) * t,
    flow: a.flow + (b.flow - a.flow) * t,
    river: a.river + (b.river - a.river) * t,
    delta: a.delta + (b.delta - a.delta) * t,
  };
}

function install({ planet, mode, surface, scene }) {
  if (window.realitySandboxSurfaceRiversV41?.installed) return;
  const { world } = planet;
  const hydro = getHydrology();
  const graph = buildRiverGraph(hydro);
  const curvatureRadius = Number(surface.getStats().curvatureRadius) || 2640;
  const cellWorldX = world.width / hydro.width;
  const cellWorldY = world.height / hydro.height;

  const material = new THREE.ShaderMaterial({
    transparent: false,
    depthWrite: true,
    depthTest: true,
    side: THREE.DoubleSide,
    uniforms: {
      time: { value: 0 },
      shallowColor: { value: new THREE.Color(0x2f86b7) },
      deepColor: { value: new THREE.Color(0x15506f) },
    },
    vertexShader: `
      attribute float riverStrength;
      attribute float riverCoord;
      varying float vStrength;
      varying float vCoord;
      varying vec3 vWorld;
      void main() {
        vStrength = riverStrength;
        vCoord = riverCoord;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform vec3 shallowColor;
      uniform vec3 deepColor;
      varying float vStrength;
      varying float vCoord;
      varying vec3 vWorld;
      void main() {
        float flowBand = sin(vCoord * 0.085 - time * (1.4 + vStrength * 1.8));
        float crossRipple = sin((vWorld.x + vWorld.z) * 0.10 + time * 1.1);
        float shimmer = flowBand * 0.045 + crossRipple * 0.018;
        vec3 color = mix(shallowColor, deepColor, clamp(0.22 + vStrength * 0.72 - shimmer, 0.0, 1.0));
        color += vec3(0.025, 0.04, 0.05) * max(0.0, shimmer);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });

  const cache = new Map();
  let mesh = null;
  let meshAnchor = null;
  let requestedKey = '';
  let generation = 0;
  let lastSurfaceActive = false;
  let lastNow = performance.now();
  const stats = {
    graphTraces: graph.traces.length,
    graphSources: graph.sources,
    graphActiveCells: graph.activeCells,
    graphEdges: graph.edges,
    buildsStarted: 0,
    buildsCompleted: 0,
    buildsCancelled: 0,
    tracesSelected: 0,
    ribbonsBuilt: 0,
    vertices: 0,
    triangles: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheEvictions: 0,
    renderLoopProceduralSamples: 0,
  };

  function surfaceActive() {
    return Boolean(mode.isActive?.() && document.documentElement.dataset.surfaceMode === 'active');
  }

  function anchorFromSurface() {
    const s = surface.getStats();
    const parts = String(s.activeChunkKey || '').split(':').map(Number);
    if (parts.length !== 2 || !parts.every(Number.isFinite)) return null;
    return {
      key: s.activeChunkKey,
      stride: s.chunkStride,
      x: wrap((parts[0] + 0.5) * s.chunkStride, world.width),
      y: clamp((parts[1] + 0.5) * s.chunkStride, 0, world.height),
    };
  }

  function sphereSag(x, z) {
    const d2 = x * x + z * z;
    const r2 = curvatureRadius * curvatureRadius;
    return curvatureRadius - Math.sqrt(Math.max(1, r2 - Math.min(d2, r2 - 1)));
  }

  function widthFor(point) {
    const flowWidth = Math.log1p(Math.max(0, point.flow)) * 0.72;
    const strengthWidth = clamp(point.river, 0, 1) * 3.2;
    const deltaWidth = clamp(point.delta, 0, 1) * 3.8;
    return clamp(0.72 + flowWidth + strengthWidth + deltaWidth, 0.85, 7.4);
  }

  function traceToLocal(trace, anchor) {
    const local = [];
    let previousX = null;
    for (const point of trace) {
      const wx = (point.gx + 0.5) * cellWorldX;
      const wy = (point.gy + 0.5) * cellWorldY;
      let lx = shortestWrappedDelta(wx, anchor.x, world.width);
      if (previousX !== null) {
        while (lx - previousX > world.width * 0.5) lx -= world.width;
        while (lx - previousX < -world.width * 0.5) lx += world.width;
      }
      previousX = lx;
      local.push({
        x: lx,
        z: wy - anchor.y,
        elevation: point.elevation,
        flow: point.flow,
        river: point.river,
        delta: point.delta,
      });
    }
    return local;
  }

  function traceTouchesField(local) {
    for (const p of local) if (p.x * p.x + p.z * p.z <= FIELD_RADIUS_SQ) return true;
    return false;
  }

  function geometryForAnchor(anchor) {
    const positions = [];
    const strengths = [];
    const coords = [];
    const indices = [];
    let vertexBase = 0;
    let selected = 0;
    let ribbons = 0;

    for (const trace of graph.traces) {
      const localRaw = traceToLocal(trace, anchor);
      if (!traceTouchesField(localRaw)) continue;
      selected++;
      const local = chaikin(localRaw, CHAIKIN_PASSES);
      if (local.length < 2) continue;
      let distanceAlong = 0;

      for (let i = 0; i < local.length; i++) {
        const p = local[i];
        const prev = local[Math.max(0, i - 1)];
        const next = local[Math.min(local.length - 1, i + 1)];
        let dx = next.x - prev.x;
        let dz = next.z - prev.z;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len;
        dz /= len;
        const px = -dz;
        const pz = dx;
        const halfWidth = widthFor(p) * 0.5;
        const sag = sphereSag(p.x, p.z);
        const y = clamp(p.elevation, 0, 1) * Z_SCALE - sag + Y_OFFSET;
        if (i > 0) distanceAlong += Math.hypot(p.x - local[i - 1].x, p.z - local[i - 1].z);
        const strength = clamp(0.15 + p.river * 0.72 + Math.log1p(Math.max(0, p.flow)) * 0.055 + p.delta * 0.2, 0, 1);

        positions.push(p.x + px * halfWidth, y, p.z + pz * halfWidth);
        positions.push(p.x - px * halfWidth, y, p.z - pz * halfWidth);
        strengths.push(strength, strength);
        coords.push(distanceAlong, distanceAlong);
      }

      for (let i = 0; i < local.length - 1; i++) {
        const a = vertexBase + i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        indices.push(a, c, b, b, c, d);
      }
      vertexBase += local.length * 2;
      ribbons++;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('riverStrength', new THREE.Float32BufferAttribute(strengths, 1));
    geometry.setAttribute('riverCoord', new THREE.Float32BufferAttribute(coords, 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return { geometry, selected, ribbons, vertices: positions.length / 3, triangles: indices.length / 3 };
  }

  function touchCache(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    cache.delete(key);
    cache.set(key, entry);
    return entry;
  }

  function evictCacheIfNeeded() {
    while (cache.size > CACHE_LIMIT) {
      const firstKey = cache.keys().next().value;
      const entry = cache.get(firstKey);
      cache.delete(firstKey);
      if (entry?.geometry && entry.geometry !== mesh?.geometry) entry.geometry.dispose();
      stats.cacheEvictions++;
    }
  }

  function applyGeometry(entry, anchor) {
    const next = new THREE.Mesh(entry.geometry, material);
    next.name = 'surfaceRiversV41';
    next.frustumCulled = true;
    next.castShadow = false;
    next.receiveShadow = false;
    next.renderOrder = 3;
    if (mesh) scene.remove(mesh);
    mesh = next;
    meshAnchor = anchor;
    scene.add(mesh);
    stats.tracesSelected = entry.selected;
    stats.ribbonsBuilt = entry.ribbons;
    stats.vertices = entry.vertices;
    stats.triangles = entry.triangles;
    document.documentElement.dataset.surfaceRiversV41 = 'ready';
  }

  function build(anchor) {
    const cached = touchCache(anchor.key);
    if (cached) {
      stats.cacheHits++;
      applyGeometry(cached, anchor);
      requestedKey = '';
      return;
    }
    stats.cacheMisses++;
    requestedKey = anchor.key;
    const buildGeneration = ++generation;
    stats.buildsStarted++;

    scheduleIdle(() => {
      if (buildGeneration !== generation || !surfaceActive()) {
        stats.buildsCancelled++;
        return;
      }
      const entry = geometryForAnchor(anchor);
      if (buildGeneration !== generation || !surfaceActive()) {
        entry.geometry.dispose();
        stats.buildsCancelled++;
        return;
      }
      cache.set(anchor.key, entry);
      evictCacheIfNeeded();
      applyGeometry(entry, anchor);
      requestedKey = '';
      stats.buildsCompleted++;
    }, 260);
  }

  function loop(now) {
    requestAnimationFrame(loop);
    material.uniforms.time.value += clamp((now - lastNow) / 1000, 0, 0.05);
    lastNow = now;
    const active = surfaceActive();
    if (!active) {
      if (lastSurfaceActive) {
        lastSurfaceActive = false;
        generation++;
        requestedKey = '';
        if (mesh) mesh.visible = false;
      }
      return;
    }
    lastSurfaceActive = true;
    if (mesh) mesh.visible = true;
    const anchor = anchorFromSurface();
    if (!anchor) return;
    if (meshAnchor) mesh.position.set(shortestWrappedDelta(meshAnchor.x, anchor.x, world.width), 0, meshAnchor.y - anchor.y);
    if (anchor.key !== meshAnchor?.key && anchor.key !== requestedKey) build(anchor);
  }
  requestAnimationFrame(loop);

  const api = {
    installed: true,
    getStats: () => ({
      ...stats,
      active: surfaceActive(),
      graphPrecomputed: true,
      continuousDownhillChannels: true,
      tributaryConfluences: true,
      cachedChunkGeometry: true,
      cacheLimit: CACHE_LIMIT,
      cacheSize: cache.size,
      fieldRadius: FIELD_RADIUS,
      activeChunkKey: meshAnchor?.key || '',
      requestedChunkKey: requestedKey,
      animatedFlowShader: true,
      hydrologySamplesInRenderLoop: 0,
      terrainSamplesInRenderLoop: 0,
      globalDisplayCap: false,
    }),
  };
  window.realitySandboxSurfaceRiversV41 = api;
  document.documentElement.dataset.surfaceRiversV41 = 'installed';

  const previousDiagnostics = window.realitySandboxPresentationDiagnostics;
  window.realitySandboxPresentationDiagnostics = () => ({
    ...(typeof previousDiagnostics === 'function' ? previousDiagnostics() : {}),
    surfaceRiversV41: api.getStats(),
  });
}

waitForRuntime().then(state => {
  if (!state) {
    document.documentElement.dataset.surfaceRiversV41 = 'unavailable';
    return;
  }
  install(state);
});

