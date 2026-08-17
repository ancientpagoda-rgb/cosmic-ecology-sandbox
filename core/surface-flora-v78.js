import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const Z_SCALE = 62;
const PLANT_CAPACITY = 96;
const LEGACY_FAUNA_EMISSIVE = 0x12202a;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrap = (value, max) => ((value % max) + max) % max;

function shortestWrappedDelta(value, origin, size) {
  let delta = value - origin;
  if (delta > size * 0.5) delta -= size;
  else if (delta < -size * 0.5) delta += size;
  return delta;
}

function hashNumber(value, salt = 0) {
  let h = ((Number(value) || 0) * 2654435761 + salt * 2246822519) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function transformed(geometry, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) {
  const copy = geometry.clone();
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  );
  copy.applyMatrix4(matrix);
  return copy;
}

function mergePlantParts(parts) {
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged || new THREE.ConeGeometry(0.5, 1.5, 6);
}

function createRosetteGeometry() {
  const parts = [];
  parts.push(transformed(new THREE.CylinderGeometry(0.07, 0.11, 0.88, 6), [0, 0.44, 0]));
  for (let index = 0; index < 9; index += 1) {
    const angle = index / 9 * TAU;
    const radius = 0.35;
    parts.push(transformed(
      new THREE.ConeGeometry(0.18, 1.22, 5),
      [Math.cos(angle) * radius, 0.48, Math.sin(angle) * radius],
      [0, angle, index % 2 ? 0.82 : -0.82],
      [0.72, 1, 1.15],
    ));
  }
  parts.push(transformed(new THREE.IcosahedronGeometry(0.28, 1), [0, 1.0, 0], [0, 0, 0], [1.15, 0.72, 1.15]));
  return mergePlantParts(parts);
}

function createRosetteBlossomGeometry() {
  const parts = [];
  for (let index = 0; index < 4; index += 1) {
    const angle = index / 4 * TAU;
    parts.push(transformed(new THREE.IcosahedronGeometry(0.13, 1), [Math.cos(angle) * 0.19, 1.13, Math.sin(angle) * 0.19]));
  }
  return mergePlantParts(parts);
}

function createBranchingGeometry() {
  const parts = [];
  parts.push(transformed(new THREE.CylinderGeometry(0.11, 0.2, 2.5, 7), [0, 1.25, 0]));
  parts.push(transformed(new THREE.ConeGeometry(0.52, 1.05, 7), [0, 2.62, 0], [0, 0, 0], [1.05, 1, 1.05]));
  for (let index = 0; index < 5; index += 1) {
    const angle = index / 5 * TAU + 0.32;
    const x = Math.cos(angle) * 0.58;
    const z = Math.sin(angle) * 0.58;
    const y = 1.05 + (index % 3) * 0.42;
    parts.push(transformed(
      new THREE.CylinderGeometry(0.055, 0.09, 1.34, 5),
      [x * 0.48, y + 0.34, z * 0.48],
      [Math.sin(angle) * 0.78, angle, -Math.cos(angle) * 0.78],
    ));
    parts.push(transformed(new THREE.IcosahedronGeometry(0.42, 1), [x, y + 0.72, z], [0, angle, 0], [1.25, 0.72, 0.9]));
  }
  return mergePlantParts(parts);
}

function createBranchingBlossomGeometry() {
  const parts = [];
  for (let index = 0; index < 5; index += 1) {
    const angle = index / 5 * TAU + 0.32;
    const x = Math.cos(angle) * 0.67;
    const z = Math.sin(angle) * 0.67;
    const y = 1.92 + (index % 3) * 0.42;
    parts.push(transformed(new THREE.OctahedronGeometry(0.17, 0), [x, y, z], [0, angle, 0], [1, 1.35, 1]));
  }
  parts.push(transformed(new THREE.OctahedronGeometry(0.21, 0), [0, 3.12, 0], [0, 0, 0], [1, 1.4, 1]));
  return mergePlantParts(parts);
}

function createCrownGeometry() {
  const parts = [];
  parts.push(transformed(new THREE.CylinderGeometry(0.18, 0.34, 3.15, 8), [0, 1.575, 0]));
  parts.push(transformed(new THREE.IcosahedronGeometry(1.04, 1), [0, 3.05, 0], [0, 0, 0], [1.25, 0.82, 1.18]));
  for (let index = 0; index < 6; index += 1) {
    const angle = index / 6 * TAU;
    const radius = 0.82;
    parts.push(transformed(
      new THREE.IcosahedronGeometry(0.63, 1),
      [Math.cos(angle) * radius, 2.82 + (index % 2) * 0.28, Math.sin(angle) * radius],
      [0, angle, 0],
      [1.12, 0.82, 1.02],
    ));
  }
  for (let index = 0; index < 4; index += 1) {
    const angle = index / 4 * TAU + 0.5;
    parts.push(transformed(
      new THREE.ConeGeometry(0.17, 0.95, 5),
      [Math.cos(angle) * 0.54, 1.9, Math.sin(angle) * 0.54],
      [Math.sin(angle) * 0.58, angle, -Math.cos(angle) * 0.58],
      [1, 1.1, 1],
    ));
  }
  return mergePlantParts(parts);
}

function createCrownBlossomGeometry() {
  const parts = [transformed(new THREE.IcosahedronGeometry(0.25, 1), [0, 4.0, 0], [0, 0, 0], [1, 1.25, 1])];
  for (let index = 0; index < 6; index += 1) {
    const angle = index / 6 * TAU;
    parts.push(transformed(
      new THREE.IcosahedronGeometry(0.16, 1),
      [Math.cos(angle) * 0.95, 3.38 + (index % 2) * 0.22, Math.sin(angle) * 0.95],
    ));
  }
  return mergePlantParts(parts);
}

async function waitForRuntime() {
  for (let attempt = 0; attempt < 360; attempt += 1) {
    const planet = window.realitySandboxPlanet;
    const mode = window.realitySandboxSurfaceMode;
    const surface = window.realitySandboxSurfaceSphereV37;
    const hook = window.realitySandboxSurfaceLightHookV36;
    const scene = hook?.getObjects?.()?.scene;
    if (planet?.world?.ecs?.components && planet?.living?.sampleDynamicPlanet && mode?.getPlayer && surface?.getStats && scene) {
      return { planet, mode, surface, scene };
    }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  return null;
}

function install({ planet, mode, surface, scene }) {
  if (window.realitySandboxSurfaceFloraV78?.installed) return;

  const { world, living } = planet;
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.86,
    metalness: 0,
    vertexColors: true,
    flatShading: false,
  });
  const blossomMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.58,
    metalness: 0.02,
    vertexColors: true,
    emissive: 0x140d12,
    emissiveIntensity: 0.12,
    flatShading: true,
  });

  const forms = {
    rosette: makeForm(createRosetteGeometry(), createRosetteBlossomGeometry()),
    branching: makeForm(createBranchingGeometry(), createBranchingBlossomGeometry()),
    crown: makeForm(createCrownGeometry(), createCrownBlossomGeometry()),
  };

  const visuals = new Map();
  let lastActive = false;
  let lastAnchorKey = '';
  let hiddenLegacyFauna = 0;
  let visiblePlants = 0;
  const stats = {
    rebuilds: 0,
    hiddenLegacyFauna: 0,
    visiblePlants: 0,
    rosettes: 0,
    branching: 0,
    crowns: 0,
    terrainSamples: 0,
    fieldScans: 0,
  };

  function makeForm(bodyGeometry, blossomGeometry) {
    const body = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, PLANT_CAPACITY);
    const blossom = new THREE.InstancedMesh(blossomGeometry, blossomMaterial, PLANT_CAPACITY);
    body.name = 'surfaceFloraV78Body';
    blossom.name = 'surfaceFloraV78Blossom';
    body.count = 0;
    blossom.count = 0;
    body.frustumCulled = false;
    blossom.frustumCulled = false;
    scene.add(body, blossom);
    return { body, blossom, bodyGeometry, blossomGeometry };
  }

  function surfaceActive() {
    return Boolean(mode.isActive?.() && document.documentElement.dataset.surfaceMode === 'active');
  }

  function hideLegacyFauna() {
    let hidden = 0;
    for (const child of scene.children) {
      if (!child?.isInstancedMesh || child.name?.startsWith('surfaceFloraV78')) continue;
      const emissive = child.material?.emissive?.getHex?.();
      if (emissive === LEGACY_FAUNA_EMISSIVE) {
        child.visible = false;
        child.name = 'surfaceFaunaV37HiddenByFloraV78';
        hidden += 1;
      }
    }
    hiddenLegacyFauna = Math.max(hiddenLegacyFauna, hidden);
    stats.hiddenLegacyFauna = hiddenLegacyFauna;
  }

  function anchorFromStats(surfaceStats) {
    const parts = String(surfaceStats.activeChunkKey || '').split(':').map(Number);
    if (parts.length !== 2 || !parts.every(Number.isFinite)) return null;
    return {
      key: surfaceStats.activeChunkKey,
      x: wrap((parts[0] + 0.5) * surfaceStats.chunkStride, world.width),
      y: clamp((parts[1] + 0.5) * surfaceStats.chunkStride, 0, world.height),
      curvatureRadius: surfaceStats.curvatureRadius,
    };
  }

  function sphereSag(x, z, curvatureRadius) {
    const d2 = x * x + z * z;
    const r2 = curvatureRadius * curvatureRadius;
    return curvatureRadius - Math.sqrt(Math.max(1, r2 - Math.min(d2, r2 - 1)));
  }

  function safeSpeciesColor(species, fallback) {
    try {
      const value = species?.color ?? fallback;
      const color = new THREE.Color(value);
      return Number.isFinite(color.r) ? color : new THREE.Color(fallback);
    } catch {
      return new THREE.Color(fallback);
    }
  }

  function addPopulation(group, morph, fallbackColor, baseScale, player, anchor, seen) {
    const components = world.ecs.components;
    for (const [id, organism] of group) {
      if (seen.size >= PLANT_CAPACITY) return;
      const worldPosition = components.position.get(id);
      if (!worldPosition) continue;
      const distanceX = shortestWrappedDelta(worldPosition.x, player.x, world.width);
      const distanceY = worldPosition.y - player.y;
      if (distanceX * distanceX + distanceY * distanceY > 185 * 185) continue;

      const localX = shortestWrappedDelta(worldPosition.x, anchor.x, world.width);
      const localZ = worldPosition.y - anchor.y;
      const terrain = living.sampleDynamicPlanet(worldPosition.x, worldPosition.y, 'surface-flora-v78');
      stats.terrainSamples += 1;
      if (!terrain?.land) continue;

      const sag = sphereSag(localX, localZ, anchor.curvatureRadius);
      const groundY = clamp(terrain.elevation ?? 0.53, 0, 1) * Z_SCALE - sag;
      const species = planet.biosphere?.getSpeciesForEntity?.(id) || null;
      const dna = organism?.dna || {};
      const vigor = clamp(0.82 + (Number(dna.metabolism) || 1) * 0.1 + hashNumber(id, 31) * 0.24, 0.78, 1.34);
      const speciesColor = safeSpeciesColor(species, fallbackColor);
      const bodyColor = new THREE.Color(fallbackColor).lerp(speciesColor, morph === 'rosette' ? 0.28 : 0.38);
      bodyColor.offsetHSL((hashNumber(id, 7) - 0.5) * 0.06, 0.03, (hashNumber(id, 9) - 0.5) * 0.08);
      const blossomColor = speciesColor.clone().offsetHSL((hashNumber(id, 17) - 0.5) * 0.1, 0.12, 0.12);

      visuals.set(id, {
        id,
        morph,
        localX,
        localZ,
        groundY,
        curvatureRadius: anchor.curvatureRadius,
        size: baseScale * vigor,
        yaw: hashNumber(id, 13) * TAU,
        phase: hashNumber(id, 23) * TAU,
        bodyColor,
        blossomColor,
        worldX: worldPosition.x,
        worldY: worldPosition.y,
        species,
        organism,
      });
      seen.add(id);
    }
  }

  function rebuildPlants(anchor) {
    visuals.clear();
    const player = mode.getPlayer();
    const components = world.ecs.components;
    const seen = new Set();
    addPopulation(components.agent, 'rosette', 0x5f9848, 1.05, player, anchor, seen);
    addPopulation(components.predator, 'branching', 0x6f8f42, 1.22, player, anchor, seen);
    addPopulation(components.apex, 'crown', 0x3f7747, 1.42, player, anchor, seen);
    stats.rebuilds += 1;
    lastAnchorKey = anchor.key;
  }

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const align = new THREE.Quaternion();
  const localRotation = new THREE.Quaternion();
  const rotation = new THREE.Quaternion();
  const euler = new THREE.Euler();

  function drawPlants(now) {
    const counts = { rosette: 0, branching: 0, crown: 0 };
    for (const visual of visuals.values()) {
      const form = forms[visual.morph];
      const index = counts[visual.morph]++;
      if (!form || index >= PLANT_CAPACITY) continue;

      const sag = sphereSag(visual.localX, visual.localZ, visual.curvatureRadius);
      up.set(visual.localX, visual.curvatureRadius - sag, visual.localZ).normalize();
      align.setFromUnitVectors(yAxis, up);
      const sway = Math.sin(now * 0.00125 + visual.phase) * (visual.morph === 'crown' ? 0.012 : 0.026);
      euler.set(sway, visual.yaw, sway * 0.72);
      localRotation.setFromEuler(euler);
      rotation.copy(align).multiply(localRotation);
      position.set(visual.localX, visual.groundY, visual.localZ);
      const pulse = 1 + Math.sin(now * 0.00055 + visual.phase) * 0.012;
      scale.set(visual.size * pulse, visual.size, visual.size * pulse);
      matrix.compose(position, rotation, scale);

      form.body.setMatrixAt(index, matrix);
      form.body.setColorAt(index, visual.bodyColor);
      form.blossom.setMatrixAt(index, matrix);
      form.blossom.setColorAt(index, visual.blossomColor);
    }

    visiblePlants = counts.rosette + counts.branching + counts.crown;
    for (const [name, form] of Object.entries(forms)) {
      form.body.count = counts[name];
      form.blossom.count = counts[name];
      form.body.instanceMatrix.needsUpdate = true;
      form.blossom.instanceMatrix.needsUpdate = true;
      if (form.body.instanceColor) form.body.instanceColor.needsUpdate = true;
      if (form.blossom.instanceColor) form.blossom.instanceColor.needsUpdate = true;
      form.body.visible = surfaceActive();
      form.blossom.visible = surfaceActive();
    }

    stats.visiblePlants = visiblePlants;
    stats.rosettes = counts.rosette;
    stats.branching = counts.branching;
    stats.crowns = counts.crown;
    document.documentElement.dataset.surfaceModeVisibleCreatures = '0';
    document.documentElement.dataset.surfaceModeVisiblePlants = String(visiblePlants);
  }

  function updateHud() {
    const info = document.querySelector('#surfaceModeHud > div:first-child');
    if (!info || !/nearby life\s+\d+/i.test(info.innerHTML)) return;
    info.innerHTML = info.innerHTML.replace(/nearby life\s+\d+/i, `nearby plants ${visiblePlants}`);
    const help = [...document.querySelectorAll('#surfaceModeHud > div')].find(node => /E scan life/i.test(node.textContent));
    if (help) help.textContent = help.textContent.replace(/E scan life/i, 'E scan plants');
  }

  function nearestPlant() {
    const player = mode.getPlayer();
    let nearest = null;
    let distance = Infinity;
    for (const visual of visuals.values()) {
      const dx = shortestWrappedDelta(visual.worldX, player.x, world.width);
      const dy = visual.worldY - player.y;
      const nextDistance = Math.hypot(dx, dy);
      if (nextDistance < distance) {
        nearest = visual;
        distance = nextDistance;
      }
    }
    return { nearest, distance };
  }

  function scanNearestPlant() {
    const note = document.getElementById('surfaceFieldNote');
    if (!note || !surfaceActive()) return null;
    const { nearest, distance } = nearestPlant();
    if (!nearest || distance > 48) {
      note.textContent = 'BOTANY SCAN · no individual plant in range — move toward a bright crown or blossom.';
      note.style.opacity = '1';
      return null;
    }
    const name = nearest.species?.name ? `${nearest.species.name} flora` : `${nearest.morph} flora`;
    const generation = nearest.species?.generation ?? 0;
    const dna = nearest.organism?.dna || {};
    note.textContent = `BOTANY SCAN · ${name} · generation ${generation} · growth ${(Number(dna.metabolism) || 1).toFixed(2)} · tropism ${(Number(dna.sense) || 1).toFixed(2)} · ${distance.toFixed(0)} units`;
    note.style.opacity = '1';
    planet.ecologyJournal?.record?.('Botanical encounter', `${name} observed as a rooted 3D plant form on the surface.`, 'flora');
    stats.fieldScans += 1;
    return { name, generation, distance, morph: nearest.morph };
  }

  window.addEventListener('keydown', event => {
    if (event.code !== 'KeyE' || !surfaceActive()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    scanNearestPlant();
  }, { capture: true, passive: false });

  function loop(now) {
    requestAnimationFrame(loop);
    const active = surfaceActive();
    hideLegacyFauna();
    if (!active) {
      if (lastActive) {
        lastActive = false;
        lastAnchorKey = '';
        visuals.clear();
        for (const form of Object.values(forms)) {
          form.body.count = 0;
          form.blossom.count = 0;
          form.body.visible = false;
          form.blossom.visible = false;
        }
      }
      return;
    }

    lastActive = true;
    const surfaceStats = surface.getStats();
    const anchor = anchorFromStats(surfaceStats);
    if (anchor && anchor.key !== lastAnchorKey) rebuildPlants(anchor);
    drawPlants(now);
    updateHud();
  }
  requestAnimationFrame(loop);

  const api = {
    installed: true,
    scan: scanNearestPlant,
    getStats: () => ({
      ...stats,
      active: surfaceActive(),
      legacyFaunaVisible: false,
      presentation: 'procedural-3d-plants',
      gpuInstancing: true,
      swayAnimation: true,
      morphologies: ['rosette', 'branching', 'crown'],
    }),
  };
  window.realitySandboxSurfaceFloraV78 = api;
  window.realitySandboxSurfaceExpedition = { scan: scanNearestPlant, getVisibleFlora: () => visiblePlants };
  document.documentElement.dataset.surfaceFloraV78 = 'gpu-instanced-3d-plants';

  const previousDiagnostics = window.realitySandboxPresentationDiagnostics;
  window.realitySandboxPresentationDiagnostics = () => ({
    ...(typeof previousDiagnostics === 'function' ? previousDiagnostics() : {}),
    surfaceFloraV78: api.getStats(),
  });
}

waitForRuntime().then(state => {
  if (!state) {
    document.documentElement.dataset.surfaceFloraV78 = 'unavailable';
    return;
  }
  install(state);
});
