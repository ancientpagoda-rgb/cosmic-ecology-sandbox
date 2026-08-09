const TAU = Math.PI * 2;
const EYE_HEIGHT = 3.6;
const MAX_ALTITUDE = 52;
const GLOBE_RADIUS_FACTOR = 0.43;
const HUD_INTERVAL_MS = 180;
// Positive pitch lowers the look target in the GPU renderer. Starting a little
// below the horizon gives people terrain immediately instead of an empty sky.
const DEFAULT_SURFACE_PITCH = 0.23;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrap = (value, max) => ((value % max) + max) % max;
const wrapAngle = value => ((value + Math.PI) % TAU + TAU) % TAU - Math.PI;

async function waitForRuntime() {
  for (let attempt = 0; attempt < 240; attempt++) {
    const ready = window.realitySandboxReady;
    if (ready && typeof ready.then === 'function') {
      try { await ready; } catch { return null; }
    }
    const runtime = window.realitySandboxUnified;
    const planet = window.realitySandboxPlanet;
    const sourceCanvas = document.getElementById('lofiLivingCanvas');
    if (runtime?.getCamera && planet?.world && planet?.living?.sampleDynamicPlanet && planet?.waterCycle?.sample && sourceCanvas) {
      return { runtime, planet, sourceCanvas };
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return null;
}

function installSurfaceMode({ runtime, planet, sourceCanvas }) {
  if (window.realitySandboxSurfaceMode) return;

  const host = document.getElementById('world') || sourceCanvas.parentElement;
  if (!host) return;

  const { world, living, waterCycle } = planet;
  const keys = new Set();
  const player = {
    x: world.width * 0.5,
    y: world.height * 0.5,
    yaw: 0,
    pitch: DEFAULT_SURFACE_PITCH,
    altitude: EYE_HEIGHT,
  };

  const stats = { poleCrossings: 0 };
  let active = false;
  let lastFrameTime = performance.now();
  let lastHudUpdate = -Infinity;
  let dragLook = false;
  let dragX = 0;
  let dragY = 0;
  let shellDisplay = '';
  let terrainRendererRequested = false;
  let terrainRendererPromise = null;

  const layer = document.createElement('div');
  layer.id = 'surfaceModeLayer';
  Object.assign(layer.style, {
    position: 'absolute', inset: '0', zIndex: '40', opacity: '0', pointerEvents: 'none',
    transition: 'opacity 220ms ease', background: '#1d4038', overflow: 'hidden',
  });

  const canvas = document.createElement('canvas');
  canvas.id = 'surfaceModeCanvas';
  canvas.width = 1;
  canvas.height = 1;
  canvas.setAttribute('aria-label', 'First-person spherical GPU surface controls for Eidolon');
  canvas.tabIndex = 0;
  Object.assign(canvas.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block',
    zIndex: '1', cursor: 'crosshair', touchAction: 'none', background: 'transparent',
  });

  const hud = document.createElement('div');
  hud.id = 'surfaceModeHud';
  Object.assign(hud.style, {
    position: 'absolute', inset: '0', zIndex: '2', pointerEvents: 'none', color: '#eef8f1',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    textShadow: '0 1px 4px rgba(0,0,0,.9)',
  });

  const info = document.createElement('div');
  Object.assign(info.style, {
    position: 'absolute', top: 'max(14px, env(safe-area-inset-top))', left: 'max(14px, env(safe-area-inset-left))',
    padding: '9px 11px', border: '1px solid rgba(190,230,205,.22)', borderRadius: '10px',
    background: 'rgba(4,12,10,.56)', backdropFilter: 'blur(6px)', fontSize: '11px', lineHeight: '1.45',
  });

  const exitButton = document.createElement('button');
  exitButton.type = 'button';
  exitButton.textContent = 'Exit Surface';
  Object.assign(exitButton.style, {
    position: 'absolute', top: 'max(14px, env(safe-area-inset-top))', right: 'max(14px, env(safe-area-inset-right))',
    minHeight: '36px', padding: '7px 12px', border: '1px solid rgba(190,230,205,.34)',
    borderRadius: '10px', background: 'rgba(4,12,10,.72)', color: '#eef8f1', pointerEvents: 'auto', cursor: 'pointer',
  });

  const help = document.createElement('div');
  help.textContent = 'WASD move · mouse look · Shift sprint · Space/Ctrl altitude · E scan life · poles wrap naturally · Esc exit';
  Object.assign(help.style, {
    position: 'absolute', left: '50%', bottom: 'max(16px, env(safe-area-inset-bottom))', transform: 'translateX(-50%)',
    maxWidth: 'calc(100vw - 30px)', padding: '7px 10px', borderRadius: '9px', background: 'rgba(4,12,10,.54)',
    fontSize: '10px', whiteSpace: 'nowrap',
  });

  const crosshair = document.createElement('div');
  crosshair.textContent = '+';
  Object.assign(crosshair.style, {
    position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
    fontSize: '19px', fontWeight: '300', opacity: '.72',
  });

  const enterButton = document.createElement('button');
  enterButton.type = 'button';
  enterButton.id = 'enterSurfaceMode';
  enterButton.textContent = 'Enter Surface';
  Object.assign(enterButton.style, {
    position: 'absolute', zIndex: '24', left: '50%', bottom: 'max(18px, env(safe-area-inset-bottom))',
    transform: 'translateX(-50%)', minHeight: '38px', padding: '8px 14px',
    border: '1px solid rgba(190,230,205,.38)', borderRadius: '11px', background: 'rgba(6,18,15,.78)',
    color: '#eef8f1', boxShadow: '0 8px 30px rgba(0,0,0,.32)', backdropFilter: 'blur(8px)',
    cursor: 'pointer', font: '600 12px/1.1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  });

  hud.append(info, exitButton, help, crosshair);
  layer.append(canvas, hud);
  host.append(layer, enterButton);

  // The detailed terrain is loaded on demand. Paint a cheap, immediate
  // fallback on the input canvas so a slow chunk or unavailable WebGL context
  // never leaves Surface Mode as a black screen. The GPU renderer replaces it
  // by setting this canvas transparent after its first active frame.
  function paintSurfaceFallback() {
    const rect = layer.getBoundingClientRect();
    const width = Math.max(2, Math.min(960, Math.round(rect.width || innerWidth || 960)));
    const height = Math.max(2, Math.min(640, Math.round(rect.height || innerHeight || 540)));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!context) return;
    const horizon = Math.round(height * (0.46 + clamp(player.pitch, -0.45, 0.45) * 0.24));
    const sky = context.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#183531');
    sky.addColorStop(0.6, '#6c998b');
    sky.addColorStop(1, '#b9d4bc');
    context.fillStyle = sky;
    context.fillRect(0, 0, width, horizon);
    const ground = context.createLinearGradient(0, horizon, 0, height);
    ground.addColorStop(0, '#527b59');
    ground.addColorStop(1, '#132b22');
    context.fillStyle = ground;
    context.fillRect(0, horizon, width, height - horizon);
    context.fillStyle = 'rgba(232, 248, 221, .22)';
    context.beginPath();
    context.moveTo(0, horizon + height * 0.06);
    for (let x = 0; x <= width; x += 20) {
      const ridge = Math.sin((x / width + player.yaw * 0.2) * 8.4) * height * 0.035 + Math.sin((x / width + player.x * 0.004) * 22) * height * 0.018;
      context.lineTo(x, horizon + height * 0.075 + ridge);
    }
    context.lineTo(width, horizon);
    context.lineTo(0, horizon);
    context.fill();
  }

  function applySphereTopology() {
    let crossed = false;
    while (player.y < 0 || player.y > world.height) {
      if (player.y < 0) {
        player.y = -player.y;
        player.x = wrap(player.x + world.width * 0.5, world.width);
        crossed = true;
      } else if (player.y > world.height) {
        player.y = world.height - (player.y - world.height);
        player.x = wrap(player.x + world.width * 0.5, world.width);
        crossed = true;
      }
    }
    if (crossed) {
      player.yaw = wrapAngle(player.yaw + Math.PI);
      stats.poleCrossings++;
      document.documentElement.dataset.surfacePoleCrossings = String(stats.poleCrossings);
    }
    player.x = wrap(player.x, world.width);
  }

  function updateHud(force = false, now = performance.now()) {
    if (!active) return;
    if (!force && now - lastHudUpdate < HUD_INTERVAL_MS) return;
    lastHudUpdate = now;
    const terrain = living.sampleDynamicPlanet(wrap(player.x, world.width), clamp(player.y, 0, world.height));
    const localWater = waterCycle.sample(wrap(player.x, world.width), clamp(player.y, 0, world.height));
    const latitude = (0.5 - player.y / world.height) * 180;
    const longitude = (player.x / world.width - 0.5) * 360;
    const altitude = Math.max(0, player.altitude - EYE_HEIGHT);
    const nearbyLife = Number(document.documentElement.dataset.surfaceModeVisibleCreatures || 0);
    const circumference = world.geography?.equatorialCircumferenceKm;
    const scaleLine = circumference ? `${circumference.toLocaleString()} km around · scale ×${world.geography.macroScale}` : 'procedural scale';
    info.innerHTML = `<b>SURFACE MODE · EIDOLON · SPHERE GPU</b><br>${terrain?.biome || 'unknown'} · ${Math.abs(latitude).toFixed(2)}° ${latitude >= 0 ? 'N' : 'S'} · ${Math.abs(longitude).toFixed(2)}° ${longitude >= 0 ? 'E' : 'W'}<br>${scaleLine} · altitude +${altitude.toFixed(1)} · rain ${(localWater?.rain || 0).toFixed(2)} · nearby life ${nearbyLife}`;
    document.documentElement.dataset.surfaceModeBiome = terrain?.biome || 'unknown';
    document.documentElement.dataset.surfaceModeCoordinates = `${player.x.toFixed(2)},${player.y.toFixed(2)}`;
  }

  function updateMovement(dt) {
    if (!active) return;
    const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const speed = sprint ? 38 : 13;
    let forward = 0;
    let strafe = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) forward += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) forward -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) strafe += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) strafe -= 1;
    const magnitude = Math.hypot(forward, strafe) || 1;
    forward /= magnitude;
    strafe /= magnitude;

    const fx = Math.cos(player.yaw);
    const fy = Math.sin(player.yaw);
    const rx = -fy;
    const ry = fx;
    player.x += (fx * forward + rx * strafe) * speed * dt;
    player.y += (fy * forward + ry * strafe) * speed * dt;
    applySphereTopology();

    if (keys.has('Space')) player.altitude = clamp(player.altitude + dt * 11, EYE_HEIGHT, MAX_ALTITUDE);
    if (keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC')) {
      player.altitude = clamp(player.altitude - dt * 11, EYE_HEIGHT, MAX_ALTITUDE);
    }
  }

  function startTerrainRenderer() {
    if (terrainRendererPromise) return terrainRendererPromise;
    // Start the renderer and the optional rich presentation bundle together.
    // The latter already waits for the renderer's public APIs, so serializing
    // these imports only delayed the first real Surface frame.
    const gpuRenderer = import('./surface-terrain-water-sphere-gpu-v37.js');
    const visualLayers = import('./surface-visual-layers.js')
      .then(() => {
        document.documentElement.dataset.surfaceVisualLayers = 'v46e-lazy-loaded';
      })
      .catch(error => {
        // Cosmetic layers must not prevent the core terrain renderer from
        // starting. Keep Surface Mode usable with its terrain-only view.
        console.warn('[Surface Mode] Optional visual layers could not start.', error);
        document.documentElement.dataset.surfaceVisualLayers = 'load-failed';
      });
    terrainRendererPromise = Promise.all([gpuRenderer, visualLayers])
      .catch(error => {
        console.warn('[Surface Mode] GPU terrain scene could not start.', error);
        document.documentElement.dataset.surfaceGpu = 'load-failed';
        paintSurfaceFallback();
      });
    return terrainRendererPromise;
  }

  function loop(now) {
    requestAnimationFrame(loop);
    const dt = clamp((now - lastFrameTime) / 1000, 0, 0.05);
    lastFrameTime = now;
    if (!active) return;
    updateMovement(dt);
    updateHud(false, now);
  }
  requestAnimationFrame(loop);

  function enterAt(x, y) {
    player.x = wrap(x, world.width);
    player.y = clamp(y, 0, world.height);
    player.altitude = EYE_HEIGHT;
    player.pitch = DEFAULT_SURFACE_PITCH;
    active = true;
    keys.clear();
    lastHudUpdate = -Infinity;
    document.documentElement.dataset.surfaceMode = 'active';
    canvas.style.opacity = '1';
    paintSurfaceFallback();
    document.documentElement.dataset.surfaceModeFallbackReady = 'true';
    document.documentElement.dataset.surfaceModeFallbackPaintedAt = performance.now().toFixed(2);
    // Keep the heavy Three.js terrain scene out of the overview page. It is
    // requested only after the explorer intentionally enters Surface Mode.
    if (!terrainRendererRequested) {
      terrainRendererRequested = true;
      startTerrainRenderer();
    }
    layer.style.pointerEvents = 'auto';
    layer.style.opacity = '1';
    enterButton.style.display = 'none';
    const shell = document.querySelector('.planet-shell');
    if (shell) {
      shellDisplay = shell.style.display;
      shell.style.display = 'none';
    }
    updateHud(true);
    canvas.focus({ preventScroll: true });
    canvas.requestPointerLock?.().catch?.(() => {});
  }

  function exitSurface() {
    if (!active) return;
    active = false;
    keys.clear();
    document.documentElement.dataset.surfaceMode = 'inactive';
    if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    layer.style.opacity = '0';
    layer.style.pointerEvents = 'none';
    enterButton.style.display = '';
    const shell = document.querySelector('.planet-shell');
    if (shell) shell.style.display = shellDisplay;
  }

  function enterFromCameraCenter() {
    const camera = runtime.getCamera();
    enterAt(camera.centerX * world.width, camera.centerY * world.height);
  }

  function globePointFromClient(clientX, clientY) {
    const rect = sourceCanvas.getBoundingClientRect();
    const cameraState = runtime.getCamera();
    const width = rect.width;
    const height = rect.height;
    const radius = Math.min(width, height) * GLOBE_RADIUS_FACTOR * cameraState.zoom;
    const sx = (clientX - rect.left - width * 0.5) / radius;
    const sy = -(clientY - rect.top - height * 0.5) / radius;
    const rho2 = sx * sx + sy * sy;
    if (rho2 > 1) return null;
    const z = Math.sqrt(Math.max(0, 1 - rho2));
    const lon0 = (cameraState.centerX - 0.5) * TAU;
    const lat0 = (0.5 - cameraState.centerY) * Math.PI;
    const sinLat0 = Math.sin(lat0);
    const cosLat0 = Math.cos(lat0);
    const latitude = Math.asin(clamp(sy * cosLat0 + z * sinLat0, -1, 1));
    const longitude = lon0 + Math.atan2(sx, z * cosLat0 - sy * sinLat0);
    return {
      x: wrap(longitude / TAU + 0.5, 1) * world.width,
      y: clamp(0.5 - latitude / Math.PI, 0, 1) * world.height,
    };
  }

  enterButton.addEventListener('click', enterFromCameraCenter);
  exitButton.addEventListener('click', exitSurface);
  sourceCanvas.addEventListener('dblclick', event => {
    if (active) return;
    const point = globePointFromClient(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    enterAt(point.x, point.y);
  });

  window.addEventListener('keydown', event => {
    if (!active) return;
    if (event.code === 'Escape') {
      event.preventDefault();
      exitSurface();
      return;
    }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ControlLeft', 'ControlRight', 'KeyC', 'ShiftLeft', 'ShiftRight'].includes(event.code)) {
      event.preventDefault();
      keys.add(event.code);
    }
  }, { passive: false });

  window.addEventListener('keyup', event => keys.delete(event.code));
  window.addEventListener('blur', () => keys.clear());

  document.addEventListener('mousemove', event => {
    if (!active) return;
    if (document.pointerLockElement === canvas) {
      player.yaw = wrapAngle(player.yaw + event.movementX * 0.00225);
      player.pitch = clamp(player.pitch - event.movementY * 0.0019, -0.58, 0.58);
      return;
    }
    if (!dragLook) return;
    const dx = event.clientX - dragX;
    const dy = event.clientY - dragY;
    dragX = event.clientX;
    dragY = event.clientY;
    player.yaw = wrapAngle(player.yaw + dx * 0.004);
    player.pitch = clamp(player.pitch - dy * 0.0032, -0.58, 0.58);
  });

  canvas.addEventListener('pointerdown', event => {
    if (!active) return;
    canvas.focus({ preventScroll: true });
    if (event.pointerType === 'mouse') {
      dragLook = true;
      dragX = event.clientX;
      dragY = event.clientY;
      canvas.requestPointerLock?.().catch?.(() => {});
    }
  });
  window.addEventListener('pointerup', () => { dragLook = false; });
  window.addEventListener('pointercancel', () => { dragLook = false; });
  window.addEventListener('resize', () => {
    if (active && canvas.style.opacity !== '0') paintSurfaceFallback();
  }, { passive: true });

  const previousDiagnostics = window.realitySandboxPresentationDiagnostics;
  window.realitySandboxPresentationDiagnostics = () => ({
    ...(typeof previousDiagnostics === 'function' ? previousDiagnostics() : {}),
    surfaceModeReady: true,
    surfaceMode: active ? 'active' : 'inactive',
    surfaceModeRenderer: 'gpu-controller-spherical-topology',
    surfaceModeCanvasPresent: Boolean(document.getElementById('surfaceModeCanvas')),
    surfaceModeBiome: document.documentElement.dataset.surfaceModeBiome || 'unknown',
    surfaceModeCoordinates: document.documentElement.dataset.surfaceModeCoordinates || 'unknown',
    surfaceModeVisibleCreatures: Number(document.documentElement.dataset.surfaceModeVisibleCreatures || 0),
    surfaceModeSphere: {
      topology: 'longitude-wrap-pole-reflection',
      poleCrossings: stats.poleCrossings,
    },
  });

  window.realitySandboxSurfaceMode = {
    enter: enterFromCameraCenter,
    enterAt,
    exit: exitSurface,
    showFallback() {
      if (!active) return;
      canvas.style.opacity = '1';
      paintSurfaceFallback();
      document.documentElement.dataset.surfaceModeFallbackReady = 'true';
      document.documentElement.dataset.surfaceModeFallbackPaintedAt = performance.now().toFixed(2);
    },
    isActive: () => active,
    getPlayer: () => ({ ...player }),
    getStats: () => ({ topology: 'sphere', poleCrossings: stats.poleCrossings }),
  };
  document.documentElement.dataset.surfaceMode = 'inactive';
  document.documentElement.dataset.surfaceModeReady = 'true';
  document.documentElement.dataset.surfaceModeRenderer = 'gpu-controller-spherical-topology';
  document.documentElement.dataset.surfaceTopology = 'sphere';
}

async function boot() {
  const state = await waitForRuntime();
  if (!state) {
    document.documentElement.dataset.surfaceModeReady = 'false';
    return;
  }
  installSurfaceMode(state);
}

boot();
