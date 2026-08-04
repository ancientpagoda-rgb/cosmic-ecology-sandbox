import '../reality-v6-5/app.js';
import { GRID_WIDTH, GRID_HEIGHT } from '../reality-v6/simulation.js';
import { ReboundWasmSystem } from '../reality-v6-6/rebound-client.js';
import { ThreeReboundUniverse } from './three-universe.js';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const DAY_MS = 86_400_000;
const SYSTEM_SEED_KEY = 'reality-v6-7-system-seeds';
const IMPACT_LOG_KEY = 'reality-v6-6-impact-log';
const mobile = innerWidth < 720 || (navigator.deviceMemory && navigator.deviceMemory <= 4);
const systemCount = mobile ? 2 : 3;
const canvas = document.getElementById('threeUniverseCanvas');
const enterButton = document.getElementById('enterSystem');
const returnButton = document.getElementById('returnSurface');
const reloadButton = document.getElementById('reloadRebound');
const systemClockButton = document.getElementById('systemClock');
const impactorButton = document.getElementById('spawnImpactor');
const focusButton = document.getElementById('focusLiving');
const autoScaleButton = document.getElementById('autoScale');
const nextSystemButton = document.getElementById('nextSystem');
const systemSelect = document.getElementById('systemSelect');
const integratorSelect = document.getElementById('integratorSelect');
const seedInput = document.getElementById('systemSeed');
const generateButton = document.getElementById('generateSystem');
const frameLoading = document.getElementById('reboundLoading');
const systemStatus = document.getElementById('systemStatus');
const systemMetrics = document.getElementById('systemMetrics');
const systemBuildStatus = document.getElementById('systemBuildStatus');
const surfaceSummary = document.getElementById('surfaceSummary');

let universe;
let runtimes = [];
let loadingPromise;
let active = false;
let selectedIndex = 0;
let lastSnapshot = 0;
let lastSync = 0;
let lastMetrics = 0;
let lastImpactCheck = 0;
let previousWorldSpeed = 0;
let impactSource;
let impactLog = [];

async function waitForWorld() {
  for (let attempt = 0; attempt < 360; attempt += 1) {
    if (
      window.realityV6?.viewer &&
      window.realityV6?.simulation &&
      window.realityV65?.coupling
    ) {
      return {
        viewer: window.realityV6.viewer,
        simulation: window.realityV6.simulation,
        coupling: window.realityV65.coupling,
      };
    }
    await sleep(50);
  }
  throw new Error('The V6.5 living world did not finish starting.');
}

function randomSeed() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] || 1;
}

function loadSeeds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SYSTEM_SEED_KEY) || 'null');
    if (Array.isArray(parsed) && parsed.length >= systemCount) {
      return parsed.slice(0, systemCount).map((value) => Number(value) >>> 0 || randomSeed());
    }
  } catch (_) {}
  return Array.from({ length: systemCount }, () => randomSeed());
}

function saveSeeds() {
  try {
    localStorage.setItem(SYSTEM_SEED_KEY, JSON.stringify(runtimes.map((runtime) => runtime.seed)));
  } catch (_) {}
}

function loadImpactLog() {
  try {
    const parsed = JSON.parse(localStorage.getItem(IMPACT_LOG_KEY) || '[]');
    impactLog = Array.isArray(parsed) ? parsed.slice(-24) : [];
  } catch (_) {
    impactLog = [];
  }
}

function saveImpactLog() {
  try {
    localStorage.setItem(IMPACT_LOG_KEY, JSON.stringify(impactLog.slice(-24)));
  } catch (_) {}
}

function compact(value) {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) < 1e-3 && value !== 0) return value.toExponential(2);
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)}b`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(2)}m`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return value.toFixed(2);
}

function systemName(index) {
  return index === 0 ? 'Home System' : `Neighbor System ${index}`;
}

function impactLocation(impactNumber, timeDays) {
  const a = Math.abs(Math.sin(impactNumber * 12.9898 + timeDays * 0.017) * 43758.5453) % 1;
  const b = Math.abs(Math.sin(impactNumber * 78.233 + timeDays * 0.009) * 19341.331) % 1;
  return {
    longitude: a * 360 - 180,
    latitude: Math.asin(b * 2 - 1) * 180 / Math.PI,
  };
}

async function ensureImpactSource(world) {
  if (impactSource) return impactSource;
  impactSource = new Cesium.CustomDataSource('REBOUND impact history');
  await world.viewer.dataSources.add(impactSource);
  for (const event of impactLog) addImpactEntity(event);
  return impactSource;
}

function addImpactEntity(event) {
  if (!impactSource) return;
  const radius = Math.max(150_000, Math.min(650_000, 130_000 + Math.log10(Math.max(1e14, event.energy)) * 21_000));
  impactSource.entities.add({
    id: event.id,
    position: Cesium.Cartesian3.fromDegrees(event.longitude, event.latitude, 35_000),
    ellipse: {
      semiMajorAxis: radius,
      semiMinorAxis: radius,
      height: 3_000,
      material: Cesium.Color.fromCssColorString('#ff5b38').withAlpha(0.13),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString('#ffb06e').withAlpha(0.72),
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 15_000_000),
    },
    label: {
      text: 'REBOUND IMPACT',
      font: '10px system-ui',
      fillColor: Cesium.Color.fromCssColorString('#ffd3b0'),
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(0, -20),
      distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 4_000_000),
    },
  });
}

async function applySurfaceImpact(world, runtime, stats) {
  if (runtime.index !== 0 || stats.impactTargetType !== 2) return;
  const { simulation, coupling } = world;
  const location = impactLocation(stats.impacts, stats.timeDays);
  const energy = Math.max(1e14, stats.impactEnergyJoules || 1e18);
  const radiusCells = Math.max(1.3, Math.min(7, 1.5 + (Math.log10(energy) - 16) * 0.72));
  const centerX = ((location.longitude + 180) / 360) * GRID_WIDTH;
  const centerY = ((location.latitude + 90) / 180) * GRID_HEIGHT;

  for (let y = 0; y < GRID_HEIGHT; y += 1) {
    for (let x = 0; x < GRID_WIDTH; x += 1) {
      const dxRaw = Math.abs(x + 0.5 - centerX);
      const dx = Math.min(dxRaw, GRID_WIDTH - dxRaw) * Math.cos(location.latitude * Math.PI / 180);
      const dy = y + 0.5 - centerY;
      const distance = Math.hypot(dx, dy);
      if (distance > radiusCells) continue;
      const cell = y * GRID_WIDTH + x;
      if (simulation.baseElevation[cell] <= 0) continue;
      const force = Math.pow(1 - distance / radiusCells, 1.6);
      simulation.population[cell] *= Math.max(0.03, 1 - force * 0.94);
      simulation.vegetation[cell] *= Math.max(0.02, 1 - force * 0.88);
      simulation.moisture[cell] = Math.max(0, simulation.moisture[cell] - force * 0.18);
      simulation.runoff[cell] = Math.min(1, simulation.runoff[cell] + force * 0.28);
      coupling.snow[cell] *= Math.max(0, 1 - force);
    }
  }

  simulation.rebuildFeatures();
  simulation.save();
  coupling.save();
  const event = {
    id: `impact-${Date.now()}-${stats.impacts}`,
    date: coupling.date.toISOString(),
    longitude: location.longitude,
    latitude: location.latitude,
    energy,
    speed: stats.impactSpeedMetersPerSecond,
  };
  impactLog.push(event);
  saveImpactLog();
  await ensureImpactSource(world);
  addImpactEntity(event);
  universe.flashImpact(0, 'Living World', Math.min(2.5, 0.6 + Math.log10(energy) / 18));
  document.getElementById('inspect').textContent = `REBOUND impact · ${(energy / 4.184e15).toFixed(1)} megatons TNT · ${location.latitude.toFixed(1)}°, ${location.longitude.toFixed(1)}°`;
  await window.realityV65.refreshOrbitalVisuals({ force: true });
}

async function createRuntime(index, seed, world) {
  const engine = await ReboundWasmSystem.load();
  const asteroids = index === 0
    ? (mobile ? 38 : 72)
    : (mobile ? 18 : 36);
  const planets = index === 0 ? 7 : 4 + ((seed + index) % 4);
  engine.initialize({ seed, planets, asteroids });
  engine.setIntegrator(Number(integratorSelect.value));
  engine.acknowledgeImpacts();
  const runtime = {
    index,
    name: systemName(index),
    seed,
    engine,
    anchorDate: new Date(world.coupling.date),
    bodies: engine.snapshot(),
    stats: engine.stats(),
  };
  universe.addSystem({ name: runtime.name, seed, index });
  universe.updateSystem(index, runtime.bodies, runtime.stats);
  return runtime;
}

async function ensureUniverse(world) {
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    frameLoading.hidden = false;
    frameLoading.textContent = `Loading Three.js and ${systemCount} local REBOUND systems…`;
    systemBuildStatus.textContent = 'Initializing GPU universe and REBOUND WebAssembly…';
    universe = new ThreeReboundUniverse(canvas, { mobile });
    const seeds = loadSeeds();
    runtimes = [];
    systemSelect.replaceChildren();

    for (let index = 0; index < systemCount; index += 1) {
      const runtime = await createRuntime(index, seeds[index], world);
      runtimes.push(runtime);
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = runtime.name;
      systemSelect.append(option);
      frameLoading.textContent = `Loaded ${index + 1} of ${systemCount} REBOUND systems…`;
    }

    saveSeeds();
    seedInput.value = String(runtimes[0].seed);
    universe.travelToSystem(0);
    universe.setActive(active);
    systemBuildStatus.textContent = `Three.js r${THREE.REVISION || '184'} · REBOUND 5.1.1 local WASM`;
    frameLoading.hidden = true;
    updateMetrics(world);
    return universe;
  })().catch((error) => {
    frameLoading.hidden = false;
    frameLoading.textContent = `V6.7 failed to load: ${error.message}`;
    systemBuildStatus.textContent = 'GPU universe unavailable';
    loadingPromise = null;
    throw error;
  });
  return loadingPromise;
}

function selectedRuntime() {
  return runtimes[selectedIndex] || runtimes[0];
}

function setSelected(index, travel = true) {
  selectedIndex = Math.max(0, Math.min(runtimes.length - 1, Number(index) || 0));
  systemSelect.value = String(selectedIndex);
  const runtime = selectedRuntime();
  if (!runtime) return;
  seedInput.value = String(runtime.seed);
  if (travel) universe.travelToSystem(selectedIndex);
  updateButtons();
}

function updateButtons() {
  const runtime = selectedRuntime();
  autoScaleButton.textContent = universe?.autoScale === false ? 'Auto-scale off' : 'Auto-scale on';
  focusButton.textContent = selectedIndex === 0 ? 'Focus living world' : 'Focus main planet';
  if (runtime) nextSystemButton.textContent = `Next: ${systemName((selectedIndex + 1) % runtimes.length)}`;
  systemClockButton.textContent = document.getElementById('clockSpeed').textContent;
}

async function regenerateSelected(world) {
  const runtime = selectedRuntime();
  if (!runtime) return;
  const requested = Number(seedInput.value);
  const seed = Number.isFinite(requested) && requested > 0 ? requested >>> 0 : randomSeed();
  runtime.seed = seed;
  runtime.engine.initialize({
    seed,
    planets: runtime.index === 0 ? 7 : 4 + ((seed + runtime.index) % 4),
    asteroids: runtime.index === 0 ? (mobile ? 38 : 72) : (mobile ? 18 : 36),
  });
  runtime.engine.setIntegrator(Number(integratorSelect.value));
  runtime.engine.acknowledgeImpacts();
  runtime.anchorDate = new Date(world.coupling.date);
  runtime.bodies = runtime.engine.snapshot();
  runtime.stats = runtime.engine.stats();
  universe.updateSystem(runtime.index, runtime.bodies, runtime.stats);
  runtime.engine.acknowledgeImpacts();
  saveSeeds();
  universe.travelToSystem(runtime.index);
}

function enterSystem(event, world) {
  event.preventDefault();
  event.stopImmediatePropagation();
  if (active) return;
  active = true;
  const speed = document.getElementById('speed');
  previousWorldSpeed = Number(speed.value) || 0;
  speed.value = '0';
  speed.dispatchEvent(new Event('input', { bubbles: true }));
  document.body.classList.add('system-active');
  ensureUniverse(world).then(() => {
    universe.setActive(true);
    universe.travelToSystem(selectedIndex);
  }).catch(console.error);
  world.viewer.scene.requestRender();
}

function returnSurface(event, world) {
  event.preventDefault();
  event.stopImmediatePropagation();
  active = false;
  document.body.classList.remove('system-active');
  universe?.setActive(false);
  const speed = document.getElementById('speed');
  speed.value = String(previousWorldSpeed);
  speed.dispatchEvent(new Event('input', { bubbles: true }));
  world.viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(18, 12, 17_000_000),
    duration: 1,
  });
}

async function synchronizeRuntime(runtime, world) {
  const targetDays = (world.coupling.date.getTime() - runtime.anchorDate.getTime()) / DAY_MS;
  const currentDays = runtime.engine.stats().timeDays;
  if (targetDays < currentDays - 0.25) {
    runtime.engine.reset();
    runtime.engine.setIntegrator(Number(integratorSelect.value));
    runtime.anchorDate = new Date(world.coupling.date);
    runtime.engine.acknowledgeImpacts();
    return;
  }
  const lag = targetDays - currentDays;
  if (lag <= 0.001) return;
  const maximumStep = mobile ? (runtime.index === selectedIndex ? 80 : 35) : (runtime.index === selectedIndex ? 365 : 120);
  runtime.engine.step(Math.min(lag, maximumStep));
}

async function synchronizeAll(world, now) {
  if (!runtimes.length || now - lastSync < (mobile ? 240 : 150)) return;
  lastSync = now;
  for (const runtime of runtimes) await synchronizeRuntime(runtime, world);
}

async function refreshSnapshots(world, now) {
  if (!runtimes.length || now - lastSnapshot < (mobile ? 240 : 110)) return;
  lastSnapshot = now;
  for (const runtime of runtimes) {
    runtime.bodies = runtime.engine.snapshot();
    runtime.stats = runtime.engine.stats();
    universe.updateSystem(runtime.index, runtime.bodies, runtime.stats);
  }

  if (now - lastImpactCheck > 180) {
    lastImpactCheck = now;
    const home = runtimes[0];
    if (home?.stats.newImpacts > 0) {
      await applySurfaceImpact(world, home, home.stats);
      home.engine.acknowledgeImpacts();
    }
    for (let index = 1; index < runtimes.length; index += 1) {
      const runtime = runtimes[index];
      if (runtime.stats.newImpacts > 0) {
        universe.flashImpact(index, runtime.stats.impactTargetType === 2 ? 'Living World' : 'Planet 3', 0.8);
        runtime.engine.acknowledgeImpacts();
      }
    }
  }
}

function updateMetrics(world, now = performance.now()) {
  if (now - lastMetrics < 650) return;
  lastMetrics = now;
  const runtime = selectedRuntime();
  if (!runtime) return;
  const stats = runtime.stats;
  const totalBodies = runtimes.reduce((sum, entry) => sum + (entry.stats?.count || 0), 0);
  const surfaceStats = world.simulation.stats();
  systemStatus.textContent = `${runtime.name} · seed ${runtime.seed} · ${stats.count} bodies · ${stats.timeDays.toFixed(2)} simulated days`;
  systemMetrics.innerHTML = [
    `energy error ${stats.energyError.toExponential(3)}`,
    `${stats.impacts} collisions · ${runtimes.length} systems · ${totalBodies} total bodies`,
    `${universe.qualityLabel()} · automatic astronomical scaling ${universe.autoScale ? 'on' : 'off'}`,
  ].join('<br>');
  surfaceSummary.innerHTML = [
    '<strong>Living planet</strong>',
    `${world.coupling.date.toISOString().slice(0, 10)} shared date`,
    `${compact(surfaceStats.population)} population · ${surfaceStats.settlements} cities`,
    `${surfaceStats.forestPercent}% forest · ${impactLog.length} recorded impacts`,
  ].join('<br>');
  updateButtons();
}

try {
  const world = await waitForWorld();
  loadImpactLog();
  await ensureImpactSource(world);
  document.getElementById('reboundFrame').hidden = true;
  document.getElementById('openReboundStandalone').href = './rebound-v6-6/BUILD.txt';
  document.getElementById('openReboundStandalone').textContent = 'REBOUND build';

  enterButton.addEventListener('click', (event) => enterSystem(event, world), true);
  returnButton.addEventListener('click', (event) => returnSurface(event, world), true);
  reloadButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    regenerateSelected(world).catch(console.error);
  }, true);

  systemClockButton.addEventListener('click', () => {
    document.getElementById('clockSpeed').click();
    requestAnimationFrame(updateButtons);
  });
  systemSelect.addEventListener('change', () => setSelected(systemSelect.value));
  nextSystemButton.addEventListener('click', () => setSelected((selectedIndex + 1) % runtimes.length));
  focusButton.addEventListener('click', () => universe?.focusLivingWorld(selectedIndex));
  autoScaleButton.addEventListener('click', () => {
    if (!universe) return;
    universe.setAutoScale(!universe.autoScale);
    updateButtons();
  });
  integratorSelect.addEventListener('change', () => {
    for (const runtime of runtimes) runtime.engine.setIntegrator(Number(integratorSelect.value));
  });
  generateButton.addEventListener('click', () => regenerateSelected(world).catch(console.error));
  impactorButton.addEventListener('click', async () => {
    await ensureUniverse(world);
    setSelected(0);
    const home = runtimes[0];
    home.engine.spawnImpactor();
    world.coupling.advanceDays(3);
    home.engine.step(3);
    home.bodies = home.engine.snapshot();
    home.stats = home.engine.stats();
    universe.updateSystem(0, home.bodies, home.stats);
  });

  addEventListener('resize', () => universe?.resize());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && active) returnSurface(event, world);
  });

  function animate(now) {
    requestAnimationFrame(animate);
    if (!active || !universe || !runtimes.length) return;
    synchronizeAll(world, now).catch(console.error);
    refreshSnapshots(world, now).catch(console.error);
    updateMetrics(world, now);
  }

  requestAnimationFrame(animate);
  window.realityV67 = {
    get universe() { return universe; },
    get systems() { return runtimes; },
    travelToSystem: (index) => setSelected(index),
  };
} catch (error) {
  systemBuildStatus.textContent = `V6.7 failed to start: ${error.message}`;
  frameLoading.hidden = false;
  frameLoading.textContent = error.message;
  console.error(error);
}
