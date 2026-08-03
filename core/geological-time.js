const TAU = Math.PI * 2;

export function createGeologicalTime(options = {}) {
  const rng = mulberry32(options.seed || 90210);
  const plateCount = options.plateCount || 14;
  const millionYearsPerSecond = options.millionYearsPerSecond || 0.35;
  const plates = Array.from({ length: plateCount }, (_, index) => createPlate(index, rng));
  let ageMyr = options.startAgeMyr ?? 0;
  let lastEpoch = epochName(ageMyr);

  function step(dt) {
    ageMyr += dt * millionYearsPerSecond;
    for (const plate of plates) {
      plate.longitude = wrapAngle(plate.longitude + plate.velocityLon * dt * millionYearsPerSecond);
      plate.latitude = clamp(plate.latitude + plate.velocityLat * dt * millionYearsPerSecond, -1.35, 1.35);
      plate.rotation += plate.angularVelocity * dt * millionYearsPerSecond;
    }
    const epoch = epochName(ageMyr);
    if (epoch !== lastEpoch) {
      lastEpoch = epoch;
      window.dispatchEvent(new CustomEvent('geological-event', {
        detail: {
          title: `${epoch} begins`,
          description: `The planet entered a new geological interval at ${ageMyr.toFixed(1)} million simulated years.`,
          ageMyr,
        },
      }));
    }
  }

  function sample(u, v) {
    const longitude = (u - 0.5) * TAU;
    const latitude = (0.5 - v) * Math.PI;
    const influences = plates
      .map(plate => ({ plate, distance: sphericalDistance(longitude, latitude, plate.longitude, plate.latitude) }))
      .sort((a, b) => a.distance - b.distance);

    const primary = influences[0];
    const secondary = influences[1];
    const boundary = clamp(1 - Math.abs(primary.distance - secondary.distance) * 5.5, 0, 1);
    const convergence = relativeConvergence(primary.plate, secondary.plate, longitude, latitude);
    const uplift = boundary * Math.max(0, convergence) * 0.13;
    const rifting = boundary * Math.max(0, -convergence) * 0.075;
    const volcanic = boundary * clamp(primary.plate.volcanism + secondary.plate.volcanism, 0, 1) * 0.9;
    const erosionCycle = 0.55 + 0.45 * Math.sin(ageMyr * 0.071 + latitude * 2.4);
    const erosion = clamp((0.015 + erosionCycle * 0.035) * (1 + uplift * 7), 0, 0.09);
    const seaLevel = seaLevelAt(ageMyr);
    const ice = iceCover(latitude, ageMyr);
    const crustAge = wrap01(primary.plate.crustAge + ageMyr * 0.004);

    return {
      plateId: primary.plate.id,
      boundary,
      convergence,
      uplift,
      rifting,
      volcanic,
      erosion,
      seaLevel,
      ice,
      crustAge,
      continental: primary.plate.continental,
    };
  }

  function getState() {
    return {
      ageMyr,
      epoch: epochName(ageMyr),
      seaLevel: seaLevelAt(ageMyr),
      globalIce: globalIceAt(ageMyr),
      plates: plates.map(plate => ({ ...plate })),
      millionYearsPerSecond,
    };
  }

  return {
    id: 'geology.deep-time',
    name: 'Geological Time Engine',
    version: '1.0.0',
    execution: 'browser',
    provides: ['geology.deep-time', 'tectonics.plates', 'terrain.evolution'],
    initialize({ provideCapability } = {}) {
      provideCapability?.('geology.deep-time', this);
      provideCapability?.('tectonics.plates', this);
      provideCapability?.('terrain.evolution', this);
    },
    step,
    sample,
    getState,
    getAgeMyr: () => ageMyr,
    save: () => ({ ageMyr, plates }),
    load(state) {
      if (Number.isFinite(state?.ageMyr)) ageMyr = state.ageMyr;
      if (Array.isArray(state?.plates)) {
        for (let i = 0; i < Math.min(plates.length, state.plates.length); i++) Object.assign(plates[i], state.plates[i]);
      }
    },
  };
}

function createPlate(index, rng) {
  return {
    id: `plate-${index}`,
    longitude: rng() * TAU - Math.PI,
    latitude: Math.asin(rng() * 2 - 1),
    velocityLon: (rng() - 0.5) * 0.012,
    velocityLat: (rng() - 0.5) * 0.006,
    angularVelocity: (rng() - 0.5) * 0.018,
    rotation: rng() * TAU,
    continental: rng() > 0.46,
    volcanism: 0.2 + rng() * 0.8,
    crustAge: rng(),
  };
}

function relativeConvergence(a, b, longitude, latitude) {
  const tangentX = Math.cos(latitude);
  const ax = a.velocityLon * tangentX;
  const ay = a.velocityLat;
  const bx = b.velocityLon * tangentX;
  const by = b.velocityLat;
  const direction = Math.atan2(b.latitude - a.latitude, wrapAngle(b.longitude - a.longitude));
  return (ax - bx) * Math.cos(direction) + (ay - by) * Math.sin(direction);
}

function sphericalDistance(lon1, lat1, lon2, lat2) {
  const cosine = Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon1 - lon2);
  return Math.acos(clamp(cosine, -1, 1));
}

function seaLevelAt(ageMyr) {
  return Math.sin(ageMyr * 0.023) * 0.018 + Math.sin(ageMyr * 0.0071 + 1.3) * 0.012;
}

function globalIceAt(ageMyr) {
  return clamp(0.32 + Math.sin(ageMyr * 0.031) * 0.24 + Math.sin(ageMyr * 0.009) * 0.18, 0, 0.82);
}

function iceCover(latitude, ageMyr) {
  const polar = smoothstep(0.58, 0.95, Math.abs(latitude) / (Math.PI / 2));
  return clamp(polar * (0.35 + globalIceAt(ageMyr) * 0.8), 0, 1);
}

function epochName(ageMyr) {
  const cycle = ((ageMyr % 600) + 600) % 600;
  if (cycle < 80) return 'Rifting Age';
  if (cycle < 180) return 'Oceanic Expansion';
  if (cycle < 300) return 'Continental Collision';
  if (cycle < 410) return 'Mountain-Building Age';
  if (cycle < 510) return 'Erosional Age';
  return 'Icehouse Age';
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

function wrapAngle(value) {
  return ((value + Math.PI) % TAU + TAU) % TAU - Math.PI;
}
function wrap01(value) {
  return ((value % 1) + 1) % 1;
}
function smoothstep(edge0, edge1, value) {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
