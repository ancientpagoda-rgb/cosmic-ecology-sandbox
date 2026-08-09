import * as THREE from 'three';
import { biomeColor } from './planet.js';

const SEA_LEVEL = 0.53;
const Z_SCALE = 62;
const TILE_SIZE = 420;
const TILE_HALF = TILE_SIZE / 2;
const CHUNK_STRIDE = 72;
const NEAR_SEGMENTS_DESKTOP = 72;
const NEAR_SEGMENTS_MOBILE = 52;
const MID_SEGMENTS_DESKTOP = 18;
const MID_SEGMENTS_MOBILE = 14;
const FAR_SEGMENTS_DESKTOP = 10;
const FAR_SEGMENTS_MOBILE = 8;
const NEAR_SAMPLES_PER_SLICE = 150;
const DISTANT_SAMPLES_PER_SLICE = 80;
const DISTANT_START_DELAY_MS = 360;
const FOV_DEGREES = 100;
const TILE_OVERLAP = 1.003;
const CURVATURE_RADIUS_FACTOR = 22.0;
const NEAR_CACHE_LIMIT = 3;
const REAR_VIEW_DOT_THRESHOLD = -0.22;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrap = (value, max) => ((value % max) + max) % max;

function shortestWrappedDelta(value, origin, size) {
  let delta = value - origin;
  if (delta > size * 0.5) delta -= size;
  else if (delta < -size * 0.5) delta += size;
  return delta;
}

function scheduleIdle(fn, timeout = 100) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout });
  else setTimeout(() => fn({ timeRemaining: () => 4, didTimeout: true }), 0);
}

async function waitForRuntime() {
  for (let attempt = 0; attempt < 300; attempt++) {
    const planet = window.realitySandboxPlanet;
    const modules = window.realitySandboxModules;
    const mode = window.realitySandboxSurfaceMode;
    const layer = document.getElementById('surfaceModeLayer');
    const inputCanvas = document.getElementById('surfaceModeCanvas');
    if (
      planet?.world && planet?.living?.sampleDynamicPlanet && planet?.waterCycle?.sample &&
      modules?.step && mode?.getPlayer && mode?.isActive && layer && inputCanvas
    ) return { planet, modules, mode, layer, inputCanvas };
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  return null;
}

function install({ planet, modules, mode, layer, inputCanvas }) {
  if (window.realitySandboxSurfaceSphereV37?.installed) return;

  const { world, living, waterCycle } = planet;
  const mobile = matchMedia('(max-width: 720px), (pointer: coarse)').matches;
  const nearSegments = mobile ? NEAR_SEGMENTS_MOBILE : NEAR_SEGMENTS_DESKTOP;
  const midSegments = mobile ? MID_SEGMENTS_MOBILE : MID_SEGMENTS_DESKTOP;
  const farSegments = mobile ? FAR_SEGMENTS_MOBILE : FAR_SEGMENTS_DESKTOP;
  const curvatureRadius = Math.max(world.width, world.height) * CURVATURE_RADIUS_FACTOR;

  const stats = {
    frames: 0,
    activeFrames: 0,
    worldStepsSuppressed: 0,
    moduleStepsSuppressed: 0,
    hudTerrainReads: 0,
    hudWaterReads: 0,
    nearBuildRequests: 0,
    nearBuildsCompleted: 0,
    distantBuildsCompleted: 0,
    buildCancels: 0,
    terrainSamples: 0,
    waterSamples: 0,
    renderLoopProceduralSamples: 0,
    lastNearBuildMs: 0,
    lastNearBuildSamples: 0,
    distantTilesVisible: 0,
    midRingComplete: false,
    farRingComplete: false,
    contextLost: false,
    priorityQueueResorts: 0,
    behindViewDeferrals: 0,
    coarseTilesBuilt: 0,
    refinedTilesBuilt: 0,
    bestAvailableReplacements: 0,
    nearCacheHits: 0,
    nearCacheMisses: 0,
    nearCacheEvictions: 0,
  };

  const surfaceActive = () => Boolean(mode.isActive?.() && document.documentElement.dataset.surfaceMode === 'active');

  const previousBudget = world.getSphericalStepDt;
  world.getSphericalStepDt = function sphericalPresentationWorldBudget(dt) {
    if (surfaceActive()) {
      stats.worldStepsSuppressed++;
      return false;
    }
    return typeof previousBudget === 'function' ? previousBudget.call(world, dt) : dt;
  };

  const nativeModuleStep = modules.step.bind(modules);
  modules.step = function sphericalPresentationModuleStep(dt) {
    if (surfaceActive()) {
      stats.moduleStepsSuppressed++;
      return;
    }
    return nativeModuleStep(dt);
  };

  const nativeTerrainSample = living.sampleDynamicPlanet.bind(living);
  const nativeWaterSample = waterCycle.sample.bind(waterCycle);
  let cachedHudTerrain = Object.freeze({
    land: true, elevation: SEA_LEVEL, biome: 'terrain-loading', temperature: 18, moisture: 0.5, fertility: 0.5,
  });
  let cachedHudWater = Object.freeze({ rain: 0, cloud: 0, lake: 0, river: 0, snowpack: 0, groundwater: 0 });

  living.sampleDynamicPlanet = function cachedSurfaceTerrainRead(x, y, ...rest) {
    if (surfaceActive() && rest.length === 0) {
      stats.hudTerrainReads++;
      return cachedHudTerrain;
    }
    return nativeTerrainSample(x, y, ...rest);
  };

  waterCycle.sample = function cachedSurfaceWaterRead(x, y, ...rest) {
    if (surfaceActive() && rest.length === 0) {
      stats.hudWaterReads++;
      return cachedHudWater;
    }
    return nativeWaterSample(x, y, ...rest);
  };

  function normalizeSphereSample(x, y) {
    let sx = x;
    let sy = y;
    while (sy < 0 || sy > world.height) {
      if (sy < 0) {
        sy = -sy;
        sx += world.width * 0.5;
      } else if (sy > world.height) {
        sy = world.height - (sy - world.height);
        sx += world.width * 0.5;
      }
    }
    return { x: wrap(sx, world.width), y: clamp(sy, 0, world.height) };
  }

  function sphereSag(x, z) {
    const d2 = x * x + z * z;
    const r2 = curvatureRadius * curvatureRadius;
    return curvatureRadius - Math.sqrt(Math.max(1, r2 - Math.min(d2, r2 - 1)));
  }

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: false, antialias: false, powerPreference: 'high-performance', depth: true, stencil: false,
    });
  } catch {
    document.documentElement.dataset.surfaceGpu = 'sphere-v37-webgl-unavailable';
    return;
  }

  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.03;
  renderer.setClearColor(0x7798aa, 1);
  renderer.domElement.id = 'surfaceGpuCanvas';
  renderer.domElement.setAttribute('aria-label', 'View-priority cached spherical terrain and opaque water surface view of Nysa');
  Object.assign(renderer.domElement.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'none', zIndex: '0', pointerEvents: 'none',
  });
  layer.prepend(renderer.domElement);
  inputCanvas.style.zIndex = '1';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7798aa);
  scene.fog = new THREE.Fog(0x7798aa, 180, 1320);
  const camera = new THREE.PerspectiveCamera(FOV_DEGREES, 1, 0.1, 1700);

  scene.add(new THREE.HemisphereLight(0xdceeff, 0x2d3a31, 1.8));
  const sun = new THREE.DirectionalLight(0xfff0d2, 2.35);
  sun.position.set(110, 180, 75);
  scene.add(sun);

  const terrainMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 });
  const waterMaterial = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      deepColor: { value: new THREE.Color(0x073b61) },
      shallowColor: { value: new THREE.Color(0x2389a4) },
    },
    transparent: false,
    depthWrite: true,
    depthTest: true,
    side: THREE.DoubleSide,
    vertexShader: `
      uniform float time;
      attribute float waterStrength;
      varying float vWater;
      varying float vWave;
      void main() {
        vec3 p = position;
        float wave = (sin((p.x + time * 4.6) * 0.15) + cos((p.z - time * 3.9) * 0.13)) * 0.075 * waterStrength;
        p.y += wave;
        vWater = waterStrength;
        vWave = wave;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 deepColor;
      uniform vec3 shallowColor;
      varying float vWater;
      varying float vWave;
      void main() {
        if (vWater < 0.14) discard;
        float strength = smoothstep(0.14, 0.9, vWater);
        float depthMix = clamp(0.20 + strength * 0.68 - vWave * 1.25, 0.0, 1.0);
        vec3 color = mix(shallowColor, deepColor, depthMix);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });

  const fallbackGeometry = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE, 24, 24);
  fallbackGeometry.rotateX(-Math.PI / 2);
  const fallbackPositions = fallbackGeometry.attributes.position;
  for (let i = 0; i < fallbackPositions.count; i++) {
    const x = fallbackPositions.getX(i);
    const z = fallbackPositions.getZ(i);
    fallbackPositions.setY(i, SEA_LEVEL * Z_SCALE - sphereSag(x, z));
  }
  fallbackGeometry.computeVertexNormals();
  const fallback = new THREE.Mesh(
    fallbackGeometry,
    new THREE.MeshStandardMaterial({ color: 0x527a55, roughness: 1 }),
  );
  scene.add(fallback);

  let nearTerrainMesh = null;
  let nearWaterMesh = null;
  let nearTerrainData = null;
  const nearCache = new Map();
  const distantTiles = new Map();
  let anchorX = NaN;
  let anchorY = NaN;
  let activeChunkKey = '';
  let requestedChunkKey = '';
  let generation = 0;
  let lastWidth = 0;
  let lastHeight = 0;
  let distantQueueTimer = 0;
  let lastSurfaceActive = false;

  function chunkForPlayer(player) {
    const chunkX = Math.floor(player.x / CHUNK_STRIDE);
    const chunkY = Math.floor(player.y / CHUNK_STRIDE);
    return {
      key: `${chunkX}:${chunkY}`,
      x: wrap((chunkX + 0.5) * CHUNK_STRIDE, world.width),
      y: clamp((chunkY + 0.5) * CHUNK_STRIDE, 0, world.height),
    };
  }

  function terrainColor(sample) {
    if (!sample?.land) return [0.055, 0.30, 0.46];
    const color = biomeColor(sample);
    return [color[0] / 255, color[1] / 255, color[2] / 255];
  }

  function waterStrengthFor(terrain, water) {
    if (!terrain?.land) return 1;
    return clamp(Math.max(water?.lake || 0, (water?.river || 0) * 0.92), 0, 1);
  }

  function disposePair(pair) {
    if (!pair) return;
    if (pair.terrain) {
      scene.remove(pair.terrain);
      pair.terrain.geometry.dispose();
    }
    if (pair.water) {
      scene.remove(pair.water);
      pair.water.geometry.dispose();
    }
  }

  function clearDistantTiles() {
    for (const pair of distantTiles.values()) disposePair(pair);
    distantTiles.clear();
    stats.distantTilesVisible = 0;
    stats.midRingComplete = false;
    stats.farRingComplete = false;
  }

  function clearNearCache() {
    for (const entry of nearCache.values()) disposePair(entry);
    nearCache.clear();
  }

  function stashCurrentNear() {
    if (!nearTerrainMesh || !nearWaterMesh || !nearTerrainData || !activeChunkKey) return;
    scene.remove(nearTerrainMesh, nearWaterMesh);
    nearCache.delete(activeChunkKey);
    nearCache.set(activeChunkKey, {
      terrain: nearTerrainMesh,
      water: nearWaterMesh,
      data: nearTerrainData,
    });
    while (nearCache.size > NEAR_CACHE_LIMIT) {
      const oldestKey = nearCache.keys().next().value;
      const oldest = nearCache.get(oldestKey);
      nearCache.delete(oldestKey);
      disposePair(oldest);
      stats.nearCacheEvictions++;
    }
    nearTerrainMesh = null;
    nearWaterMesh = null;
    nearTerrainData = null;
  }

  function activateNearPair(chunk, pair, fromCache = false) {
    if (nearTerrainMesh || nearWaterMesh) stashCurrentNear();
    nearTerrainMesh = pair.terrain;
    nearWaterMesh = pair.water;
    nearTerrainData = pair.data || {
      heights: pair.heights,
      side: pair.side,
      segments: pair.segments,
      anchorX: chunk.x,
      anchorY: chunk.y,
      centerTerrain: pair.centerTerrain,
      centerWater: pair.centerWater,
    };
    if (fromCache) scene.add(nearTerrainMesh, nearWaterMesh);
    anchorX = chunk.x;
    anchorY = chunk.y;
    activeChunkKey = chunk.key;
    requestedChunkKey = '';
    fallback.visible = false;
    if (nearTerrainData.centerTerrain) cachedHudTerrain = nearTerrainData.centerTerrain;
    if (nearTerrainData.centerWater) cachedHudWater = nearTerrainData.centerWater;
  }

  function buildTile({ tileX, tileY, offsetX, offsetZ, segments, samplesPerSlice, buildGeneration, kind, onComplete }) {
    const terrainGeometry = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE, segments, segments);
    terrainGeometry.rotateX(-Math.PI / 2);
    const positions = terrainGeometry.attributes.position;
    const colors = new Float32Array(positions.count * 3);
    const heights = new Float32Array(positions.count);
    const waterHeights = new Float32Array(positions.count);
    const waterStrengths = new Float32Array(positions.count);
    let index = 0;
    let centerTerrain = null;
    let centerWater = null;
    let cancelled = false;

    function cancel() {
      if (cancelled) return;
      cancelled = true;
      terrainGeometry.dispose();
      stats.buildCancels++;
    }

    function slice(deadline) {
      if (buildGeneration !== generation || !surfaceActive()) {
        cancel();
        return;
      }

      let count = 0;
      while (index < positions.count) {
        const localX = positions.getX(index);
        const localZ = positions.getZ(index);
        const normalized = normalizeSphereSample(tileX + localX, tileY + localZ);
        const terrain = nativeTerrainSample(normalized.x, normalized.y);
        const water = nativeWaterSample(normalized.x, normalized.y);
        stats.terrainSamples++;
        stats.waterSamples++;
        count++;

        const tangentX = offsetX + localX;
        const tangentZ = offsetZ + localZ;
        const sag = sphereSag(tangentX, tangentZ);
        const elevation = terrain?.land ? clamp(terrain.elevation ?? SEA_LEVEL, 0, 1) : SEA_LEVEL - 0.005;
        const height = elevation * Z_SCALE - sag;
        heights[index] = height;
        positions.setY(index, height);

        const color = terrainColor(terrain);
        colors[index * 3] = color[0];
        colors[index * 3 + 1] = color[1];
        colors[index * 3 + 2] = color[2];

        const waterStrength = waterStrengthFor(terrain, water);
        waterStrengths[index] = waterStrength;
        waterHeights[index] = terrain?.land
          ? height + 0.10
          : SEA_LEVEL * Z_SCALE + 0.14 - sag;

        if (index === Math.floor(positions.count / 2)) {
          centerTerrain = terrain;
          centerWater = water;
        }
        index++;

        if (count >= samplesPerSlice) break;
        if (deadline?.timeRemaining && deadline.timeRemaining() < 1.2) break;
      }

      if (index < positions.count) {
        scheduleIdle(slice, kind === 'near' ? 80 : 180);
        return;
      }
      if (buildGeneration !== generation || !surfaceActive()) {
        cancel();
        return;
      }

      terrainGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      terrainGeometry.computeVertexNormals();
      const terrainMesh = new THREE.Mesh(terrainGeometry, terrainMaterial);
      terrainMesh.frustumCulled = true;
      terrainMesh.position.set(offsetX, 0, offsetZ);
      if (kind !== 'near') terrainMesh.scale.set(TILE_OVERLAP, 1, TILE_OVERLAP);

      const waterGeometry = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE, segments, segments);
      waterGeometry.rotateX(-Math.PI / 2);
      const waterPositions = waterGeometry.attributes.position;
      for (let i = 0; i < waterPositions.count; i++) waterPositions.setY(i, waterHeights[i]);
      waterGeometry.setAttribute('waterStrength', new THREE.BufferAttribute(waterStrengths, 1));
      const waterMesh = new THREE.Mesh(waterGeometry, waterMaterial);
      waterMesh.position.set(offsetX, 0, offsetZ);
      if (kind !== 'near') waterMesh.scale.set(TILE_OVERLAP, 1, TILE_OVERLAP);
      waterMesh.renderOrder = 3;

      scene.add(terrainMesh, waterMesh);
      onComplete({ terrain: terrainMesh, water: waterMesh, heights, centerTerrain, centerWater, side: segments + 1, segments });
    }

    scheduleIdle(slice, kind === 'near' ? 80 : 180);
  }

  function ringOffsets(radius) {
    const result = [];
    for (let z = -radius; z <= radius; z++) {
      for (let x = -radius; x <= radius; x++) {
        if (Math.max(Math.abs(x), Math.abs(z)) !== radius) continue;
        result.push({ x, z });
      }
    }
    return result;
  }

  function taskViewDot(task, player) {
    const length = Math.hypot(task.x, task.z) || 1;
    const fx = Math.cos(player.yaw || 0);
    const fz = Math.sin(player.yaw || 0);
    return (task.x * fx + task.z * fz) / length;
  }

  function taskPriority(task, player) {
    const dot = taskViewDot(task, player);
    const ringBonus = task.ring === 1 ? 0.75 : 0;
    const stageBonus = task.stage === 'base' ? 0.55 : 0.12;
    return dot * 2.6 + ringBonus + stageBonus;
  }

  function queueDistantRings(buildGeneration) {
    clearTimeout(distantQueueTimer);
    distantQueueTimer = setTimeout(() => {
      if (buildGeneration !== generation || !surfaceActive() || !Number.isFinite(anchorX)) return;

      const tasks = [
        ...ringOffsets(1).map(offset => ({ ...offset, ring: 1, stage: 'base', segments: farSegments })),
        ...ringOffsets(2).map(offset => ({ ...offset, ring: 2, stage: 'base', segments: farSegments })),
        ...ringOffsets(1).map(offset => ({ ...offset, ring: 1, stage: 'refine', segments: midSegments })),
      ];

      function buildNext() {
        if (buildGeneration !== generation || !surfaceActive()) return;
        if (!tasks.length) {
          stats.midRingComplete = [...distantTiles.entries()].filter(([key]) => key.startsWith('1:')).length >= 8;
          stats.farRingComplete = [...distantTiles.entries()].filter(([key]) => key.startsWith('2:')).length >= 16;
          document.documentElement.dataset.surfaceDistantRings = 'view-covered';
          return;
        }

        const player = mode.getPlayer();
        tasks.sort((a, b) => taskPriority(b, player) - taskPriority(a, player));
        stats.priorityQueueResorts++;

        let index = tasks.findIndex(task => task.stage === 'base' || distantTiles.has(`${task.ring}:${task.x}:${task.z}`));
        if (index < 0) {
          scheduleIdle(buildNext, 240);
          return;
        }

        const best = tasks[index];
        const bestDot = taskViewDot(best, player);
        if (bestDot < REAR_VIEW_DOT_THRESHOLD && distantTiles.size >= 8) {
          stats.behindViewDeferrals++;
          setTimeout(() => scheduleIdle(buildNext, 240), 180);
          return;
        }

        const item = tasks.splice(index, 1)[0];
        const key = `${item.ring}:${item.x}:${item.z}`;
        const offsetX = item.x * TILE_SIZE;
        const offsetZ = item.z * TILE_SIZE;
        const tileX = anchorX + offsetX;
        const tileY = anchorY + offsetZ;

        buildTile({
          tileX,
          tileY,
          offsetX,
          offsetZ,
          segments: item.segments,
          samplesPerSlice: DISTANT_SAMPLES_PER_SLICE,
          buildGeneration,
          kind: item.stage === 'refine' ? 'mid' : 'far',
          onComplete: pair => {
            if (buildGeneration !== generation || !surfaceActive()) {
              disposePair(pair);
              return;
            }

            const previous = distantTiles.get(key);
            if (previous) {
              disposePair(previous);
              stats.bestAvailableReplacements++;
            }
            pair.stage = item.stage;
            pair.ring = item.ring;
            distantTiles.set(key, pair);
            stats.distantBuildsCompleted++;
            stats.distantTilesVisible = distantTiles.size;
            if (item.stage === 'base') stats.coarseTilesBuilt++;
            else stats.refinedTilesBuilt++;
            document.documentElement.dataset.surfaceDistantTiles = String(distantTiles.size);
            scheduleIdle(buildNext, 220);
          },
        });
      }

      scheduleIdle(buildNext, 220);
    }, DISTANT_START_DELAY_MS);
  }

  function requestNearBuild(player) {
    const chunk = chunkForPlayer(player);
    if (chunk.key === activeChunkKey || chunk.key === requestedChunkKey) return;

    const cached = nearCache.get(chunk.key);
    if (cached) {
      const buildGeneration = ++generation;
      nearCache.delete(chunk.key);
      clearTimeout(distantQueueTimer);
      clearDistantTiles();
      activateNearPair(chunk, cached, true);
      stats.nearCacheHits++;
      stats.nearBuildsCompleted++;
      document.documentElement.dataset.surfaceTerrainChunk = activeChunkKey;
      document.documentElement.dataset.surfaceDistantRings = 'loading';
      queueDistantRings(buildGeneration);
      return;
    }

    stats.nearCacheMisses++;
    requestedChunkKey = chunk.key;
    const buildGeneration = ++generation;
    stats.nearBuildRequests++;
    clearTimeout(distantQueueTimer);
    clearDistantTiles();
    const startedAt = performance.now();
    const terrainAtStart = stats.terrainSamples;
    const waterAtStart = stats.waterSamples;

    buildTile({
      tileX: chunk.x,
      tileY: chunk.y,
      offsetX: 0,
      offsetZ: 0,
      segments: nearSegments,
      samplesPerSlice: NEAR_SAMPLES_PER_SLICE,
      buildGeneration,
      kind: 'near',
      onComplete: pair => {
        if (buildGeneration !== generation || !surfaceActive()) {
          disposePair(pair);
          return;
        }

        pair.data = {
          heights: pair.heights,
          side: pair.side,
          segments: pair.segments,
          anchorX: chunk.x,
          anchorY: chunk.y,
          centerTerrain: pair.centerTerrain,
          centerWater: pair.centerWater,
        };
        activateNearPair(chunk, pair, false);

        stats.nearBuildsCompleted++;
        stats.lastNearBuildMs = performance.now() - startedAt;
        stats.lastNearBuildSamples = (stats.terrainSamples - terrainAtStart) + (stats.waterSamples - waterAtStart);
        document.documentElement.dataset.surfaceTerrainChunk = activeChunkKey;
        document.documentElement.dataset.surfaceTerrainBuildMs = stats.lastNearBuildMs.toFixed(1);
        document.documentElement.dataset.surfaceDistantRings = 'loading';
        queueDistantRings(buildGeneration);
      },
    });
  }

  function cachedGroundHeight(player) {
    if (!nearTerrainData) return SEA_LEVEL * Z_SCALE;
    const localX = shortestWrappedDelta(player.x, nearTerrainData.anchorX, world.width);
    const localZ = player.y - nearTerrainData.anchorY;
    const segments = nearTerrainData.segments;
    const u = clamp((localX + TILE_HALF) / TILE_SIZE, 0, 1) * segments;
    const v = clamp((localZ + TILE_HALF) / TILE_SIZE, 0, 1) * segments;
    const x0 = Math.floor(u);
    const z0 = Math.floor(v);
    const x1 = Math.min(segments, x0 + 1);
    const z1 = Math.min(segments, z0 + 1);
    const tx = u - x0;
    const tz = v - z0;
    const at = (x, z) => nearTerrainData.heights[z * nearTerrainData.side + x] ?? SEA_LEVEL * Z_SCALE;
    const a = at(x0, z0) * (1 - tx) + at(x1, z0) * tx;
    const b = at(x0, z1) * (1 - tx) + at(x1, z1) * tx;
    return a * (1 - tz) + b * tz;
  }

  function resize() {
    const rect = layer.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width;
    lastHeight = height;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function isPresenting() {
    return surfaceActive() && !stats.contextLost;
  }

  renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    stats.contextLost = true;
    document.documentElement.dataset.surfaceGpu = 'sphere-v37-context-lost';
  }, false);
  renderer.domElement.addEventListener('webglcontextrestored', () => { stats.contextLost = false; }, false);

  const up = new THREE.Vector3();
  const east = new THREE.Vector3();
  const south = new THREE.Vector3();
  const horizontal = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const cameraPosition = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();

  function updateCamera(player) {
    const localX = Number.isFinite(anchorX) ? shortestWrappedDelta(player.x, anchorX, world.width) : 0;
    const localZ = Number.isFinite(anchorY) ? player.y - anchorY : 0;
    const groundY = cachedGroundHeight(player);
    const baseSphereY = -sphereSag(localX, localZ);

    up.set(localX, baseSphereY + curvatureRadius, localZ).normalize();
    east.set(up.y, -up.x, 0).normalize();
    south.crossVectors(east, up).normalize();

    const altitude = Math.max(3.6, player.altitude || 3.6);
    cameraPosition.set(localX, groundY, localZ).addScaledVector(up, altitude);
    horizontal.copy(east).multiplyScalar(Math.cos(player.yaw || 0)).addScaledVector(south, Math.sin(player.yaw || 0)).normalize();
    forward.copy(horizontal).multiplyScalar(Math.cos(player.pitch || 0)).addScaledVector(up, Math.sin(player.pitch || 0)).normalize();

    camera.position.copy(cameraPosition);
    camera.up.copy(up);
    lookTarget.copy(cameraPosition).addScaledVector(forward, 30);
    camera.lookAt(lookTarget);
  }

  function loop(now) {
    requestAnimationFrame(loop);
    stats.frames++;
    const active = surfaceActive();
    if (!active) {
      renderer.domElement.style.display = 'none';
      if (lastSurfaceActive) {
        lastSurfaceActive = false;
        generation++;
        requestedChunkKey = '';
        activeChunkKey = '';
        clearTimeout(distantQueueTimer);
        clearDistantTiles();
        clearNearCache();
      }
      return;
    }

    lastSurfaceActive = true;
    stats.activeFrames++;
    renderer.domElement.style.display = 'block';
    inputCanvas.style.opacity = '0';
    resize();

    const player = mode.getPlayer();
    requestNearBuild(player);
    updateCamera(player);

    waterMaterial.uniforms.time.value = now * 0.001;
    renderer.render(scene, camera);
    document.documentElement.dataset.surfaceGpu = 'active';
    document.documentElement.dataset.surfaceModeVisibleCreatures = '0';
  }
  requestAnimationFrame(loop);

  const gpuApi = {
    installed: true,
    isPresenting,
    getStats: () => ({
      renderer: 'WebGLRenderer',
      gpuPrimary: true,
      active: isPresenting(),
      diagnosticScene: 'view-priority-best-available-spherical-terrain-water',
      frames: stats.frames,
      activeFrames: stats.activeFrames,
      rendererInfo: {
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        points: renderer.info.render.points,
        lines: renderer.info.render.lines,
      },
    }),
  };
  window.realitySandboxSurfaceGpu = gpuApi;

  const api = {
    installed: true,
    getStats: () => ({
      ...stats,
      surfaceActive: surfaceActive(),
      scene: 'view-priority-best-available-spherical-terrain-water',
      simulationRunning: !surfaceActive(),
      waterEnabled: true,
      waterOpaque: true,
      vegetationEnabled: false,
      weatherEnabled: false,
      creaturesEnabled: false,
      proceduralSamplingInRenderLoop: false,
      sphereCurvatureEnabled: true,
      sphericalPoleSampling: true,
      curvatureRadius,
      curvatureRadiusFactor: CURVATURE_RADIUS_FACTOR,
      presentationScaleMultiplier: 10,
      activeChunkKey,
      requestedChunkKey,
      nearSegments,
      midSegments,
      farSegments,
      tileSize: TILE_SIZE,
      chunkStride: CHUNK_STRIDE,
      plannedDistantTiles: 24,
      viewPriorityEnabled: true,
      bestAvailableRefinement: true,
      rearTileDeferral: true,
      nearCacheLimit: NEAR_CACHE_LIMIT,
      nearCacheSize: nearCache.size,
    }),
  };

  window.realitySandboxSurfaceSphereV37 = api;
  document.documentElement.dataset.surfaceSphereV37 = 'view-priority-best-available';
  document.documentElement.dataset.surfacePresentationScale = '10x';

  const previousDiagnostics = window.realitySandboxPresentationDiagnostics;
  window.realitySandboxPresentationDiagnostics = () => ({
    ...(typeof previousDiagnostics === 'function' ? previousDiagnostics() : {}),
    surfaceGpu: gpuApi.getStats(),
    surfaceSphereV37: api.getStats(),
  });
}

async function boot() {
  const state = await waitForRuntime();
  if (!state) {
    document.documentElement.dataset.surfaceSphereV37 = 'unavailable';
    return;
  }
  install(state);
}

boot();

