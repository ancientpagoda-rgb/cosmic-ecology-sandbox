const MOBILE_BUFFER = { width: 384, height: 216 };
const DESKTOP_BUFFER = { width: 1280, height: 720 };
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const GRID_WIDTH = 360;
const GRID_HEIGHT = 180;
const GRID_SIZE = GRID_WIDTH * GRID_HEIGHT;
let bootAttempts = 0;
let earthGrid = null;

function boot() {
  if (window.realitySandboxHifi?.ready) return;
  const unified = window.realitySandboxUnified;
  const backing = document.getElementById('lofiLivingCanvas');
  if (!unified || !backing) {
    if (bootAttempts++ < 240) setTimeout(boot, 50);
    return;
  }

  earthGrid ||= buildEarthGrid();
  const mobile = matchMedia('(max-width: 720px), (pointer: coarse)').matches;
  const buffer = mobile ? MOBILE_BUFFER : DESKTOP_BUFFER;
  const canvas = document.createElement('canvas');
  canvas.id = 'lofiLivingCanvas';
  canvas.className = 'hifi-living-canvas';
  canvas.width = buffer.width;
  canvas.height = buffer.height;
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-label', 'Scientific Earth model with simulated precipitation radar. Pinch or scroll to zoom and drag to rotate.');

  backing.id = 'lofiLivingCanvasBacking';
  backing.tabIndex = -1;
  backing.setAttribute('aria-hidden', 'true');
  backing.after(canvas);

  const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const surfaceCanvas = document.createElement('canvas');
  surfaceCanvas.width = buffer.width;
  surfaceCanvas.height = buffer.height;
  const surfaceContext = surfaceCanvas.getContext('2d', { alpha: true });
  const stars = createStars(buffer.width, buffer.height, mobile ? 100 : 320);
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  let lastSignature = '';
  let lastLightMinute = -1;
  let lastRenderMs = 0;
  let rendering = false;
  let queued = false;

  document.body.dataset.presentationFidelity = 'high';
  document.body.dataset.scientificPlanet = 'earth';
  installInteractions();

  const originalRender = unified.render.bind(unified);
  unified.render = frame => {
    originalRender(frame);
    renderIfNeeded(frame?.timestamp ?? performance.now());
  };

  const originalSnapshot = unified.getSnapshot.bind(unified);
  unified.getSnapshot = () => {
    const snapshot = originalSnapshot();
    snapshot.presentation = {
      ...snapshot.presentation,
      fidelity: 'high',
      displayMode: 'hifi-procedural-sphere',
      outputWidth: buffer.width,
      outputHeight: buffer.height,
      backingRenderer: 'pixi-webgl',
      visibleRenderer: 'canvas2d-cached-scientific-earth',
      scientificPlanet: 'earth',
      coordinateSystem: 'latitude-longitude',
      solarLighting: 'UTC-derived approximate subsolar point',
      earthReferenceModel: 'recognizable geospatial approximation',
      earthGridResolution: `${GRID_WIDTH}x${GRID_HEIGHT}`,
    };
    return snapshot;
  };

  window.realitySandboxHifi = {
    ready: true,
    canvas,
    buffer: { ...buffer },
    render: () => renderIfNeeded(performance.now(), true),
    projectGeo,
    getViewGeometry,
    surfaceSample: (latitudeDegrees, longitudeDegrees) => sampleEarth(latitudeDegrees * DEG, longitudeDegrees * DEG),
    getState: () => ({
      ready: true,
      mobile,
      width: buffer.width,
      height: buffer.height,
      lastRenderMs,
      scientificPlanet: 'earth',
      earthGridResolution: `${GRID_WIDTH}x${GRID_HEIGHT}`,
      camera: unified.getCamera(),
      solarSubpoint: solarSubpoint(new Date()),
    }),
  };

  renderIfNeeded(performance.now(), true);

  function getViewGeometry() {
    const camera = unified.getCamera();
    const width = buffer.width;
    const height = buffer.height;
    const baseRadius = Math.min(width, height) * (mobile ? 0.43 : 0.44);
    return {
      width,
      height,
      cx: width * 0.5,
      cy: height * 0.5,
      baseRadius,
      radius: baseRadius * camera.zoom,
      lon0: (camera.centerX - 0.5) * Math.PI * 2,
      lat0: (0.5 - camera.centerY) * Math.PI,
      camera,
    };
  }

  function projectGeo(latitudeDegrees, longitudeDegrees) {
    const geometry = getViewGeometry();
    const latitude = latitudeDegrees * DEG;
    const longitude = longitudeDegrees * DEG;
    const deltaLongitude = wrapLongitude(longitude - geometry.lon0);
    const sinLat = Math.sin(latitude);
    const cosLat = Math.cos(latitude);
    const sinLat0 = Math.sin(geometry.lat0);
    const cosLat0 = Math.cos(geometry.lat0);
    const sx = cosLat * Math.sin(deltaLongitude);
    const sy = sinLat * cosLat0 - cosLat * Math.cos(deltaLongitude) * sinLat0;
    const depth = sinLat * sinLat0 + cosLat * Math.cos(deltaLongitude) * cosLat0;
    return {
      x: geometry.cx + sx * geometry.radius,
      y: geometry.cy - sy * geometry.radius,
      visible: depth > 0,
      depth,
      radius: geometry.radius,
      cx: geometry.cx,
      cy: geometry.cy,
    };
  }

  function renderIfNeeded(timestamp, force = false) {
    const camera = unified.getCamera();
    const lightMinute = Math.floor(Date.now() / 60000);
    const signature = [camera.zoom.toFixed(4), camera.centerX.toFixed(5), camera.centerY.toFixed(5)].join(':');
    if (!force && signature === lastSignature && lightMinute === lastLightMinute) return;
    if (rendering) {
      queued = true;
      return;
    }
    rendering = true;
    const started = performance.now();
    drawEarth(new Date());
    lastRenderMs = performance.now() - started;
    lastSignature = signature;
    lastLightMinute = lightMinute;
    rendering = false;
    if (queued) {
      queued = false;
      requestAnimationFrame(() => renderIfNeeded(performance.now(), true));
    }
  }

  function drawEarth(now) {
    const { width, height, cx, cy, baseRadius, radius, lon0, lat0 } = getViewGeometry();
    const sinLat0 = Math.sin(lat0);
    const cosLat0 = Math.cos(lat0);
    const sun = solarSubpoint(now);
    drawSpace(context, width, height, stars);
    drawAtmosphericGlow(context, cx, cy, radius, baseRadius);

    const image = surfaceContext.createImageData(width, height);
    const data = image.data;
    const left = Math.max(0, Math.floor(cx - radius - 2));
    const right = Math.min(width - 1, Math.ceil(cx + radius + 2));
    const top = Math.max(0, Math.floor(cy - radius - 2));
    const bottom = Math.min(height - 1, Math.ceil(cy + radius + 2));

    for (let py = top; py <= bottom; py++) {
      const sy = -(py + 0.5 - cy) / radius;
      for (let px = left; px <= right; px++) {
        const sx = (px + 0.5 - cx) / radius;
        const rho2 = sx * sx + sy * sy;
        if (rho2 > 1) continue;
        const viewZ = Math.sqrt(Math.max(0, 1 - rho2));
        const latitude = Math.asin(clamp(sy * cosLat0 + viewZ * sinLat0, -1, 1));
        const longitude = wrapLongitude(lon0 + Math.atan2(sx, viewZ * cosLat0 - sy * sinLat0));
        const surface = sampleEarth(latitude, longitude);
        const lightAmount = solarIllumination(latitude, longitude, sun.latitude, sun.longitude);
        let red = surface.red;
        let green = surface.green;
        let blue = surface.blue;
        const daylight = 0.1 + smoothstep(-0.15, 0.32, lightAmount) * 0.9;
        const twilight = smoothstep(-0.18, 0.03, lightAmount) * (1 - smoothstep(0.03, 0.22, lightAmount));
        red = red * daylight + 32 * twilight;
        green = green * daylight + 10 * twilight;
        blue = blue * daylight + 4 * twilight;

        if (!surface.land) {
          const glint = Math.pow(Math.max(0, lightAmount), 26) * Math.pow(viewZ, 5);
          red += 112 * glint;
          green += 137 * glint;
          blue += 155 * glint;
        } else if (lightAmount < -0.08 && surface.populationPotential > 0.52) {
          const city = cityPattern(latitude, longitude, surface.populationPotential);
          if (city > 0.89) {
            const glow = clamp((-lightAmount - 0.08) * 3.8, 0, 1) * (city - 0.88) * 6;
            red += 190 * glow;
            green += 135 * glow;
            blue += 62 * glow;
          }
        }

        const atmosphere = Math.pow(1 - viewZ, 2.35);
        red += 32 * atmosphere;
        green += 88 * atmosphere;
        blue += 145 * atmosphere;
        const index = (py * width + px) * 4;
        data[index] = clampByte(red);
        data[index + 1] = clampByte(green);
        data[index + 2] = clampByte(blue);
        data[index + 3] = clampByte(228 + viewZ * 27);
      }
    }

    surfaceContext.clearRect(0, 0, width, height);
    surfaceContext.putImageData(image, 0, 0);
    context.drawImage(surfaceCanvas, 0, 0);
    drawAtmosphericRim(context, cx, cy, radius, baseRadius);
  }

  function installInteractions() {
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      canvas.focus({ preventScroll: true });
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      const camera = unified.getCamera();
      unified.setCamera({ ...camera, zoom: clamp(camera.zoom * Math.exp(-delta * 0.0015), MIN_ZOOM, MAX_ZOOM) });
      renderIfNeeded(performance.now(), true);
    }, { passive: false });

    canvas.addEventListener('pointerdown', event => {
      event.preventDefault();
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture?.(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size >= 2) beginPinch();
      else drag = { id: event.pointerId, x: event.clientX, y: event.clientY, camera: unified.getCamera() };
      canvas.dataset.dragging = 'true';
    });

    canvas.addEventListener('pointermove', event => {
      if (!pointers.has(event.pointerId)) return;
      event.preventDefault();
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size >= 2) {
        if (!pinch) beginPinch();
        const pair = [...pointers.values()].slice(0, 2);
        const distance = Math.max(1, Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y));
        unified.setCamera({ ...pinch.camera, zoom: clamp(pinch.camera.zoom * distance / pinch.distance, MIN_ZOOM, MAX_ZOOM) });
        renderIfNeeded(performance.now(), true);
        return;
      }
      if (!drag || drag.id !== event.pointerId) return;
      const rect = canvas.getBoundingClientRect();
      const dx = (event.clientX - drag.x) / Math.max(1, rect.width);
      const dy = (event.clientY - drag.y) / Math.max(1, rect.height);
      unified.setCamera({
        zoom: drag.camera.zoom,
        centerX: wrap01(drag.camera.centerX - dx / Math.max(1, drag.camera.zoom)),
        centerY: clamp(drag.camera.centerY + dy / Math.max(1, drag.camera.zoom), 0.01, 0.99),
      });
      renderIfNeeded(performance.now(), true);
    });

    const endPointer = event => {
      pointers.delete(event.pointerId);
      try { canvas.releasePointerCapture?.(event.pointerId); } catch {}
      pinch = null;
      drag = null;
      if (pointers.size === 1) {
        const [id, point] = [...pointers.entries()][0];
        drag = { id, x: point.x, y: point.y, camera: unified.getCamera() };
      }
      canvas.dataset.dragging = pointers.size ? 'true' : 'false';
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('dblclick', event => {
      event.preventDefault();
      unified.resetCamera();
      renderIfNeeded(performance.now(), true);
    });
    canvas.addEventListener('keydown', event => {
      const camera = unified.getCamera();
      if (event.key === '0' || event.key === 'Home') unified.resetCamera();
      else if (event.key === '+' || event.key === '=' || event.key === 'PageUp') unified.setCamera({ ...camera, zoom: clamp(camera.zoom * 1.35, MIN_ZOOM, MAX_ZOOM) });
      else if (event.key === '-' || event.key === '_' || event.key === 'PageDown') unified.setCamera({ ...camera, zoom: clamp(camera.zoom / 1.35, MIN_ZOOM, MAX_ZOOM) });
      else return;
      event.preventDefault();
      renderIfNeeded(performance.now(), true);
    });
  }

  function beginPinch() {
    const pair = [...pointers.values()].slice(0, 2);
    if (pair.length < 2) return;
    pinch = { distance: Math.max(1, Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y)), camera: unified.getCamera() };
    drag = null;
  }
}

function buildEarthGrid() {
  const red = new Uint8Array(GRID_SIZE);
  const green = new Uint8Array(GRID_SIZE);
  const blue = new Uint8Array(GRID_SIZE);
  const land = new Uint8Array(GRID_SIZE);
  const population = new Uint8Array(GRID_SIZE);
  for (let y = 0; y < GRID_HEIGHT; y++) {
    const latitude = 89.5 - y;
    for (let x = 0; x < GRID_WIDTH; x++) {
      const longitude = x - 179.5;
      const surface = calculateSurface(latitude, longitude);
      const color = surface.land ? landColor(surface) : oceanColor(surface, latitude * DEG);
      const index = y * GRID_WIDTH + x;
      red[index] = clampByte(color[0]);
      green[index] = clampByte(color[1]);
      blue[index] = clampByte(color[2]);
      land[index] = surface.land ? 1 : 0;
      population[index] = clampByte(surface.populationPotential * 255);
    }
  }
  return { red, green, blue, land, population };
}

function sampleEarth(latitude, longitude) {
  const latDegrees = clamp(latitude * RAD, -89.999, 89.999);
  const lonDegrees = wrapDegrees(longitude * RAD);
  const x = mod(Math.floor(lonDegrees + 180), GRID_WIDTH);
  const y = clamp(Math.floor(90 - latDegrees), 0, GRID_HEIGHT - 1);
  const index = y * GRID_WIDTH + x;
  return {
    red: earthGrid.red[index],
    green: earthGrid.green[index],
    blue: earthGrid.blue[index],
    land: earthGrid.land[index] === 1,
    populationPotential: earthGrid.population[index] / 255,
  };
}

function calculateSurface(lat, lon) {
  const continent = continentMask(lat, lon);
  const mountains = mountainMask(lat, lon);
  const oceanBasin = oceanDepth(lat, lon);
  const elevation = continent * 0.9 + mountains * 0.55 + 0.08 * climateNoise(lat * 2.4, lon * 2.4) - oceanBasin * 0.52 - 0.1;
  const land = elevation > 0.02;
  const temperature = clamp(1 - Math.pow(Math.abs(Math.sin(lat * DEG)), 1.18) * 0.98 - Math.max(0, elevation) * 0.34, 0, 1);
  const desertIndex = desertZones(lat, lon);
  const moisture = clamp(0.55 + climateNoise(lat, lon) * 0.26 - desertIndex * 0.48 + continent * 0.07, 0, 1);
  const snow = land && (temperature < 0.18 || lat > 71 || lat < -68);
  const tundra = land && !snow && temperature < 0.28;
  const desert = land && !snow && desertIndex > 0.36 && temperature > 0.42;
  const populationPotential = clamp((1 - Math.abs(lat) / 90) * 0.7 + moisture * 0.38 - mountains * 0.32 - desertIndex * 0.16, 0, 1);
  return { land, elevation, temperature, moisture, desert, snow, tundra, populationPotential };
}

function continentMask(lat, lon) {
  const pieces = [
    blob(lat, lon, 52, -108, 27, 42, 1), blob(lat, lon, 40, -78, 18, 24, 0.82),
    blob(lat, lon, 18, -99, 11, 16, 0.58), blob(lat, lon, -14, -60, 25, 20, 1.02),
    blob(lat, lon, 71, -42, 13, 19, 0.78), blob(lat, lon, 6, 20, 25, 27, 1.02),
    blob(lat, lon, 51, 14, 17, 22, 0.86), blob(lat, lon, 55, 72, 19, 56, 1.05),
    blob(lat, lon, 25, 46, 11, 17, 0.48), blob(lat, lon, 22, 79, 13, 12, 0.54),
    blob(lat, lon, 34, 106, 18, 25, 0.78), blob(lat, lon, 61, 112, 15, 33, 0.68),
    blob(lat, lon, -25, 134, 18, 24, 0.9), blob(lat, lon, -42, 172, 8, 7, 0.3),
    blob(lat, lon, -80, 0, 8, 180, 1.15),
  ];
  const cutouts = blob(lat, lon, 25, -84, 8, 7, 0.5) + blob(lat, lon, 34, 33, 7, 9, 0.35) + blob(lat, lon, 18, 115, 11, 15, 0.32) + blob(lat, lon, -5, 75, 14, 20, 0.18);
  return clamp(pieces.reduce((sum, value) => sum + value, 0) - cutouts, 0, 1.35);
}

function mountainMask(lat, lon) {
  return clamp(
    ridge(lat, lon, -18, -70, 44, 5, 0.9) + ridge(lat, lon, 45, -112, 28, 7, 0.48) +
    ridge(lat, lon, 45, 10, 12, 4, 0.3) + ridge(lat, lon, 31, 82, 30, 6, 0.96) +
    ridge(lat, lon, 9, 39, 20, 5, 0.34) + ridge(lat, lon, 37, 138, 10, 3, 0.22) +
    ridge(lat, lon, -6, 146, 12, 4, 0.25), 0, 1.2);
}

function oceanDepth(lat, lon) {
  return clamp(0.42 + blob(lat, lon, 0, -145, 38, 72, 0.34) + blob(lat, lon, 0, -25, 31, 45, 0.22) + blob(lat, lon, -20, 80, 27, 34, 0.18), 0, 1);
}

function desertZones(lat, lon) {
  return clamp(blob(lat, lon, 22, 15, 11, 32, 1) + blob(lat, lon, 24, 46, 8, 18, 0.78) + blob(lat, lon, -24, 134, 12, 18, 0.72) + blob(lat, lon, 42, 104, 8, 18, 0.48) + blob(lat, lon, -23, -69, 7, 6, 0.56) + blob(lat, lon, 33, -112, 8, 12, 0.44), 0, 1);
}

function climateNoise(lat, lon) {
  return Math.sin((lon + lat * 0.5) * Math.PI / 45) * 0.4 + Math.cos((lon * 0.7 - lat * 1.4) * Math.PI / 33) * 0.35 + Math.sin((lon * 1.8 + lat * 0.3) * Math.PI / 22) * 0.25;
}

function landColor(surface) {
  if (surface.snow) return mixColor([214, 225, 232], [247, 251, 252], 0.58 + surface.elevation * 0.18);
  if (surface.elevation > 0.78) return mixColor([110, 103, 94], [209, 208, 204], smoothstep(0.78, 1.15, surface.elevation));
  if (surface.tundra) return mixColor([116, 130, 103], [165, 178, 146], 0.5);
  if (surface.desert) return mixColor([167, 126, 69], [226, 193, 124], clamp(surface.temperature * 0.68 + (1 - surface.moisture) * 0.32, 0, 1));
  if (surface.moisture > 0.72 && surface.temperature > 0.42) return mixColor([21, 83, 47], [55, 129, 68], 0.58 + surface.moisture * 0.22);
  if (surface.moisture > 0.46) return mixColor([48, 103, 57], [106, 146, 79], 0.42 + surface.temperature * 0.2);
  return mixColor([96, 116, 69], [151, 148, 89], 1 - surface.moisture);
}

function oceanColor(surface, latitude) {
  const depth = clamp((-surface.elevation + 0.03) / 0.72, 0, 1);
  const polar = smoothstep(56 * DEG, 82 * DEG, Math.abs(latitude));
  return mixColor(mixColor([6, 27, 68], [25, 108, 153], 1 - depth * 0.72), [92, 138, 166], polar * 0.22);
}

function cityPattern(latitude, longitude, suitability) {
  const a = Math.sin((longitude * 7.2 + latitude * 1.7) * 9.1);
  const b = Math.cos((longitude * 4.7 - latitude * 5.3) * 7.3);
  return clamp(((a + b + 2) * 0.25) * suitability, 0, 1);
}

function solarSubpoint(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = (date.getTime() - start) / 86400000;
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const latitude = 23.44 * Math.sin((2 * Math.PI * (284 + day)) / 365.2422) * DEG;
  const longitude = wrapLongitude((180 - hours * 15) * DEG);
  return { latitude, longitude, latitudeDegrees: latitude * RAD, longitudeDegrees: longitude * RAD };
}

function solarIllumination(latitude, longitude, sunLatitude, sunLongitude) {
  return Math.sin(latitude) * Math.sin(sunLatitude) + Math.cos(latitude) * Math.cos(sunLatitude) * Math.cos(wrapLongitude(longitude - sunLongitude));
}

function ridge(lat, lon, centerLat, centerLon, length, width, weight) {
  const dLon = wrappedDelta(lon, centerLon);
  const dLat = lat - centerLat;
  return Math.exp(-(dLat * dLat) / (2 * length * length)) * Math.exp(-(dLon * dLon) / (2 * width * width)) * weight;
}

function blob(lat, lon, centerLat, centerLon, radiusLat, radiusLon, weight) {
  const dLat = (lat - centerLat) / radiusLat;
  const dLon = wrappedDelta(lon, centerLon) / radiusLon;
  return Math.exp(-(dLat * dLat + dLon * dLon) * 1.45) * weight;
}

function wrappedDelta(a, b) {
  let delta = a - b;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

function drawAtmosphericGlow(context, cx, cy, radius, baseRadius) {
  context.save();
  context.shadowColor = 'rgba(65, 137, 188, 0.52)';
  context.shadowBlur = Math.max(18, baseRadius * 0.13);
  context.beginPath();
  context.arc(cx, cy, Math.min(radius, baseRadius * 1.04), 0, Math.PI * 2);
  context.strokeStyle = 'rgba(103, 181, 225, 0.38)';
  context.lineWidth = Math.max(3, baseRadius * 0.018);
  context.stroke();
  context.restore();
}

function drawAtmosphericRim(context, cx, cy, radius, baseRadius) {
  context.save();
  const edgeWidth = Math.max(1.5, baseRadius * 0.012);
  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  context.strokeStyle = 'rgba(142, 210, 244, 0.74)';
  context.lineWidth = edgeWidth;
  context.stroke();
  context.beginPath();
  context.arc(cx - radius * 0.13, cy - radius * 0.18, radius * 0.72, Math.PI * 1.03, Math.PI * 1.62);
  context.strokeStyle = 'rgba(255,255,255,0.14)';
  context.lineWidth = Math.max(1, edgeWidth * 0.66);
  context.stroke();
  context.restore();
}

function drawSpace(context, width, height, stars) {
  const gradient = context.createRadialGradient(width * 0.52, height * 0.48, 0, width * 0.5, height * 0.5, Math.max(width, height) * 0.75);
  gradient.addColorStop(0, '#081420');
  gradient.addColorStop(0.58, '#030913');
  gradient.addColorStop(1, '#010307');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  for (const star of stars) {
    context.globalAlpha = star.alpha;
    context.fillStyle = star.warm ? '#f5dfc4' : '#d6ebff';
    context.fillRect(star.x, star.y, star.size, star.size);
  }
  context.globalAlpha = 1;
}

function createStars(width, height, count) {
  return Array.from({ length: count }, (_, index) => ({
    x: Math.floor(hash(index, 11) * width),
    y: Math.floor(hash(index, 29) * height),
    size: hash(index, 53) > 0.94 ? 2 : 1,
    alpha: 0.22 + hash(index, 71) * 0.62,
    warm: hash(index, 101) > 0.78,
  }));
}

function hash(a, b) {
  let value = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ 0x9e3779b9;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function mixColor(a, b, t) {
  const amount = clamp(t, 0, 1);
  return [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount];
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / Math.max(0.000001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function wrapLongitude(value) {
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

function wrapDegrees(value) {
  let wrapped = value;
  while (wrapped > 180) wrapped -= 360;
  while (wrapped < -180) wrapped += 360;
  return wrapped;
}

function wrap01(value) { return value - Math.floor(value); }
function mod(value, divisor) { return ((value % divisor) + divisor) % divisor; }
function clampByte(value) { return Math.max(0, Math.min(255, Math.round(value))); }
function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
