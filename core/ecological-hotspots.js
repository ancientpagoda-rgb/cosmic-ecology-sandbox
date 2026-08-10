const STORAGE_PREFIX = 'eidolon-ecological-hotspots-v1';
const GRID_COLUMNS = 12;
const GRID_ROWS = 7;
const OBSERVATION_RADIUS = 118;
const MAX_ACTIVE_HOTSPOTS = 6;
const MAX_MEMORY = 32;
const RESCAN_TICKS = 120;
const MATCH_RADIUS = 170;

const TYPE_LABEL = Object.freeze({
  drought: 'drought front',
  flood: 'flood pulse',
  bloom: 'resource bloom',
  diversity: 'diversity refuge',
  predation: 'predator front',
  disease: 'disease cluster',
  lineage: 'lineage frontier',
});

const NAME_PREFIXES = Object.freeze({
  drought: ['Sunscar', 'Dryglass', 'Dustwake', 'Cinder'],
  flood: ['Highwater', 'Rainmirror', 'Tideglass', 'Floodwake'],
  bloom: ['Greenwake', 'Mosslight', 'Verdant', 'Bloom'],
  diversity: ['Wildweave', 'Manylife', 'Kinfield', 'Mosaic'],
  predation: ['Fangline', 'Hunter', 'Redtrail', 'Chase'],
  disease: ['Fever', 'Pale', 'Sickleaf', 'Ashen'],
  lineage: ['Newblood', 'Founder', 'Driftkin', 'Branch'],
});

function startWhenReady() {
  const start = async () => {
    try {
      if (window.realitySandboxReady) await window.realitySandboxReady;
      const planet = window.realitySandboxPlanet;
      const runtime = window.realitySandboxUnified;
      if (!planet?.world || !planet?.waterCycle || !planet?.living || !planet?.biosphere || !planet?.seasonalResources || !runtime) return;

      const detector = createEcologicalHotspotMemory({
        world: planet.world,
        waterCycle: planet.waterCycle,
        living: planet.living,
        biosphere: planet.biosphere,
        seasonalResources: planet.seasonalResources,
        ecologyJournal: planet.ecologyJournal,
        seed: window.realitySandboxSeed?.seed || planet.world.seed || 'eidolon',
      });

      planet.ecologicalHotspots = detector;
      window.realitySandboxEcologicalHotspots = detector;

      detector.scan({ initial: true });
      const ui = installHotspotUi(detector, runtime, planet.world);
      const overlay = installHotspotOverlay(detector, runtime, planet.world);
      ui.render();
      overlay.render();

      let lastScanTick = planet.world.tick;
      const interval = window.setInterval(() => {
        if (document.hidden) return;
        if (planet.world.tick - lastScanTick >= RESCAN_TICKS) {
          lastScanTick = planet.world.tick;
          detector.scan();
          ui.render();
        }
        overlay.render();
      }, 900);

      window.addEventListener('pagehide', () => {
        window.clearInterval(interval);
        overlay.destroy();
      }, { once: true });

      window.dispatchEvent(new CustomEvent('eidolon-hotspots-ready', {
        detail: { count: detector.getHotspots().length },
      }));
    } catch (error) {
      console.warn('[ecological-hotspots] disabled:', error);
    }
  };

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}

export function createEcologicalHotspotMemory({
  world,
  waterCycle,
  living,
  biosphere,
  seasonalResources,
  ecologyJournal,
  seed = 'eidolon',
}) {
  const storageKey = `${STORAGE_PREFIX}:${seed}`;
  const state = readState(storageKey);
  let active = [];
  let scanNumber = state.scanNumber || 0;

  function scan({ initial = false } = {}) {
    scanNumber += 1;
    const candidates = [];

    for (let row = 0; row < GRID_ROWS; row += 1) {
      for (let column = 0; column < GRID_COLUMNS; column += 1) {
        const x = (column + 0.5) / GRID_COLUMNS * world.width;
        const y = (row + 0.5) / GRID_ROWS * world.height;
        candidates.push(observeCell(x, y, column, row));
      }
    }

    active = chooseHotspots(candidates);
    const discoveries = remember(active);
    state.scanNumber = scanNumber;
    persist(storageKey, state);

    if (!initial) {
      for (const hotspot of discoveries) {
        ecologyJournal?.record?.(
          'Ecological hotspot discovered',
          `${hotspot.name} emerged as a ${TYPE_LABEL[hotspot.type]}. ${hotspot.description}`,
          'ecology',
        );
      }
    } else if (discoveries[0]) {
      ecologyJournal?.record?.(
        'Planet memory expanded',
        `${active.length} emergent ecological hotspots are now being tracked across Eidolon; ${discoveries[0].name} currently ranks highest.`,
        'ecology',
      );
    }

    return getHotspots();
  }

  function observeCell(x, y, column, row) {
    const water = waterCycle.sample(x, y) || {};
    const resource = seasonalResources.sample(x, y) || {};
    const terrain = living.sampleDynamicPlanet?.(x, y) || {};
    const nearbySpecies = biosphere.getNearbySpecies?.(x, y, OBSERVATION_RADIUS) || [];
    const animals = nearbySpecies.reduce((sum, species) => sum + finite(species.population), 0);
    const predators = nearbySpecies
      .filter(species => species.guild === 'predator' || species.guild === 'apex')
      .reduce((sum, species) => sum + finite(species.population), 0);
    const lineageAnimals = countLineageAnimals(x, y, OBSERVATION_RADIUS);
    const infected = countInfectedAnimals(x, y, OBSERVATION_RADIUS);
    const speciesRichness = nearbySpecies.length;

    const drought = clamp01(finite(water.drought));
    const flood = clamp01(finite(water.flood));
    const soil = clamp01(finite(water.soil));
    const rain = clamp01(finite(water.rain) * 8);
    const river = clamp01(finite(water.river));
    const surface = clamp01(finite(water.surface));
    const tide = clamp01(finite(water.tide));
    const delta = clamp01(finite(water.delta));
    const food = clamp01(finite(resource.food));
    const moisture = clamp01(finite(resource.moisture));
    const fertility = clamp01(finite(resource.fertility));
    const animalDensity = clamp01(animals / 9);
    const predatorDensity = clamp01(predators / 3);
    const predatorRatio = clamp01(predators / Math.max(1, animals));
    const richness = clamp01(speciesRichness / 4);
    const infectionRatio = clamp01(infected / Math.max(1, animals));
    const lineageDensity = clamp01(lineageAnimals / 5);

    const scores = {
      drought: drought * 0.44 + (1 - soil) * 0.28 + (1 - moisture) * 0.18 + (1 - food) * 0.10,
      flood: flood * 0.46 + surface * 0.18 + river * 0.16 + rain * 0.10 + delta * tide * 0.10,
      bloom: food * 0.38 + fertility * 0.28 + moisture * 0.18 + animalDensity * 0.10 + richness * 0.06,
      diversity: richness * 0.46 + animalDensity * 0.24 + food * 0.14 + fertility * 0.10 + moisture * 0.06,
      predation: predatorDensity * 0.40 + predatorRatio * 0.34 + animalDensity * 0.16 + richness * 0.10,
      disease: infectionRatio * 0.62 + clamp01(infected / 3) * 0.22 + animalDensity * 0.10 + drought * 0.06,
      lineage: lineageDensity * 0.58 + richness * 0.18 + animalDensity * 0.14 + food * 0.10,
    };

    const [type, score] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    const biome = String(terrain.biome || 'wildland');
    const name = makeName(type, biome, seed, column, row);

    const snapshot = {
      tick: world.tick,
      type,
      score: round(score),
      x: round(x),
      y: round(y),
      column,
      row,
      biome,
      animals,
      predators,
      infected,
      lineageAnimals,
      speciesRichness,
      species: nearbySpecies.slice(0, 4).map(species => ({
        id: species.id,
        name: species.name,
        guild: species.guild,
        population: species.population,
      })),
      water: {
        drought: round(drought),
        flood: round(flood),
        soil: round(soil),
        rain: round(rain),
        river: round(river),
        surface: round(surface),
        tide: round(tide),
        delta: round(delta),
      },
      resources: {
        food: round(food),
        moisture: round(moisture),
        fertility: round(fertility),
      },
    };

    return {
      id: `${type}:${column}:${row}`,
      name,
      ...snapshot,
      description: describe(snapshot),
    };
  }

  function chooseHotspots(candidates) {
    const ranked = [...candidates].sort((a, b) => b.score - a.score);
    const chosen = [];
    const typeCounts = new Map();

    for (const candidate of ranked) {
      const count = typeCounts.get(candidate.type) || 0;
      if (count >= 2) continue;
      if (chosen.some(existing => sphericalDistance(existing, candidate) < MATCH_RADIUS)) continue;
      chosen.push(candidate);
      typeCounts.set(candidate.type, count + 1);
      if (chosen.length >= MAX_ACTIVE_HOTSPOTS) break;
    }

    if (chosen.length < 3) {
      for (const candidate of ranked) {
        if (chosen.some(existing => existing.id === candidate.id)) continue;
        if (chosen.some(existing => sphericalDistance(existing, candidate) < MATCH_RADIUS * 0.72)) continue;
        chosen.push(candidate);
        if (chosen.length >= Math.min(3, MAX_ACTIVE_HOTSPOTS)) break;
      }
    }

    return chosen;
  }

  function remember(hotspots) {
    const discoveries = [];

    for (const hotspot of hotspots) {
      let memory = state.memory.find(item =>
        item.type === hotspot.type && sphericalDistance(item, hotspot) <= MATCH_RADIUS,
      );

      if (!memory) {
        memory = {
          id: `memory:${hotspot.type}:${hotspot.column}:${hotspot.row}:${scanNumber}`,
          type: hotspot.type,
          name: hotspot.name,
          x: hotspot.x,
          y: hotspot.y,
          biome: hotspot.biome,
          firstSeenTick: world.tick,
          lastSeenTick: world.tick,
          observations: 1,
          peakScore: hotspot.score,
          latest: clone(hotspot),
        };
        state.memory.unshift(memory);
        discoveries.push(hotspot);
      } else {
        memory.lastSeenTick = world.tick;
        memory.observations += 1;
        memory.peakScore = Math.max(memory.peakScore, hotspot.score);
        memory.x = hotspot.x;
        memory.y = hotspot.y;
        memory.biome = hotspot.biome;
        memory.latest = clone(hotspot);
      }
    }

    state.memory.sort((a, b) => b.lastSeenTick - a.lastSeenTick || b.peakScore - a.peakScore);
    state.memory.length = Math.min(state.memory.length, MAX_MEMORY);
    return discoveries;
  }

  function countInfectedAnimals(x, y, radius) {
    return countAnimalsMatching(x, y, radius, organism => finite(organism?.infected) > 0);
  }

  function countLineageAnimals(x, y, radius) {
    return countAnimalsMatching(x, y, radius, organism => Boolean(organism?.lineageCapsuleId));
  }

  function countAnimalsMatching(x, y, radius, predicate) {
    const components = world.ecs?.components || {};
    const position = components.position;
    if (!position) return 0;
    let count = 0;

    for (const group of [components.agent, components.predator, components.apex]) {
      for (const [id, organism] of group || []) {
        const pos = position.get(id);
        if (!pos || sphericalDistance(pos, { x, y }) > radius) continue;
        if (predicate(organism)) count += 1;
      }
    }
    return count;
  }

  function sphericalDistance(a, b) {
    const dx = Math.min(Math.abs(a.x - b.x), world.width - Math.abs(a.x - b.x));
    return Math.hypot(dx, a.y - b.y);
  }

  function getHotspots() {
    return active.map(clone);
  }

  function getMemory(limit = 12) {
    return state.memory.slice(0, Math.max(0, limit)).map(clone);
  }

  function getPrimary() {
    return active[0] ? clone(active[0]) : null;
  }

  function getSnapshot() {
    return {
      scanNumber,
      observationRadius: OBSERVATION_RADIUS,
      hotspots: getHotspots(),
      memory: getMemory(8),
    };
  }

  return { scan, getHotspots, getMemory, getPrimary, getSnapshot };
}

function installHotspotUi(detector, runtime, world) {
  const pulse = document.querySelector('.planet-pulse');
  const actions = pulse?.querySelector('.planet-pulse__actions');
  if (!pulse || !actions) return { render() {} };

  let details = pulse.querySelector('[data-hotspot-memory]');
  if (!details) {
    details = document.createElement('details');
    details.className = 'planet-pulse__memory planet-pulse__hotspots';
    details.dataset.hotspotMemory = '';
    details.innerHTML = '<summary>Emergent hotspots</summary><ol data-hotspot-list></ol>';
    pulse.insertBefore(details, actions);
  }

  let observe = actions.querySelector('[data-hotspot-observe]');
  if (!observe) {
    observe = document.createElement('button');
    observe.type = 'button';
    observe.dataset.hotspotObserve = '';
    actions.prepend(observe);
  }

  const list = details.querySelector('[data-hotspot-list]');
  observe.addEventListener('click', () => {
    const hotspot = detector.getPrimary();
    if (!hotspot) return;
    const current = runtime.getCamera?.() || {};
    runtime.setCamera?.({
      ...current,
      centerX: hotspot.x / world.width,
      centerY: hotspot.y / world.height,
      zoom: Math.max(2.25, finite(current.zoom) || 1),
    });
    runtime.updateInterface?.(true);
    observe.textContent = `Observing ${hotspot.name}`;
  });

  function render() {
    const hotspots = detector.getHotspots();
    const primary = hotspots[0];
    observe.disabled = !primary;
    observe.textContent = primary ? `Observe ${primary.name}` : 'No hotspot detected';
    list.replaceChildren(...hotspots.slice(0, 5).map(hotspot => {
      const item = document.createElement('li');
      const label = document.createElement('b');
      const text = document.createElement('span');
      label.textContent = TYPE_LABEL[hotspot.type] || hotspot.type;
      text.textContent = `${hotspot.name} · ${Math.round(hotspot.score * 100)}% signal`;
      item.append(label, text);
      item.title = hotspot.description;
      return item;
    }));
  }

  return { render };
}

function installHotspotOverlay(detector, runtime, world) {
  const host = document.getElementById('world');
  const canvas = document.getElementById('lofiLivingCanvas');
  if (!host || !canvas) return { render() {}, destroy() {} };

  const style = document.createElement('style');
  style.textContent = `
    .ecological-hotspot-overlay{position:absolute;inset:0;z-index:6;pointer-events:none;overflow:hidden}
    .ecological-hotspot-marker{position:absolute;width:12px;height:12px;border:1.5px solid currentColor;border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 0 0 3px color-mix(in srgb,currentColor 16%,transparent),0 0 18px color-mix(in srgb,currentColor 35%,transparent)}
    .ecological-hotspot-marker::after{content:"";position:absolute;inset:3px;border-radius:50%;background:currentColor;opacity:.9}
  `;
  document.head.append(style);

  const overlay = document.createElement('div');
  overlay.className = 'ecological-hotspot-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  host.append(overlay);

  const markerColors = {
    drought: '#d7a45d',
    flood: '#79bed7',
    bloom: '#9bd36d',
    diversity: '#d5cf7d',
    predation: '#e46f55',
    disease: '#c78caa',
    lineage: '#b493d4',
  };

  function render() {
    const hotspots = detector.getHotspots();
    const camera = runtime.getCamera?.();
    if (!camera || camera.zoom < 0.68) {
      overlay.replaceChildren();
      return;
    }

    const hostRect = host.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const width = canvasRect.width;
    const height = canvasRect.height;
    const mobile = matchMedia('(max-width: 720px), (pointer: coarse)').matches;

    overlay.replaceChildren(...hotspots.map(hotspot => {
      const projected = projectToSphere(
        hotspot.x / world.width,
        hotspot.y / world.height,
        width,
        height,
        camera,
        mobile,
      );
      const marker = document.createElement('span');
      marker.className = 'ecological-hotspot-marker';
      marker.title = `${hotspot.name}: ${hotspot.description}`;
      marker.style.color = markerColors[hotspot.type] || '#f4f0bd';
      marker.style.left = `${canvasRect.left - hostRect.left + projected.x}px`;
      marker.style.top = `${canvasRect.top - hostRect.top + projected.y}px`;
      marker.style.display = projected.visible ? 'block' : 'none';
      marker.style.opacity = String(clamp01(0.38 + projected.depth * 0.62));
      return marker;
    }));
  }

  function destroy() {
    overlay.remove();
    style.remove();
  }

  return { render, destroy };
}

function projectToSphere(worldX, worldY, width, height, camera, mobile) {
  const baseRadius = Math.min(width, height) * (mobile ? 0.42 : 0.43);
  const radius = baseRadius * camera.zoom;
  const cx = width * 0.5;
  const cy = height * 0.5;
  const lon = (worldX - 0.5) * Math.PI * 2;
  const lat = (0.5 - worldY) * Math.PI;
  const lon0 = (camera.centerX - 0.5) * Math.PI * 2;
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

function describe(snapshot) {
  if (snapshot.type === 'drought') {
    return `${snapshot.biome} water stress is high: drought ${pct(snapshot.water.drought)}, soil ${pct(snapshot.water.soil)}, forage ${pct(snapshot.resources.food)}.`;
  }
  if (snapshot.type === 'flood') {
    return `${snapshot.biome} water is concentrating here: flood ${pct(snapshot.water.flood)}, river ${pct(snapshot.water.river)}, surface water ${pct(snapshot.water.surface)}.`;
  }
  if (snapshot.type === 'bloom') {
    return `${snapshot.biome} productivity is elevated: forage ${pct(snapshot.resources.food)}, fertility ${pct(snapshot.resources.fertility)}, with ${snapshot.animals} nearby animals.`;
  }
  if (snapshot.type === 'diversity') {
    return `${snapshot.speciesRichness} animal lineages and ${snapshot.animals} individuals overlap in this ${snapshot.biome} region.`;
  }
  if (snapshot.type === 'predation') {
    return `${snapshot.predators} predators are concentrated among ${snapshot.animals} observed animals in this ${snapshot.biome} region.`;
  }
  if (snapshot.type === 'disease') {
    return `${snapshot.infected} of ${snapshot.animals} observed animals carry active infection in this ${snapshot.biome} region.`;
  }
  return `${snapshot.lineageAnimals} Foundry-lineage animals are persisting alongside ${snapshot.speciesRichness} tracked lineages in this ${snapshot.biome} region.`;
}

function makeName(type, biome, seed, column, row) {
  const prefixes = NAME_PREFIXES[type] || ['Wild'];
  const hash = hashText(`${seed}:${type}:${column}:${row}`);
  const prefix = prefixes[hash % prefixes.length];
  const biomeWord = biome
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();
  const suffixes = ['Reach', 'Basin', 'Verge', 'Mosaic', 'Shelf', 'Belt'];
  const suffix = suffixes[(hash >>> 5) % suffixes.length];
  return `${prefix} ${biomeWord || 'Wild'} ${suffix}`;
}

function readState(storageKey) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved && Array.isArray(saved.memory)) {
      return { scanNumber: Math.max(0, finite(saved.scanNumber)), memory: saved.memory.slice(0, MAX_MEMORY) };
    }
  } catch {
    // Browser storage is optional.
  }
  return { scanNumber: 0, memory: [] };
}

function persist(storageKey, state) {
  try {
    localStorage.setItem(storageKey, JSON.stringify({
      scanNumber: state.scanNumber,
      memory: state.memory.slice(0, MAX_MEMORY),
    }));
  } catch {
    // Discovery remains live when storage is unavailable.
  }
}

function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pct(value) {
  return `${Math.round(clamp01(finite(value)) * 100)}%`;
}

function round(value) {
  return Math.round(finite(value) * 1000) / 1000;
}

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, finite(value)));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

startWhenReady();
