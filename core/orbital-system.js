const TAU = Math.PI * 2;
const PLANET_NAMES = ['Cinder', 'Aurelia', 'Gaia', 'Ember', 'Brontes', 'Thalassa', 'Nereid', 'Hyperion'];

export function createOrbitalSystem(world, options = {}) {
  const star = normalizeStar(options.star);
  const rng = mulberry32(options.seed ?? hashSeed(`${star.id}:${star.mass}:${star.metallicity}`));
  const disk = createDiskProfile(star, rng);
  const { bodies, homeIndex } = createPlanetarySystem(star, disk, rng);
  const home = bodies[homeIndex];
  const moon = createMoon(home, disk, rng);
  const axialTilt = home.axialTilt;
  const daysPerSecond = 2.4;
  let day = 42;
  let formationProgress = 0;

  world.planetProfile = home;
  world.stellarProfile = star;
  world.diskProfile = disk;

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
    const origin = bodyPosition(home);
    const relative = bodies.map(body => {
      const position = bodyPosition(body);
      return {
        ...body,
        formationProgress,
        position: {
          x: position.x - origin.x,
          y: position.y - origin.y,
          z: position.z - origin.z,
        },
      };
    });

    relative.push({ ...moon, formationProgress, position: moonPosition() });
    relative.push({
      id: 'sun',
      name: star.name,
      type: 'star',
      radius: clamp(0.52 + Math.pow(star.mass, 0.65) * 0.12, 0.48, 1.3),
      color: rgbToHex(star.color),
      mass: star.mass,
      luminosity: star.luminosity,
      metallicity: star.metallicity,
      spectralClass: star.spectralClass,
      position: { x: -origin.x, y: -origin.y, z: -origin.z },
    });
    return relative;
  }

  function getOrbitPaths(samples = 160) {
    const origin = bodyPosition(home);
    return bodies
      .filter(body => body.id !== home.id)
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
    const yearPhase = ((day / home.periodDays) % 1 + 1) % 1;
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
    const moonMassFactor = clamp(moon.massEarth / 0.0123, 0.25, 2.2);
    return {
      level: 0.5 + lunarBulge * 0.28 * moonMassFactor + solarBulge * 0.11,
      springTide: alignment,
      amplitude: 0.14 + alignment * 0.18 * moonMassFactor,
    };
  }

  function setFormationProgress(value) {
    formationProgress = clamp(value, 0, 1);
  }

  function getFormationState() {
    return {
      progress: formationProgress,
      stage: formationProgress < 0.18
        ? 'dust'
        : formationProgress < 0.42
          ? 'planetesimals'
          : formationProgress < 0.72
            ? 'protoplanets'
            : formationProgress < 1
              ? 'differentiation'
              : 'stable-system',
      star: { ...star },
      disk: { ...disk },
      homePlanet: { ...home },
      moon: { ...moon },
    };
  }

  function getState() {
    return {
      day,
      axialTilt,
      star: { ...star },
      disk: { ...disk },
      formation: getFormationState(),
      bodies: getRelativeBodies(),
      moon: { ...moon, position: moonPosition() },
      season: getSeasonState(0),
    };
  }

  return {
    id: 'orbit.system',
    name: 'Stellar-Disk Planetary System',
    version: '2.0.0',
    execution: 'browser',
    provides: ['orbits.system', 'climate.seasons', 'hydrology.tides', 'planet.formation'],
    step,
    getBodies: getRelativeBodies,
    getOrbitPaths,
    getSeasonState,
    getTideAt,
    getState,
    getDay: () => day,
    getStar: () => ({ ...star }),
    getDisk: () => ({ ...disk }),
    getHomePlanet: () => ({ ...home }),
    getFormationState,
    setFormationProgress,
    save: () => ({ day, formationProgress }),
    load(state) {
      if (Number.isFinite(state?.day)) day = state.day;
      if (Number.isFinite(state?.formationProgress)) setFormationProgress(state.formationProgress);
    },
  };
}

function createDiskProfile(star, rng) {
  const metalFactor = clamp(Math.pow(10, star.metallicity), 0.08, 2.5);
  const massFraction = 0.006 + rng() * 0.018;
  const diskMassSolar = star.mass * massFraction;
  const solidMassEarth = diskMassSolar * 332946 * 0.012 * metalFactor;
  const snowLineAu = 2.7 * Math.sqrt(Math.max(0.02, star.luminosity));
  return {
    massSolar: diskMassSolar,
    solidMassEarth,
    metalFactor,
    snowLineAu,
    turbulence: 0.12 + rng() * 0.46,
    lifetimeMyr: 1.5 + rng() * 7,
    carbonToOxygen: 0.35 + rng() * 0.55,
  };
}

function createPlanetarySystem(star, disk, rng) {
  const habitableCenter = Math.sqrt(Math.max(0.02, star.luminosity));
  const count = clamp(Math.round(4 + Math.log2(Math.max(1.1, disk.solidMassEarth)) + rng() * 2), 4, 8);
  const innerEdge = clamp(0.16 * Math.sqrt(star.luminosity), 0.08, 0.55);
  const outerEdge = Math.max(innerEdge * 6, disk.snowLineAu * (1.5 + rng() * 1.6));
  const raw = [];

  for (let index = 0; index < count; index++) {
    const t = count === 1 ? 0 : index / (count - 1);
    const semiMajorAxis = innerEdge * Math.pow(outerEdge / innerEdge, t) * (0.92 + rng() * 0.16);
    const beyondSnow = semiMajorAxis > disk.snowLineAu;
    const solidShare = disk.solidMassEarth / count * (0.38 + rng() * 1.25);
    const gasCapture = beyondSnow ? clamp((disk.lifetimeMyr - 2.2) * 0.12 + rng() * 0.25, 0, 1) : rng() * 0.08;
    const massEarth = clamp(solidShare * (beyondSnow ? 1.8 : 0.7) * (1 + gasCapture * 12), 0.08, 220);
    const rocky = !beyondSnow || massEarth < 5;
    const composition = rocky
      ? disk.carbonToOxygen > 0.78 ? 'carbon-rocky' : 'silicate-rocky'
      : gasCapture > 0.55 ? 'gas-giant' : 'ice-rich';
    const radiusEarth = rocky
      ? Math.pow(massEarth, 0.27)
      : composition === 'gas-giant'
        ? clamp(4.2 + Math.log2(massEarth) * 1.25, 5, 12)
        : clamp(1.7 + Math.pow(massEarth, 0.22), 2, 5.5);
    const equilibriumTemperature = 278 * Math.pow(star.luminosity, 0.25) / Math.sqrt(semiMajorAxis);
    const volatileDelivery = clamp(
      (disk.snowLineAu / Math.max(disk.snowLineAu, semiMajorAxis)) * 0.22 +
      (semiMajorAxis / disk.snowLineAu) * 0.18 +
      rng() * 0.2,
      0.01,
      0.75,
    );
    const atmosphereRetention = clamp(massEarth / Math.max(0.35, equilibriumTemperature / 290), 0, 1);

    raw.push({
      semiMajorAxis,
      massEarth,
      radiusEarth,
      radius: clamp(0.11 + Math.log2(radiusEarth + 1) * 0.1, 0.12, 0.5),
      composition,
      waterFraction: rocky ? volatileDelivery * clamp(1 - Math.abs(equilibriumTemperature - 285) / 260, 0.05, 1) : volatileDelivery,
      atmosphereRetention,
      equilibriumTemperature,
      eccentricity: clamp(rng() ** 2 * (0.22 + disk.turbulence * 0.18), 0.002, 0.32),
      inclination: (rng() - 0.5) * (2 + disk.turbulence * 9),
      axialTilt: clamp((3 + rng() * 31 + disk.turbulence * 8) * Math.PI / 180, 0.02, 0.78),
      periodDays: 365.25 * Math.sqrt(semiMajorAxis ** 3 / star.mass),
      phase: rng(),
      color: colorForComposition(composition, equilibriumTemperature, volatileDelivery),
    });
  }

  let homeIndex = 0;
  let homeScore = -Infinity;
  for (let index = 0; index < raw.length; index++) {
    const body = raw[index];
    const temperatureFit = 1 - Math.abs(body.equilibriumTemperature - 286) / 145;
    const massFit = 1 - Math.abs(Math.log(Math.max(0.1, body.massEarth))) / 4.2;
    const waterFit = body.waterFraction * 0.75;
    const rockyBonus = body.composition.includes('rocky') ? 0.7 : -0.8;
    const score = temperatureFit + massFit + waterFit + rockyBonus - Math.abs(body.semiMajorAxis - habitableCenter) * 0.2;
    if (score > homeScore) {
      homeScore = score;
      homeIndex = index;
    }
  }

  const bodies = raw.map((body, index) => {
    const isHome = index === homeIndex;
    const name = isHome ? 'Gaia' : PLANET_NAMES[index < homeIndex ? index : index + 1] || `World ${index + 1}`;
    return {
      ...body,
      id: isHome ? 'gaia' : slugify(name),
      name,
      type: 'planet',
      habitableZoneDistance: body.semiMajorAxis / habitableCenter,
      origin: 'stellar-disk-accretion',
    };
  });

  return { bodies, homeIndex };
}

function createMoon(home, disk, rng) {
  const impactEnergy = clamp(home.massEarth * (0.55 + rng() * 1.2) * disk.turbulence, 0.08, 3.5);
  const massEarth = clamp(home.massEarth * (0.004 + impactEnergy * 0.009), 0.001, 0.08);
  return {
    id: 'selene',
    name: 'Selene',
    type: 'moon',
    parentId: 'gaia',
    massEarth,
    radius: clamp(0.04 + Math.pow(massEarth / 0.0123, 0.28) * 0.025, 0.045, 0.11),
    color: 0xa9aaa7,
    orbitRadius: clamp(0.25 + rng() * 0.22, 0.22, 0.52),
    periodDays: clamp(18 + rng() * 22, 12, 45),
    inclination: 2 + rng() * 7,
    impactEnergy,
    origin: 'giant-impact-debris',
  };
}

function normalizeStar(star = {}) {
  return {
    id: star.id || 'sol',
    name: star.name || 'Local Star',
    mass: clamp(Number(star.mass) || 1, 0.08, 60),
    age: clamp(Number(star.age) || 4.57, 0.01, 13.7),
    metallicity: clamp(Number(star.metallicity) || 0, -2.5, 0.8),
    temperature: clamp(Number(star.temperature) || 5772, 2200, 50000),
    luminosity: clamp(Number(star.luminosity) || 1, 0.0004, 800000),
    spectralClass: star.spectralClass || 'G2V',
    color: star.color || [1, 0.91, 0.72],
  };
}

function colorForComposition(composition, temperature, water) {
  if (composition === 'gas-giant') return temperature > 500 ? 0xb79072 : 0xa99b87;
  if (composition === 'ice-rich') return 0x607f97;
  if (composition === 'carbon-rocky') return 0x514b49;
  if (water > 0.28 && temperature > 235 && temperature < 345) return 0x416f8d;
  return temperature > 500 ? 0x8a5744 : 0x746a62;
}

function solveEccentricAnomaly(mean, eccentricity) {
  let value = mean;
  for (let i = 0; i < 5; i++) {
    value -= (value - eccentricity * Math.sin(value) - mean) / (1 - eccentricity * Math.cos(value));
  }
  return value;
}

function seasonName(phase, north) {
  const shifted = ((phase + (north ? 0 : 0.5)) % 1 + 1) % 1;
  if (shifted < 0.25) return 'Spring';
  if (shifted < 0.5) return 'Summer';
  if (shifted < 0.75) return 'Autumn';
  return 'Winter';
}

function rgbToHex(color) {
  const [r, g, b] = color.map(value => clamp(Math.round(value * 255), 0, 255));
  return (r << 16) | (g << 8) | b;
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function hashSeed(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
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

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
