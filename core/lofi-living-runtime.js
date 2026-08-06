import { Application, Graphics } from 'pixi.js';
import { biomeColor } from './planet.js';

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const UI_INTERVAL_MS = 300;
const PALETTE = {
  background: 0x030806,
  atmosphere: 0x8bb8a8,
  cloud: 0xc9d8d1,
  rain: 0x78b9d5,
  storm: 0x6d8090,
  plant: 0x9bd36d,
  grazer: 0xf0ddb0,
  predator: 0xe46f55,
  apex: 0xb493d4,
  selection: 0xf4f0bd,
};

export function createLofiLivingRuntime(world, dependencies, options = {}) {
  const { orbitalSystem, living, waterCycle, biosphere, dynamics } = dependencies;
  const mobile = options.mobile ?? matchMedia('(max-width: 720px), (pointer: coarse)').matches;
  const seed = options.seed ?? 734221;
  const planetName = options.planetName || world.planetName || 'Procedural Planet';
  const controls = options.controls || {};
  const logicalSize = chooseLogicalSize(mobile);

  let masterSteps = 0;
  let unifiedSeconds = 0;
  let lastWorldTick = world.tick;
  let duplicateClockViolations = 0;
  let lastRender = -Infinity;
  let lastUiUpdate = -Infinity;
  let lastDrawnEntities = 0;
  let lastDrawnWeather = 0;
  let destroyed = false;
  let selectedPoint = { x: world.width * 0.5, y: world.height * 0.5 };
  let latestEvent = 'Terrain, water, weather, vegetation, and animals are now sharing one world state.';

  const camera = { zoom: 1, centerX: 0.5, centerY: 0.5 };
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  let canvas = null;
  let app = null;
  let graphics = null;
  let shell = null;
  let interfaceNodes = null;
  let pixiLoadPromise = null;

  async function initialize({ provideCapability }) {
    installCanvas();
    installInterface();
    installEventFeed();
    await ensurePixi();
    updateInterface(true);
    provideCapability('runtime.living-planet', api);
    provideCapability('presentation.pixi-root', api);
    return api;
  }

  function installCanvas() {
    const host = document.getElementById('world') || document.body;
    canvas = document.createElement('canvas');
    canvas.id = 'lofiLivingCanvas';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', `${planetName}, a fictional procedural planet. Drag to rotate, scroll or pinch to zoom, and click a region to inspect it.`);
    canvas.style.imageRendering = 'pixelated';
    host.prepend(canvas);
    installInteraction();
    document.body.dataset.rootExperience = 'procedural-living-planet';
    document.body.dataset.worldGeometry = 'sphere';
  }

  function installInterface() {
    const host = document.getElementById('world') || document.body;
    shell = document.createElement('div');
    shell.className = 'planet-shell';
    shell.innerHTML = `
      <section class="planet-masthead" aria-labelledby="planetTitle">
        <p class="planet-eyebrow">Procedural living planet · fictional world</p>
        <h1 class="planet-title" id="planetTitle">${escapeHtml(planetName)}</h1>
        <p class="planet-subtitle">One coupled simulation: terrain shapes water, water shapes plants, and food and climate shape animal survival and evolution.</p>
        <p class="planet-subtitle" data-planet-event aria-live="polite"></p>
      </section>
      <section class="planet-dashboard" aria-label="Living planet overview">
        <dl class="planet-stats">
          ${statMarkup('season', 'Season', 'Season is derived from Nysa’s procedural orbit and axial tilt.')}
          ${statMarkup('storms', 'Rain systems', 'Cloud cells currently producing rain or snow in the water-cycle grid.')}
          ${statMarkup('plants', 'Plants', 'Active plant and seed-pod entities with stored biomass above zero.')}
          ${statMarkup('grazers', 'Grazers', 'Living herbivore entities that seek and consume vegetation.')}
          ${statMarkup('predators', 'Predators', 'Living predator and apex-predator entities in the food web.')}
          ${statMarkup('species', 'Species', 'Persisting named animal lineages tracked by the biosphere model.')}
          ${statMarkup('soil', 'Mean soil', 'Mean normalized soil-water storage from sampled land regions; 100% is model saturation, not a physical volume.')}
          ${statMarkup('diversity', 'Trait spread', 'Mean range of inherited speed, sensing, and metabolism traits across animals, normalized for comparison.')}
        </dl>
        <div class="planet-controls">
          <button type="button" data-planet-pause aria-pressed="false">Pause</button>
          <button type="button" data-planet-step title="Advance one fixed simulation step">Step</button>
          <label>
            <span class="sr-only">Simulation speed</span>
            <select data-planet-speed aria-label="Simulation speed">
              <option value="0.25">¼×</option>
              <option value="1" selected>1×</option>
              <option value="5">5×</option>
              <option value="20">20×</option>
            </select>
          </label>
          <output class="planet-clock" data-planet-clock>tick 0</output>
        </div>
        <details class="planet-help">
          <summary>How to read these numbers</summary>
          <p>Counts are actual simulated entities. “Mean soil” and “trait spread” are normalized model indices and are labeled as such. Hover or focus any statistic for its exact definition. Nothing on this page represents measured Earth data.</p>
        </details>
      </section>
      <section class="planet-inspector" aria-label="Selected region inspector">
        <h2 data-inspect-title>Selected region</h2>
        <p class="planet-inspector__hint">Click or tap the globe to inspect the exact terrain, water, weather, and nearby life used by the simulation.</p>
        <p class="planet-inspector__coords" data-inspect-coords></p>
        <div class="planet-inspector__grid">
          ${readingMarkup('biome', 'Biome')}
          ${readingMarkup('elevation', 'Elevation')}
          ${readingMarkup('temperature', 'Temperature')}
          ${readingMarkup('rainfall', 'Annual rain')}
          ${readingMarkup('weather', 'Weather')}
          ${readingMarkup('water', 'Surface water')}
          ${readingMarkup('soil', 'Soil moisture')}
          ${readingMarkup('flood', 'Flood index')}
          ${readingMarkup('life', 'Nearby life')}
        </div>
      </section>
      <aside class="planet-legend" aria-label="Map legend">
        <span><i style="background:#9bd36d"></i>plants</span>
        <span><i style="background:#f0ddb0"></i>grazers</span>
        <span><i style="background:#e46f55"></i>predators</span>
        <span><i style="background:#b493d4"></i>apex</span>
        <span><i style="background:#78b9d5"></i>rain and rivers</span>
        <span><i style="background:#c9d8d1"></i>cloud</span>
      </aside>`;
    host.append(shell);

    interfaceNodes = {
      stats: Object.fromEntries([...shell.querySelectorAll('[data-stat]')].map(node => [node.dataset.stat, node])),
      event: shell.querySelector('[data-planet-event]'),
      pause: shell.querySelector('[data-planet-pause]'),
      step: shell.querySelector('[data-planet-step]'),
      speed: shell.querySelector('[data-planet-speed]'),
      clock: shell.querySelector('[data-planet-clock]'),
      inspectTitle: shell.querySelector('[data-inspect-title]'),
      inspectCoords: shell.querySelector('[data-inspect-coords]'),
      readings: Object.fromEntries([...shell.querySelectorAll('[data-reading]')].map(node => [node.dataset.reading, node])),
    };

    interfaceNodes.pause.addEventListener('click', () => {
      controls.setPaused?.(!controls.isPaused?.());
      updateInterface(true);
    });
    interfaceNodes.step.addEventListener('click', () => {
      controls.setPaused?.(true);
      controls.stepOnce?.();
      updateInterface(true);
    });
    interfaceNodes.speed.addEventListener('change', () => {
      controls.setTimeScale?.(Number(interfaceNodes.speed.value));
      updateInterface(true);
    });
  }

  function installEventFeed() {
    const setEvent = event => {
      const detail = event.detail || {};
      latestEvent = [detail.title, detail.description].filter(Boolean).join(' — ') || latestEvent;
      updateInterface(true);
    };
    window.addEventListener('planet-event', setEvent);
    window.addEventListener('biosphere-event', setEvent);
    window.addEventListener('water-cycle-event', setEvent);
    api._removeEventFeed = () => {
      window.removeEventListener('planet-event', setEvent);
      window.removeEventListener('biosphere-event', setEvent);
      window.removeEventListener('water-cycle-event', setEvent);
    };
  }

  function installInteraction() {
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.addEventListener('keydown', onKeyDown);
  }

  function removeInteraction() {
    if (!canvas) return;
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('dblclick', onDoubleClick);
    canvas.removeEventListener('keydown', onKeyDown);
  }

  async function ensurePixi() {
    if (app) return app;
    if (pixiLoadPromise) return pixiLoadPromise;
    pixiLoadPromise = (async () => {
      const next = new Application();
      await next.init({
        canvas,
        width: logicalSize.width,
        height: logicalSize.height,
        background: PALETTE.background,
        antialias: false,
        autoStart: false,
        sharedTicker: false,
        preference: 'webgl',
        powerPreference: mobile ? 'low-power' : 'high-performance',
        resolution: 1,
        clearBeforeRender: true,
      });
      next.stop();
      graphics = new Graphics();
      next.stage.addChild(graphics);
      app = next;
      return app;
    })().finally(() => { pixiLoadPromise = null; });
    return pixiLoadPromise;
  }

  function onWheel(event) {
    if (destroyed) return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    const pixelDelta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * innerHeight : event.deltaY;
    zoomAtClientPoint(camera.zoom * Math.exp(-pixelDelta * (event.ctrlKey ? 0.006 : 0.0015)), event.clientX, event.clientY);
  }

  function onPointerDown(event) {
    if (destroyed) return;
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size >= 2) beginPinch();
    else {
      drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, centerX: camera.centerX, centerY: camera.centerY, moved: 0 };
      canvas.dataset.dragging = 'true';
    }
  }

  function onPointerMove(event) {
    if (!pointers.has(event.pointerId) || destroyed) return;
    event.preventDefault();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size >= 2) {
      if (!pinch) beginPinch();
      const pair = [...pointers.values()].slice(0, 2);
      const distance = pointDistance(pair[0], pair[1]);
      const midpoint = pointMidpoint(pair[0], pair[1]);
      setCameraAroundAnchor(pinch.distance > 0 ? pinch.zoom * distance / pinch.distance : pinch.zoom, pinch.anchor, midpoint.x, midpoint.y);
      return;
    }
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    drag.moved = Math.max(drag.moved, Math.hypot(event.clientX - drag.x, event.clientY - drag.y));
    setCamera({
      zoom: camera.zoom,
      centerX: drag.centerX - (event.clientX - drag.x) / rect.width / camera.zoom,
      centerY: drag.centerY + (event.clientY - drag.y) / rect.height / camera.zoom,
    });
  }

  function onPointerUp(event) {
    if (!pointers.has(event.pointerId)) return;
    const click = pointers.size === 1 && drag?.pointerId === event.pointerId && drag.moved < 7;
    pointers.delete(event.pointerId);
    try { canvas.releasePointerCapture?.(event.pointerId); } catch {}
    if (click) selectAtClientPoint(event.clientX, event.clientY);
    if (pointers.size >= 2) beginPinch();
    else {
      pinch = null;
      drag = null;
      canvas.dataset.dragging = 'false';
    }
  }

  function onDoubleClick(event) {
    event.preventDefault();
    resetCamera();
  }

  function onKeyDown(event) {
    const rect = canvas.getBoundingClientRect();
    const x = rect.left + rect.width * 0.5;
    const y = rect.top + rect.height * 0.5;
    if (event.key === '+' || event.key === '=' || event.key === 'PageUp') zoomAtClientPoint(camera.zoom * 1.35, x, y);
    else if (event.key === '-' || event.key === '_' || event.key === 'PageDown') zoomAtClientPoint(camera.zoom / 1.35, x, y);
    else if (event.key === '0' || event.key === 'Home') resetCamera();
    else return;
    event.preventDefault();
  }

  function beginPinch() {
    const pair = [...pointers.values()].slice(0, 2);
    if (pair.length < 2) return;
    const midpoint = pointMidpoint(pair[0], pair[1]);
    pinch = { distance: Math.max(1, pointDistance(pair[0], pair[1])), zoom: camera.zoom, anchor: clientToWorld(midpoint.x, midpoint.y) };
    drag = null;
    canvas.dataset.dragging = 'true';
  }

  function zoomAtClientPoint(nextZoom, clientX, clientY) {
    const anchor = clientToWorld(clientX, clientY);
    setCameraAroundAnchor(nextZoom, anchor, clientX, clientY);
  }

  function setCameraAroundAnchor(nextZoom, anchor, clientX, clientY) {
    const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    camera.zoom = zoom;
    const after = clientToWorld(clientX, clientY);
    setCamera({ zoom, centerX: camera.centerX + wrappedDelta(anchor.x - after.x), centerY: camera.centerY + anchor.y - after.y });
  }

  function clientToWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: camera.centerX, y: camera.centerY };
    const px = (clientX - rect.left) / rect.width * logicalSize.width;
    const py = (clientY - rect.top) / rect.height * logicalSize.height;
    return sphereScreenToWorld(px, py, logicalSize.width, logicalSize.height) || { x: camera.centerX, y: camera.centerY };
  }

  function selectAtClientPoint(clientX, clientY) {
    const normalized = clientToWorld(clientX, clientY);
    selectedPoint = { x: normalized.x * world.width, y: normalized.y * world.height };
    invalidateRender();
    updateInterface(true);
    return inspectSelected();
  }

  function setCamera(next = {}) {
    camera.zoom = clamp(Number(next.zoom) || camera.zoom, MIN_ZOOM, MAX_ZOOM);
    camera.centerX = wrap01(Number.isFinite(next.centerX) ? next.centerX : camera.centerX);
    camera.centerY = clamp(Number.isFinite(next.centerY) ? next.centerY : camera.centerY, 0.01, 0.99);
    invalidateRender();
    return getCamera();
  }

  function resetCamera() { return setCamera({ zoom: 1, centerX: 0.5, centerY: 0.5 }); }
  function getCamera() { return { ...camera, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM }; }
  function invalidateRender() { lastRender = -Infinity; }

  function step(dt) {
    if (!Number.isFinite(dt) || dt <= 0 || destroyed) return;
    if (world.tick < lastWorldTick) duplicateClockViolations += 1;
    lastWorldTick = world.tick;
    masterSteps += 1;
    unifiedSeconds += dt;
  }

  function render(frame = {}) {
    if (!app || !graphics || destroyed) return;
    const timestamp = frame.timestamp ?? performance.now();
    const minimumInterval = mobile ? 125 : 80;
    if (timestamp - lastRender >= minimumInterval) {
      lastRender = timestamp;
      drawLivingWorld();
      if (typeof app.render === 'function') app.render();
      else app.renderer.render({ container: app.stage });
    }
    updateInterface(false, timestamp);
  }

  function getSphereFrame(width, height) {
    const baseRadius = Math.min(width, height) * (mobile ? 0.42 : 0.43);
    return { cx: width * 0.5, cy: height * 0.5, radius: baseRadius * camera.zoom };
  }

  function sphereScreenToWorld(px, py, width, height) {
    const { cx, cy, radius } = getSphereFrame(width, height);
    const sx = (px - cx) / radius;
    const sy = -(py - cy) / radius;
    const rho2 = sx * sx + sy * sy;
    if (rho2 > 1) return null;
    const z = Math.sqrt(Math.max(0, 1 - rho2));
    const lon0 = (camera.centerX - 0.5) * Math.PI * 2;
    const lat0 = (0.5 - camera.centerY) * Math.PI;
    const sinLat0 = Math.sin(lat0);
    const cosLat0 = Math.cos(lat0);
    const latitude = Math.asin(clamp(sy * cosLat0 + z * sinLat0, -1, 1));
    const longitude = lon0 + Math.atan2(sx, z * cosLat0 - sy * sinLat0);
    return { x: wrap01(longitude / (Math.PI * 2) + 0.5), y: clamp(0.5 - latitude / Math.PI, 0, 1), normal: { x: sx, y: sy, z } };
  }

  function worldToSphereScreen(worldX, worldY, width, height) {
    const { cx, cy, radius } = getSphereFrame(width, height);
    const lon = (worldX - 0.5) * Math.PI * 2;
    const lat = (0.5 - worldY) * Math.PI;
    const lon0 = (camera.centerX - 0.5) * Math.PI * 2;
    const lat0 = (0.5 - camera.centerY) * Math.PI;
    const delta = lon - lon0;
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    const sinLat0 = Math.sin(lat0);
    const cosLat0 = Math.cos(lat0);
    const x = cosLat * Math.sin(delta);
    const y = sinLat * cosLat0 - cosLat * Math.cos(delta) * sinLat0;
    const z = sinLat * sinLat0 + cosLat * Math.cos(delta) * cosLat0;
    return { x: cx + x * radius, y: cy - y * radius, depth: z, visible: z > 0 };
  }

  function drawLivingWorld() {
    const width = app.renderer.width;
    const height = app.renderer.height;
    const tile = mobile ? 3 : 3;
    const { cx, cy, radius } = getSphereFrame(width, height);
    graphics.clear();
    graphics.rect(0, 0, width, height).fill(PALETTE.background);
    graphics.circle(cx + 2, cy + 3, radius + 2).fill({ color: 0x000000, alpha: 0.55 });
    graphics.circle(cx, cy, radius + 2).fill({ color: PALETTE.atmosphere, alpha: 0.25 });

    const left = Math.max(0, Math.floor((cx - radius) / tile) * tile);
    const right = Math.min(width, Math.ceil((cx + radius) / tile) * tile);
    const top = Math.max(0, Math.floor((cy - radius) / tile) * tile);
    const bottom = Math.min(height, Math.ceil((cy + radius) / tile) * tile);

    for (let py = top; py < bottom; py += tile) {
      for (let px = left; px < right; px += tile) {
        const sample = sphereScreenToWorld(px + tile * 0.5, py + tile * 0.5, width, height);
        if (!sample) continue;
        const worldX = sample.x * world.width;
        const worldY = sample.y * world.height;
        const terrain = living.sampleDynamicPlanet(worldX, worldY);
        const water = waterCycle.sample(worldX, worldY);
        const base = coupledSurfaceColor(terrain, water);
        const light = clamp(0.3 + 0.78 * (sample.normal.x * -0.35 + sample.normal.y * 0.42 + sample.normal.z * 0.82), 0.18, 1.06);
        graphics.rect(px, py, tile, tile).fill(shadeColor(base, light));
      }
    }

    const weather = dynamics.getWeather?.() || [];
    lastDrawnWeather = 0;
    for (const cell of weather.slice(0, mobile ? 12 : 24)) {
      const point = worldToSphereScreen(cell.x / world.width, cell.y / world.height, width, height);
      if (!point.visible) continue;
      const cloudRadius = Math.max(2, Math.round((cell.radius || 10) / world.width * radius * 2.4));
      const strength = clamp(cell.strength ?? 0.5, 0, 1);
      const color = cell.type === 'storm' ? PALETTE.storm : PALETTE.cloud;
      const x = quantize(point.x, 2);
      const y = quantize(point.y, 2);
      graphics.rect(x - cloudRadius, y - 1, cloudRadius * 2, 3).fill({ color, alpha: (0.25 + strength * 0.42) * point.depth });
      graphics.rect(x - Math.max(1, cloudRadius - 2), y - 3, Math.max(2, cloudRadius * 2 - 4), 2).fill({ color, alpha: (0.18 + strength * 0.3) * point.depth });
      if (cell.type === 'rain' || cell.type === 'storm') {
        graphics.rect(x - cloudRadius, y + 3, 1, 3).fill({ color: PALETTE.rain, alpha: 0.55 * point.depth });
        graphics.rect(x + Math.max(1, cloudRadius - 2), y + 2, 1, 4).fill({ color: PALETTE.rain, alpha: 0.45 * point.depth });
      }
      lastDrawnWeather += 1;
    }

    lastDrawnEntities = 0;
    const components = world.ecs.components;
    const maximum = mobile ? 150 : 320;
    for (const [id, position] of components.position.entries()) {
      if (lastDrawnEntities >= maximum) break;
      let color = null;
      let baseSize = 1;
      let alpha = 1;
      if (components.resource.has(id)) {
        const plant = components.resource.get(id);
        if ((plant.amount || 0) <= 0.02) continue;
        color = PALETTE.plant;
        alpha = 0.35 + clamp(plant.amount || 0, 0, 1) * 0.65;
      } else if (components.agent.has(id)) color = biosphere.getSpeciesForEntity(id)?.color || PALETTE.grazer;
      else if (components.predator.has(id)) { color = biosphere.getSpeciesForEntity(id)?.color || PALETTE.predator; baseSize = 2; }
      else if (components.apex.has(id)) { color = biosphere.getSpeciesForEntity(id)?.color || PALETTE.apex; baseSize = 2; }
      if (color === null) continue;
      const point = worldToSphereScreen(position.x / world.width, position.y / world.height, width, height);
      if (!point.visible) continue;
      const size = clamp(Math.round(baseSize * Math.sqrt(camera.zoom)), baseSize, baseSize * 3);
      graphics.rect(Math.floor(point.x), Math.floor(point.y), size, size).fill({ color: shadeColor(color, 0.58 + point.depth * 0.42), alpha });
      lastDrawnEntities += 1;
    }

    const selected = worldToSphereScreen(selectedPoint.x / world.width, selectedPoint.y / world.height, width, height);
    if (selected.visible) {
      graphics.circle(selected.x, selected.y, clamp(3 + camera.zoom, 4, 9)).stroke({ color: PALETTE.selection, width: 1, alpha: 0.92 });
      graphics.circle(selected.x, selected.y, 1).fill(PALETTE.selection);
    }
    graphics.circle(cx, cy, radius).stroke({ color: PALETTE.atmosphere, width: 1, alpha: 0.76 });
  }

  function updateInterface(force = false, timestamp = performance.now()) {
    if (!interfaceNodes || (!force && timestamp - lastUiUpdate < UI_INTERVAL_MS)) return;
    lastUiUpdate = timestamp;
    const stats = getPlanetStats();
    for (const [key, value] of Object.entries(stats.display)) {
      if (interfaceNodes.stats[key]) interfaceNodes.stats[key].textContent = value;
    }
    interfaceNodes.event.textContent = latestEvent;
    const isPaused = Boolean(controls.isPaused?.());
    interfaceNodes.pause.textContent = isPaused ? 'Resume' : 'Pause';
    interfaceNodes.pause.setAttribute('aria-pressed', String(isPaused));
    interfaceNodes.step.disabled = !isPaused;
    interfaceNodes.speed.value = String(controls.getTimeScale?.() ?? 1);
    interfaceNodes.clock.textContent = `tick ${world.tick.toLocaleString()}`;
    updateInspector(inspectSelected());
  }

  function getPlanetStats() {
    const c = world.ecs.components;
    const plants = [...c.resource.values()].filter(plant => (plant.amount || 0) > 0.02).length;
    const grazers = c.agent.size;
    const predators = c.predator.size + c.apex.size;
    const species = biosphere.getSpecies().filter(item => item.population > 0);
    const weather = dynamics.getWeather?.() || [];
    const rainSystems = weather.filter(cell => cell.type === 'rain' || cell.type === 'storm' || cell.type === 'snow').length;
    const orbit = orbitalSystem.getSeasonState(0);
    const soilSamples = sampleGrid(36, world.width, world.height, point => waterCycle.sample(point.x, point.y).soil || 0);
    const animals = [...c.agent.values(), ...c.predator.values(), ...c.apex.values()];
    const traitValues = animals.flatMap(animal => animal.dna ? [animal.dna.speed, animal.dna.sense, animal.dna.metabolism] : []);
    const traitSpread = normalizedSpread(traitValues);
    return {
      plants,
      grazers,
      predators,
      species: species.length,
      rainSystems,
      meanSoil: mean(soilSamples),
      traitSpread,
      display: {
        season: orbit.northernSeason,
        storms: String(rainSystems),
        plants: String(plants),
        grazers: String(grazers),
        predators: String(predators),
        species: String(species.length),
        soil: `${Math.round(mean(soilSamples) * 100)}% idx`,
        diversity: `${Math.round(traitSpread * 100)}% idx`,
      },
    };
  }

  function inspectSelected() {
    const inspection = dynamics.inspect(selectedPoint.x, selectedPoint.y);
    const latitude = 90 - selectedPoint.y / world.height * 180;
    const longitude = selectedPoint.x / world.width * 360 - 180;
    return { ...inspection, latitude, longitude };
  }

  function updateInspector(inspection) {
    if (!interfaceNodes || !inspection) return;
    interfaceNodes.inspectTitle.textContent = inspection.title;
    interfaceNodes.inspectCoords.textContent = `${formatCoordinate(inspection.latitude, 'N', 'S')} · ${formatCoordinate(inspection.longitude, 'E', 'W')} · procedural coordinates`;
    const life = inspection.counts;
    const values = {
      biome: inspection.biome,
      elevation: `${inspection.elevation.toLocaleString()} m model`,
      temperature: `${inspection.temperature.toFixed(1)} °C model`,
      rainfall: `${inspection.rainfall.toLocaleString()} mm/yr model`,
      weather: inspection.weather,
      water: inspection.water,
      soil: `${inspection.soilMoisture}% index`,
      flood: `${inspection.floodRisk}% index`,
      life: `${life.plants}P · ${life.grazers}G · ${life.predators + life.apex}C`,
    };
    for (const [key, value] of Object.entries(values)) {
      if (interfaceNodes.readings[key]) {
        interfaceNodes.readings[key].textContent = value;
        interfaceNodes.readings[key].title = value;
      }
    }
  }

  async function debugScenario(kind) {
    if (kind === 'shared-clock') return { ok: duplicateClockViolations === 0, kind, privateRafLoops: 0, masterSteps, source: 'root-module-host-fixed-step' };
    if (kind === 'camera') {
      const before = getCamera();
      setCamera({ zoom: 2.5, centerX: 0.42, centerY: 0.57 });
      const after = getCamera();
      setCamera(before);
      return { ok: after.zoom > before.zoom && Number.isFinite(after.centerX), kind, before, after };
    }
    if (kind === 'coupling') {
      const point = { x: world.width * 0.41, y: world.height * 0.58 };
      const terrain = living.sampleDynamicPlanet(point.x, point.y);
      const water = waterCycle.sample(point.x, point.y);
      const inspection = dynamics.inspect(point.x, point.y);
      return {
        ok: Boolean(terrain.biome && inspection.biome) && Number.isFinite(water.soil) && Number.isFinite(inspection.soilMoisture),
        kind,
        point,
        terrain: { biome: terrain.biome, elevation: terrain.elevation, temperature: terrain.temperature },
        water: { soil: water.soil, rain: water.rain, river: water.river, flood: water.flood },
        inspection,
      };
    }
    if (kind === 'scene') {
      return {
        ok: Boolean(canvas && app && graphics && shell),
        kind,
        model: 'procedural',
        renderer: 'pixi-single-canvas',
        interactiveCamera: true,
        inspector: Boolean(interfaceNodes?.inspectTitle),
        controls: 3,
        drawnEntities: lastDrawnEntities,
        drawnWeather: lastDrawnWeather,
      };
    }
    return { ok: true, kind };
  }

  function getState() {
    return {
      mode: 'procedural-living-planet',
      planetName,
      model: 'procedural',
      seed,
      masterSteps,
      unifiedSeconds,
      duplicateClockViolations,
      mobile,
      camera: getCamera(),
      statistics: getPlanetStats(),
    };
  }

  function getSnapshot() {
    return {
      version: 4,
      mode: 'procedural-living-planet',
      planet: { name: planetName, fictional: true, model: 'procedural', seed, earthData: false },
      clock: { source: 'root-module-host-fixed-step', masterSteps, unifiedSeconds, duplicateClockViolations },
      presentation: {
        renderer: 'pixi-single-canvas',
        geometry: 'sphere',
        projection: 'orthographic',
        spherical: true,
        logicalWidth: logicalSize.width,
        logicalHeight: logicalSize.height,
        drawnEntities: lastDrawnEntities,
        drawnWeather: lastDrawnWeather,
        tickerStarted: Boolean(app?.ticker?.started),
        camera: getCamera(),
        interactions: { wheelZoom: true, pinchZoom: true, dragRotate: true, regionInspection: true },
      },
      coupling: {
        terrainSource: 'core/planet.js',
        climateSource: 'core/living-systems.js',
        waterSource: 'core/water-cycle.js',
        ecologySource: 'core/world.js',
        evolutionSource: 'core/biosphere.js',
      },
      interface: { controls: 3, inspector: true, statisticDefinitions: true },
      statistics: getPlanetStats(),
      selectedRegion: inspectSelected(),
    };
  }

  function runInvariants() {
    const failures = [];
    const visibleCanvases = [...document.querySelectorAll('canvas')].filter(element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    });
    if (document.body.dataset.rootExperience !== 'procedural-living-planet') failures.push('The public root is not labeled as a procedural living planet.');
    if (visibleCanvases.length !== 1 || visibleCanvases[0] !== canvas) failures.push('The root must use exactly one visible simulation canvas.');
    if (document.getElementById('lofiLivingCanvasBacking')) failures.push('A replacement or backing canvas is still installed.');
    if (!shell || !interfaceNodes?.inspectTitle) failures.push('The integrated inspector is missing.');
    if (shell?.querySelectorAll('.planet-stat[title]').length !== 8) failures.push('Statistic definitions are missing.');
    if (app?.ticker?.started) failures.push('PixiJS started a private ticker.');
    if (duplicateClockViolations > 0) failures.push('The presentation observed a reversed root clock.');
    if (window.realitySandboxHifi || window.realitySandboxLilacClouds || window.realitySandboxRainRunoff) failures.push('A retired renderer sidecar is active.');
    return { ok: failures.length === 0, failures };
  }

  function save() {
    return { version: 4, masterSteps, unifiedSeconds, camera: getCamera(), selectedPoint };
  }

  function load(state = {}) {
    if (Number.isFinite(state.masterSteps)) masterSteps = Math.max(0, state.masterSteps);
    if (Number.isFinite(state.unifiedSeconds)) unifiedSeconds = Math.max(0, state.unifiedSeconds);
    if (state.camera) setCamera(state.camera);
    if (Number.isFinite(state.selectedPoint?.x) && Number.isFinite(state.selectedPoint?.y)) selectedPoint = { ...state.selectedPoint };
  }

  function destroy() {
    destroyed = true;
    removeInteraction();
    api._removeEventFeed?.();
    pointers.clear();
    app?.destroy?.(true, { children: true });
    app = null;
    graphics = null;
    canvas?.remove();
    shell?.remove();
    canvas = null;
    shell = null;
    delete document.body.dataset.rootExperience;
    delete document.body.dataset.worldGeometry;
  }

  const api = {
    id: 'runtime.procedural-living-planet',
    name: 'Procedural Living Planet Runtime',
    version: '2.0.0',
    execution: 'browser-single-master-clock',
    source: 'One PixiJS renderer reading the same terrain, water, climate, ecology, and evolution state used by the simulation',
    license: 'Project license plus dependency licenses in THIRD_PARTY_NOTICES.md',
    provides: ['runtime.living-planet', 'presentation.pixi-root'],
    requires: [],
    initialize,
    step,
    render,
    save,
    load,
    destroy,
    setCamera,
    resetCamera,
    getCamera,
    selectAtClientPoint,
    inspectSelected,
    updateInterface,
    debugScenario,
    runInvariants,
    getState,
    getSnapshot,
    _removeEventFeed: null,
  };

  return api;
}

function statMarkup(key, label, definition) {
  return `<div class="planet-stat" tabindex="0" title="${escapeHtml(definition)}" aria-label="${escapeHtml(`${label}. ${definition}`)}"><dt>${escapeHtml(label)}</dt><dd data-stat="${key}">—</dd></div>`;
}

function readingMarkup(key, label) {
  return `<div class="planet-reading"><span>${escapeHtml(label)}</span><b data-reading="${key}">—</b></div>`;
}

function chooseLogicalSize(mobile) {
  const aspect = clamp(innerWidth / Math.max(1, innerHeight), 0.45, 2.4);
  if (aspect < 1) {
    const height = mobile ? 384 : 480;
    return { width: Math.max(176, Math.round(height * aspect)), height };
  }
  const width = mobile ? 384 : 480;
  return { width, height: Math.max(200, Math.round(width / aspect)) };
}

function coupledSurfaceColor(terrain, water) {
  let [red, green, blue] = biomeColor(terrain);
  if (!terrain.land) {
    const depth = clamp((0.53 - terrain.elevation) * 3.2, 0, 1);
    return rgbToHex(mixRgb([28, 118, 150], [8, 35, 78], depth));
  }
  const river = clamp((water.river || 0) * 1.2 + (water.surface || 0) * 0.25, 0, 1);
  const flood = clamp(water.flood || 0, 0, 1);
  const drought = clamp(water.drought || 0, 0, 1);
  if ((water.lake || 0) > 0.15) [red, green, blue] = mixRgb([red, green, blue], [34, 112, 164], clamp(water.lake, 0, 0.9));
  else if (river > 0.12) [red, green, blue] = mixRgb([red, green, blue], [43, 133, 178], 0.36 + river * 0.5);
  if (flood > 0.2) [red, green, blue] = mixRgb([red, green, blue], [62, 128, 149], flood * 0.52);
  if (drought > 0.25) [red, green, blue] = mixRgb([red, green, blue], [165, 126, 72], drought * 0.48);
  if ((water.snow || 0) > 0.001 || (water.snowpack || 0) > 0.28) [red, green, blue] = mixRgb([red, green, blue], [226, 239, 241], 0.68);
  return rgbToHex([red, green, blue]);
}

function sampleGrid(count, width, height, sample) {
  const values = [];
  for (let index = 0; index < count; index++) {
    const x = ((index * 37) % count + 0.5) / count;
    const y = ((index * 19) % count + 0.5) / count;
    values.push(sample({ x: x * width, y: y * height }));
  }
  return values;
}

function normalizedSpread(values) {
  if (!values.length) return 0;
  return clamp((Math.max(...values) - Math.min(...values)) / 1.8, 0, 1);
}

function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function pointDistance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function pointMidpoint(a, b) { return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 }; }
function wrap01(value) { return value - Math.floor(value); }
function wrappedDelta(value) { return value - Math.floor(value + 0.5); }
function quantize(value, size) { return Math.round(value / size) * size; }
function mixRgb(a, b, t) { const amount = clamp(t, 0, 1); return a.map((value, index) => Math.round(value + (b[index] - value) * amount)); }
function rgbToHex(rgb) { return (clamp(Math.round(rgb[0]), 0, 255) << 16) | (clamp(Math.round(rgb[1]), 0, 255) << 8) | clamp(Math.round(rgb[2]), 0, 255); }
function shadeColor(color, brightness) {
  const amount = clamp(brightness, 0, 1.2);
  const red = clamp(Math.round(((color >> 16) & 0xff) * amount), 0, 255);
  const green = clamp(Math.round(((color >> 8) & 0xff) * amount), 0, 255);
  const blue = clamp(Math.round((color & 0xff) * amount), 0, 255);
  return (red << 16) | (green << 8) | blue;
}
function formatCoordinate(value, positive, negative) { return `${Math.abs(value).toFixed(1)}°${value >= 0 ? positive : negative}`; }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]); }
function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }
