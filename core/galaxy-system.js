const TAU = Math.PI * 2;

export function createGalaxySystem(options = {}) {
  const seed = options.seed || 1337;
  const mobile = options.mobile ?? matchMedia('(pointer: coarse)').matches;
  const starCount = options.starCount || (mobile ? 18000 : 65000);
  const armCount = 4;
  const radius = 120;
  const thickness = 8;
  const rng = mulberry32(seed);
  const stars = new Array(starCount);

  for (let index = 0; index < starCount; index++) {
    const coreBias = Math.pow(rng(), 1.75);
    const radial = coreBias * radius;
    const arm = index % armCount;
    const armOffset = arm / armCount * TAU;
    const spin = radial * 0.115;
    const scatter = gaussian(rng) * (0.08 + radial / radius * 0.22);
    const angle = armOffset + spin + scatter;
    const halo = rng() < 0.09;
    const vertical = halo
      ? gaussian(rng) * thickness * 2.8
      : gaussian(rng) * (0.45 + radial / radius * thickness * 0.55);
    const jitter = gaussian(rng) * (0.35 + radial * 0.015);

    const x = Math.cos(angle) * radial + Math.cos(angle + Math.PI / 2) * jitter;
    const z = Math.sin(angle) * radial + Math.sin(angle + Math.PI / 2) * jitter;
    const metadata = generateStarMetadata(rng, radial / radius, index);

    stars[index] = {
      id: `star-${index}`,
      position: { x, y: vertical, z },
      ...metadata,
      arm,
      halo,
    };
  }

  const localStarIndex = Math.floor(starCount * 0.43);
  stars[localStarIndex] = {
    id: 'sol',
    position: { x: 52, y: 0.4, z: -21 },
    mass: 1,
    age: 4.57,
    metallicity: 0,
    temperature: 5772,
    luminosity: 1,
    spectralClass: 'G2V',
    color: [1, 0.91, 0.72],
    size: 1.25,
    arm: 2,
    halo: false,
  };

  const nebulae = Array.from({ length: mobile ? 10 : 18 }, (_, index) => {
    const arm = index % armCount;
    const radial = 20 + rng() * 88;
    const angle = arm / armCount * TAU + radial * 0.115 + gaussian(rng) * 0.18;
    return {
      id: `nebula-${index}`,
      position: {
        x: Math.cos(angle) * radial,
        y: gaussian(rng) * 2.2,
        z: Math.sin(angle) * radial,
      },
      radius: 3 + rng() * 8,
      hue: rng(),
      density: 0.2 + rng() * 0.5,
    };
  });

  const clusters = Array.from({ length: mobile ? 6 : 12 }, (_, index) => {
    const angle = rng() * TAU;
    const radial = 35 + rng() * 105;
    return {
      id: `cluster-${index}`,
      position: {
        x: Math.cos(angle) * radial,
        y: gaussian(rng) * 16,
        z: Math.sin(angle) * radial,
      },
      radius: 1.5 + rng() * 3.5,
      population: Math.floor(500 + rng() * 9000),
    };
  });

  return {
    id: 'galaxy.milkyway',
    name: 'Procedural Spiral Galaxy',
    version: '1.0.0',
    execution: 'browser-gpu',
    provides: ['galaxy.population', 'galaxy.structure', 'stellar.metadata'],
    initialize({ provideCapability } = {}) {
      provideCapability?.('galaxy.population', this);
      provideCapability?.('galaxy.structure', this);
      provideCapability?.('stellar.metadata', this);
    },
    getStars: () => stars,
    getNebulae: () => nebulae,
    getClusters: () => clusters,
    getLocalStar: () => stars[localStarIndex],
    getSummary: () => ({ starCount, armCount, radius, localStarIndex }),
    getNearbyStars(position, maxDistance = 12, limit = 128) {
      const maxDistanceSquared = maxDistance * maxDistance;
      return stars
        .filter(star => distanceSquared(star.position, position) <= maxDistanceSquared)
        .sort((a, b) => distanceSquared(a.position, position) - distanceSquared(b.position, position))
        .slice(0, limit);
    },
  };
}

function generateStarMetadata(rng, normalizedRadius, index) {
  const roll = rng();
  let spectralClass;
  let mass;
  let temperature;
  let luminosity;
  let size;
  let color;

  if (roll < 0.00003) {
    spectralClass = 'O'; mass = 22 + rng() * 40; temperature = 30000 + rng() * 16000; luminosity = 30000 + rng() * 700000; size = 3.2; color = [0.62, 0.74, 1];
  } else if (roll < 0.0013) {
    spectralClass = 'B'; mass = 2.1 + rng() * 14; temperature = 10000 + rng() * 19000; luminosity = 25 + rng() * 25000; size = 2.3; color = [0.7, 0.8, 1];
  } else if (roll < 0.008) {
    spectralClass = 'A'; mass = 1.4 + rng() * 0.7; temperature = 7500 + rng() * 2400; luminosity = 5 + rng() * 70; size = 1.8; color = [0.82, 0.87, 1];
  } else if (roll < 0.04) {
    spectralClass = 'F'; mass = 1.04 + rng() * 0.35; temperature = 6000 + rng() * 1400; luminosity = 1.4 + rng() * 4; size = 1.45; color = [0.95, 0.95, 1];
  } else if (roll < 0.115) {
    spectralClass = 'G'; mass = 0.8 + rng() * 0.24; temperature = 5200 + rng() * 750; luminosity = 0.6 + rng() * 0.8; size = 1.25; color = [1, 0.91, 0.72];
  } else if (roll < 0.235) {
    spectralClass = 'K'; mass = 0.45 + rng() * 0.34; temperature = 3700 + rng() * 1400; luminosity = 0.08 + rng() * 0.5; size = 1.05; color = [1, 0.72, 0.42];
  } else {
    spectralClass = 'M'; mass = 0.08 + rng() * 0.36; temperature = 2400 + rng() * 1200; luminosity = 0.0008 + rng() * 0.07; size = 0.82; color = [1, 0.38, 0.2];
  }

  const age = Math.min(13.4, Math.max(0.02, Math.pow(rng(), 0.7) * 12.8));
  const metallicity = -1.1 + (1 - normalizedRadius) * 0.9 + gaussian(rng) * 0.18;
  const subclass = index % 10;

  return {
    mass,
    age,
    metallicity,
    temperature,
    luminosity,
    spectralClass: `${spectralClass}${subclass}`,
    color,
    size,
  };
}

function gaussian(rng) {
  const u = Math.max(1e-8, rng());
  const v = Math.max(1e-8, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
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

function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}
