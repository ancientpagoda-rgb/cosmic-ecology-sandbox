const RADAR_STEP_MS = 1200;
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
let attempts = 0;

const BASE_SYSTEMS = [
  { id: 'north-atlantic', latitude: 49, longitude: -42, radius: 14, intensity: 0.88, drift: 4.8, spin: 1 },
  { id: 'north-pacific', latitude: 43, longitude: 166, radius: 16, intensity: 0.82, drift: 4.1, spin: 1 },
  { id: 'west-pacific-tropical', latitude: 18, longitude: 132, radius: 10, intensity: 0.94, drift: 2.8, spin: -1 },
  { id: 'atlantic-tropical', latitude: 15, longitude: -48, radius: 9, intensity: 0.86, drift: 2.5, spin: -1 },
  { id: 'south-indian', latitude: -38, longitude: 72, radius: 14, intensity: 0.76, drift: 4.6, spin: -1 },
  { id: 'south-pacific', latitude: -42, longitude: -142, radius: 15, intensity: 0.72, drift: 4.2, spin: -1 },
];

function bootEarthRadar() {
  if (window.realitySandboxLilacClouds?.ready) return;

  const unified = window.realitySandboxUnified;
  const hifi = window.realitySandboxHifi;
  const canvas = document.getElementById('lofiLivingCanvas');
  if (!unified || !hifi?.ready || typeof hifi.projectGeo !== 'function' || !canvas) {
    if (attempts++ < 240) setTimeout(bootEarthRadar, 50);
    return;
  }

  const context = canvas.getContext('2d');
  let lastSignature = '';
  let activeSystems = [];

  const originalUnifiedRender = unified.render.bind(unified);
  unified.render = frame => {
    originalUnifiedRender(frame);
    drawWhenFresh(frame?.timestamp ?? performance.now());
  };

  const originalHifiRender = hifi.render.bind(hifi);
  hifi.render = () => {
    originalHifiRender();
    drawRadar(performance.now());
  };

  const originalSnapshot = unified.getSnapshot.bind(unified);
  unified.getSnapshot = () => {
    const snapshot = originalSnapshot();
    snapshot.presentation = {
      ...snapshot.presentation,
      rainRadar: true,
      radarPalette: 'lavender-violet-pink',
      radarCoordinateSystem: 'georeferenced latitude-longitude',
      radarDataMode: 'simulated-not-live',
    };
    return snapshot;
  };

  const earthWeather = {
    ready: true,
    mode: 'simulated-georeferenced',
    isLiveData: false,
    getSystems,
    getPrecipitationSamples,
  };
  window.realitySandboxEarthWeather = earthWeather;

  window.realitySandboxLilacClouds = {
    ready: true,
    rainRadar: true,
    georeferenced: true,
    simulated: true,
    render: () => {
      originalHifiRender();
      drawRadar(performance.now());
    },
    getState: () => ({
      ready: true,
      rainRadar: true,
      georeferenced: true,
      simulated: true,
      activeSystems: activeSystems.map(system => ({
        id: system.id,
        latitude: system.latitude,
        longitude: system.longitude,
        intensity: system.intensity,
      })),
    }),
  };

  originalHifiRender();
  drawWhenFresh(performance.now());

  function drawWhenFresh(timestamp) {
    const camera = unified.getCamera();
    const step = Math.floor(timestamp / RADAR_STEP_MS);
    const signature = [step, camera.zoom.toFixed(4), camera.centerX.toFixed(5), camera.centerY.toFixed(5)].join(':');
    if (signature === lastSignature) return;
    lastSignature = signature;
    drawRadar(timestamp);
  }

  function drawRadar(timestamp) {
    const geometry = hifi.getViewGeometry();
    activeSystems = getSystems(timestamp);

    context.save();
    context.beginPath();
    context.arc(geometry.cx, geometry.cy, geometry.radius, 0, TAU);
    context.clip();
    context.globalCompositeOperation = 'screen';

    drawItcz(timestamp, geometry.radius);
    for (const system of activeSystems) drawSystem(system, timestamp, geometry.radius);

    context.restore();
  }

  function drawItcz(timestamp, radius) {
    const phase = timestamp / 22000;
    const latitudeBase = 4 + Math.sin(phase * 0.35) * 3;
    const segments = 18;

    for (let segment = 0; segment < segments; segment++) {
      const longitude = -175 + segment * (350 / (segments - 1));
      const intensity = clamp(0.36 + 0.33 * Math.sin(segment * 1.7 + phase * 2.2) + 0.2 * hash(segment, 801), 0, 0.8);
      if (intensity < 0.48) continue;
      const latitude = latitudeBase + Math.sin(longitude * DEG * 2.4 + phase) * 4;
      const projected = hifi.projectGeo(latitude, longitude);
      if (!projected.visible) continue;

      const size = radius * (0.012 + intensity * 0.018) * (0.45 + projected.depth * 0.55);
      context.save();
      context.shadowColor = intensity > 0.7 ? 'rgba(255, 112, 218, 0.85)' : 'rgba(154, 93, 232, 0.65)';
      context.shadowBlur = size * 0.85;
      context.fillStyle = intensity > 0.7 ? 'rgba(255, 118, 218, 0.44)' : 'rgba(145, 88, 224, 0.36)';
      context.beginPath();
      context.ellipse(projected.x, projected.y, size * 1.8, size * 0.75, 0.15, 0, TAU);
      context.fill();
      context.restore();
    }
  }

  function drawSystem(system, timestamp, radius) {
    const depth = hifi.projectGeo(system.latitude, system.longitude).depth;
    if (depth < -0.18) return;

    const phase = timestamp / 9500 + hashString(system.id) * TAU;
    const outerWidth = Math.max(4, radius * 0.018 * (0.55 + system.intensity * 0.45));

    drawSpiralBand(system, phase, 0.48, system.radius * 1.18, outerWidth * 1.2, 'rgba(180, 134, 245, 0.28)', 'rgba(189, 143, 250, 0.54)');
    drawSpiralBand(system, phase + 0.8, 0.64, system.radius * 0.82, outerWidth * 0.82, 'rgba(113, 57, 205, 0.62)', 'rgba(149, 78, 231, 0.9)');
    drawSpiralBand(system, phase + 1.4, 0.82, system.radius * 0.46, outerWidth * 0.44, 'rgba(255, 112, 211, 0.9)', 'rgba(255, 104, 220, 1)');

    const center = hifi.projectGeo(system.latitude, system.longitude);
    if (center.visible && system.intensity > 0.78) {
      const coreSize = radius * (0.012 + system.intensity * 0.012) * (0.5 + center.depth * 0.5);
      context.save();
      context.shadowColor = 'rgba(255, 110, 220, 0.95)';
      context.shadowBlur = coreSize * 1.4;
      context.strokeStyle = 'rgba(255, 180, 235, 0.88)';
      context.lineWidth = Math.max(1, coreSize * 0.22);
      context.beginPath();
      context.arc(center.x, center.y, coreSize, 0, TAU);
      context.stroke();
      context.restore();
    }
  }

  function drawSpiralBand(system, phase, threshold, maximumRadius, width, color, glow) {
    if (system.intensity < threshold) return;
    const points = [];
    const samples = 72;
    const turns = system.radius > 12 ? 1.65 : 2.05;

    for (let sample = 0; sample <= samples; sample++) {
      const t = sample / samples;
      const angle = phase + system.spin * t * turns * TAU;
      const distance = maximumRadius * (0.14 + t * 0.86);
      const wobble = Math.sin(t * TAU * 4 + phase * 1.7) * maximumRadius * 0.06;
      const location = destinationPoint(system.latitude, system.longitude, Math.max(0.2, distance + wobble), angle);
      const projected = hifi.projectGeo(location.latitude, location.longitude);
      points.push(projected.visible ? projected : null);
    }

    strokeProjected(points, width, color, glow);
  }

  function strokeProjected(points, width, color, glow) {
    let segment = [];
    const flush = () => {
      if (segment.length < 2) {
        segment = [];
        return;
      }
      context.save();
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.strokeStyle = color;
      context.lineWidth = width;
      context.shadowColor = glow;
      context.shadowBlur = width * 0.7;
      context.beginPath();
      context.moveTo(segment[0].x, segment[0].y);
      for (let index = 1; index < segment.length - 1; index++) {
        const point = segment[index];
        const next = segment[index + 1];
        context.quadraticCurveTo(point.x, point.y, (point.x + next.x) * 0.5, (point.y + next.y) * 0.5);
      }
      const last = segment[segment.length - 1];
      context.lineTo(last.x, last.y);
      context.stroke();
      context.restore();
      segment = [];
    };

    for (const point of points) {
      if (point) segment.push(point);
      else flush();
    }
    flush();
  }
}

function getSystems(timestamp) {
  const elapsedHours = timestamp / 3600000;
  return BASE_SYSTEMS.map((system, index) => {
    const wobble = Math.sin(timestamp / 26000 + index * 1.9) * (system.latitude > 0 ? 2.2 : 1.8);
    const pulse = 0.88 + 0.12 * Math.sin(timestamp / 7000 + index * 2.4);
    return {
      ...system,
      latitude: clamp(system.latitude + wobble, -72, 72),
      longitude: wrapDegrees(system.longitude + elapsedHours * system.drift),
      intensity: clamp(system.intensity * pulse, 0.48, 1),
    };
  });
}

function getPrecipitationSamples(timestamp) {
  const systems = getSystems(timestamp);
  const samples = [];

  for (const system of systems) {
    const phase = timestamp / 9500 + hashString(system.id) * TAU;
    for (let ring = 0; ring < 4; ring++) {
      const ringIntensity = clamp(system.intensity - ring * 0.12, 0, 1);
      if (ringIntensity < 0.46) continue;
      const distance = system.radius * (0.12 + ring * 0.22);
      const count = ring === 0 ? 1 : 6 + ring * 2;
      for (let index = 0; index < count; index++) {
        const bearing = phase + system.spin * (index / Math.max(1, count)) * TAU + ring * 0.7;
        const location = ring === 0
          ? { latitude: system.latitude, longitude: system.longitude }
          : destinationPoint(system.latitude, system.longitude, distance, bearing);
        samples.push({
          systemId: system.id,
          latitude: location.latitude,
          longitude: location.longitude,
          intensity: ringIntensity,
          radius: system.radius,
        });
      }
    }
  }

  return samples;
}

function destinationPoint(latitudeDegrees, longitudeDegrees, distanceDegrees, bearingRadians) {
  const latitude = latitudeDegrees * DEG;
  const longitude = longitudeDegrees * DEG;
  const angularDistance = distanceDegrees * DEG;
  const sinLatitude = Math.sin(latitude);
  const cosLatitude = Math.cos(latitude);
  const sinDistance = Math.sin(angularDistance);
  const cosDistance = Math.cos(angularDistance);
  const destinationLatitude = Math.asin(
    sinLatitude * cosDistance + cosLatitude * sinDistance * Math.cos(bearingRadians),
  );
  const destinationLongitude = longitude + Math.atan2(
    Math.sin(bearingRadians) * sinDistance * cosLatitude,
    cosDistance - sinLatitude * Math.sin(destinationLatitude),
  );
  return {
    latitude: destinationLatitude / DEG,
    longitude: wrapDegrees(destinationLongitude / DEG),
  };
}

function hashString(value) {
  let hashValue = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hashValue ^= value.charCodeAt(index);
    hashValue = Math.imul(hashValue, 16777619);
  }
  return ((hashValue >>> 0) % 100000) / 100000;
}

function hash(a, b) {
  let value = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ 0x9e3779b9;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function wrapDegrees(value) {
  let wrapped = value;
  while (wrapped > 180) wrapped -= 360;
  while (wrapped < -180) wrapped += 360;
  return wrapped;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootEarthRadar, { once: true });
else bootEarthRadar();
