import * as THREE from 'three';
import { samplePlanet } from './planet.js';
import { sampleHydrology } from './hydrology.js';
import { createGeologicalTime } from './geological-time.js';
import { createCreatureBody3D } from './creature-body-3d.js';
import { createLocalCreaturePhysics } from './local-creature-physics.js';
import { createEvolutionLedger } from './evolution-lineages.js';

const YUKA_SOURCES = [
  'https://cdn.jsdelivr.net/npm/yuka@0.7.8/build/yuka.module.js',
  'https://unpkg.com/yuka@0.7.8/build/yuka.module.js',
];
const PATCH_SIZE = 0.9;
const GLOBAL_SCALE = 0.04;
const SAMPLE_WIDTH = 8192;
const SAMPLE_HEIGHT = 4096;
const ROLES = ['agent', 'predator', 'apex'];
const BASE_SPEED = { agent: 34, predator: 48, apex: 31 };

export function createEmbodiedEvolution(world, originSystem, groundLevel, options = {}) {
  const mobile = options.mobile ?? matchMedia('(max-width: 720px), (pointer: coarse)').matches;
  const container = options.container || document.getElementById('world') || document.body;
  const rng = mulberry32(options.seed ?? 0x260806);
  const geology = createGeologicalTime({
    seed: options.geologySeed || 90210,
    startAgeMyr: 0,
    millionYearsPerSecond: 0.18,
  });
  const ledger = createEvolutionLedger(world, {
    seed: (options.seed ?? 0x260806) ^ 0x9E3779B9,
    mobile,
  });

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x9fb3b5, mobile ? 0.2 : 0.14);
  const camera = new THREE.PerspectiveCamera(mobile ? 54 : 48, 1, 0.008, 14);
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: !mobile,
    powerPreference: mobile ? 'low-power' : 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = 'embodied-evolution-3d';
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.domElement.style.cssText = 'position:fixed;inset:0;z-index:6;width:100%;height:100%;pointer-events:none;opacity:0;transition:opacity .25s ease';
  document.body.append(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xb7d3ff, 0x091018, 1.16));
  const sun = new THREE.DirectionalLight(0xfff0cf, 2.45);
  sun.position.set(3, 4, 2);
  scene.add(sun);
  const sceneRoot = new THREE.Group();
  scene.add(sceneRoot);
  const creatureRoot = new THREE.Group();
  const structureRoot = new THREE.Group();
  sceneRoot.add(creatureRoot, structureRoot);

  const hud = document.createElement('section');
  hud.className = 'embodied-evolution-hud';
  hud.hidden = true;
  hud.setAttribute('aria-live', 'polite');
  hud.style.cssText = 'position:fixed;right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));z-index:15;max-width:min(390px,calc(100vw - 24px));padding:10px 12px;border:1px solid rgba(147,217,190,.24);border-radius:12px;background:rgba(2,10,12,.72);backdrop-filter:blur(10px);color:#d8fff2;font:600 11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.035em;pointer-events:none';
  hud.innerHTML = `
    <strong style="display:block;margin-bottom:4px;color:#8ff0c7">PHASE 6 · LIVING LINEAGES</strong>
    <span data-evolution-summary>Waiting for embodied organisms…</span>
    <small data-evolution-detail style="display:block;margin-top:4px;color:rgba(216,255,242,.7)"></small>
  `;
  document.body.append(hud);
  const summaryElement = hud.querySelector('[data-evolution-summary]');
  const detailElement = hud.querySelector('[data-evolution-detail]');

  const records = new Map();
  const structureMeshes = new Map();
  let YUKA;
  let manager;
  let physics;
  let active = false;
  let destroyed = false;
  let lastWidth = 0;
  let lastHeight = 0;
  let lastHud = -Infinity;
  let terrainClock = 0;
  let structureClock = 0;
  let fullSimulationCount = 0;

  async function initialize({ provideCapability }) {
    YUKA = await loadYuka();
    manager = new YUKA.EntityManager();
    physics = await createLocalCreaturePhysics({ mobile });
    provideCapability('evolution.embodied', api);
    provideCapability('evolution.lineages', ledger);
    provideCapability('evolution.societies', api);
    provideCapability('ai.yuka', manager);
    provideCapability('physics.creatures', physics);
  }

  function step(dt) {
    if (destroyed || !manager || !physics) return;
    const ground = groundLevel.getState();
    ledger.step(dt, sampleNiche);
    active = Boolean(ground.active && originSystem.getState().animalsReady);
    renderer.domElement.style.opacity = active ? '1' : '0';
    hud.hidden = !active;

    if (!active) {
      trimAllLocalRecords();
      return;
    }

    geology.load(ground.geology || {});
    synchronizeLocalLod(ground);
    for (const record of records.values()) {
      record.decisionClock -= dt;
      if (record.decisionClock <= 0) {
        decide(record);
        record.decisionClock = clamp(0.62 - record.genome.sense * 0.12 + rng() * 0.12, 0.18, 0.62);
      }
    }

    manager.update(dt);
    writeBackYuka();
    terrainClock += dt;
    if (terrainClock >= (mobile ? 0.42 : 0.3)) {
      terrainClock = 0;
      physics.updateTerrain(ground.navigation, ground.terrain, sampleSurface);
    }

    const targets = new Map();
    for (const record of records.values()) {
      const point = world.ecs.components.position.get(record.entityId);
      if (!point) continue;
      const local = geoToLocal(point, ground.navigation, ground.terrain.level || 7);
      const surface = sampleSurface(point.x / world.width, point.y / world.height);
      const localSpeed = record.vehicle.getSpeed() * worldUnitsPerTurn(ground.terrain.level || 7) /
        Math.max(1, world.width * GLOBAL_SCALE);
      targets.set(record.entityId, {
        x: local.x,
        z: local.z,
        floorY: surface.floorY,
        speed: localSpeed,
      });
    }
    const transforms = physics.step(dt, targets);
    updateCreatureMeshes(dt, ground, transforms);

    structureClock += dt;
    if (structureClock >= 0.65) {
      structureClock = 0;
      synchronizeStructures(ground);
    }
  }

  function synchronizeLocalLod(ground) {
    const center = {
      x: wrap(ground.navigation.u, 1) * world.width,
      y: clamp(ground.navigation.v, 0, 1) * world.height,
    };
    const radius = mobile ? 34 : 52;
    const cap = mobile ? 14 : 38;
    const candidates = [];

    for (const role of ROLES) {
      for (const [entityId] of world.ecs.components[role].entries()) {
        const position = world.ecs.components.position.get(entityId);
        const genome = ledger.getGenome(entityId);
        if (!position || !genome) continue;
        const distance = torusDistance(center, position, world.width, world.height);
        if (distance <= radius * radius) candidates.push({ entityId, role, position, genome, distance });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const selected = new Set(candidates.slice(0, cap).map(item => item.entityId));

    for (const [entityId] of records.entries()) {
      if (!selected.has(entityId)) removeLocalCreature(entityId);
    }
    for (const candidate of candidates.slice(0, cap)) {
      if (!records.has(candidate.entityId)) addLocalCreature(candidate, ground);
    }
    fullSimulationCount = records.size;
  }

  function addLocalCreature(candidate, ground) {
    const { entityId, role, position, genome } = candidate;
    const vehicle = new YUKA.Vehicle();
    vehicle.position.set(position.x * GLOBAL_SCALE, 0, position.y * GLOBAL_SCALE);
    const velocity = world.ecs.components.velocity.get(entityId);
    if (velocity) vehicle.velocity.set(velocity.vx * GLOBAL_SCALE, 0, velocity.vy * GLOBAL_SCALE);
    vehicle.maxSpeed = BASE_SPEED[role] * genome.speed * GLOBAL_SCALE;
    vehicle.maxForce = 5.5 * genome.stamina;
    vehicle.updateNeighborhood = true;
    vehicle.neighborhoodRadius = 3.8 + genome.sense * 1.7;

    const wander = new YUKA.WanderBehavior();
    wander.weight = role === 'agent' ? 0.38 : 0.22;
    const seek = new YUKA.SeekBehavior(new YUKA.Vector3().copy(vehicle.position));
    seek.weight = role === 'agent' ? 0.78 : 0.32;
    const separation = new YUKA.SeparationBehavior();
    separation.weight = 0.62 + (1 - genome.social) * 0.78;
    const alignment = new YUKA.AlignmentBehavior();
    alignment.weight = role === 'agent' ? genome.social * 0.48 : genome.social * 0.12;
    const cohesion = new YUKA.CohesionBehavior();
    cohesion.weight = role === 'agent' ? genome.social * 0.39 : genome.social * 0.1;
    const evade = new YUKA.EvadeBehavior();
    evade.active = false;
    evade.weight = 1.35 + genome.caution;
    const pursuit = new YUKA.PursuitBehavior();
    pursuit.active = false;
    pursuit.weight = 1.15 + genome.aggression * 0.8;
    for (const behavior of [wander, seek, separation, alignment, cohesion, evade, pursuit]) vehicle.steering.add(behavior);
    manager.add(vehicle);

    const body = createCreatureBody3D(genome, role, { id: entityId, mobile });
    creatureRoot.add(body.root);
    const local = geoToLocal(position, ground.navigation, ground.terrain.level || 7);
    const surface = sampleSurface(position.x / world.width, position.y / world.height);
    body.root.position.set(local.x, surface.floorY, local.z);
    physics.addCreature(entityId, body, { x: local.x, y: surface.floorY, z: local.z });

    records.set(entityId, {
      entityId,
      role,
      genome,
      vehicle,
      body,
      behavior: { wander, seek, separation, alignment, cohesion, evade, pursuit },
      mode: 'wander',
      decisionClock: rng() * 0.4,
    });
  }

  function removeLocalCreature(entityId) {
    const record = records.get(entityId);
    if (!record) return;
    manager.remove(record.vehicle);
    physics.removeCreature(entityId);
    creatureRoot.remove(record.body.root);
    record.body.dispose();
    records.delete(entityId);
  }

  function trimAllLocalRecords() {
    for (const entityId of [...records.keys()]) removeLocalCreature(entityId);
    for (const [id, mesh] of structureMeshes.entries()) {
      structureRoot.remove(mesh);
      disposeObject(mesh);
      structureMeshes.delete(id);
    }
  }

  function decide(record) {
    const { role, genome, vehicle, behavior } = record;
    behavior.evade.active = false;
    behavior.pursuit.active = false;
    behavior.seek.active = true;
    behavior.seek.weight = role === 'agent' ? 0.62 : 0.28;
    const component = world.ecs.components[role].get(record.entityId);
    const energy = component?.energy || 0;
    const structures = ledger.getStructures().filter(item => item.speciesId === genome.speciesId);

    const home = nearestStructure(record, structures, ['nest', 'settlement']);
    if (home && energy < (role === 'agent' ? 0.7 : 1.15)) {
      setTarget(behavior.seek.target, vehicle.position, home);
      behavior.seek.weight = 0.75;
      record.mode = 'rest';
      return;
    }

    if (role === 'agent') {
      const threat = nearestLocalCreature(record, ['predator', 'apex'], 145 * genome.sense);
      if (threat) {
        behavior.evade.pursuer = threat.vehicle;
        behavior.evade.active = true;
        behavior.seek.active = false;
        record.mode = 'flee';
        return;
      }
      const food = nearestResource(record, 185 * genome.sense);
      if (food) {
        setTarget(behavior.seek.target, vehicle.position, food);
        behavior.seek.weight = 0.72 + genome.metabolism * 0.34;
        record.mode = 'forage';
        return;
      }
      const group = nearestLocalCreature(record, ['agent'], 120 * genome.sense, true);
      if (group && group.genome.speciesId === genome.speciesId && genome.social > 0.44) {
        setTarget(behavior.seek.target, vehicle.position, world.ecs.components.position.get(group.entityId));
        behavior.seek.weight = 0.18 + genome.social * 0.38;
        record.mode = 'communicate';
        return;
      }
    } else {
      const preyRoles = role === 'apex' ? ['predator', 'agent'] : ['agent'];
      const prey = nearestLocalCreature(record, preyRoles, 205 * genome.sense);
      if (prey) {
        behavior.pursuit.evader = prey.vehicle;
        behavior.pursuit.predictionFactor = 0.65 + genome.memory * 0.85;
        behavior.pursuit.active = true;
        behavior.seek.active = false;
        record.mode = 'hunt';
        return;
      }
      const territory = nearestStructure(record, structures, ['territory']);
      if (territory && genome.aggression > 0.48) {
        setTarget(behavior.seek.target, vehicle.position, territory);
        behavior.seek.weight = 0.32 + genome.aggression * 0.22;
        record.mode = 'patrol';
        return;
      }
    }

    const angle = rng() * Math.PI * 2;
    behavior.seek.target.set(
      vehicle.position.x + Math.cos(angle) * (2 + genome.curiosity * 2.8),
      0,
      vehicle.position.z + Math.sin(angle) * (2 + genome.curiosity * 2.8),
    );
    behavior.seek.weight = 0.1 + genome.curiosity * 0.08;
    record.mode = 'wander';
  }

  function writeBackYuka() {
    const maxX = world.width * GLOBAL_SCALE;
    const maxZ = world.height * GLOBAL_SCALE;
    for (const record of records.values()) {
      const position = world.ecs.components.position.get(record.entityId);
      const velocity = world.ecs.components.velocity.get(record.entityId);
      if (!position) continue;
      record.vehicle.position.x = wrap(record.vehicle.position.x, maxX);
      record.vehicle.position.z = clamp(record.vehicle.position.z, 0.01, maxZ - 0.01);
      record.vehicle.position.y = 0;
      position.x = record.vehicle.position.x / GLOBAL_SCALE;
      position.y = record.vehicle.position.z / GLOBAL_SCALE;
      if (velocity) {
        velocity.vx = record.vehicle.velocity.x / GLOBAL_SCALE;
        velocity.vy = record.vehicle.velocity.z / GLOBAL_SCALE;
      }
    }
  }

  function updateCreatureMeshes(dt, ground, transforms) {
    for (const record of records.values()) {
      const point = world.ecs.components.position.get(record.entityId);
      if (!point) continue;
      const local = geoToLocal(point, ground.navigation, ground.terrain.level || 7);
      const surface = sampleSurface(point.x / world.width, point.y / world.height);
      const transform = transforms.get(record.entityId) || { x: local.x, y: surface.floorY, z: local.z };
      record.body.root.position.set(transform.x, transform.y, transform.z);

      const velocity = world.ecs.components.velocity.get(record.entityId) || { vx: 0, vy: 1 };
      if (Math.hypot(velocity.vx, velocity.vy) > 0.02) {
        record.body.root.rotation.y = Math.atan2(velocity.vx, velocity.vy);
      }
      const speed = clamp(record.vehicle.getSpeed() / Math.max(0.001, record.vehicle.maxSpeed), 0, 1.5);
      const ageRatio = record.genome.lifeAge / Math.max(1, record.genome.lifespan);
      record.body.update(dt, {
        speed,
        mode: record.mode,
        communication: record.mode === 'communicate' ? ledger.getCommunication(record.entityId) : 0,
        ageRatio,
      });
      const distance = Math.hypot(local.x, local.z);
      record.body.setLod(distance > 2.8 ? 2 : distance > 1.45 ? 1 : 0);
    }
  }

  function synchronizeStructures(ground) {
    const structures = ledger.getStructures();
    const selected = new Set();
    const max = mobile ? 18 : 48;
    const nearby = structures
      .map(structure => ({ structure, local: geoToLocal(structure, ground.navigation, ground.terrain.level || 7) }))
      .filter(item => Math.hypot(item.local.x, item.local.z) < (mobile ? 3.1 : 4.4))
      .sort((a, b) => Math.hypot(a.local.x, a.local.z) - Math.hypot(b.local.x, b.local.z))
      .slice(0, max);

    for (const item of nearby) {
      const { structure, local } = item;
      selected.add(structure.id);
      let mesh = structureMeshes.get(structure.id);
      if (!mesh) {
        mesh = createStructureMesh(structure, mobile);
        structureMeshes.set(structure.id, mesh);
        structureRoot.add(mesh);
      }
      const surface = sampleSurface(structure.x / world.width, structure.y / world.height);
      mesh.position.set(local.x, surface.floorY + 0.005, local.z);
      mesh.scale.setScalar(0.62 + structure.progress * 0.48);
      mesh.userData.structure = structure;
    }

    for (const [id, mesh] of structureMeshes.entries()) {
      if (selected.has(id)) continue;
      structureRoot.remove(mesh);
      disposeObject(mesh);
      structureMeshes.delete(id);
    }
  }

  function render(frame = {}) {
    if (destroyed) return;
    const ground = groundLevel.getState();
    const shouldRender = Boolean(active && ground.active && records.size);
    renderer.domElement.style.opacity = shouldRender ? '1' : '0';
    hud.hidden = !shouldRender;
    if (!shouldRender) return;

    resize();
    configureCamera(ground);
    renderer.render(scene, camera);

    const timestamp = frame.timestamp ?? performance.now();
    if (timestamp - lastHud > 320) {
      lastHud = timestamp;
      const state = ledger.getState();
      const physicsLabel = physics.ready ? 'Rapier contact' : 'terrain lock';
      summaryElement.textContent = `${state.counts.agent} grazers · ${state.counts.predator} predators · ${state.counts.apex} apex · ${state.species} living species`;
      detailElement.textContent = `${fullSimulationCount} full 3D · ${state.creatures - fullSimulationCount} distant statistical · gen ${state.maxGeneration} · ${state.speciations} branches · ${state.structures} structures · ${state.settlements} settlements · ${physicsLabel}`;
    }
  }

  function configureCamera(ground) {
    const navigation = ground.navigation;
    const surface = ground.terrain.surface || sampleSurface(navigation.u, navigation.v);
    const pitch = clamp(navigation.pitch ?? -0.08, -0.55, 0.34);
    const cameraDistance = clamp(navigation.cameraDistance ?? 0.46, 0, 0.74);
    const firstPerson = cameraDistance < 0.08;
    const floorY = surface.floorY || 0;
    sceneRoot.rotation.y = navigation.heading ?? 0;

    if (firstPerson) {
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

  function sampleSurface(u, v) {
    u = wrap(u, 1);
    v = clamp(v, 0, 1);
    const base = samplePlanet(u * SAMPLE_WIDTH, v * SAMPLE_HEIGHT, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    const hydro = sampleHydrology(u * SAMPLE_WIDTH, v * SAMPLE_HEIGHT, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    const geological = geology.sample(u, v);
    const height = base.elevation + geological.uplift - geological.rifting - geological.erosion;
    const seaLevel = geological.seaLevel;
    const water = height < 0.53 + seaLevel;
    const waterStrength = water ? 1 : clamp(Math.max(hydro.lake, hydro.delta * 0.9, hydro.river * 0.78), 0, 1);
    const terrainY = (height - seaLevel - 0.53) * 3.8;
    const waterY = water ? 0.006 : terrainY + 0.007;
    return {
      ...base,
      ...hydro,
      ...geological,
      height,
      seaLevel,
      water,
      waterStrength,
      terrainY,
      waterY,
      floorY: waterStrength > 0.25 ? Math.max(terrainY, waterY) : terrainY,
    };
  }

  function sampleNiche(x, y) {
    const surface = sampleSurface(x / world.width, y / world.height);
    return {
      temperature: surface.temperature,
      moisture: clamp(surface.rainfall * 0.7 + surface.river * 0.18 + surface.lake * 0.12, 0, 1),
      elevation: clamp(surface.height, 0, 1),
      water: surface.waterStrength,
      land: !surface.water && surface.waterStrength < 0.72,
    };
  }

  function nearestLocalCreature(record, roles, radius, excludeSelf = false) {
    const origin = world.ecs.components.position.get(record.entityId);
    let best = null;
    let bestDistance = radius * radius;
    for (const candidate of records.values()) {
      if ((excludeSelf || candidate.entityId !== record.entityId) && candidate.entityId === record.entityId) continue;
      if (candidate.entityId === record.entityId || !roles.includes(candidate.role)) continue;
      const point = world.ecs.components.position.get(candidate.entityId);
      const distance = torusDistance(origin, point, world.width, world.height);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    }
    return best;
  }

  function nearestResource(record, radius) {
    const origin = world.ecs.components.position.get(record.entityId);
    let best = null;
    let bestDistance = radius * radius;
    for (const [entityId, resource] of world.ecs.components.resource.entries()) {
      if ((resource.amount || 0) <= 0) continue;
      const point = world.ecs.components.position.get(entityId);
      if (!point) continue;
      const distance = torusDistance(origin, point, world.width, world.height);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = point;
      }
    }
    return best;
  }

  function nearestStructure(record, structures, types) {
    const origin = world.ecs.components.position.get(record.entityId);
    let best = null;
    let bestDistance = Infinity;
    for (const structure of structures) {
      if (!types.includes(structure.type)) continue;
      const distance = torusDistance(origin, structure, world.width, world.height);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = structure;
      }
    }
    return best;
  }

  function setTarget(target, vehiclePosition, point) {
    const maxX = world.width * GLOBAL_SCALE;
    const maxZ = world.height * GLOBAL_SCALE;
    target.set(
      vehiclePosition.x + shortest(point.x * GLOBAL_SCALE - vehiclePosition.x, maxX),
      0,
      clamp(vehiclePosition.z + shortest(point.y * GLOBAL_SCALE - vehiclePosition.z, maxZ), 0, maxZ),
    );
  }

  function geoToLocal(point, navigation, level) {
    const u = wrap(point.x / world.width, 1);
    const v = clamp(point.y / world.height, 0, 1);
    const units = worldUnitsPerTurn(level);
    return {
      x: turnDelta(u, navigation.u) * units,
      z: (v - navigation.v) * units,
    };
  }

  function save() {
    return {
      version: 3,
      ledger: ledger.save(),
    };
  }

  function load(state) {
    ledger.load(state?.ledger || state);
  }

  function getState() {
    return {
      ...ledger.getState(),
      fullSimulationCount,
      physicsReady: Boolean(physics?.ready),
      renderedStructures: structureMeshes.size,
    };
  }

  function destroy() {
    destroyed = true;
    trimAllLocalRecords();
    physics?.clear?.();
    renderer.dispose();
    renderer.domElement.remove();
    hud.remove();
  }

  const api = {
    id: 'evolution.embodied-yuka',
    name: 'True 3D Embodied Evolution and Emergent Societies',
    version: '2.0.0',
    execution: 'browser-three-rapier-yuka',
    source: 'Yuka 0.7.8, Rapier 0.19.3, Three.js AnimationMixer, and Reality Sandbox lineage simulation',
    license: 'MIT / Apache-2.0 / project license',
    provides: ['evolution.embodied', 'evolution.lineages', 'evolution.societies', 'ai.yuka', 'physics.creatures'],
    requires: ['origin.abiogenesis', 'exploration.ground-level'],
    after: ['terrain.ground-level', 'origin.surface-visuals'],
    initialize,
    step,
    render,
    save,
    load,
    getState,
    getSpecies: ledger.getSpecies,
    getStructures: ledger.getStructures,
    destroy,
  };

  return api;
}

function createStructureMesh(structure, mobile) {
  const group = new THREE.Group();
  group.userData.type = structure.type;
  const speciesHue = hashString(structure.speciesId) % 360;
  const primary = new THREE.MeshStandardMaterial({
    color: new THREE.Color(`hsl(${speciesHue} 42% 48%)`),
    roughness: 0.92,
    metalness: 0,
  });
  const accent = new THREE.MeshStandardMaterial({
    color: new THREE.Color(`hsl(${wrap(speciesHue + 55, 360)} 58% 62%)`),
    roughness: 0.76,
    metalness: 0.02,
  });

  if (structure.type === 'nest') {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 5, mobile ? 12 : 22), primary);
    ring.rotation.x = Math.PI * 0.5;
    group.add(ring);
    for (let index = 0; index < (mobile ? 4 : 7); index++) {
      const twig = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 0.13, 4), accent);
      twig.rotation.z = Math.PI * 0.5;
      twig.rotation.y = index / (mobile ? 4 : 7) * Math.PI;
      twig.position.y = 0.014;
      group.add(twig);
    }
  } else if (structure.type === 'tool-cache') {
    for (let index = 0; index < (mobile ? 3 : 6); index++) {
      const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.018 + index * 0.0015, 0), index % 2 ? accent : primary);
      stone.position.set((index % 3 - 1) * 0.026, 0.018, (Math.floor(index / 3) - 0.5) * 0.03);
      group.add(stone);
    }
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 5), accent);
    handle.rotation.z = Math.PI * 0.42;
    handle.position.y = 0.035;
    group.add(handle);
  } else if (structure.type === 'territory') {
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(`hsl(${speciesHue} 70% 62%)`),
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.235, mobile ? 24 : 48), ringMaterial);
    ring.rotation.x = -Math.PI * 0.5;
    group.add(ring);
  } else if (structure.type === 'settlement') {
    const huts = mobile ? 2 : 3 + Math.floor(structure.progress * 3);
    for (let index = 0; index < huts; index++) {
      const angle = index / huts * Math.PI * 2;
      const radius = 0.04 + (index % 2) * 0.035;
      const hut = new THREE.Group();
      hut.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.034, 0.055, mobile ? 6 : 9), primary);
      wall.position.y = 0.028;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.045, mobile ? 6 : 9), accent);
      roof.position.y = 0.072;
      hut.add(wall, roof);
      group.add(hut);
    }
    const hearth = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffa64a }));
    hearth.position.y = 0.012;
    group.add(hearth);
  }

  group.traverse(object => {
    if (object.isMesh) object.castShadow = true;
  });
  return group;
}

function disposeObject(root) {
  root.traverse(object => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach(material => material.dispose?.());
    else object.material?.dispose?.();
  });
}

async function loadYuka() {
  let error;
  for (const source of YUKA_SOURCES) {
    try {
      return await import(/* @vite-ignore */ source);
    } catch (next) {
      error = next;
    }
  }
  throw new Error(`Unable to load Yuka 0.7.8: ${error?.message || 'network unavailable'}`);
}

function worldUnitsPerTurn(level) {
  return PATCH_SIZE * (2 ** level);
}

function torusDistance(a, b, width, height) {
  if (!a || !b) return Infinity;
  const dx = shortest((b.x || 0) - (a.x || 0), width);
  const dy = shortest((b.y || 0) - (a.y || 0), height);
  return dx * dx + dy * dy;
}

function shortest(delta, period) {
  if (delta > period * 0.5) return delta - period;
  if (delta < -period * 0.5) return delta + period;
  return delta;
}

function turnDelta(value, reference) {
  let delta = value - reference;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  return delta;
}

function hashString(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

const wrap = (value, max) => ((value % max) + max) % max;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
