const TAU = Math.PI * 2;
const FOV_DEG = 100;
const UPDATE_MS = 50;
const NORMAL_DAYS_PER_SECOND = 1 / 900;
const TIMELAPSE_DAYS_PER_SECOND = 2.4;
const SOLAR_RADIUS_AU = 0.00465047;
const EARTH_RADIUS_KM = 6371;
const EARTH_MASS_KG = 5.9722e24;
const G_KM3_KG_S2 = 6.67430e-20;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapTau = v => ((v % TAU) + TAU) % TAU;
const smooth01 = v => { const t = clamp(v, 0, 1); return t * t * (3 - 2 * t); };

async function waitForRuntime() {
  for (let i = 0; i < 300; i++) {
    const planet = window.realitySandboxPlanet;
    const mode = window.realitySandboxSurfaceMode;
    const layer = document.getElementById('surfaceModeLayer');
    if (planet?.world && planet?.orbitalSystem?.getState && mode?.getPlayer && mode?.isActive && layer) return { planet, mode, layer };
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  return null;
}

function install({ planet, mode, layer }) {
  if (window.realitySandboxSurfaceCelestialsV38?.installed) return;
  const { world, orbitalSystem } = planet;
  const canvas = document.createElement('canvas');
  canvas.id = 'surfaceCelestialCanvas';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', zIndex: '0', pointerEvents: 'none', display: 'none' });
  const gpuCanvas = document.getElementById('surfaceGpuCanvas');
  if (gpuCanvas?.nextSibling) layer.insertBefore(canvas, gpuCanvas.nextSibling);
  else layer.append(canvas);
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  const stars = Array.from({ length: 180 }, (_, i) => {
    let h = Math.imul(i + 43, 2654435761) >>> 0;
    h ^= h >>> 16;
    const u = (h & 0xffff) / 0xffff;
    h = Math.imul(h ^ 0x9e3779b9, 2246822519) >>> 0;
    const v = (h & 0xffff) / 0xffff;
    return { ra: u * TAU, dec: Math.asin(v * 2 - 1), alpha: 0.28 + (((h >>> 16) & 255) / 255) * 0.65, radius: 0.45 + ((h >>> 24) & 3) * 0.20 };
  });

  const stats = {
    frames: 0, updates: 0, sunAltitudeDeg: 0, sunAzimuthDeg: 0, moonAltitudeDeg: 0, moonAzimuthDeg: 0,
    moonIllumination: 0, moonPhase: 'unknown', sunAngularDiameterDeg: 0, moonAngularDiameterDeg: 0,
    daylight: 1, twilight: 0, visualDay: 0, orbitSteps: 0, timeLapseToggles: 0,
  };
  let width = 0, height = 0, dpr = 1;
  let last = performance.now(), lastUpdate = -Infinity, activeLast = false;
  let epochState = null, epochVisualDay = 0, visualDay = 0;
  let timeLapse = false;

  function resize() {
    const rect = layer.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    if (w === width && h === height && ratio === dpr) return;
    width = w; height = h; dpr = ratio;
    canvas.width = Math.max(1, Math.round(w * ratio));
    canvas.height = Math.max(1, Math.round(h * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function equatorial(v, tilt) {
    const c = Math.cos(tilt), s = Math.sin(tilt);
    return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
  }

  function localSkyFromRaDec(ra, dec, player, siderealDay) {
    const lat = (0.5 - player.y / world.height) * Math.PI;
    const lon = (player.x / world.width - 0.5) * TAU;
    const sidereal = TAU * (((siderealDay % 1) + 1) % 1) + lon;
    const H = sidereal - ra;
    const east = -Math.cos(dec) * Math.sin(H);
    const north = Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(H);
    const up = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
    return { east, south: -north, up, altitude: Math.asin(clamp(up, -1, 1)), azimuth: Math.atan2(east, north) };
  }

  function localSky(vector, player, tilt, day) {
    const e = equatorial(vector, tilt);
    const r = Math.hypot(e.x, e.y, e.z) || 1;
    return localSkyFromRaDec(Math.atan2(e.z, e.x), Math.asin(clamp(e.y / r, -1, 1)), player, day);
  }

  function projectSky(sky, player) {
    const yaw = player.yaw || 0, pitch = player.pitch || 0;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const fx = cy * cp, fz = sy * cp, fy = sp;
    const rx = -sy, rz = cy;
    const ux = -cy * sp, uz = -sy * sp, uy = cp;
    const xCam = sky.east * rx + sky.south * rz;
    const yCam = sky.east * ux + sky.south * uz + sky.up * uy;
    const zCam = sky.east * fx + sky.south * fz + sky.up * fy;
    if (zCam <= 0.01) return null;
    const tanY = Math.tan(FOV_DEG * Math.PI / 360), aspect = width / Math.max(1, height);
    const nx = xCam / (zCam * tanY * aspect), ny = yCam / (zCam * tanY);
    return { x: width * (0.5 + nx * 0.5), y: height * (0.5 - ny * 0.5), visible: Math.abs(nx) < 1.25 && Math.abs(ny) < 1.25 };
  }

  function moonAtVisualDay(state, deltaDays) {
    const moon = state.moon;
    const inclination = (moon.inclination || 0) * Math.PI / 180;
    const cosI = Math.max(1e-5, Math.cos(inclination));
    const baseSin = moon.position.z / Math.max(1e-5, (moon.orbitRadius || 1) * cosI);
    const baseCos = moon.position.x / Math.max(1e-5, moon.orbitRadius || 1);
    const angle = Math.atan2(baseSin, baseCos) + TAU * deltaDays / Math.max(1, moon.periodDays || 27.3);
    return { x: Math.cos(angle) * moon.orbitRadius, y: Math.sin(angle) * Math.sin(inclination) * moon.orbitRadius, z: Math.sin(angle) * Math.cos(inclination) * moon.orbitRadius };
  }

  function angularSizes(state) {
    const home = orbitalSystem.getHomePlanet();
    const sun = state.bodies.find(b => b.id === 'sun');
    const sunDist = Math.hypot(sun?.position?.x || 1, sun?.position?.y || 0, sun?.position?.z || 0) || 1;
    const starRadiusSolar = Math.pow(clamp(state.star.mass || 1, 0.08, 60), 0.8);
    const sunRadius = Math.atan(SOLAR_RADIUS_AU * starRadiusSolar / sunDist);
    const moon = state.moon;
    const moonRadiusKm = EARTH_RADIUS_KM * Math.pow(Math.max(0.0001, moon.massEarth || 0.0123), 0.27);
    const p = Math.max(1, moon.periodDays || 27.3) * 86400;
    const primary = Math.max(0.05, home.massEarth || 1) * EARTH_MASS_KG;
    const dist = Math.cbrt(G_KM3_KG_S2 * primary * p * p / (4 * Math.PI * Math.PI));
    return { sun: clamp(sunRadius, 0.0012, 0.025), moon: clamp(Math.atan(moonRadiusKm / Math.max(moonRadiusKm * 1.1, dist)), 0.0015, 0.04) };
  }

  function phaseName(k, waxing) {
    if (k < 0.03) return 'new';
    if (k > 0.97) return 'full';
    if (k < 0.47) return waxing ? 'waxing crescent' : 'waning crescent';
    if (k < 0.53) return waxing ? 'first quarter' : 'last quarter';
    return waxing ? 'waxing gibbous' : 'waning gibbous';
  }
  const pxRadius = angle => Math.max(2.3, Math.tan(angle) / Math.tan(FOV_DEG * Math.PI / 360) * height * 0.5);

  function drawMoon(x, y, r, illumination, waxing) {
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip();
    ctx.fillStyle = 'rgba(205,209,207,.98)'; ctx.fillRect(x-r, y-r, r*2, r*2);
    const dark = 1 - illumination, shift = (waxing ? 1 : -1) * (2 * illumination - 1) * r;
    ctx.fillStyle = 'rgba(6,9,14,.97)'; ctx.beginPath(); ctx.ellipse(x + shift, y, Math.max(0.08, dark) * r * 1.98, r, 0, 0, TAU); ctx.fill();
    ctx.restore(); ctx.strokeStyle = 'rgba(235,239,237,.72)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
  }

  function draw(player, sunSky, moonSky, sizes, illumination, waxing) {
    ctx.clearRect(0, 0, width, height);
    const sunHeight = Math.sin(sunSky.altitude);
    const daylight = smooth01((sunHeight + 0.08) / 0.30);
    const twilight = smooth01((sunHeight + 0.18) / 0.18) * (1 - daylight);
    stats.daylight = daylight; stats.twilight = twilight;
    const nightAlpha = (1 - daylight) * (0.44 - twilight * 0.16);
    if (nightAlpha > 0.03) { ctx.fillStyle = `rgba(2,7,16,${clamp(nightAlpha,0,0.48)})`; ctx.fillRect(0, 0, width, height); }
    const starAlpha = clamp((1 - daylight - twilight * 0.55) * 0.88, 0, 0.82);
    if (starAlpha > 0.04) {
      for (const star of stars) {
        const sky = localSkyFromRaDec(star.ra, star.dec, player, visualDay);
        if (sky.altitude < -0.08) continue;
        const p = projectSky(sky, player); if (!p?.visible) continue;
        ctx.fillStyle = `rgba(235,242,255,${star.alpha * starAlpha})`; ctx.beginPath(); ctx.arc(p.x, p.y, star.radius, 0, TAU); ctx.fill();
      }
    }
    const sp = projectSky(sunSky, player);
    if (sp?.visible && sunSky.altitude > -0.12) {
      const r = pxRadius(sizes.sun), glow = ctx.createRadialGradient(sp.x, sp.y, r*.15, sp.x, sp.y, r*4.2);
      glow.addColorStop(0, 'rgba(255,247,196,.98)'); glow.addColorStop(.2, 'rgba(255,221,128,.50)'); glow.addColorStop(1, 'rgba(255,205,110,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(sp.x, sp.y, r*4.2, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,246,190,1)'; ctx.beginPath(); ctx.arc(sp.x, sp.y, r, 0, TAU); ctx.fill();
    }
    const mp = projectSky(moonSky, player);
    if (mp?.visible && moonSky.altitude > -0.10) drawMoon(mp.x, mp.y, pxRadius(sizes.moon), illumination, waxing);
  }

  function beginEpoch() {
    epochState = orbitalSystem.getState(); epochVisualDay = epochState.day; visualDay = epochVisualDay; stats.visualDay = visualDay;
  }

  function update() {
    resize(); if (!epochState) beginEpoch();
    const player = mode.getPlayer(), state = epochState;
    const sun = state.bodies.find(b => b.id === 'sun'); if (!sun?.position || !state.moon?.position) return;
    const moonPosition = moonAtVisualDay(state, visualDay - epochVisualDay);
    const sunSky = localSky(sun.position, player, state.axialTilt || 0, visualDay);
    const moonSky = localSky(moonPosition, player, state.axialTilt || 0, visualDay);
    const sizes = angularSizes(state);
    const ml = Math.hypot(moonPosition.x, moonPosition.y, moonPosition.z) || 1, sl = Math.hypot(sun.position.x, sun.position.y, sun.position.z) || 1;
    const cosE = clamp((moonPosition.x*sun.position.x + moonPosition.y*sun.position.y + moonPosition.z*sun.position.z)/(ml*sl), -1, 1);
    const illumination = (1 - cosE) * 0.5, waxing = (sun.position.z * moonPosition.x - sun.position.x * moonPosition.z) >= 0;
    stats.sunAltitudeDeg = sunSky.altitude * 180 / Math.PI; stats.sunAzimuthDeg = wrapTau(sunSky.azimuth) * 180 / Math.PI;
    stats.moonAltitudeDeg = moonSky.altitude * 180 / Math.PI; stats.moonAzimuthDeg = wrapTau(moonSky.azimuth) * 180 / Math.PI;
    stats.moonIllumination = illumination; stats.moonPhase = phaseName(illumination, waxing);
    stats.sunAngularDiameterDeg = sizes.sun * 2 * 180 / Math.PI; stats.moonAngularDiameterDeg = sizes.moon * 2 * 180 / Math.PI;
    stats.visualDay = visualDay; stats.updates++;
    draw(player, sunSky, moonSky, sizes, illumination, waxing);
    document.documentElement.dataset.surfaceSunAltitude = stats.sunAltitudeDeg.toFixed(2);
    document.documentElement.dataset.surfaceMoonPhase = stats.moonPhase;
  }

  window.addEventListener('keydown', event => {
    if (event.code !== 'KeyT' || !mode.isActive?.()) return;
    event.preventDefault();
    timeLapse = !timeLapse; stats.timeLapseToggles++;
    document.documentElement.dataset.surfaceSkyTimeMode = timeLapse ? 'timelapse' : 'stable';
  }, { passive: false });

  function loop(now) {
    requestAnimationFrame(loop); stats.frames++;
    const active = mode.isActive?.() && document.documentElement.dataset.surfaceMode === 'active';
    canvas.style.display = active ? 'block' : 'none';
    if (!active) { activeLast = false; epochState = null; last = now; return; }
    if (!activeLast) { activeLast = true; beginEpoch(); last = now; }
    const dt = clamp((now - last) / 1000, 0, 0.08); last = now;
    if (!window.realitySandboxDebug?.isPaused?.()) visualDay += dt * (timeLapse ? TIMELAPSE_DAYS_PER_SECOND : NORMAL_DAYS_PER_SECOND);
    if (now - lastUpdate >= UPDATE_MS) { lastUpdate = now; update(); }
  }
  requestAnimationFrame(loop);

  const api = {
    installed: true,
    getStats: () => ({
      ...stats,
      active: Boolean(mode.isActive?.()),
      source: 'Nysa orbital epoch + toggleable surface rotation clock',
      axialTiltCoupled: true, observerLatitudeLongitudeCoupled: true, orbitalClockRunsInSurface: false,
      surfaceRotationClockIndependent: true,
      celestialDaySeconds: 1 / (timeLapse ? TIMELAPSE_DAYS_PER_SECOND : NORMAL_DAYS_PER_SECOND),
      timeMode: timeLapse ? 'timelapse' : 'stable', timeLapseEnabled: timeLapse,
      timeScaleDaysPerSecond: timeLapse ? TIMELAPSE_DAYS_PER_SECOND : NORMAL_DAYS_PER_SECOND,
      timeLapseOriginalRateRestored: true,
      respectsPause: true, moonPhaseFromElongation: true, apparentAngularSizeModeled: true,
      cameraProjectedStars: true, cameraProjectedSunMoon: true, screenFixedStarfield: false,
    }),
  };
  window.realitySandboxSurfaceCelestialsV38 = api;
  window.realitySandboxSurfaceCelestialsV35 = api;
  document.documentElement.dataset.surfaceCelestialsV38 = 'stable-plus-timelapse';
  document.documentElement.dataset.surfaceSkyTimeMode = 'stable';
  const prev = window.realitySandboxPresentationDiagnostics;
  window.realitySandboxPresentationDiagnostics = () => ({ ...(typeof prev === 'function' ? prev() : {}), surfaceCelestialsV38: api.getStats(), surfaceCelestialsV35: api.getStats() });
}

waitForRuntime().then(state => {
  if (!state) { document.documentElement.dataset.surfaceCelestialsV38 = 'unavailable'; return; }
  install(state);
});

