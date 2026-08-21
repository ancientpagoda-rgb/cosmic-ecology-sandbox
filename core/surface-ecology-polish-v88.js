import * as THREE from 'three';

const BUILD = 'v88-layered-ecology-terrain-light';
const Z_SCALE = 62;
const SEA_LEVEL = 0.53;
const html = document.documentElement;
const mobile = matchMedia('(max-width: 720px), (pointer: coarse)').matches;
const GROUND_RADIUS = mobile ? 72 : 110;
const GROUND_CELL = mobile ? 8 : 5.5;
const MAX_GROUND_COVER = mobile ? 260 : 720;
const SAMPLES_PER_SLICE = mobile ? 28 : 44;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrap = (value, max) => ((value % max) + max) % max;

function hash2(x, y, seed = 0) {
  let h = (Math.imul(Math.floor(x), 374761393) ^ Math.imul(Math.floor(y), 668265263) ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function requestIdle(fn, timeout = 220) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout });
  else setTimeout(() => fn({ timeRemaining: () => 3, didTimeout: true }), 0);
}

async function waitForRuntime() {
  for (let attempt = 0; attempt < 320; attempt += 1) {
    const planet = window.realitySandboxPlanet;
    const mode = window.realitySandboxSurfaceMode;
    const surface = window.realitySandboxSurfaceSphereV37;
    const objects = window.realitySandboxSurfaceLightHookV36?.getObjects?.();
    if (
      planet?.world && planet?.living?.sampleDynamicPlanet && planet?.waterCycle?.sample &&
      mode?.isActive && surface?.getStats && objects?.scene && objects?.renderer
    ) {
      return { planet, mode, surface, ...objects };
    }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  return null;
}

function install({ planet, mode, surface, scene, renderer, sun, hemisphere }) {
  if (window.realitySandboxSurfaceEcologyV88?.installed) return;

  const { world, living, waterCycle } = planet;
  const seed = Number(window.realitySandboxSeed?.numericSeed || 734221);
  const patchedMaterials = new WeakSet();
  const patchedObjects = new WeakSet();
  const stats = {
    installed: true,
    floraMeshesBrightened: 0,
    terrainMaterialsDetailed: 0,
    terrainMeshesReceivingShadows: 0,
    shadowCasters: 0,
    coverBuilds: 0,
    coverInstances: 0,
    coverTerrainSamples: 0,
    coverWaterSamples: 0,
    activeChunkKey: '',
  };

  // Keep foliage readable from every direction. The old black silhouettes were
  // especially noticeable on surfaces facing away from the directional sun.
  if (hemisphere) {
    hemisphere.intensity = Math.max(Number(hemisphere.intensity) || 0, 2.05);
    hemisphere.groundColor?.setHex?.(0x5e6954);
  }

  // One modest shadow map gives the large evolved plants a contact anchor. Far
  // vegetation remains non-shadow-casting, so the ecology layer stays cheap.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (sun) {
    sun.castShadow = true;
    const size = mobile ? 512 : 1024;
    sun.shadow.mapSize.set(size, size);
    sun.shadow.camera.left = -150;
    sun.shadow.camera.right = 150;
    sun.shadow.camera.top = 150;
    sun.shadow.camera.bottom = -150;
    sun.shadow.camera.near = 8;
    sun.shadow.camera.far = 430;
    sun.shadow.bias = -0.00045;
    sun.shadow.normalBias = 0.035;
    sun.shadow.camera.updateProjectionMatrix?.();
  }

  function patchTerrainMaterial(material) {
    if (!material?.isMeshStandardMaterial || !material.vertexColors || material.roughness < 0.9) return false;
    if (patchedMaterials.has(material) || material.userData?.surfaceTerrainDetailV88) return false;
    patchedMaterials.add(material);
    material.userData.surfaceTerrainDetailV88 = true;
    material.roughness = 0.98;

    const previousCompile = material.onBeforeCompile;
    material.onBeforeCompile = shader => {
      previousCompile?.(shader);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vEcologyWorldPos;',
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvEcologyWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vEcologyWorldPos;',
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float ecologyDistance = length(vViewPosition);
          float ecologyNear = 1.0 - smoothstep(105.0, 390.0, ecologyDistance);
          vec2 ecologyCell = floor(vEcologyWorldPos.xz * 2.35);
          float ecologyGrain = fract(sin(dot(ecologyCell, vec2(12.9898, 78.233))) * 43758.5453);
          float ecologyPatch = 0.5 + 0.25 * sin(vEcologyWorldPos.x * 0.071 + vEcologyWorldPos.z * 0.043)
                                      + 0.25 * cos(vEcologyWorldPos.z * 0.059 - vEcologyWorldPos.x * 0.027);
          float ecologyMoist = 0.5 + 0.5 * sin(vEcologyWorldPos.x * 0.018 + sin(vEcologyWorldPos.z * 0.021) * 2.1);
          vec3 ecologyDry = vec3(1.04, 0.98, 0.84);
          vec3 ecologyWet = vec3(0.78, 0.92, 0.82);
          diffuseColor.rgb *= mix(vec3(1.0), mix(ecologyDry, ecologyWet, ecologyMoist), 0.13 * ecologyNear);
          diffuseColor.rgb *= 0.965 + ecologyPatch * 0.07 * ecologyNear;
          float ecologyRock = smoothstep(0.945, 0.995, ecologyGrain) * ecologyNear;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.33, 0.30), ecologyRock * 0.38);`,
        );
    };
    material.customProgramCacheKey = () => BUILD;
    material.needsUpdate = true;
    stats.terrainMaterialsDetailed += 1;
    return true;
  }

  function brightenEvolvedLife(object) {
    const isFlora = Boolean(object?.userData?.floraV78 || /flora/i.test(object?.name || ''));
    const isFaunaFallback = Boolean(object?.userData?.faunaV87 || /fauna/i.test(object?.name || ''));
    if (!object?.isInstancedMesh || (!isFlora && !isFaunaFallback)) return false;

    const material = object.material;
    if (material?.isMeshStandardMaterial) {
      // Instance and vertex colors multiply the base color; keep the base white
      // so inherited pigments cannot collapse into a near-black silhouette.
      material.color?.setHex?.(0xffffff);
      material.roughness = isFlora ? 0.92 : 0.84;
      material.metalness = 0;
      material.flatShading = false;
      material.emissive?.setHex?.(isFlora ? 0x08130a : 0x0a100c);
      material.emissiveIntensity = 0.045;
      if (isFlora) material.vertexColors = true;
      material.needsUpdate = true;
    }
    object.castShadow = true;
    object.receiveShadow = false;
    if (!patchedObjects.has(object)) {
      patchedObjects.add(object);
      stats.floraMeshesBrightened += 1;
      stats.shadowCasters += 1;
    }
    return true;
  }

  function patchScene() {
    scene.traverse(object => {
      if (!object?.isMesh) return;
      if (brightenEvolvedLife(object)) return;

      if (!object.isInstancedMesh && patchTerrainMaterial(object.material)) {
        object.receiveShadow = true;
      }
      if (
        !object.isInstancedMesh &&
        object.material?.isMeshStandardMaterial &&
        object.material?.vertexColors &&
        object.material?.roughness >= 0.9
      ) {
        if (!object.receiveShadow) {
          object.receiveShadow = true;
          stats.terrainMeshesReceivingShadows += 1;
        }
      }
    });

    const vegetation = scene.getObjectByName('surfaceVegetationV38');
    if (vegetation) {
      vegetation.children.forEach((child, index) => {
        if (!child?.isInstancedMesh) return;
        // Only nearby tree trunks/canopies cast full shadows on desktop.
        child.castShadow = !mobile && index < 2;
        child.receiveShadow = false;
      });
    }
  }

  const coverGeometry = new THREE.ConeGeometry(0.16, 0.58, 3, 1);
  coverGeometry.translate(0, 0.29, 0);
  const coverMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    vertexColors: false,
  });
  let coverMesh = null;
  let activeCoverKey = '';
  let requestedCoverKey = '';
  let coverGeneration = 0;

  function surfaceActive() {
    return Boolean(mode.isActive?.() && html.dataset.surfaceMode === 'active');
  }

  function normalizeSphereSample(x, y) {
    let sx = x;
    let sy = y;
    while (sy < 0 || sy > world.height) {
      if (sy < 0) {
        sy = -sy;
        sx += world.width * 0.5;
      } else {
        sy = world.height - (sy - world.height);
        sx += world.width * 0.5;
      }
    }
    return { x: wrap(sx, world.width), y: clamp(sy, 0, world.height) };
  }

  function sphereSag(localX, localZ, radius) {
    const d2 = localX * localX + localZ * localZ;
    const r2 = radius * radius;
    return radius - Math.sqrt(Math.max(1, r2 - Math.min(d2, r2 - 1)));
  }

  function anchorFromSurface(surfaceStats) {
    const parts = String(surfaceStats.activeChunkKey || '').split(':').map(Number);
    const stride = Number(surfaceStats.chunkStride);
    if (parts.length !== 2 || !parts.every(Number.isFinite) || !Number.isFinite(stride)) return null;
    return {
      key: surfaceStats.activeChunkKey,
      x: wrap((parts[0] + 0.5) * stride, world.width),
      y: clamp((parts[1] + 0.5) * stride, 0, world.height),
      curvatureRadius: Number(surfaceStats.curvatureRadius) || Math.max(world.width, world.height) * 22,
    };
  }

  function coverColor(terrain, water, gx, gy) {
    const moisture = clamp(Number(terrain?.moisture ?? terrain?.rainfall ?? 0.5) + Number(water?.groundwater || 0) * 0.28, 0, 1);
    const fertility = clamp(Number(terrain?.fertility ?? 0.5), 0, 1);
    const stress = clamp((0.38 - moisture) * 1.5 + (0.35 - fertility), 0, 1);
    const pigment = hash2(gx + 113, gy - 61, seed + 433);
    const biome = terrain?.biome || 'grassland';
    let color = biome === 'rainforest' ? 0x3f8750
      : biome === 'forest' ? 0x527b42
      : biome === 'steppe' ? 0x87934f
      : biome === 'desert' ? 0x9a8c58
      : 0x6f9849;
    if (stress > 0.48) color = 0x8b714b; // senescent/dry tissue
    else if (pigment > 0.965) color = moisture > 0.55 ? 0x765a7f : 0x925f55; // anthocyanin/stress pigments
    return new THREE.Color(color);
  }

  function disposeCover() {
    if (!coverMesh) return;
    scene.remove(coverMesh);
    coverMesh.dispose?.();
    coverMesh = null;
  }

  function buildGroundCover(anchor) {
    const generation = ++coverGeneration;
    requestedCoverKey = anchor.key;
    const candidates = [];
    const cellRadius = Math.ceil(GROUND_RADIUS / GROUND_CELL);
    const centerX = Math.floor(anchor.x / GROUND_CELL);
    const centerY = Math.floor(anchor.y / GROUND_CELL);
    for (let gy = centerY - cellRadius; gy <= centerY + cellRadius; gy += 1) {
      for (let gx = centerX - cellRadius; gx <= centerX + cellRadius; gx += 1) {
        const jitterX = (hash2(gx, gy, seed + 17) - 0.5) * GROUND_CELL * 0.82;
        const jitterY = (hash2(gx, gy, seed + 29) - 0.5) * GROUND_CELL * 0.82;
        const sample = normalizeSphereSample((gx + 0.5) * GROUND_CELL + jitterX, (gy + 0.5) * GROUND_CELL + jitterY);
        let localX = sample.x - anchor.x;
        if (localX > world.width * 0.5) localX -= world.width;
        else if (localX < -world.width * 0.5) localX += world.width;
        const localZ = sample.y - anchor.y;
        if (localX * localX + localZ * localZ > GROUND_RADIUS * GROUND_RADIUS) continue;
        candidates.push({ gx, gy, wx: sample.x, wy: sample.y, localX, localZ });
      }
    }

    const matrices = [];
    const colors = [];
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    let index = 0;

    function process(deadline) {
      if (generation !== coverGeneration || !surfaceActive()) return;
      let worked = 0;
      while (index < candidates.length && matrices.length < MAX_GROUND_COVER) {
        const c = candidates[index++];
        const terrain = living.sampleDynamicPlanet(c.wx, c.wy, 'ground-cover-v88');
        const water = waterCycle.sample(c.wx, c.wy, 'ground-cover-v88');
        stats.coverTerrainSamples += 1;
        stats.coverWaterSamples += 1;
        worked += 1;
        if (!terrain?.land) continue;
        if (Math.max(Number(water?.river || 0), Number(water?.lake || 0), Number(water?.surface || 0)) > 0.18) continue;

        const moisture = clamp(Number(terrain.moisture ?? terrain.rainfall ?? 0.5), 0, 1);
        const fertility = clamp(Number(terrain.fertility ?? 0.5), 0, 1);
        const biome = terrain.biome || 'grassland';
        let chance = biome === 'rainforest' ? 0.90 : biome === 'forest' ? 0.80 : biome === 'grassland' ? 0.74 : biome === 'steppe' ? 0.54 : biome === 'desert' ? 0.18 : 0.34;
        chance *= 0.55 + moisture * 0.28 + fertility * 0.26;
        if (hash2(c.gx, c.gy, seed + 83) > chance) continue;

        const y = clamp(Number(terrain.elevation ?? SEA_LEVEL), 0, 1) * Z_SCALE - sphereSag(c.localX, c.localZ, anchor.curvatureRadius) + 0.025;
        const yaw = hash2(c.gx, c.gy, seed + 97) * Math.PI * 2;
        const base = 0.55 + hash2(c.gx, c.gy, seed + 101) * 0.85;
        const height = base * (0.72 + moisture * 0.48);
        position.set(c.localX, y, c.localZ);
        quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        scale.set(base, height, base);
        matrix.compose(position, quaternion, scale);
        matrices.push(matrix.clone());
        colors.push(coverColor(terrain, water, c.gx, c.gy));

        if (worked >= SAMPLES_PER_SLICE) break;
        if (deadline?.timeRemaining && deadline.timeRemaining() < 1.0) break;
      }

      if (index < candidates.length && matrices.length < MAX_GROUND_COVER) {
        requestIdle(process);
        return;
      }
      if (generation !== coverGeneration || !surfaceActive()) return;

      const next = new THREE.InstancedMesh(coverGeometry, coverMaterial, Math.max(1, matrices.length));
      next.name = 'surfaceGroundCoverV88';
      next.count = matrices.length;
      next.frustumCulled = true;
      next.castShadow = false;
      next.receiveShadow = false;
      for (let i = 0; i < matrices.length; i += 1) {
        next.setMatrixAt(i, matrices[i]);
        next.setColorAt(i, colors[i]);
      }
      next.instanceMatrix.needsUpdate = true;
      if (next.instanceColor) next.instanceColor.needsUpdate = true;
      disposeCover();
      coverMesh = next;
      scene.add(next);
      activeCoverKey = anchor.key;
      requestedCoverKey = '';
      stats.coverBuilds += 1;
      stats.coverInstances = matrices.length;
      stats.activeChunkKey = anchor.key;
      html.dataset.surfaceGroundCover = String(matrices.length);
    }

    requestIdle(process);
  }

  let lastActive = false;
  let frame = 0;
  function loop() {
    requestAnimationFrame(loop);
    frame += 1;
    const active = surfaceActive();
    if (!active) {
      if (lastActive) {
        lastActive = false;
        coverGeneration += 1;
        activeCoverKey = '';
        requestedCoverKey = '';
        disposeCover();
      }
      return;
    }
    lastActive = true;

    // Scene scanning is intentionally throttled; terrain chunks are persistent
    // enough that checking a few times per second catches replacements quickly.
    if (frame % 18 === 0) patchScene();
    const surfaceStats = surface.getStats();
    const anchor = anchorFromSurface(surfaceStats);
    if (anchor && anchor.key !== activeCoverKey && anchor.key !== requestedCoverKey) buildGroundCover(anchor);
  }

  patchScene();
  requestAnimationFrame(loop);

  const api = {
    installed: true,
    build: BUILD,
    getStats: () => ({ ...stats, active: surfaceActive() }),
  };
  window.realitySandboxSurfaceEcologyV88 = api;
  html.dataset.surfaceEcologyV88 = BUILD;

  const previousDiagnostics = window.realitySandboxPresentationDiagnostics;
  window.realitySandboxPresentationDiagnostics = () => ({
    ...(typeof previousDiagnostics === 'function' ? previousDiagnostics() : {}),
    surfaceEcologyV88: api.getStats(),
  });
}

waitForRuntime().then(state => {
  if (!state) {
    html.dataset.surfaceEcologyV88 = 'unavailable';
    return;
  }
  install(state);
});
