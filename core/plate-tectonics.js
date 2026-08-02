/*
 * Lightweight spherical plate model adapted for Reality Sandbox from the
 * plate-segmentation and boundary concepts demonstrated by Tectonics.js.
 * Original project: https://github.com/davidson16807/tectonics.js
 * Original author: Andrew Davidson / davidson16807
 * License: Creative Commons Attribution 4.0 International (CC BY 4.0)
 *
 * Modifications: rewritten as an ES module, reduced to a deterministic
 * browser/mobile-friendly sampler, and integrated with Reality Sandbox's
 * latitude/longitude terrain pipeline. This is not the original Tectonics.js UI.
 */

const PLATE_COUNT = 16;
const seeds = createPlateSeeds(PLATE_COUNT, 918273);

export function sampleTectonics(nx, ny, nz) {
  let nearest = null;
  let second = null;

  for (const plate of seeds) {
    const similarity = nx * plate.x + ny * plate.y + nz * plate.z;
    if (!nearest || similarity > nearest.similarity) {
      second = nearest;
      nearest = { plate, similarity };
    } else if (!second || similarity > second.similarity) {
      second = { plate, similarity };
    }
  }

  const boundaryDistance = Math.max(0, nearest.similarity - (second?.similarity ?? -1));
  const boundaryStrength = Math.exp(-boundaryDistance * 28);
  const a = nearest.plate;
  const b = second?.plate ?? a;

  const relativeX = a.vx - b.vx;
  const relativeY = a.vy - b.vy;
  const relativeZ = a.vz - b.vz;
  const boundaryNormalX = a.x - b.x;
  const boundaryNormalY = a.y - b.y;
  const boundaryNormalZ = a.z - b.z;
  const convergence = relativeX * boundaryNormalX + relativeY * boundaryNormalY + relativeZ * boundaryNormalZ;

  const uplift = Math.max(0, convergence) * boundaryStrength;
  const rift = Math.max(0, -convergence) * boundaryStrength;
  const continentalBias = a.continental * 0.72 + b.continental * 0.28;

  return {
    plateId: a.id,
    continentalBias,
    boundaryStrength,
    convergence,
    uplift,
    rift,
  };
}

function createPlateSeeds(count, seed) {
  const random = mulberry32(seed);
  const result = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * i + (random() - 0.5) * 0.35;
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;

    // Tangential plate velocity formed from a random angular velocity vector.
    const ax = random() - 0.5;
    const ay = random() - 0.5;
    const az = random() - 0.5;
    const speed = 0.18 + random() * 0.32;
    const vx = (ay * z - az * y) * speed;
    const vy = (az * x - ax * z) * speed;
    const vz = (ax * y - ay * x) * speed;

    result.push({
      id: i,
      x, y, z,
      vx, vy, vz,
      continental: random() > 0.52 ? 1 : 0,
    });
  }
  return result;
}

function mulberry32(seed) {
  return function random() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
