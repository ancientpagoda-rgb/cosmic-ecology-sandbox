const TAU = Math.PI * 2;

export function createOrbitalSystem(world) {
  const bodies = [
    planet('cinder', 'Cinder', 0.62, 88, 0.12, 0xc97855, 0.42, 7),
    planet('aurelia', 'Aurelia', 0.86, 224, 0.18, 0xe1ad6e, 0.18, 3),
    planet('gaia', 'Gaia', 1, 365.25, 0.22, 0x3d7fc4, 0.0167, 0),
    planet('ember', 'Ember', 1.42, 687, 0.16, 0xa34d35, 0.093, 2),
    planet('brontes', 'Brontes', 2.35, 2150, 0.48, 0xc7a56f, 0.048, 1),
    planet('thalassa', 'Thalassa', 3.25, 3900, 0.38, 0x5d8fb9, 0.055, 2.5),
  ];

  const moon = {
    id: 'selene',
    name: 'Selene',
    parentId: 'gaia',
    radius: 0.065,
    color: 0xc9ced8,
    orbitRadius: 0.36,
    periodDays: 27.32,
    inclination: 5.1,
  };

  const axialTilt = 23.44 * Math.PI / 180;
  const daysPerSecond = 2.4;
  let day = 42;

  function step(dt) {
    day += dt * daysPerSecond;
  }

  function bodyPosition(body, atDay = day) {
    const mean = TAU * ((atDay / body.periodDays) + body.phase);
    const eccentricAnomaly = solveEccentricAnomaly(mean, body.eccentricity);
    const x = body.semiMajorAxis * (Math.cos(eccentricAnomaly) - body.eccentricity);
    const z = body.semiMajorAxis * Math.sqrt(1 - body.eccentricity ** 2) * Math.sin(eccentricAnomaly);
    const inclination = body.inclination * Math.PI / 180;
    return {
      x,
      y: z * Math.sin(inclination),
      z: z * Math.cos(inclination),
    };
  }

  function moonPosition(atDay = day) {
    const angle = TAU * (atDay / moon.periodDays);
    const inclination = moon.inclination * Math.PI / 180;
    return {
      x: Math.cos(angle) * moon.orbitRadius,
      y: Math.sin(angle) * Math.sin(inclination) * moon.orbitRadius,
      z: Math.sin(angle) * Math.cos(inclination) * moon.orbitRadius,
    };
  }

  function getRelativeBodies() {
    const gaia = bodies.find(body => body.id === 'gaia');
    const origin = bodyPosition(gaia);
    const relative = bodies.map(body => {
      const position = bodyPosition(body);
      return {
        ...body,
        position: {
          x: position.x - origin.x,
          y: position.y - origin.y,
          z: position.z - origin.z,
        },
      };
    });
    relative.push({ ...moon, position: moonPosition() });
    relative.push({
      id: 'sun',
      name: 'Sun',
      type: 'star',
      radius: 0.62,
      color: 0xffd27a,
      position: { x: -origin.x, y: -origin.y, z: -origin.z },
    });
    return relative;
  }

  function getOrbitPaths(samples = 160) {
    const gaia = bodies.find(body => body.id === 'gaia');
    const origin = bodyPosition(gaia);
    return bodies
      .filter(body => body.id !== 'gaia')
      .map(body => ({
        id: body.id,
        points: Array.from({ length: samples }, (_, index) => {
          const angleDay = body.periodDays * index / samples;
          const position = bodyPosition(body, angleDay);
          return {
            x: position.x - origin.x,
            y: position.y - origin.y,
            z: position.z - origin.z,
          };
        }),
      }));
  }

  function getSeasonState(latitude = 0) {
    const yearPhase = ((day / 365.25) % 1 + 1) % 1;
    const declination = axialTilt * Math.sin(TAU * (yearPhase - 0.218));
    const latitudeRad = latitude * Math.PI / 2;
    const insolation = clamp(
      Math.sin(latitudeRad) * Math.sin(declination) +
      Math.cos(latitudeRad) * Math.cos(declination),
      -1,
      1,
    );
    const seasonalOffset = Math.sin(TAU * (yearPhase - 0.218)) * Math.sin(latitudeRad) * 0.13;
    return {
      yearPhase,
      declination,
      insolation,
      temperatureOffset: seasonalOffset,
      northernSeason: seasonName(yearPhase, true),
      southernSeason: seasonName(yearPhase, false),
    };
  }

  function getTideAt(x, y) {
    const moonPos = moonPosition();
    const sunBody = getRelativeBodies().find(body => body.id === 'sun');
    const moonLongitude = Math.atan2(moonPos.z, moonPos.x);
    const sunLongitude = Math.atan2(sunBody.position.z, sunBody.position.x);
    const localLongitude = (x / world.width - 0.5) * TAU;
    const latitude = (0.5 - y / world.height) * Math.PI;
    const lunarBulge = Math.cos(2 * (localLongitude - moonLongitude)) * Math.cos(latitude) ** 2;
    const solarBulge = Math.cos(2 * (localLongitude - sunLongitude)) * Math.cos(latitude) ** 2;
    const alignment = (1 + Math.cos(2 * (moonLongitude - sunLongitude))) * 0.5;
    return {
      level: 0.5 + lunarBulge * 0.28 + solarBulge * 0.11,
      springTide: alignment,
      amplitude: 0.14 + alignment * 0.18,
    };
  }

  function getState() {
    return {
      day,
      axialTilt,
      bodies: getRelativeBodies(),
      moon: { ...moon, position: moonPosition() },
      season: getSeasonState(0),
    };
  }

  return {
    id: 'orbit.system',
    name: 'Procedural Star System',
    version: '1.0.0',
    execution: 'browser',
    provides: ['orbits.system', 'climate.seasons', 'hydrology.tides'],
    step,
    getBodies: getRelativeBodies,
    getOrbitPaths,
    getSeasonState,
    getTideAt,
    getState,
    getDay: () => day,
    save: () => ({ day }),
    load(state) {
      if (Number.isFinite(state?.day)) day = state.day;
    },
  };
}

function planet(id, name, semiMajorAxis, periodDays, radius, color, eccentricity, inclination) {
  return {
    id,
    name,
    type: 'planet',
    semiMajorAxis,
    periodDays,
    radius,
    color,
    eccentricity,
    inclination,
    phase: hashPhase(id),
  };
}

function solveEccentricAnomaly(mean, eccentricity) {
  let value = mean;
  for (let i = 0; i < 5; i++) {
    value -= (value - eccentricity * Math.sin(value) - mean) / (1 - eccentricity * Math.cos(value));
  }
  return value;
}

function hashPhase(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return ((hash >>> 0) % 1000) / 1000;
}

function seasonName(phase, north) {
  const shifted = ((phase + (north ? 0 : 0.5)) % 1 + 1) % 1;
  if (shifted < 0.25) return 'Spring';
  if (shifted < 0.5) return 'Summer';
  if (shifted < 0.75) return 'Autumn';
  return 'Winter';
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
