const SVG_NS = 'http://www.w3.org/2000/svg';
const TAU = Math.PI * 2;
const ANIMAL_PARENT_RADIUS = 28;
const PLANT_PARENT_RADIUS = 54;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const wrapHue = value => ((value % 360) + 360) % 360;

function hash32(text) {
  let hash = 2166136261;
  const value = String(text);
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function random01(key) {
  let x = hash32(key) || 1;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return (x >>> 0) / 4294967296;
}

function mutate(value, amount, min, max, key) {
  return clamp(value + (random01(key) - 0.5) * 2 * amount, min, max);
}

function mutateInteger(value, amount, min, max, key) {
  return Math.round(mutate(value, amount, min, max, key));
}

function toroidalDistance(a, b, width) {
  let dx = Math.abs(a.x - b.x);
  dx = Math.min(dx, width - dx);
  return Math.hypot(dx, a.y - b.y);
}

function rgbIntToHsl(color) {
  const r = ((color >> 16) & 255) / 255;
  const g = ((color >> 8) & 255) / 255;
  const b = (color & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;
  const l = (max + min) / 2;
  const s = delta ? delta / (1 - Math.abs(2 * l - 1)) : 0;
  return { h, s: s * 100, l: l * 100 };
}

function hslColor(h, s, l) {
  return `hsl(${Math.round(wrapHue(h))} ${Math.round(clamp(s, 0, 100))}% ${Math.round(clamp(l, 0, 100))}%)`;
}

function animalGuild(world, id) {
  const c = world.ecs.components;
  if (c.agent.has(id)) return 'grazer';
  if (c.predator.has(id)) return 'predator';
  if (c.apex.has(id)) return 'apex';
  return null;
}

function organismFor(world, id) {
  const c = world.ecs.components;
  return c.agent.get(id) || c.predator.get(id) || c.apex.get(id) || null;
}

function founderAnimalMorphology(seed, id, organism, guild, species) {
  const dna = organism.dna || (organism.dna = {});
  const key = `${seed}:animal:${guild}:${id}`;
  const base = guild === 'grazer'
    ? { length: 1.05, width: 0.72, head: 0.72, tail: 0.72, limbs: 0.82, ornament: 0.18, hue: 198 }
    : guild === 'predator'
      ? { length: 1.28, width: 0.64, head: 0.78, tail: 1.0, limbs: 0.92, ornament: 0.48, hue: 8 }
      : { length: 1.42, width: 0.9, head: 0.9, tail: 0.86, limbs: 0.78, ornament: 0.76, hue: 282 };
  const speciesHsl = species?.color != null ? rgbIntToHsl(species.color) : null;
  return {
    version: 1,
    generation: 0,
    speciesId: species?.id || null,
    bodyLength: clamp(base.length * (0.82 + random01(`${key}:length`) * 0.36) * (0.9 + (dna.speed || 1) * 0.1), 0.7, 1.9),
    bodyWidth: clamp(base.width * (0.82 + random01(`${key}:width`) * 0.36) * (1.08 - (dna.speed || 1) * 0.08), 0.42, 1.35),
    headScale: clamp(base.head * (0.82 + random01(`${key}:head`) * 0.36) * (0.9 + (dna.sense || 1) * 0.1), 0.48, 1.3),
    limbLength: clamp(base.limbs * (0.78 + random01(`${key}:limbs`) * 0.44) * (0.9 + (dna.speed || 1) * 0.12), 0.4, 1.45),
    tailLength: clamp(base.tail * (0.68 + random01(`${key}:tail`) * 0.64), 0.18, 1.65),
    ornament: clamp(base.ornament + (random01(`${key}:ornament`) - 0.5) * 0.5, 0, 1),
    pattern: Math.floor(random01(`${key}:pattern`) * 4),
    pigmentHue: speciesHsl?.h ?? wrapHue(base.hue + (dna.hueShift || 0) + (random01(`${key}:hue`) - 0.5) * 24),
    pigmentSaturation: speciesHsl?.s ?? 68 + random01(`${key}:sat`) * 20,
    pigmentLightness: speciesHsl?.l ?? 50 + random01(`${key}:light`) * 14,
  };
}

function inheritedAnimalMorphology(seed, id, parentMorph, species) {
  const key = `${seed}:animal-child:${id}`;
  const child = {
    ...parentMorph,
    version: 1,
    generation: (parentMorph.generation || 0) + 1,
    speciesId: species?.id || parentMorph.speciesId || null,
    bodyLength: mutate(parentMorph.bodyLength, 0.09, 0.62, 2.05, `${key}:length`),
    bodyWidth: mutate(parentMorph.bodyWidth, 0.075, 0.36, 1.45, `${key}:width`),
    headScale: mutate(parentMorph.headScale, 0.07, 0.4, 1.45, `${key}:head`),
    limbLength: mutate(parentMorph.limbLength, 0.09, 0.3, 1.6, `${key}:limb`),
    tailLength: mutate(parentMorph.tailLength, 0.12, 0.08, 1.9, `${key}:tail`),
    ornament: mutate(parentMorph.ornament, 0.08, 0, 1, `${key}:ornament`),
    pattern: random01(`${key}:pattern-roll`) < 0.08 ? Math.floor(random01(`${key}:pattern`) * 4) : parentMorph.pattern,
    pigmentHue: wrapHue(parentMorph.pigmentHue + (random01(`${key}:hue`) - 0.5) * 10),
    pigmentSaturation: mutate(parentMorph.pigmentSaturation, 4, 30, 100, `${key}:sat`),
    pigmentLightness: mutate(parentMorph.pigmentLightness, 4, 25, 78, `${key}:light`),
  };
  if (species?.color != null) {
    const speciesHsl = rgbIntToHsl(species.color);
    child.pigmentHue = wrapHue(child.pigmentHue * 0.35 + speciesHsl.h * 0.65);
    child.pigmentSaturation = child.pigmentSaturation * 0.35 + speciesHsl.s * 0.65;
    child.pigmentLightness = child.pigmentLightness * 0.35 + speciesHsl.l * 0.65;
  }
  return child;
}

function applySpeciationShift(seed, id, morph, species) {
  if (!species || morph.speciesId === species.id) return morph;
  const key = `${seed}:speciation:${species.id}:${id}`;
  const speciesHsl = rgbIntToHsl(species.color);
  return {
    ...morph,
    speciesId: species.id,
    generation: Math.max(morph.generation || 0, species.generation || 0),
    bodyLength: mutate(morph.bodyLength, 0.2, 0.62, 2.1, `${key}:length`),
    bodyWidth: mutate(morph.bodyWidth, 0.16, 0.34, 1.5, `${key}:width`),
    headScale: mutate(morph.headScale, 0.15, 0.38, 1.5, `${key}:head`),
    limbLength: mutate(morph.limbLength, 0.18, 0.28, 1.65, `${key}:limb`),
    tailLength: mutate(morph.tailLength, 0.22, 0.05, 2, `${key}:tail`),
    ornament: mutate(morph.ornament, 0.2, 0, 1, `${key}:ornament`),
    pattern: Math.floor(random01(`${key}:pattern`) * 4),
    pigmentHue: wrapHue(speciesHsl.h + (random01(`${key}:hue`) - 0.5) * 8),
    pigmentSaturation: clamp(speciesHsl.s + (random01(`${key}:sat`) - 0.5) * 10, 30, 100),
    pigmentLightness: clamp(speciesHsl.l + (random01(`${key}:light`) - 0.5) * 8, 25, 78),
  };
}

function founderPlantDna(seed, id, resource) {
  const key = `${seed}:plant:${resource.kind}:${id}`;
  const dna = resource.dna || {};
  resource.dna = dna;
  dna.morphologyVersion = 1;
  dna.generation = 0;
  dna.branchCount = clamp(Math.round(dna.branchCount ?? (2 + random01(`${key}:branches`) * 4)), 2, 7);
  dna.branchAngle = clamp(dna.branchAngle ?? (0.4 + random01(`${key}:angle`) * 0.8), 0.25, 1.35);
  dna.curvature = clamp(dna.curvature ?? (0.2 + random01(`${key}:curve`) * 0.6), 0.05, 1);
  dna.segmentLength = clamp(dna.segmentLength ?? (10 + random01(`${key}:segment`) * 12), 6, 28);
  dna.thickness = clamp(dna.thickness ?? (0.6 + random01(`${key}:thickness`) * 0.8), 0.4, 1.8);
  dna.depth = clamp(dna.depth ?? (0.2 + random01(`${key}:depth`) * 0.7), 0.1, 1);
  dna.lean = clamp(dna.lean ?? ((random01(`${key}:lean`) - 0.5) * 0.6), -0.8, 0.8);
  dna.height = 0.72 + random01(`${key}:height`) * 0.9;
  dna.canopy = 0.6 + random01(`${key}:canopy`) * 0.9;
  dna.leafAspect = 0.55 + random01(`${key}:leaf`) * 1.2;
  dna.hue = wrapHue(76 + (random01(`${key}:hue`) - 0.5) * 72);
  dna.saturation = 42 + random01(`${key}:sat`) * 42;
  dna.lightness = 31 + random01(`${key}:light`) * 27;
  dna.flower = random01(`${key}:flower`) > 0.58 ? random01(`${key}:flower-strength`) : 0;
  dna.flowerHue = wrapHue(dna.hue + 70 + random01(`${key}:flower-hue`) * 190);
  return dna;
}

function inheritPlantDna(seed, id, resource, parentDna) {
  const key = `${seed}:plant-child:${id}`;
  const child = resource.dna || (resource.dna = {});
  child.morphologyVersion = 1;
  child.generation = (parentDna.generation || 0) + 1;
  child.branchCount = mutateInteger(parentDna.branchCount, 1, 2, 8, `${key}:branches`);
  child.branchAngle = mutate(parentDna.branchAngle, 0.09, 0.2, 1.45, `${key}:angle`);
  child.curvature = mutate(parentDna.curvature, 0.08, 0.02, 1.1, `${key}:curve`);
  child.segmentLength = mutate(parentDna.segmentLength, 1.8, 5, 32, `${key}:segment`);
  child.thickness = mutate(parentDna.thickness, 0.12, 0.32, 2, `${key}:thickness`);
  child.depth = mutate(parentDna.depth, 0.06, 0.05, 1, `${key}:depth`);
  child.lean = mutate(parentDna.lean, 0.1, -0.9, 0.9, `${key}:lean`);
  child.height = mutate(parentDna.height, 0.12, 0.35, 2.1, `${key}:height`);
  child.canopy = mutate(parentDna.canopy, 0.14, 0.3, 1.9, `${key}:canopy`);
  child.leafAspect = mutate(parentDna.leafAspect, 0.12, 0.3, 2, `${key}:leaf`);
  child.hue = wrapHue(parentDna.hue + (random01(`${key}:hue`) - 0.5) * 12);
  child.saturation = mutate(parentDna.saturation, 4, 24, 96, `${key}:sat`);
  child.lightness = mutate(parentDna.lightness, 4, 22, 72, `${key}:light`);
  child.flower = mutate(parentDna.flower || 0, 0.12, 0, 1, `${key}:flower`);
  child.flowerHue = wrapHue((parentDna.flowerHue ?? parentDna.hue + 140) + (random01(`${key}:flower-hue`) - 0.5) * 18);
  return child;
}

function animalPath(m) {
  const l = m.bodyLength;
  const w = m.bodyWidth;
  const h = m.headScale;
  const limb = m.limbLength;
  const tail = m.tailLength;
  const horn = m.ornament;
  return [
    `M ${-1.05 * l} ${-0.18 * w}`,
    `L ${-1.05 * l - 0.75 * tail} 0`,
    `L ${-1.02 * l} ${0.18 * w}`,
    `L ${-0.45 * l} ${0.58 * w}`,
    `L ${-0.18 * l} ${0.58 * w + 0.52 * limb}`,
    `L ${0.02 * l} ${0.55 * w}`,
    `L ${0.45 * l} ${0.53 * w}`,
    `L ${0.62 * l} ${0.53 * w + 0.48 * limb}`,
    `L ${0.75 * l} ${0.36 * w}`,
    `L ${1.0 * l + 0.42 * h} ${0.24 * w}`,
    `L ${1.08 * l + 0.48 * h} 0`,
    `L ${1.0 * l + 0.28 * h} ${-0.28 * w}`,
    `L ${0.58 * l} ${-0.46 * w}`,
    `L ${0.35 * l} ${-0.5 * w - horn * 0.5}`,
    `L ${0.1 * l} ${-0.53 * w}`,
    `L ${-0.18 * l} ${-0.54 * w - 0.5 * limb}`,
    `L ${-0.45 * l} ${-0.52 * w}`,
    'Z',
  ].join(' ');
}

function markingPath(m) {
  if (m.pattern === 0) return 'M -0.45 -0.2 L 0.45 -0.2 L 0.45 0.2 L -0.45 0.2 Z';
  if (m.pattern === 1) return 'M -0.6 -0.35 L -0.38 -0.35 L 0.25 0.35 L 0.03 0.35 Z M 0.12 -0.35 L 0.34 -0.35 L 0.76 0.2 L 0.54 0.2 Z';
  if (m.pattern === 2) return 'M -0.38 0 A 0.16 0.16 0 1 0 -0.06 0 A 0.16 0.16 0 1 0 -0.38 0 M 0.2 -0.12 A 0.13 0.13 0 1 0 0.46 -0.12 A 0.13 0.13 0 1 0 0.2 -0.12';
  return 'M -0.65 0 L -0.28 -0.3 L 0.1 0 L 0.48 -0.3 L 0.74 0 L 0.42 0.3 L 0.06 0 L -0.3 0.3 Z';
}

function plantBranchPath(dna) {
  const count = Math.max(2, Math.min(8, Math.round(dna.branchCount || 3)));
  const height = 1.25 * (dna.height || 1);
  let d = `M 0 0 Q ${dna.lean * 0.35} ${-height * 0.5} ${dna.lean} ${-height}`;
  for (let i = 0; i < count; i++) {
    const t = (i + 1) / (count + 1);
    const y = -height * (0.25 + t * 0.7);
    const direction = i % 2 ? 1 : -1;
    const spread = (0.35 + t * 0.45) * dna.branchAngle * direction;
    const curve = dna.curvature * direction;
    d += ` M ${dna.lean * t} ${y} Q ${spread * 0.55} ${y - 0.22 - Math.abs(curve) * 0.18} ${spread} ${y - 0.38}`;
  }
  return d;
}

function createAnimalNode() {
  const group = document.createElementNS(SVG_NS, 'g');
  const body = document.createElementNS(SVG_NS, 'path');
  const marking = document.createElementNS(SVG_NS, 'path');
  body.setAttribute('stroke-linejoin', 'round');
  marking.setAttribute('pointer-events', 'none');
  group.append(body, marking);
  return { group, body, marking, signature: '' };
}

function createPlantNode() {
  const group = document.createElementNS(SVG_NS, 'g');
  const branches = document.createElementNS(SVG_NS, 'path');
  const canopy = document.createElementNS(SVG_NS, 'ellipse');
  const flower = document.createElementNS(SVG_NS, 'circle');
  branches.setAttribute('fill', 'none');
  branches.setAttribute('stroke-linecap', 'round');
  group.append(branches, canopy, flower);
  return { group, branches, canopy, flower, signature: '' };
}

async function installMorphologyGenetics() {
  try {
    await window.realitySandboxReady;
  } catch {
    return;
  }

  const runtime = window.realitySandboxUnified;
  const planet = window.realitySandboxPlanet;
  const world = planet?.world;
  const biosphere = planet?.biosphere;
  const sourceCanvas = document.getElementById('lofiLivingCanvas');
  const host = sourceCanvas?.parentElement;
  if (!runtime?.render || !runtime?.getCamera || !world || !biosphere || !sourceCanvas || !host) return;
  if (runtime.__morphologyGeneticsInstalled) return;

  const seed = world.seed || window.realitySandboxSeed?.seed || 'nysa';
  const c = world.ecs.components;
  const animalNodes = new Map();
  const plantNodes = new Map();
  const initialAnimalIds = new Set([...c.agent.keys(), ...c.predator.keys(), ...c.apex.keys()]);
  const initialPlantIds = new Set(c.resource.keys());
  const mobile = matchMedia('(max-width: 720px), (pointer: coarse)').matches;
  const maxAnimals = mobile ? 90 : 180;
  const maxPlants = mobile ? 100 : 190;

  const overlay = document.createElementNS(SVG_NS, 'svg');
  overlay.id = 'morphologyOverlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.setAttribute('preserveAspectRatio', 'none');
  Object.assign(overlay.style, {
    position: 'absolute',
    zIndex: '3',
    pointerEvents: 'none',
    overflow: 'hidden',
  });
  host.insertBefore(overlay, sourceCanvas.nextSibling);

  function syncOverlay() {
    overlay.setAttribute('viewBox', `0 0 ${Math.max(1, sourceCanvas.width)} ${Math.max(1, sourceCanvas.height)}`);
    for (const property of ['inset', 'left', 'top', 'right', 'bottom', 'width', 'height', 'transform', 'transformOrigin']) {
      overlay.style[property] = sourceCanvas.style[property] || '';
    }
  }

  function nearestAnimalParent(id, guild) {
    const pos = c.position.get(id);
    const organism = organismFor(world, id);
    if (!pos || !organism) return null;
    let best = null;
    let bestDistance = ANIMAL_PARENT_RADIUS;
    for (const [otherId, otherPos] of c.position) {
      if (otherId === id || animalGuild(world, otherId) !== guild) continue;
      const other = organismFor(world, otherId);
      const morph = other?.dna?.morphology;
      if (!other || !morph || (other.age || 0) <= (organism.age || 0) + 0.5) continue;
      const distance = toroidalDistance(pos, otherPos, world.width);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = morph;
      }
    }
    return best;
  }

  function nearestPlantParent(id, kind) {
    const pos = c.position.get(id);
    if (!pos) return null;
    let best = null;
    let bestDistance = PLANT_PARENT_RADIUS;
    for (const [otherId, other] of c.resource) {
      if (otherId === id || other.kind !== kind || !other.dna?.morphologyVersion) continue;
      const otherPos = c.position.get(otherId);
      if (!otherPos) continue;
      const distance = toroidalDistance(pos, otherPos, world.width);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = other.dna;
      }
    }
    return best;
  }

  function ensureAnimalGenetics(id) {
    const organism = organismFor(world, id);
    const guild = animalGuild(world, id);
    if (!organism || !guild) return null;
    const dna = organism.dna || (organism.dna = {});
    const species = biosphere.getSpeciesForEntity(id);
    if (!dna.morphology) {
      const parent = initialAnimalIds.has(id) ? null : nearestAnimalParent(id, guild);
      dna.morphology = parent
        ? inheritedAnimalMorphology(seed, id, parent, species)
        : founderAnimalMorphology(seed, id, organism, guild, species);
    }
    dna.morphology = applySpeciationShift(seed, id, dna.morphology, species);
    return dna.morphology;
  }

  function ensurePlantGenetics(id, resource) {
    if (!resource) return null;
    if (!resource.dna?.morphologyVersion) {
      const parent = initialPlantIds.has(id) ? null : nearestPlantParent(id, resource.kind);
      if (parent) inheritPlantDna(seed, id, resource, parent);
      else founderPlantDna(seed, id, resource);
    }
    return resource.dna;
  }

  function initializeFounders() {
    for (const id of initialAnimalIds) ensureAnimalGenetics(id);
    for (const id of initialPlantIds) ensurePlantGenetics(id, c.resource.get(id));
  }

  function project(worldX, worldY, camera, width, height) {
    const radius = Math.min(width, height) * (mobile ? 0.42 : 0.43) * camera.zoom;
    const cx = width * 0.5;
    const cy = height * 0.5;
    const lon = (worldX / world.width - 0.5) * TAU;
    const lat = (0.5 - worldY / world.height) * Math.PI;
    const lon0 = (camera.centerX - 0.5) * TAU;
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

  function animalSignature(m) {
    return [m.bodyLength, m.bodyWidth, m.headScale, m.limbLength, m.tailLength, m.ornament, m.pattern, m.pigmentHue, m.pigmentSaturation, m.pigmentLightness]
      .map(value => typeof value === 'number' ? value.toFixed(3) : value).join('|');
  }

  function updateAnimalNode(id, point, organism, morph, camera) {
    let node = animalNodes.get(id);
    if (!node) {
      node = createAnimalNode();
      animalNodes.set(id, node);
      overlay.appendChild(node.group);
    }
    const signature = animalSignature(morph);
    if (node.signature !== signature) {
      node.signature = signature;
      node.body.setAttribute('d', animalPath(morph));
      node.marking.setAttribute('d', markingPath(morph));
      const bodyColor = hslColor(morph.pigmentHue, morph.pigmentSaturation, morph.pigmentLightness);
      const markColor = hslColor(morph.pigmentHue + 145, clamp(morph.pigmentSaturation * 0.75, 20, 100), clamp(morph.pigmentLightness + (morph.pattern % 2 ? 18 : -18), 18, 82));
      node.body.setAttribute('fill', bodyColor);
      node.body.setAttribute('stroke', hslColor(morph.pigmentHue, morph.pigmentSaturation * 0.55, morph.pigmentLightness * 0.55));
      node.body.setAttribute('stroke-width', '0.12');
      node.marking.setAttribute('fill', markColor);
      node.marking.setAttribute('opacity', '0.62');
    }
    const velocity = c.velocity.get(id) || { vx: 1, vy: 0 };
    const angle = Math.atan2(velocity.vy, velocity.vx) * 180 / Math.PI;
    const guild = animalGuild(world, id);
    const guildScale = guild === 'grazer' ? 2.0 : guild === 'predator' ? 2.45 : 3.05;
    const scale = guildScale * clamp(Math.sqrt(camera.zoom), 0.85, 3.3) * clamp(0.58 + point.depth * 0.6, 0.55, 1.18);
    node.group.setAttribute('transform', `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) rotate(${angle.toFixed(1)}) scale(${scale.toFixed(2)})`);
    node.group.setAttribute('opacity', String(clamp(0.38 + point.depth * 0.72, 0.35, 1)));
    node.group.style.display = '';
  }

  function plantSignature(dna) {
    return [dna.branchCount, dna.branchAngle, dna.curvature, dna.thickness, dna.lean, dna.height, dna.canopy, dna.leafAspect, dna.hue, dna.saturation, dna.lightness, dna.flower, dna.flowerHue]
      .map(value => typeof value === 'number' ? value.toFixed(3) : value).join('|');
  }

  function updatePlantNode(id, point, resource, dna, camera) {
    let node = plantNodes.get(id);
    if (!node) {
      node = createPlantNode();
      plantNodes.set(id, node);
      overlay.appendChild(node.group);
    }
    const signature = plantSignature(dna);
    if (node.signature !== signature) {
      node.signature = signature;
      node.branches.setAttribute('d', plantBranchPath(dna));
      node.branches.setAttribute('stroke', hslColor(dna.hue - 18, dna.saturation * 0.62, dna.lightness * 0.6));
      node.branches.setAttribute('stroke-width', String(0.16 + dna.thickness * 0.17));
      node.canopy.setAttribute('cx', String(dna.lean));
      node.canopy.setAttribute('cy', String(-1.28 * dna.height));
      node.canopy.setAttribute('rx', String(0.55 * dna.canopy * dna.leafAspect));
      node.canopy.setAttribute('ry', String(0.48 * dna.canopy / Math.sqrt(dna.leafAspect)));
      node.canopy.setAttribute('fill', hslColor(dna.hue, dna.saturation, dna.lightness));
      node.canopy.setAttribute('stroke', hslColor(dna.hue - 14, dna.saturation * 0.6, dna.lightness * 0.64));
      node.canopy.setAttribute('stroke-width', '0.1');
      node.flower.setAttribute('cx', String(dna.lean + 0.18));
      node.flower.setAttribute('cy', String(-1.42 * dna.height));
      node.flower.setAttribute('r', String(0.08 + dna.flower * 0.18));
      node.flower.setAttribute('fill', hslColor(dna.flowerHue, 82, 62));
      node.flower.setAttribute('opacity', String(clamp(dna.flower * 1.2, 0, 1)));
    }
    const growth = clamp(0.38 + (resource.amount || 0) * 0.62, 0.3, 1);
    const scale = (1.65 + dna.height * 0.55) * clamp(Math.sqrt(camera.zoom), 0.8, 3) * growth * clamp(0.58 + point.depth * 0.55, 0.5, 1.12);
    node.group.setAttribute('transform', `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) scale(${scale.toFixed(2)})`);
    node.group.setAttribute('opacity', String(clamp((resource.amount || 0) * (0.35 + point.depth * 0.72), 0.16, 1)));
    node.group.style.display = '';
  }

  function updateOverlay() {
    syncOverlay();
    if (sourceCanvas.dataset.dragging === 'true') {
      overlay.style.display = 'none';
      return;
    }
    overlay.style.display = 'block';
    const width = Math.max(1, sourceCanvas.width);
    const height = Math.max(1, sourceCanvas.height);
    const camera = runtime.getCamera();
    const seenAnimals = new Set();
    const seenPlants = new Set();

    let animalCount = 0;
    for (const [id, position] of c.position) {
      const organism = organismFor(world, id);
      if (!organism || animalCount >= maxAnimals) continue;
      const point = project(position.x, position.y, camera, width, height);
      if (!point.visible) continue;
      const morph = ensureAnimalGenetics(id);
      if (!morph) continue;
      updateAnimalNode(id, point, organism, morph, camera);
      seenAnimals.add(id);
      animalCount += 1;
    }

    let plantCount = 0;
    for (const [id, resource] of c.resource) {
      if ((resource.amount || 0) <= 0.02 || plantCount >= maxPlants) continue;
      const position = c.position.get(id);
      if (!position) continue;
      const point = project(position.x, position.y, camera, width, height);
      if (!point.visible) continue;
      const dna = ensurePlantGenetics(id, resource);
      if (!dna) continue;
      updatePlantNode(id, point, resource, dna, camera);
      seenPlants.add(id);
      plantCount += 1;
    }

    for (const [id, node] of animalNodes) {
      if (!c.position.has(id)) {
        node.group.remove();
        animalNodes.delete(id);
      } else if (!seenAnimals.has(id)) node.group.style.display = 'none';
    }
    for (const [id, node] of plantNodes) {
      if (!c.position.has(id) || !c.resource.has(id)) {
        node.group.remove();
        plantNodes.delete(id);
      } else if (!seenPlants.has(id)) node.group.style.display = 'none';
    }
  }

  initializeFounders();
  syncOverlay();

  const originalRender = runtime.render.bind(runtime);
  runtime.render = frame => {
    const result = originalRender(frame);
    updateOverlay();
    return result;
  };

  runtime.__morphologyGeneticsInstalled = true;
  window.realitySandboxMorphology = {
    stats() {
      const animals = [...c.agent.keys(), ...c.predator.keys(), ...c.apex.keys()];
      const plants = [...c.resource.keys()];
      return {
        animals: animals.length,
        animalsWithMorphology: animals.filter(id => Boolean(organismFor(world, id)?.dna?.morphology)).length,
        plants: plants.length,
        plantsWithMorphology: plants.filter(id => Boolean(c.resource.get(id)?.dna?.morphologyVersion)).length,
      };
    },
    animalGenes(id) { return organismFor(world, id)?.dna?.morphology || null; },
    plantGenes(id) { return c.resource.get(id)?.dna || null; },
  };

  updateOverlay();
}

document.addEventListener('DOMContentLoaded', installMorphologyGenetics, { once: true });
