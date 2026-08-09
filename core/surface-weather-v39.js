import * as THREE from 'three';

const GRID_SIZE = 15;
const FIELD_EXTENT = 560;
const FIELD_DIAMETER = FIELD_EXTENT * 2;
const SAMPLES_PER_SLICE = 24;
const CLOUD_COUNT_DESKTOP = 240;
const CLOUD_COUNT_MOBILE = 130;
const PRECIP_COUNT_DESKTOP = 120;
const PRECIP_COUNT_MOBILE = 64;
const CLOUD_BASE = 24;
const CLOUD_TOP = 68;
const WIND_VISUAL_SCALE = 3.8;
const PRECIP_FALL_SPEED = 48;
const Z_SCALE = 62;
const TAU = Math.PI * 2;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (v, max) => ((v % max) + max) % max;

function shortestWrappedDelta(value, origin, size) {
  let delta = value - origin;
  if (delta > size * 0.5) delta -= size;
  else if (delta < -size * 0.5) delta += size;
  return delta;
}

function hash01(value) {
  let h = Math.imul((value | 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function scheduleIdle(fn, timeout = 180) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout });
  else setTimeout(() => fn({ timeRemaining: () => 4, didTimeout: true }), 0);
}

async function waitForRuntime() {
  for (let i = 0; i < 360; i++) {
    const planet = window.realitySandboxPlanet;
    const mode = window.realitySandboxSurfaceMode;
    const surface = window.realitySandboxSurfaceSphereV37;
    const objects = window.realitySandboxSurfaceLightHookV36?.getObjects?.();
    if (
      planet?.world &&
      planet?.living?.sampleDynamicPlanet &&
      planet?.waterCycle?.sample &&
      mode?.getPlayer &&
      mode?.isActive &&
      surface?.getStats &&
      objects?.scene &&
      objects?.camera
    ) return { planet, mode, surface, scene: objects.scene, camera: objects.camera };
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  return null;
}

function install({ planet, mode, surface, scene, camera }) {
  if (window.realitySandboxSurfaceWeatherV39?.installed) return;

  const { world, living, waterCycle } = planet;
  const mobile = matchMedia('(max-width: 720px), (pointer: coarse)').matches;
  const cloudCount = mobile ? CLOUD_COUNT_MOBILE : CLOUD_COUNT_DESKTOP;
  const precipCount = mobile ? PRECIP_COUNT_MOBILE : PRECIP_COUNT_DESKTOP;
  const seed = window.realitySandboxSeed?.numericSeed || 734221;
  const curvatureRadius = surface.getStats().curvatureRadius;

  let field = null;
  let activeAnchor = null;
  let requestedKey = '';
  let generation = 0;
  let lastSurfaceActive = false;
  let lastNow = performance.now();
  let cloudGeometry = null;
  let cloudMesh = null;
  let precipGeometry = null;
  let precipMesh = null;

  const stats = {
    buildsStarted: 0,
    buildsCompleted: 0,
    buildsCancelled: 0,
    waterSamples: 0,
    terrainSamples: 0,
    interpolationCalls: 0,
    particleFrames: 0,
    renderLoopProceduralSamples: 0,
    anchorHandoffs: 0,
    averageCloud: 0,
    maxCloud: 0,
    averageRain: 0,
    maxRain: 0,
    averageSnow: 0,
    meanWind: 0,
    visibleCloudParticles: 0,
    visiblePrecipitation: 0,
  };

  function surfaceActive() {
    return Boolean(mode.isActive?.() && document.documentElement.dataset.surfaceMode === 'active');
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

  function sphereSag(x, z) {
    const d2 = x * x + z * z;
    const r2 = curvatureRadius * curvatureRadius;
    return curvatureRadius - Math.sqrt(Math.max(1, r2 - Math.min(d2, r2 - 1)));
  }

  function anchorFromSurface() {
    const s = surface.getStats();
    const parts = String(s.activeChunkKey || '').split(':').map(Number);
    if (parts.length !== 2 || !parts.every(Number.isFinite)) return null;
    return {
      key: s.activeChunkKey,
      stride: s.chunkStride,
      x: wrap((parts[0] + 0.5) * s.chunkStride, world.width),
      y: clamp((parts[1] + 0.5) * s.chunkStride, 0, world.height),
    };
  }

  function buildField(anchor) {
    const buildGeneration = ++generation;
    requestedKey = anchor.key;
    stats.buildsStarted++;

    const count = GRID_SIZE * GRID_SIZE;
    const u = new Float32Array(count);
    const v = new Float32Array(count);
    const cloud = new Float32Array(count);
    const rain = new Float32Array(count);
    const snow = new Float32Array(count);
    const height = new Float32Array(count);
    let index = 0;
    let cloudSum = 0;
    let rainSum = 0;
    let snowSum = 0;
    let windSum = 0;
    let maxCloud = 0;
    let maxRain = 0;

    function process(deadline) {
      if (buildGeneration !== generation || !surfaceActive()) {
        stats.buildsCancelled++;
        return;
      }

      let worked = 0;
      while (index < count) {
        const gx = index % GRID_SIZE;
        const gz = Math.floor(index / GRID_SIZE);
        const fx = gx / (GRID_SIZE - 1);
        const fz = gz / (GRID_SIZE - 1);
        const localX = -FIELD_EXTENT + fx * FIELD_DIAMETER;
        const localZ = -FIELD_EXTENT + fz * FIELD_DIAMETER;
        const normalized = normalizeSphereSample(anchor.x + localX, anchor.y + localZ);

        // Extra argument intentionally bypasses the Surface HUD cache wrappers.
        // These are build-time samples only; the render loop never calls them.
        const water = waterCycle.sample(normalized.x, normalized.y, 'surface-weather-v39');
        const terrain = living.sampleDynamicPlanet(normalized.x, normalized.y, 'surface-weather-v39');
        stats.waterSamples++;
        stats.terrainSamples++;

        const lat01 = Math.abs(normalized.y / world.height - 0.5) * 2;
        const latitudeRad = (0.5 - normalized.y / world.height) * Math.PI;
        const seasonOffset = Number(water?.season?.temperatureOffset) || 0;
        const seasonalWind = Math.max(0.35, 1 + seasonOffset * 1.8);
        const zonal = (1.2 + Math.cos(lat01 * Math.PI) * 2.8) * seasonalWind;
        const meridional = Math.sin((normalized.y / world.height) * Math.PI * 3) * 0.18;
        const sphericalEastCorrection = 1 / Math.max(0.28, Math.abs(Math.cos(latitudeRad)));

        u[index] = zonal * sphericalEastCorrection * WIND_VISUAL_SCALE;
        v[index] = meridional * 11.5;
        cloud[index] = clamp((Number(water?.cloud) || 0) / 1.25, 0, 1);
        rain[index] = clamp((Number(water?.rain) || 0) * 80, 0, 1);
        snow[index] = clamp((Number(water?.snow) || 0) * 80, 0, 1);
        height[index] = clamp(Number(terrain?.elevation) || 0.53, 0, 1) * Z_SCALE - sphereSag(localX, localZ);

        const wind = Math.hypot(u[index], v[index]);
        cloudSum += cloud[index];
        rainSum += rain[index];
        snowSum += snow[index];
        windSum += wind;
        maxCloud = Math.max(maxCloud, cloud[index]);
        maxRain = Math.max(maxRain, rain[index]);
        index++;
        worked++;

        if (worked >= SAMPLES_PER_SLICE) break;
        if (deadline?.timeRemaining && deadline.timeRemaining() < 1.1) break;
      }

      if (index < count) {
        scheduleIdle(process, 220);
        return;
      }
      if (buildGeneration !== generation || !surfaceActive()) {
        stats.buildsCancelled++;
        return;
      }

      const previousKey = activeAnchor?.key || '';
      field = { u, v, cloud, rain, snow, height };
      activeAnchor = anchor;
      requestedKey = '';
      stats.buildsCompleted++;
      stats.averageCloud = cloudSum / count;
      stats.maxCloud = maxCloud;
      stats.averageRain = rainSum / count;
      stats.maxRain = maxRain;
      stats.averageSnow = snowSum / count;
      stats.meanWind = windSum / count;
      if (previousKey && previousKey !== anchor.key) stats.anchorHandoffs++;
      resetParticles();
      document.documentElement.dataset.surfaceWeatherChunk = anchor.key;
      document.documentElement.dataset.surfaceWeatherCloud = stats.averageCloud.toFixed(3);
    }

    scheduleIdle(process, 180);
  }

  function sampleField(localX, localZ) {
    if (!field) return null;
    stats.interpolationCalls++;
    const x = clamp((localX + FIELD_EXTENT) / FIELD_DIAMETER, 0, 1) * (GRID_SIZE - 1);
    const z = clamp((localZ + FIELD_EXTENT) / FIELD_DIAMETER, 0, 1) * (GRID_SIZE - 1);
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const x1 = Math.min(GRID_SIZE - 1, x0 + 1);
    const z1 = Math.min(GRID_SIZE - 1, z0 + 1);
    const tx = x - x0;
    const tz = z - z0;
    const i00 = z0 * GRID_SIZE + x0;
    const i10 = z0 * GRID_SIZE + x1;
    const i01 = z1 * GRID_SIZE + x0;
    const i11 = z1 * GRID_SIZE + x1;

    function bilinear(array) {
      const a = array[i00] * (1 - tx) + array[i10] * tx;
      const b = array[i01] * (1 - tx) + array[i11] * tx;
      return a * (1 - tz) + b * tz;
    }

    return {
      u: bilinear(field.u),
      v: bilinear(field.v),
      cloud: bilinear(field.cloud),
      rain: bilinear(field.rain),
      snow: bilinear(field.snow),
      height: bilinear(field.height),
    };
  }

  const cloudState = Array.from({ length: cloudCount }, (_, i) => ({
    x: (hash01(seed + i * 13) * 2 - 1) * FIELD_EXTENT,
    z: (hash01(seed + i * 29 + 7) * 2 - 1) * FIELD_EXTENT,
    y: 0,
    phase: hash01(seed + i * 47 + 19) * TAU,
    life: 0.5 + hash01(seed + i * 71 + 3) * 1.5,
  }));

  const precipState = Array.from({ length: precipCount }, (_, i) => ({
    x: (hash01(seed + i * 97 + 11) * 2 - 1) * FIELD_EXTENT,
    z: (hash01(seed + i * 41 + 23) * 2 - 1) * FIELD_EXTENT,
    y: hash01(seed + i * 59 + 31),
    phase: hash01(seed + i * 83 + 17),
  }));

  function ensureMeshes() {
    if (!cloudMesh) {
      cloudGeometry = new THREE.BufferGeometry();
      cloudGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cloudCount * 3), 3));
      cloudGeometry.setAttribute('weatherAlpha', new THREE.BufferAttribute(new Float32Array(cloudCount), 1));
      cloudGeometry.setAttribute('weatherSize', new THREE.BufferAttribute(new Float32Array(cloudCount), 1));
      const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        uniforms: {
          cloudColor: { value: new THREE.Color(0xdce4e5) },
        },
        vertexShader: `
          attribute float weatherAlpha;
          attribute float weatherSize;
          varying float vAlpha;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vAlpha = weatherAlpha;
            gl_PointSize = clamp(weatherSize * (310.0 / max(12.0, -mv.z)), 2.0, 84.0);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: `
          uniform vec3 cloudColor;
          varying float vAlpha;
          void main() {
            vec2 p = gl_PointCoord * 2.0 - 1.0;
            float r2 = dot(p, p);
            if (r2 > 1.0) discard;
            float soft = smoothstep(1.0, 0.18, r2);
            gl_FragColor = vec4(cloudColor, vAlpha * soft);
          }
        `,
      });
      cloudMesh = new THREE.Points(cloudGeometry, material);
      cloudMesh.name = 'surfaceWeatherCloudsV39';
      cloudMesh.frustumCulled = false;
      cloudMesh.renderOrder = 6;
      scene.add(cloudMesh);
    }

    if (!precipMesh) {
      precipGeometry = new THREE.BufferGeometry();
      precipGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(precipCount * 2 * 3), 3));
      precipGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(precipCount * 2 * 3), 3));
      const material = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
        depthTest: true,
      });
      precipMesh = new THREE.LineSegments(precipGeometry, material);
      precipMesh.name = 'surfaceWeatherPrecipV39';
      precipMesh.frustumCulled = false;
      precipMesh.renderOrder = 7;
      scene.add(precipMesh);
    }
  }

  function resetParticles() {
    for (let i = 0; i < cloudState.length; i++) {
      const p = cloudState[i];
      p.x = (hash01(seed + generation * 103 + i * 13) * 2 - 1) * FIELD_EXTENT;
      p.z = (hash01(seed + generation * 197 + i * 29) * 2 - 1) * FIELD_EXTENT;
      p.life = 0.5 + hash01(seed + generation * 61 + i * 71) * 1.5;
    }
    for (let i = 0; i < precipState.length; i++) {
      const p = precipState[i];
      p.x = (hash01(seed + generation * 37 + i * 97) * 2 - 1) * FIELD_EXTENT;
      p.z = (hash01(seed + generation * 89 + i * 41) * 2 - 1) * FIELD_EXTENT;
      p.y = hash01(seed + generation * 43 + i * 59);
    }
  }

  function respawnCloud(p, index) {
    p.x = -FIELD_EXTENT + hash01(seed + generation * 211 + index * 101 + stats.particleFrames) * FIELD_DIAMETER;
    p.z = -FIELD_EXTENT + hash01(seed + generation * 223 + index * 79 + stats.particleFrames) * FIELD_DIAMETER;
    p.life = 0.7 + hash01(seed + index * 137 + stats.particleFrames) * 1.4;
  }

  function updateParticles(dt, now) {
    if (!field || !activeAnchor) return;
    ensureMeshes();
    stats.particleFrames++;

    const cloudPositions = cloudGeometry.getAttribute('position');
    const cloudAlpha = cloudGeometry.getAttribute('weatherAlpha');
    const cloudSize = cloudGeometry.getAttribute('weatherSize');
    let visibleClouds = 0;

    for (let i = 0; i < cloudState.length; i++) {
      const p = cloudState[i];
      const f = sampleField(p.x, p.z);
      if (!f) continue;
      p.x += f.u * dt;
      p.z += f.v * dt;
      p.life -= dt * 0.035;
      if (Math.abs(p.x) > FIELD_EXTENT || Math.abs(p.z) > FIELD_EXTENT || p.life <= 0) respawnCloud(p, i);

      const cloudiness = clamp(f.cloud, 0, 1);
      const lift = CLOUD_BASE + (CLOUD_TOP - CLOUD_BASE) * (0.25 + p.phase / TAU * 0.75);
      p.y += ((f.height + lift) - p.y) * Math.min(1, dt * 2.2);
      if (!Number.isFinite(p.y) || p.y === 0) p.y = f.height + lift;

      const alpha = 0.025 + Math.pow(cloudiness, 1.35) * 0.62;
      const size = 18 + cloudiness * 48 + Math.sin(now * 0.0004 + p.phase) * 3;
      cloudPositions.setXYZ(i, p.x, p.y, p.z);
      cloudAlpha.setX(i, alpha);
      cloudSize.setX(i, size);
      if (alpha > 0.08) visibleClouds++;
    }
    cloudPositions.needsUpdate = true;
    cloudAlpha.needsUpdate = true;
    cloudSize.needsUpdate = true;
    stats.visibleCloudParticles = visibleClouds;

    const precipPositions = precipGeometry.getAttribute('position');
    const precipColors = precipGeometry.getAttribute('color');
    let visiblePrecip = 0;

    for (let i = 0; i < precipState.length; i++) {
      const p = precipState[i];
      const f = sampleField(p.x, p.z);
      if (!f) continue;
      const precipitation = Math.max(f.rain, f.snow);
      const isSnow = f.snow > f.rain;
      const ground = f.height + 1.2;
      const cloudBase = f.height + CLOUD_BASE + 18 + p.phase * 22;

      if (p.y <= 0 || p.y > 1) p.y = hash01(seed + i * 101 + stats.particleFrames) * 0.95 + 0.05;
      const fall = isSnow ? PRECIP_FALL_SPEED * 0.22 : PRECIP_FALL_SPEED;
      p.y -= dt * fall / Math.max(24, cloudBase - ground);
      p.x += f.u * dt * (isSnow ? 0.48 : 0.24);
      p.z += f.v * dt * (isSnow ? 0.48 : 0.24);

      if (p.y <= 0 || Math.abs(p.x) > FIELD_EXTENT || Math.abs(p.z) > FIELD_EXTENT) {
        p.x = -FIELD_EXTENT + hash01(seed + i * 131 + stats.particleFrames) * FIELD_DIAMETER;
        p.z = -FIELD_EXTENT + hash01(seed + i * 149 + stats.particleFrames) * FIELD_DIAMETER;
        p.y = 1;
      }

      const base = i * 2;
      if (precipitation < 0.035) {
        precipPositions.setXYZ(base, p.x, ground - 2, p.z);
        precipPositions.setXYZ(base + 1, p.x, ground - 2, p.z);
        precipColors.setXYZ(base, 0, 0, 0);
        precipColors.setXYZ(base + 1, 0, 0, 0);
        continue;
      }

      visiblePrecip++;
      const y = ground + (cloudBase - ground) * p.y;
      const streak = isSnow ? 1.2 : 5.5 + precipitation * 5.5;
      precipPositions.setXYZ(base, p.x, y, p.z);
      precipPositions.setXYZ(base + 1, p.x - f.u * 0.045, y - streak, p.z - f.v * 0.045);
      if (isSnow) {
        precipColors.setXYZ(base, 0.92, 0.96, 1.0);
        precipColors.setXYZ(base + 1, 0.78, 0.86, 0.92);
      } else {
        precipColors.setXYZ(base, 0.54, 0.72, 0.84);
        precipColors.setXYZ(base + 1, 0.32, 0.52, 0.66);
      }
    }
    precipPositions.needsUpdate = true;
    precipColors.needsUpdate = true;
    stats.visiblePrecipitation = visiblePrecip;

    const player = mode.getPlayer();
    const surfaceAnchor = anchorFromSurface();
    if (surfaceAnchor) {
      const offsetX = shortestWrappedDelta(activeAnchor.x, surfaceAnchor.x, world.width);
      const offsetZ = activeAnchor.y - surfaceAnchor.y;
      cloudMesh.position.set(offsetX, 0, offsetZ);
      precipMesh.position.set(offsetX, 0, offsetZ);
    }

    // Weather increases atmospheric obscuration without touching solar-light intensity.
    if (scene.fog) {
      const playerLocalX = shortestWrappedDelta(player.x, activeAnchor.x, world.width);
      const playerLocalZ = player.y - activeAnchor.y;
      const local = sampleField(playerLocalX, playerLocalZ);
      if (local) {
        const obscuration = clamp(local.cloud * 0.45 + local.rain * 0.8 + local.snow * 0.65, 0, 1);
        const altitude = Math.max(0, Number(player.altitude) || 0);
        const flightRelief = clamp(altitude / 280, 0, 0.75);
        scene.fog.near = 180 - obscuration * 95 + flightRelief * 160;
        scene.fog.far = 1320 - obscuration * 620 + flightRelief * 220;
      }
    }
  }

  function loop(now) {
    requestAnimationFrame(loop);
    const dt = clamp((now - lastNow) / 1000, 0, 0.05);
    lastNow = now;
    const active = surfaceActive();

    if (!active) {
      if (lastSurfaceActive) {
        lastSurfaceActive = false;
        generation++;
        requestedKey = '';
        field = null;
        activeAnchor = null;
        if (cloudMesh) cloudMesh.visible = false;
        if (precipMesh) precipMesh.visible = false;
      }
      return;
    }

    lastSurfaceActive = true;
    const anchor = anchorFromSurface();
    if (!anchor) return;
    if (anchor.key !== activeAnchor?.key && anchor.key !== requestedKey) buildField(anchor);

    if (cloudMesh) cloudMesh.visible = true;
    if (precipMesh) precipMesh.visible = true;
    updateParticles(dt, now);
  }
  requestAnimationFrame(loop);

  const api = {
    installed: true,
    getStats: () => ({
      ...stats,
      active: surfaceActive(),
      fieldReady: Boolean(field),
      activeChunkKey: activeAnchor?.key || '',
      requestedChunkKey: requestedKey,
      gridSize: GRID_SIZE,
      fieldExtent: FIELD_EXTENT,
      cachedField: true,
      bilinearInterpolation: true,
      sphericalLatitudeCorrection: true,
      usesWaterCyclePhysics: true,
      cloudParticles: cloudCount,
      precipitationParticles: precipCount,
      proceduralSamplingInRenderLoop: false,
      weatherSimulationRunningInSurface: false,
      presentationOnlyAdvection: true,
    }),
  };

  window.realitySandboxSurfaceWeatherV39 = api;
  document.documentElement.dataset.surfaceWeatherV39 = 'cached-bilinear-spherical-weather';

  const previousDiagnostics = window.realitySandboxPresentationDiagnostics;
  window.realitySandboxPresentationDiagnostics = () => ({
    ...(typeof previousDiagnostics === 'function' ? previousDiagnostics() : {}),
    surfaceWeatherV39: api.getStats(),
  });
}

waitForRuntime().then(state => {
  if (!state) {
    document.documentElement.dataset.surfaceWeatherV39 = 'unavailable';
    return;
  }
  install(state);
});

