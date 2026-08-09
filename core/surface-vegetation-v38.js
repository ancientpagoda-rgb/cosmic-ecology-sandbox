import * as THREE from 'three';

const TAU = Math.PI * 2;
const Z_SCALE = 62;
const NEAR_RADIUS = 190;
const MID_RADIUS = 430;
const NEAR_CELL = 10;
const MID_CELL = 22;
const SAMPLES_PER_SLICE = 38;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (v, max) => ((v % max) + max) % max;

function hash2(x, y, seed = 0) {
  let h = (Math.imul(Math.floor(x), 374761393) ^ Math.imul(Math.floor(y), 668265263) ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

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
    const hook = window.realitySandboxSurfaceLightHookV36;
    const objects = hook?.getObjects?.();
    if (planet?.world && planet?.living?.sampleDynamicPlanet && planet?.waterCycle?.sample && mode?.getPlayer && surface?.getStats && objects?.scene) {
      return { planet, mode, surface, scene: objects.scene };
    }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  return null;
}

function install({ planet, mode, surface, scene }) {
  if (window.realitySandboxSurfaceVegetationV38?.installed) return;
  const { world, living, waterCycle } = planet;
  const seed = window.realitySandboxSeed?.numericSeed || 734221;
  const curvatureRadius = surface.getStats().curvatureRadius;

  const trunkGeometry = new THREE.CylinderGeometry(0.18, 0.28, 2.4, 5, 1);
  trunkGeometry.translate(0, 1.2, 0);
  const canopyGeometry = new THREE.ConeGeometry(1.15, 3.8, 6, 1);
  canopyGeometry.translate(0, 3.35, 0);
  const shrubGeometry = new THREE.ConeGeometry(0.48, 1.25, 5, 1);
  shrubGeometry.translate(0, 0.62, 0);
  const farGeometry = new THREE.ConeGeometry(0.82, 2.6, 4, 1);
  farGeometry.translate(0, 1.3, 0);

  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x73543a, roughness: 1, metalness: 0 });
  const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const shrubMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const farMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });

  let group = null;
  let activeKey = '';
  let requestedKey = '';
  let buildGeneration = 0;
  let lastSurfaceActive = false;
  const stats = {
    buildsStarted: 0, buildsCompleted: 0, buildsCancelled: 0,
    terrainSamples: 0, waterSamples: 0, candidates: 0,
    nearTrees: 0, nearShrubs: 0, midPlants: 0,
    instances: 0, renderLoopProceduralSamples: 0,
  };

  function surfaceActive() {
    return mode.isActive?.() && document.documentElement.dataset.surfaceMode === 'active';
  }

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
    return {
      key: s.activeChunkKey,
      x: wrap((parts[0] + 0.5) * s.chunkStride, world.width),
      y: clamp((parts[1] + 0.5) * s.chunkStride, 0, world.height),
    };
  }

  function suitability(t, w) {
    if (!t?.land || ['ice', 'cold-desert', 'snow-mountain', 'mountain'].includes(t.biome)) return 0;
    const temp = Number.isFinite(t.temperature) ? t.temperature : 0.55;
    const rain = Number.isFinite(t.rainfall) ? t.rainfall : (Number.isFinite(t.moisture) ? t.moisture : 0.45);
    const fertility = Number.isFinite(t.fertility) ? t.fertility : 0.5;
    const waterBoost = clamp((w?.river || 0)*0.42 + (w?.lake || 0)*0.28 + (w?.delta || 0)*0.55, 0, 0.55);
    const temperatureFit = 1 - Math.abs(temp - 0.58) * 1.45;
    const desertPenalty = t.biome === 'desert' && waterBoost < 0.18 ? 0.18 : 1;
    return clamp((temperatureFit*0.38 + rain*0.38 + fertility*0.28 + waterBoost) * desertPenalty, 0, 1);
  }

  function disposeGroup() {
    if (!group) return;
    scene.remove(group);
    for (const child of group.children) child.dispose?.();
    group = null;
  }

  function createInstanced(geometry, material, matrices, colors) {
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, matrices.length));
    mesh.count = matrices.length;
    mesh.frustumCulled = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    for (let i = 0; i < matrices.length; i++) {
      mesh.setMatrixAt(i, matrices[i]);
      if (colors?.[i]) mesh.setColorAt(i, colors[i]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
  }

  function candidateCells(anchor, cell, radius, lod) {
    const result = [];
    const cx = Math.floor(anchor.x / cell), cy = Math.floor(anchor.y / cell), cr = Math.ceil(radius / cell);
    for (let gy = cy-cr; gy <= cy+cr; gy++) {
      for (let gx = cx-cr; gx <= cx+cr; gx++) {
        const jitterX = (hash2(gx+37, gy-17, seed+lod*101)-0.5)*cell*0.78;
        const jitterY = (hash2(gx-11, gy+53, seed+lod*211)-0.5)*cell*0.78;
        const wx = wrap((gx+0.5)*cell+jitterX, world.width);
        const wy = (gy+0.5)*cell+jitterY;
        const normalized = normalizeSphereSample(wx, wy);
        const lx = shortestWrappedDelta(normalized.x, anchor.x, world.width);
        const lz = normalized.y-anchor.y;
        const d2 = lx*lx+lz*lz;
        if (d2 > radius*radius) continue;
        if (lod === 1 && d2 <= NEAR_RADIUS*NEAR_RADIUS) continue;
        result.push({ gx, gy, wx: normalized.x, wy: normalized.y, lx, lz, d2, lod });
      }
    }
    return result;
  }

  function build(anchor) {
    const generation = ++buildGeneration;
    requestedKey = anchor.key;
    stats.buildsStarted++;
    const candidates = [...candidateCells(anchor, NEAR_CELL, NEAR_RADIUS, 0), ...candidateCells(anchor, MID_CELL, MID_RADIUS, 1)];
    stats.candidates += candidates.length;
    let index = 0;
    const trunks = [], trunkColors = [], canopies = [], canopyColors = [], shrubs = [], shrubColors = [], fars = [], farColors = [];
    const matrix = new THREE.Matrix4(), pos = new THREE.Vector3(), scale = new THREE.Vector3();
    const up = new THREE.Vector3(), yAxis = new THREE.Vector3(0,1,0), qAlign = new THREE.Quaternion(), qYaw = new THREE.Quaternion(), q = new THREE.Quaternion();

    function process(deadline) {
      if (generation !== buildGeneration || !surfaceActive()) { stats.buildsCancelled++; return; }
      let worked = 0;
      while (index < candidates.length) {
        const c = candidates[index++];
        const terrain = living.sampleDynamicPlanet(c.wx, c.wy, 'vegetation-v38');
        const water = waterCycle.sample(c.wx, c.wy, 'vegetation-v38');
        stats.terrainSamples++; stats.waterSamples++; worked++;
        if (!terrain?.land) continue;
        if (Math.max(water?.lake || 0, (water?.river || 0)*0.92) > 0.22) continue;
        const fit = suitability(terrain, water);
        if (fit < 0.18) continue;
        const chanceNoise = hash2(c.gx, c.gy, seed + c.lod*991);
        const biome = terrain.biome || 'grassland';
        let chance = biome === 'rainforest' ? 0.94 : biome === 'forest' ? 0.82 : biome === 'grassland' ? 0.44 : biome === 'steppe' ? 0.30 : biome === 'desert' ? 0.08 : 0.18;
        chance *= 0.48 + fit*0.74;
        if (c.lod === 1) chance *= 0.52;
        if (chanceNoise > chance) continue;

        const sag = sphereSag(c.lx, c.lz);
        const y = clamp(terrain.elevation ?? 0.53, 0, 1)*Z_SCALE - sag;
        up.set(c.lx, curvatureRadius - sag, c.lz).normalize();
        qAlign.setFromUnitVectors(yAxis, up);
        qYaw.setFromAxisAngle(yAxis, hash2(c.gx+71, c.gy+29, seed)*TAU);
        q.copy(qAlign).multiply(qYaw);
        const rand = 0.72 + hash2(c.gx+9, c.gy+7, seed)*0.72;
        pos.set(c.lx, y, c.lz);

        if (c.lod === 1) {
          scale.set(rand, rand, rand); matrix.compose(pos, q, scale); fars.push(matrix.clone());
          farColors.push(new THREE.Color(biome === 'rainforest' ? 0x245f32 : biome === 'forest' ? 0x3b7040 : 0x728a45));
        } else if (biome === 'forest' || biome === 'rainforest') {
          const tall = biome === 'rainforest' ? 1.28 : 1;
          scale.set(rand*0.95, rand*tall, rand*0.95); matrix.compose(pos, q, scale); trunks.push(matrix.clone()); canopies.push(matrix.clone());
          trunkColors.push(new THREE.Color(biome === 'rainforest' ? 0x654830 : 0x76553b));
          canopyColors.push(new THREE.Color(biome === 'rainforest' ? 0x1f7139 : 0x3b7f42));
        } else {
          const low = biome === 'grassland' ? 0.8 : 0.62;
          scale.set(rand*low, rand*(0.55+fit*0.5), rand*low); matrix.compose(pos, q, scale); shrubs.push(matrix.clone());
          shrubColors.push(new THREE.Color(biome === 'desert' ? 0x8b844e : biome === 'steppe' ? 0x7c914d : 0x6e9d48));
        }

        if (worked >= SAMPLES_PER_SLICE) break;
        if (deadline?.timeRemaining && deadline.timeRemaining() < 1.1) break;
      }
      if (index < candidates.length) { requestIdleCallback(process, { timeout: 260 }); return; }
      if (generation !== buildGeneration || !surfaceActive()) { stats.buildsCancelled++; return; }

      const next = new THREE.Group();
      next.name = 'surfaceVegetationV38';
      next.add(createInstanced(trunkGeometry, trunkMaterial, trunks, trunkColors));
      next.add(createInstanced(canopyGeometry, foliageMaterial, canopies, canopyColors));
      next.add(createInstanced(shrubGeometry, shrubMaterial, shrubs, shrubColors));
      next.add(createInstanced(farGeometry, farMaterial, fars, farColors));
      disposeGroup(); group = next; scene.add(group);
      activeKey = anchor.key;
      requestedKey = '';
      stats.nearTrees = canopies.length; stats.nearShrubs = shrubs.length; stats.midPlants = fars.length;
      stats.instances = trunks.length + canopies.length + shrubs.length + fars.length;
      stats.buildsCompleted++;
      document.documentElement.dataset.surfaceVegetationInstances = String(stats.instances);
    }
    requestIdleCallback(process, { timeout: 260 });
  }

  function loop() {
    requestAnimationFrame(loop);
    const active = surfaceActive();
    if (!active) {
      if (lastSurfaceActive) { lastSurfaceActive = false; buildGeneration++; activeKey = ''; requestedKey = ''; disposeGroup(); }
      return;
    }
    lastSurfaceActive = true;
    const s = surface.getStats();
    const anchor = anchorFromSurface(s);
    if (!anchor || anchor.key === activeKey || anchor.key === requestedKey) return;
    build(anchor);
  }
  requestAnimationFrame(loop);

  const api = {
    installed: true,
    getStats: () => ({
      ...stats,
      active: surfaceActive(),
      vegetationEnabled: true,
      gpuInstancing: true,
      biomeDriven: true,
      hydrologyFiltered: true,
      distanceLod: true,
      globalDisplayCap: false,
      activeChunkKey: activeKey,
      requestedChunkKey: requestedKey,
    }),
  };
  window.realitySandboxSurfaceVegetationV38 = api;
  document.documentElement.dataset.surfaceVegetationV38 = 'gpu-instanced-biome-lod';
  const prev = window.realitySandboxPresentationDiagnostics;
  window.realitySandboxPresentationDiagnostics = () => ({ ...(typeof prev === 'function' ? prev() : {}), surfaceVegetationV38: api.getStats() });
}

waitForRuntime().then(state => {
  if (!state) { document.documentElement.dataset.surfaceVegetationV38 = 'unavailable'; return; }
  install(state);
});

