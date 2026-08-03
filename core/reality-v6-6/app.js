import '../reality-v6-5/app.js';
import { GRID_WIDTH, GRID_HEIGHT } from '../reality-v6/simulation.js';
import { ReboundWasmSystem } from './rebound-client.js';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const DAY_MS = 86_400_000;
const IMPACT_LOG_KEY = 'reality-v6-6-impact-log';
const SYSTEM_SEED_KEY = 'reality-v6-6-system-seed';
const BODY_COLORS = ['#ffd66f', '#98baff', '#6ee3a1', '#d9e8ff', '#9ca8b8', '#ffffff'];
let system;
let systemLoading;
let systemActive = false;
let anchorDate;
let latestBodies = [];
let latestStats = null;
let lastSnapshot = 0;
let lastSync = 0;
let lastImpactCheck = 0;
let lastRenderedImpact = 0;
let syncing = false;
let yaw = -0.32;
let pitch = 0.56;
let zoom = 1;
let focusLiving = false;
let pointerStart = null;
let trails = new Map();
let impactLog = [];
let impactSource;

const canvas = document.getElementById('localSystemCanvas');
const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
const systemStatus = document.getElementById('systemStatus');
const systemMetrics = document.getElementById('systemMetrics');
const systemBuildStatus = document.getElementById('systemBuildStatus');
const enterButton = document.getElementById('enterSystem');
const returnButton = document.getElementById('returnSurface');
const reloadButton = document.getElementById('reloadRebound');
const seedInput = document.getElementById('systemSeed');
const generateButton = document.getElementById('generateSystem');
const impactorButton = document.getElementById('spawnImpactor');
const systemClockButton = document.getElementById('systemClock');
const integratorSelect = document.getElementById('integratorSelect');
const focusButton = document.getElementById('focusLiving');
const zoomInButton = document.getElementById('systemZoomIn');
const zoomOutButton = document.getElementById('systemZoomOut');
const resetViewButton = document.getElementById('systemResetView');
const frameLoading = document.getElementById('reboundLoading');

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

function randomSeed() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] || 1;
}

function storedSeed() {
  try {
    const value = Number(localStorage.getItem(SYSTEM_SEED_KEY));
    return Number.isFinite(value) && value > 0 ? value >>> 0 : randomSeed();
  } catch (_) {
    return randomSeed();
  }
}

function persistSeed(seed) {
  try { localStorage.setItem(SYSTEM_SEED_KEY, String(seed >>> 0)); } catch (_) {}
}

async function waitForWorld() {
  for (let attempt = 0; attempt < 360; attempt += 1) {
    if (
      window.realityV6?.viewer &&
      window.realityV6?.simulation &&
      window.realityV64 &&
      window.realityV65?.coupling
    ) return {
      viewer: window.realityV6.viewer,
      simulation: window.realityV6.simulation,
      coupling: window.realityV65.coupling,
    };
    await sleep(50);
  }
  throw new Error('The V6.5 living world did not finish starting.');
}

function resizeCanvas() {
  const dpr = Math.min(1.5, devicePixelRatio || 1);
  const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height, dpr };
}

function rotatePoint(body) {
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const horizontal = body.x * cosYaw - body.y * sinYaw;
  const depth = body.x * sinYaw + body.y * cosYaw;
  return {
    x: horizontal,
    y: depth * sinPitch - body.z * cosPitch,
    depth: depth * cosPitch + body.z * sinPitch,
  };
}

function displayScale(width, height, bodies) {
  if (focusLiving && latestStats?.livingIndex >= 0) return Math.min(width, height) * 420 * zoom;
  let radius = 1;
  for (const body of bodies) {
    if (body.type === 4) continue;
    radius = Math.max(radius, Math.hypot(body.x, body.y, body.z));
  }
  return Math.min(width, height) * 0.42 / Math.max(1.4, radius) * zoom;
}

function bodyRadius(body, dpr) {
  if (body.type === 0) return 8.5 * dpr;
  if (body.type === 2) return 5.2 * dpr;
  if (body.type === 3) return 2.4 * dpr;
  if (body.type === 4) return 1.05 * dpr;
  return 3.4 * dpr;
}

function renderStarfield(width, height) {
  context.fillStyle = '#01040a';
  context.fillRect(0, 0, width, height);
  const seed = latestStats?.seed || 1;
  for (let index = 0; index < 150; index += 1) {
    const x = Math.abs(Math.sin(seed * 0.00001 + index * 12.9898) * 43758.5453) % 1;
    const y = Math.abs(Math.sin(seed * 0.00002 + index * 78.233) * 19341.331) % 1;
    const alpha = 0.18 + (index % 7) * 0.07;
    context.fillStyle = `rgba(210,228,255,${alpha})`;
    context.fillRect(Math.floor(x * width), Math.floor(y * height), index % 11 === 0 ? 2 : 1, index % 11 === 0 ? 2 : 1);
  }
}

function renderSystem() {
  const { width, height, dpr } = resizeCanvas();
  renderStarfield(width, height);
  if (!latestBodies.length) return;

  const living = latestStats?.livingIndex >= 0 ? latestBodies[latestStats.livingIndex] : null;
  const centerBody = focusLiving && living ? living : { x: 0, y: 0, z: 0 };
  const centered = latestBodies.map((body) => ({
    ...body,
    x: body.x - centerBody.x,
    y: body.y - centerBody.y,
    z: body.z - centerBody.z,
  }));
  const scale = displayScale(width, height, centered);
  const centerX = width * 0.5;
  const centerY = height * 0.52;

  if (!focusLiving) {
    context.lineWidth = Math.max(0.65, dpr * 0.65);
    for (const body of centered) {
      if (body.type === 0 || body.type === 3) continue;
      const radius = Math.hypot(body.x, body.y);
      if (!Number.isFinite(radius) || radius <= 0) continue;
      context.strokeStyle = body.type === 4 ? 'rgba(160,180,205,.055)' : 'rgba(130,165,220,.12)';
      context.beginPath();
      context.ellipse(centerX, centerY, radius * scale, radius * scale * Math.sin(pitch), 0, 0, Math.PI * 2);
      context.stroke();
    }
  }

  const projected = centered.map((body) => {
    const point = rotatePoint(body);
    return {
      body,
      x: centerX + point.x * scale,
      y: centerY + point.y * scale,
      depth: point.depth,
    };
  }).sort((a, b) => a.depth - b.depth);

  for (const item of projected) {
    const { body } = item;
    if (item.x < -20 || item.x > width + 20 || item.y < -20 || item.y > height + 20) continue;
    const trail = trails.get(body.name) || [];
    trail.push([item.x, item.y]);
    if (trail.length > (body.type === 4 ? 24 : 90)) trail.shift();
    trails.set(body.name, trail);
    if (trail.length > 2) {
      context.strokeStyle = body.type === 4 ? 'rgba(180,195,215,.08)' : `${BODY_COLORS[body.type] || '#fff'}38`;
      context.lineWidth = body.type === 4 ? 0.5 * dpr : 0.9 * dpr;
      context.beginPath();
      trail.forEach((point, index) => index ? context.lineTo(point[0], point[1]) : context.moveTo(point[0], point[1]));
      context.stroke();
    }
  }

  for (const item of projected) {
    const { body } = item;
    if (item.x < -20 || item.x > width + 20 || item.y < -20 || item.y > height + 20) continue;
    const radius = bodyRadius(body, dpr);
    const color = BODY_COLORS[body.type] || '#fff';
    if (body.type === 0) {
      const glow = context.createRadialGradient(item.x, item.y, 0, item.x, item.y, radius * 4.2);
      glow.addColorStop(0, 'rgba(255,245,180,.95)');
      glow.addColorStop(0.28, 'rgba(255,195,65,.48)');
      glow.addColorStop(1, 'rgba(255,150,40,0)');
      context.fillStyle = glow;
      context.beginPath();
      context.arc(item.x, item.y, radius * 4.2, 0, Math.PI * 2);
      context.fill();
    }
    context.fillStyle = color;
    context.beginPath();
    context.arc(item.x, item.y, radius, 0, Math.PI * 2);
    context.fill();
    if (body.type === 2) {
      context.strokeStyle = '#ffffff';
      context.lineWidth = 1.2 * dpr;
      context.stroke();
    }
    if (body.type !== 4 && (body.type === 0 || body.type === 2 || focusLiving)) {
      context.fillStyle = 'rgba(230,241,255,.82)';
      context.font = `${Math.round(9 * dpr)}px system-ui`;
      context.fillText(body.name, item.x + radius + 3 * dpr, item.y - radius - 2 * dpr);
    }
  }

  if (performance.now() - lastRenderedImpact < 1_800) {
    const alpha = 1 - (performance.now() - lastRenderedImpact) / 1_800;
    context.fillStyle = `rgba(255,115,60,${alpha * 0.16})`;
    context.fillRect(0, 0, width, height);
  }
}

function compact(value) {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) < 1e-3 && value !== 0) return value.toExponential(2);
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)}b`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(2)}m`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return value.toFixed(2);
}

function impactLocation(impactNumber, timeDays) {
  const a = Math.abs(Math.sin(impactNumber * 12.9898 + timeDays * 0.017) * 43758.5453) % 1;
  const b = Math.abs(Math.sin(impactNumber * 78.233 + timeDays * 0.009) * 19341.331) % 1;
  return {
    longitude: a * 360 - 180,
    latitude: Math.asin(b * 2 - 1) * 180 / Math.PI,
  };
}

async function applySurfaceImpact(world, stats) {
  if (stats.impactTargetType !== 2) return;
  const { viewer, simulation, coupling } = world;
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

  if (!impactSource) {
    impactSource = new Cesium.CustomDataSource('REBOUND impact history');
    await viewer.dataSources.add(impactSource);
  }
  impactSource.entities.add({
    id: event.id,
    position: Cesium.Cartesian3.fromDegrees(location.longitude, location.latitude, 35_000),
    ellipse: {
      semiMajorAxis: 120_000 + radiusCells * 65_000,
      semiMinorAxis: 120_000 + radiusCells * 65_000,
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

  lastRenderedImpact = performance.now();
  document.getElementById('inspect').textContent = `REBOUND impact · ${(energy / 4.184e15).toFixed(1)} megatons TNT · ${location.latitude.toFixed(1)}°, ${location.longitude.toFixed(1)}°`;
  await window.realityV65.refreshOrbitalVisuals({ force: true });
}

async function ensureSystem(world) {
  if (system) return system;
  if (systemLoading) return systemLoading;
  systemLoading = (async () => {
    systemBuildStatus.textContent = 'Loading same-origin REBOUND WebAssembly…';
    frameLoading.hidden = false;
    const loaded = await ReboundWasmSystem.load();
    const seed = storedSeed();
    seedInput.value = String(seed);
    loaded.initialize({ seed, planets: 7, asteroids: innerWidth < 700 ? 40 : 64 });
    loaded.setIntegrator(Number(integratorSelect.value));
    system = loaded;
    anchorDate = new Date(world.coupling.date);
    latestBodies = system.snapshot();
    latestStats = system.stats();
    system.acknowledgeImpacts();
    systemBuildStatus.textContent = 'REBOUND 5.1.1 · local WASM · same-origin';
    frameLoading.hidden = true;
    return system;
  })().catch((error) => {
    frameLoading.hidden = false;
    frameLoading.textContent = `Local REBOUND failed to load: ${error.message}`;
    systemBuildStatus.textContent = 'REBOUND WASM unavailable';
    systemLoading = null;
    throw error;
  });
  return systemLoading;
}

function setSharedClockNext() {
  const clock = document.getElementById('clockSpeed');
  clock.click();
  requestAnimationFrame(() => {
    systemClockButton.textContent = clock.textContent;
  });
}

function enterLocalSystem(event, world) {
  event.preventDefault();
  event.stopImmediatePropagation();
  if (systemActive) return;
  systemActive = true;
  document.getElementById('speed').value = '0';
  document.body.classList.add('system-active');
  ensureSystem(world).catch(console.error);
  world.viewer.scene.requestRender();
}

function returnLocalSurface(event, world) {
  event.preventDefault();
  event.stopImmediatePropagation();
  systemActive = false;
  document.body.classList.remove('system-active');
  world.viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(18, 12, 17_000_000),
    duration: 1.0,
  });
}

async function regenerateSystem(world) {
  const requested = Number(seedInput.value);
  const seed = Number.isFinite(requested) && requested > 0 ? requested >>> 0 : randomSeed();
  seedInput.value = String(seed);
  persistSeed(seed);
  const loaded = await ensureSystem(world);
  loaded.initialize({ seed, planets: 7, asteroids: innerWidth < 700 ? 40 : 64 });
  loaded.setIntegrator(Number(integratorSelect.value));
  anchorDate = new Date(world.coupling.date);
  trails.clear();
  latestBodies = loaded.snapshot();
  latestStats = loaded.stats();
  loaded.acknowledgeImpacts();
}

async function synchronizeSystem(world, now) {
  if (!system || syncing || now - lastSync < 120) return;
  syncing = true;
  lastSync = now;
  try {
    const targetDays = (world.coupling.date.getTime() - anchorDate.getTime()) / DAY_MS;
    const currentDays = system.stats().timeDays;
    if (targetDays < currentDays - 0.25) {
      system.reset();
      anchorDate = new Date(world.coupling.date);
      trails.clear();
    } else {
      const lag = targetDays - currentDays;
      if (lag > 0.001) system.step(Math.min(lag, 365.25));
    }
  } finally {
    syncing = false;
  }
}

try {
  const world = await waitForWorld();
  loadImpactLog();
  document.getElementById('reboundFrame').hidden = true;
  document.getElementById('openReboundStandalone').href = './rebound-v6-6/BUILD.txt';
  document.getElementById('openReboundStandalone').textContent = 'Build details';
  systemClockButton.textContent = document.getElementById('clockSpeed').textContent;

  enterButton.addEventListener('click', (event) => enterLocalSystem(event, world), true);
  returnButton.addEventListener('click', (event) => returnLocalSurface(event, world), true);
  reloadButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    regenerateSystem(world).catch(console.error);
  }, true);

  generateButton.addEventListener('click', () => regenerateSystem(world).catch(console.error));
  impactorButton.addEventListener('click', async () => {
    const loaded = await ensureSystem(world);
    loaded.spawnImpactor();
    loaded.step(3);
    latestBodies = loaded.snapshot();
    latestStats = loaded.stats();
  });
  systemClockButton.addEventListener('click', setSharedClockNext);
  integratorSelect.addEventListener('change', async () => {
    const loaded = await ensureSystem(world);
    loaded.setIntegrator(Number(integratorSelect.value));
  });
  focusButton.addEventListener('click', () => {
    focusLiving = !focusLiving;
    focusButton.textContent = focusLiving ? 'View whole system' : 'Focus living world';
    trails.clear();
  });
  zoomInButton.addEventListener('click', () => { zoom = Math.min(8, zoom * 1.35); });
  zoomOutButton.addEventListener('click', () => { zoom = Math.max(0.22, zoom / 1.35); });
  resetViewButton.addEventListener('click', () => {
    yaw = -0.32;
    pitch = 0.56;
    zoom = 1;
    focusLiving = false;
    focusButton.textContent = 'Focus living world';
    trails.clear();
  });

  canvas.addEventListener('pointerdown', (event) => {
    pointerStart = { x: event.clientX, y: event.clientY, yaw, pitch };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!pointerStart) return;
    yaw = pointerStart.yaw + (event.clientX - pointerStart.x) * 0.008;
    pitch = Math.max(0.08, Math.min(1.45, pointerStart.pitch + (event.clientY - pointerStart.y) * 0.006));
  });
  canvas.addEventListener('pointerup', () => { pointerStart = null; });
  canvas.addEventListener('pointercancel', () => { pointerStart = null; });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoom = Math.max(0.22, Math.min(8, zoom * Math.exp(-event.deltaY * 0.001)));
  }, { passive: false });

  async function animate(now) {
    requestAnimationFrame(animate);
    if (!systemActive) return;
    if (!system) {
      renderSystem();
      return;
    }

    await synchronizeSystem(world, now);
    if (now - lastSnapshot > 90) {
      latestBodies = system.snapshot();
      latestStats = system.stats();
      lastSnapshot = now;
    }

    if (now - lastImpactCheck > 350 && latestStats) {
      lastImpactCheck = now;
      if (latestStats.newImpacts > 0) {
        await applySurfaceImpact(world, latestStats);
        system.acknowledgeImpacts();
        latestStats = system.stats();
      }
    }

    renderSystem();
    if (latestStats) {
      const lagDays = Math.max(0, (world.coupling.date.getTime() - anchorDate.getTime()) / DAY_MS - latestStats.timeDays);
      systemMetrics.innerHTML = [
        `${latestStats.count} bodies · seed ${latestStats.seed}`,
        `${latestStats.timeDays.toFixed(1)} simulated days · lag ${lagDays.toFixed(2)} d`,
        `energy error ${latestStats.energyError.toExponential(2)}`,
        `${latestStats.impacts} impacts · ${compact(latestStats.impactSpeedMetersPerSecond / 1000)} km/s last speed`,
      ].join('<br>');
      systemStatus.textContent = `REBOUND local WASM · shared date ${world.coupling.date.toISOString().slice(0, 10)} · Astronomy tide ${world.coupling.lastState.tideIndex.toFixed(2)}`;
    }
  }

  requestAnimationFrame(animate);
  window.realityV66 = {
    load: () => ensureSystem(world),
    regenerate: () => regenerateSystem(world),
    spawnImpactor: async () => {
      const loaded = await ensureSystem(world);
      return loaded.spawnImpactor();
    },
  };
} catch (error) {
  systemBuildStatus.textContent = `V6.6 failed to start: ${error.message}`;
  frameLoading.textContent = `V6.6 failed to start: ${error.message}`;
  console.error(error);
}
