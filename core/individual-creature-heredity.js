const SVG_NS = 'http://www.w3.org/2000/svg';
const STYLE_ID = 'eidolonIndividualCreatureHeredityStyles';
const GRID_SIZE = 12;
const PIXEL_COUNT = GRID_SIZE * GRID_SIZE;
const RENDER_MS = 90;
const COSMIC_ZOOM_THRESHOLD = 0.68;

async function start() {
  try {
    if (window.realitySandboxReady) await window.realitySandboxReady;
    const planet = window.realitySandboxPlanet;
    const runtime = window.realitySandboxUnified;
    const canvas = document.getElementById('lofiLivingCanvas');
    if (!planet?.world?.ecs || !planet?.biosphere || !planet?.lineageFoundry || !runtime || !canvas) return;

    installStyles();
    const heredity = installIndividualHeredity({
      world: planet.world,
      biosphere: planet.biosphere,
      foundry: planet.lineageFoundry,
    });
    const overlay = installIndividualSpriteOverlay({
      world: planet.world,
      biosphere: planet.biosphere,
      runtime,
      canvas,
    });

    const api = {
      ...heredity,
      overlay,
      getSnapshot() {
        return {
          ...heredity.getSnapshot(),
          overlay: overlay.getSnapshot(),
        };
      },
      destroy() {
        heredity.destroy();
        overlay.destroy();
      },
    };

    planet.individualCreatureHeredity = api;
    window.realitySandboxIndividualCreatureHeredity = api;
    window.dispatchEvent(new CustomEvent('eidolon-individual-heredity-ready', {
      detail: api.getSnapshot(),
    }));
    window.addEventListener('pagehide', api.destroy, { once: true });
  } catch (error) {
    console.warn('[individual-creature-heredity] disabled:', error);
  }
}

export function installIndividualHeredity({ world, biosphere, foundry }) {
  const originalStep = world.step;
  if (typeof originalStep !== 'function') return emptyHeredity();

  const known = new Set();
  let birthsTracked = 0;
  let inheritedGenomes = 0;
  let mutatedBirths = 0;
  let genomeMutations = 0;
  let parentConfidenceTotal = 0;
  let parentConfidenceSamples = 0;
  let lastBirth = null;

  seedMissingCustomGenomes();
  rememberCurrent();

  function wrappedStep(dt) {
    seedMissingCustomGenomes();
    const before = snapshotParents();
    originalStep.call(world, dt);
    const births = detectBirths(before);
    for (const birth of births) inheritBirthGenome(birth, before);
    rememberCurrent();
  }

  world.step = wrappedStep;

  function seedMissingCustomGenomes() {
    const visuals = capsuleVisuals(foundry);
    const c = world.ecs.components;

    for (const [id, organism] of organisms(c)) {
      if (normalizeGenome(organism.visualGenome)) continue;
      const species = biosphere.getSpeciesForEntity?.(id);
      const lineageId = organism.lineageCapsuleId || species?.lineageCapsuleId;
      const sprite = normalizeSprite(visuals.get(lineageId)?.sprite);
      if (!sprite) continue;
      organism.lineageCapsuleId = lineageId;
      organism.visualGenome = {
        sprite,
        generation: 0,
        lineageId,
        ancestorEntityId: id,
        parentEntityId: null,
        birthTick: world.tick,
        mutations: 0,
      };
      inheritedGenomes += 1;
    }
  }

  function snapshotParents() {
    const parents = [];
    const c = world.ecs.components;

    for (const [id, organism, guild] of organisms(c)) {
      const position = c.position.get(id);
      if (!position) continue;
      const species = biosphere.getSpeciesForEntity?.(id);
      parents.push({
        id,
        guild,
        x: position.x,
        y: position.y,
        dna: copyDna(organism.dna),
        speciesId: species?.id || organism.speciesId || null,
        lineageId: organism.lineageCapsuleId || species?.lineageCapsuleId || null,
        visualGenome: cloneGenome(organism.visualGenome),
      });
    }
    return parents;
  }

  function detectBirths(before) {
    const c = world.ecs.components;
    const beforeIds = new Set(before.map(parent => parent.id));
    const births = [];
    for (const [id, organism, guild] of organisms(c)) {
      if (beforeIds.has(id) || known.has(id)) continue;
      const position = c.position.get(id);
      if (!position) continue;
      births.push({ id, organism, guild, position });
    }
    return births;
  }

  function inheritBirthGenome(birth, parents) {
    birthsTracked += 1;
    const candidates = parents
      .filter(parent => parent.guild === birth.guild)
      .map(parent => ({
        parent,
        score: parentScore(parent, birth),
      }))
      .filter(item => item.score < 1.25)
      .sort((a, b) => a.score - b.score);

    const best = candidates[0];
    if (!best) {
      lastBirth = {
        childId: birth.id,
        tick: world.tick,
        guild: birth.guild,
        inherited: false,
      };
      return;
    }

    const parent = best.parent;
    const confidence = clamp(1 - best.score / 1.25, 0, 1);
    parentConfidenceTotal += confidence;
    parentConfidenceSamples += 1;

    birth.organism.parentEntityId = parent.id;
    birth.organism.birthTick = world.tick;
    if (parent.lineageId) birth.organism.lineageCapsuleId = parent.lineageId;

    const parentGenome = normalizeGenome(parent.visualGenome);
    if (!parentGenome) {
      lastBirth = {
        childId: birth.id,
        parentId: parent.id,
        tick: world.tick,
        guild: birth.guild,
        confidence: round(confidence),
        inherited: false,
      };
      return;
    }

    const result = inheritAndMutateGenome({
      parentGenome,
      parentDna: parent.dna,
      childDna: birth.organism.dna,
      climateStress: birth.organism.climateStress,
      key: `${world.seed || 'eidolon'}|${world.tick}|${parent.id}|${birth.id}`,
    });

    birth.organism.visualGenome = {
      sprite: result.sprite,
      generation: Math.max(0, finite(parentGenome.generation)) + 1,
      lineageId: parentGenome.lineageId || parent.lineageId || null,
      ancestorEntityId: parentGenome.ancestorEntityId ?? parent.id,
      parentEntityId: parent.id,
      birthTick: world.tick,
      mutations: Math.max(0, finite(parentGenome.mutations)) + result.mutations,
    };

    inheritedGenomes += 1;
    if (result.mutations > 0) {
      mutatedBirths += 1;
      genomeMutations += result.mutations;
    }

    lastBirth = {
      childId: birth.id,
      parentId: parent.id,
      tick: world.tick,
      guild: birth.guild,
      confidence: round(confidence),
      inherited: true,
      mutations: result.mutations,
      visualGeneration: birth.organism.visualGenome.generation,
    };
  }

  function parentScore(parent, birth) {
    const spatial = sphericalDistance(
      { x: parent.x, y: parent.y },
      birth.position,
      world.width,
    );
    const spatialScore = clamp(spatial / 18, 0, 2);
    const geneticScore = dnaDistance(parent.dna, birth.organism.dna);
    return spatialScore * 0.78 + geneticScore * 0.22;
  }

  function rememberCurrent() {
    known.clear();
    const c = world.ecs.components;
    for (const [id] of organisms(c)) known.add(id);
  }

  function getSnapshot() {
    const c = world.ecs.components;
    let visualGenomes = 0;
    let maxVisualGeneration = 0;
    let maxMutations = 0;
    const lineages = new Set();

    for (const [, organism] of organisms(c)) {
      const genome = normalizeGenome(organism.visualGenome);
      if (!genome) continue;
      visualGenomes += 1;
      maxVisualGeneration = Math.max(maxVisualGeneration, finite(genome.generation));
      maxMutations = Math.max(maxMutations, finite(genome.mutations));
      if (genome.lineageId) lineages.add(genome.lineageId);
    }

    return {
      version: 1,
      model: 'individual-parent-offspring-visual-heredity',
      birthsTracked,
      inheritedGenomes,
      mutatedBirths,
      genomeMutations,
      livingVisualGenomes: visualGenomes,
      representedLineages: lineages.size,
      maxVisualGeneration,
      maxAccumulatedMutations: maxMutations,
      meanParentConfidence: parentConfidenceSamples
        ? round(parentConfidenceTotal / parentConfidenceSamples)
        : null,
      lastBirth,
      populationCap: null,
    };
  }

  function destroy() {
    if (world.step === wrappedStep) world.step = originalStep;
  }

  return { getSnapshot, seedMissingCustomGenomes, destroy };
}

export function inheritAndMutateGenome({
  parentGenome,
  parentDna,
  childDna,
  climateStress = 0,
  key = 'birth',
}) {
  const normalized = normalizeGenome(parentGenome);
  if (!normalized) return { sprite: null, mutations: 0, pressure: 0 };

  const traitShift = dnaDistance(parentDna, childDna);
  const pressure = clamp(
    0.07 + traitShift * 0.58 + clamp(finite(climateStress), 0, 1) * 0.10,
    0.07,
    0.42,
  );
  const random = seededRandom(hashText(key));
  const pixels = normalized.sprite.pixels.split('');
  let mutations = 0;

  if (random() < pressure) {
    mutateOnePixel(pixels, random);
    mutations += 1;
  }
  if (random() < pressure * 0.22) {
    mutateOnePixel(pixels, random);
    mutations += 1;
  }

  if (!pixels.some(pixel => pixel === '1' || pixel === '2')) {
    const fallback = normalized.sprite.pixels.split('');
    pixels.splice(0, pixels.length, ...fallback);
    mutations = 0;
  }

  return {
    sprite: { width: GRID_SIZE, height: GRID_SIZE, pixels: pixels.join('') },
    mutations,
    pressure: round(pressure),
  };
}

function mutateOnePixel(pixels, random) {
  const occupied = [];
  const frontier = [];

  for (let index = 0; index < pixels.length; index += 1) {
    if (pixels[index] !== '0') occupied.push(index);
    else if (hasOccupiedNeighbor(pixels, index)) frontier.push(index);
  }

  const mode = random();
  if (mode < 0.46 && frontier.length) {
    const index = frontier[Math.floor(random() * frontier.length)];
    pixels[index] = random() < 0.78 ? '1' : '2';
  } else if (mode < 0.82 && occupied.length) {
    const index = occupied[Math.floor(random() * occupied.length)];
    pixels[index] = pixels[index] === '1' ? '2' : '1';
  } else if (occupied.length > 3) {
    const index = occupied[Math.floor(random() * occupied.length)];
    pixels[index] = '0';
  }
}

function hasOccupiedNeighbor(pixels, index) {
  const x = index % GRID_SIZE;
  const y = Math.floor(index / GRID_SIZE);
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) continue;
      if (pixels[ny * GRID_SIZE + nx] !== '0') return true;
    }
  }
  return false;
}

export function installIndividualSpriteOverlay({ world, biosphere, runtime, canvas }) {
  const host = document.getElementById('world') || canvas.parentElement || document.body;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('eidolon-individual-sprites');
  svg.setAttribute('aria-hidden', 'true');
  host.append(svg);

  const mobile = matchMedia('(max-width: 720px), (pointer: coarse)').matches;
  let timer = 0;
  let rendered = 0;
  let variants = 0;
  let lastRenderAt = 0;

  function render() {
    if (document.hidden) return;
    const camera = runtime.getCamera?.();
    const rect = canvas.getBoundingClientRect();

    if (!camera || !rect.width || !rect.height || finite(camera.zoom) < COSMIC_ZOOM_THRESHOLD) {
      svg.replaceChildren();
      rendered = 0;
      variants = 0;
      return;
    }

    const hostRect = host.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    svg.style.left = `${rect.left - hostRect.left}px`;
    svg.style.top = `${rect.top - hostRect.top}px`;
    svg.style.width = `${rect.width}px`;
    svg.style.height = `${rect.height}px`;

    const frame = projectionFrame(canvas, rect, mobile);
    const c = world.ecs.components;
    const nodes = [];
    const variantKeys = new Set();

    for (const [id, organism, guild] of organisms(c)) {
      const genome = normalizeGenome(organism.visualGenome);
      if (!genome) continue;
      const position = c.position.get(id);
      if (!position) continue;

      const point = projectToOverlay(
        position.x / world.width,
        position.y / world.height,
        frame,
        camera,
      );
      if (!point.visible) continue;

      const velocity = c.velocity.get(id) || { vx: 0, vy: 0 };
      const ahead = projectToOverlay(
        wrap01((position.x + finite(velocity.vx) * 0.7) / world.width),
        clamp((position.y + finite(velocity.vy) * 0.7) / world.height, 0, 1),
        frame,
        camera,
      );
      const heading = ahead.visible ? Math.atan2(ahead.y - point.y, ahead.x - point.x) : 0;

      const species = biosphere.getSpeciesForEntity?.(id);
      const roleScale = guild === 'apex' ? 1.45 : guild === 'predator' ? 1.2 : 1;
      const dna = organism.dna || {};
      const length = clamp(0.9 + finite(dna.speed, 1) * 0.25, 0.95, 1.55) * roleScale;
      const width = clamp(1.25 - finite(dna.metabolism, 1) * 0.2, 0.75, 1.25) * roleScale;
      const colorValue = species?.color ?? hueToRgb(organism.colorHue ?? 200);
      const color = cssHex(colorValue);
      const accent = cssHex(shiftColor(colorValue, (hashText(species?.id || id) % 31) - 15));

      nodes.push(spriteNode(
        point,
        heading,
        genome.sprite,
        color,
        accent,
        length,
        width,
        camera.zoom,
        finite(organism.infected) > 0,
      ));
      variantKeys.add(genome.sprite.pixels);
    }

    svg.replaceChildren(...nodes);
    rendered = nodes.length;
    variants = variantKeys.size;
    lastRenderAt = performance.now();
  }

  timer = window.setInterval(render, RENDER_MS);
  render();

  function getSnapshot() {
    return {
      version: 1,
      renderer: 'individual-heritable-pixel-genomes',
      rendered,
      visibleVariants: variants,
      lastRenderAt,
      grid: `${GRID_SIZE}x${GRID_SIZE}`,
      projection: 'pixi-backing-space-mapped-to-css',
      displayCap: null,
    };
  }

  function destroy() {
    if (timer) clearInterval(timer);
    timer = 0;
    svg.remove();
  }

  return { render, getSnapshot, destroy };
}

function organisms(components) {
  const rows = [];
  for (const [id, organism] of components.agent || []) rows.push([id, organism, 'grazer']);
  for (const [id, organism] of components.predator || []) rows.push([id, organism, 'predator']);
  for (const [id, organism] of components.apex || []) rows.push([id, organism, 'apex']);
  return rows;
}

function capsuleVisuals(foundry) {
  return new Map((foundry.list?.() || []).map(capsule => [capsule.id, capsule.visual || {}]));
}

function normalizeGenome(input) {
  if (!input || typeof input !== 'object') return null;
  const sprite = normalizeSprite(input.sprite);
  if (!sprite) return null;
  return {
    ...input,
    sprite,
    generation: Math.max(0, finite(input.generation)),
    mutations: Math.max(0, finite(input.mutations)),
  };
}

function cloneGenome(input) {
  const genome = normalizeGenome(input);
  return genome ? JSON.parse(JSON.stringify(genome)) : null;
}

function normalizeSprite(input) {
  if (!input || finite(input.width) !== GRID_SIZE || finite(input.height) !== GRID_SIZE) return null;
  const pixels = String(input.pixels || '').replace(/[^012]/g, '').slice(0, PIXEL_COUNT);
  if (pixels.length !== PIXEL_COUNT || !/[12]/.test(pixels)) return null;
  return { width: GRID_SIZE, height: GRID_SIZE, pixels };
}

function copyDna(input) {
  return {
    speed: finite(input?.speed, 1),
    sense: finite(input?.sense, 1),
    metabolism: finite(input?.metabolism, 1),
    hueShift: finite(input?.hueShift, 0),
  };
}

function dnaDistance(a, b) {
  const speed = Math.abs(finite(a?.speed, 1) - finite(b?.speed, 1)) / 0.8;
  const sense = Math.abs(finite(a?.sense, 1) - finite(b?.sense, 1)) / 0.9;
  const metabolism = Math.abs(finite(a?.metabolism, 1) - finite(b?.metabolism, 1)) / 1.0;
  const hue = Math.abs(finite(a?.hueShift, 0) - finite(b?.hueShift, 0)) / 120;
  return clamp((speed + sense + metabolism + hue * 0.35) / 3.35, 0, 1);
}

function sphericalDistance(a, b, width) {
  const raw = Math.abs(a.x - b.x);
  const dx = Math.min(raw, Math.max(0, width - raw));
  return Math.hypot(dx, a.y - b.y);
}

function spriteNode(point, heading, sprite, color, accent, length, width, zoom, infected) {
  const group = document.createElementNS(SVG_NS, 'g');
  const base = clamp(6.3 * Math.sqrt(Math.max(1, finite(zoom))), 6.3, 21);
  const sx = base * length * 1.65;
  const sy = base * width * 1.65;
  const cellW = sx / sprite.width;
  const cellH = sy / sprite.height;
  const left = -sx * 0.5;
  const top = -sy * 0.5;

  group.setAttribute(
    'transform',
    `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) rotate(${(heading * 180 / Math.PI).toFixed(2)})`,
  );
  group.setAttribute('opacity', clamp(0.45 + point.depth * 0.58, 0.35, 1).toFixed(3));

  for (let index = 0; index < sprite.pixels.length; index += 1) {
    const state = sprite.pixels[index];
    if (state === '0') continue;
    const x = index % sprite.width;
    const y = Math.floor(index / sprite.width);
    const cell = document.createElementNS(SVG_NS, 'rect');
    cell.setAttribute('x', left + x * cellW);
    cell.setAttribute('y', top + y * cellH);
    cell.setAttribute('width', cellW + 0.12);
    cell.setAttribute('height', cellH + 0.12);
    cell.setAttribute('fill', state === '2' ? accent : color);
    cell.setAttribute('shape-rendering', 'crispEdges');
    group.append(cell);
  }

  if (infected) {
    const ring = document.createElementNS(SVG_NS, 'ellipse');
    ring.setAttribute('cx', '0');
    ring.setAttribute('cy', '0');
    ring.setAttribute('rx', sx * 0.58);
    ring.setAttribute('ry', sy * 0.58);
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', '#e6ff76');
    ring.setAttribute('stroke-width', '1');
    ring.setAttribute('opacity', '.7');
    group.append(ring);
  }

  return group;
}

function projectionFrame(canvas, rect, mobile) {
  return {
    sourceWidth: Math.max(1, finite(canvas?.width) || finite(rect?.width) || 1),
    sourceHeight: Math.max(1, finite(canvas?.height) || finite(rect?.height) || 1),
    cssWidth: Math.max(1, finite(rect?.width) || 1),
    cssHeight: Math.max(1, finite(rect?.height) || 1),
    radiusScale: mobile ? 0.42 : 0.43,
  };
}

function projectToOverlay(worldX, worldY, frame, camera) {
  const source = project(
    worldX,
    worldY,
    frame.sourceWidth,
    frame.sourceHeight,
    camera,
    frame.radiusScale,
  );
  return {
    ...source,
    x: source.x / frame.sourceWidth * frame.cssWidth,
    y: source.y / frame.sourceHeight * frame.cssHeight,
  };
}

function project(worldX, worldY, width, height, camera, radiusScale) {
  const radius = Math.min(width, height) * radiusScale * finite(camera.zoom, 1);
  const cx = width * 0.5;
  const cy = height * 0.5;
  const lon = (worldX - 0.5) * Math.PI * 2;
  const lat = (0.5 - worldY) * Math.PI;
  const lon0 = (finite(camera.centerX, 0.5) - 0.5) * Math.PI * 2;
  const lat0 = (0.5 - finite(camera.centerY, 0.5)) * Math.PI;
  const delta = lon - lon0;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLat0 = Math.sin(lat0);
  const cosLat0 = Math.cos(lat0);
  const x = cosLat * Math.sin(delta);
  const y = sinLat * cosLat0 - cosLat * Math.cos(delta) * sinLat0;
  const z = sinLat * sinLat0 + cosLat * Math.cos(delta) * cosLat0;
  return {
    x: cx + x * radius,
    y: cy - y * radius,
    depth: z,
    visible: z > 0,
  };
}

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .eidolon-custom-sprites{display:none!important}
    .eidolon-individual-sprites{position:absolute;z-index:9;overflow:visible;pointer-events:none;contain:layout style paint}
  `;
  document.head.append(style);
}

function hueToRgb(hue) {
  const h = ((finite(hue) % 360) + 360) % 360;
  const c = 0.72;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = 0.16;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const [r, g, b] = rgb.map(value => Math.round((value + m) * 255));
  return (r << 16) | (g << 8) | b;
}

function shiftColor(color, amount) {
  const c = Number(color) || 0x69d8ff;
  const r = clamp(((c >> 16) & 255) + amount, 0, 255);
  const g = clamp(((c >> 8) & 255) + amount, 0, 255);
  const b = clamp((c & 255) - amount, 0, 255);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

function cssHex(value) {
  return `#${(Number(value) >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
}

function seededRandom(seed) {
  let state = seed >>> 0 || 0x9e3779b9;
  return function random() {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function hashText(value) {
  let hash = 2166136261;
  const text = String(value ?? '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function emptyHeredity() {
  return {
    getSnapshot: () => ({
      version: 1,
      model: 'individual-parent-offspring-visual-heredity',
      active: false,
    }),
    seedMissingCustomGenomes() {},
    destroy() {},
  };
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function round(value) {
  return Math.round(finite(value) * 1000) / 1000;
}

function wrap01(value) {
  return ((value % 1) + 1) % 1;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

start();
