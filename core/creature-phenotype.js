const FORMS = Object.freeze(['beetle','crawler','hopper','kite','glider','serpent','tripod','orb']);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;

function hashText(value) {
  let hash = 2166136261;
  const text = String(value ?? '');
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeForm(value) {
  const form = String(value || '').toLowerCase();
  return FORMS.includes(form) ? form : null;
}

function roleColor(role) {
  if (role === 'apex') return '#d86654';
  if (role === 'predator') return '#d99555';
  return '#6fbd7b';
}

function cssHex(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
      return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`.toLowerCase();
    }
  }
  if (Number.isFinite(Number(value))) {
    return `#${(Number(value) >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
  }
  return '#78b987';
}

function shiftColor(value, amount) {
  const hex = cssHex(value).slice(1);
  const n = parseInt(hex, 16);
  const r = clamp(((n >> 16) & 255) + amount, 0, 255);
  const g = clamp(((n >> 8) & 255) + amount, 0, 255);
  const b = clamp((n & 255) + amount, 0, 255);
  return `#${[r,g,b].map(v => Math.round(v).toString(16).padStart(2,'0')).join('')}`;
}

function normalizeSprite(sprite) {
  if (!sprite || typeof sprite !== 'object') return null;
  const width = Math.max(1, Math.min(24, Math.round(finite(sprite.width) || 12)));
  const height = Math.max(1, Math.min(24, Math.round(finite(sprite.height) || 12)));
  const pixels = String(sprite.pixels || '').replace(/[^012]/g, '');
  if (pixels.length !== width * height) return null;
  return Object.freeze({ width, height, pixels });
}

function spriteFor(organism, species) {
  return normalizeSprite(
    organism?.visualGenome?.sprite ||
    organism?.visualGenome?.visual?.sprite ||
    species?.visual?.sprite ||
    species?.sprite ||
    null
  );
}

export function phenotypeFor({ id, species, organism, role }) {
  const dna = organism?.dna || {};
  const speciesKey = species?.id || organism?.speciesId || `${role}:${id}`;
  const seed = hashText(speciesKey);
  const individual = hashText(`${speciesKey}:${id}`);
  const explicitForm = normalizeForm(species?.visualForm || species?.visual?.form || organism?.visualGenome?.form);
  const form = explicitForm || FORMS[seed % FORMS.length];
  const speed = clamp(finite(dna.speed) || 1, 0.45, 2);
  const sense = clamp(finite(dna.sense) || 1, 0.35, 2.1);
  const metabolism = clamp(finite(dna.metabolism) || 1, 0.4, 2.2);
  const generation = Math.max(0, finite(species?.generation));
  const baseScale = role === 'apex' ? 1.42 : role === 'predator' ? 1.18 : 1;
  const length = baseScale * clamp(0.88 + speed * 0.22 + (seed % 11) * 0.012, 0.95, 1.65);
  const width = baseScale * clamp(1.24 - metabolism * 0.22 + ((seed >>> 5) % 9) * 0.018, 0.72, 1.3);
  const eyes = sense > 1.28 ? 3 : sense < 0.78 ? 1 : 2;
  const legs = form === 'serpent' || form === 'orb' ? 0 : form === 'tripod' ? 3 : speed > 1.18 ? 6 : 4;
  const tail = role !== 'grazer' || speed > 1.12;
  const antennae = role === 'grazer' && sense > 0.95;
  const spikes = role === 'apex' ? 3 + (seed % 3) : role === 'predator' && generation > 0 ? 2 : 0;
  const baseColor = species?.color ?? species?.visual?.color ?? roleColor(role);
  const color = cssHex(baseColor);
  const accent = cssHex(shiftColor(baseColor, ((seed >>> 9) % 31) - 15));
  const sprite = spriteFor(organism, species);
  const gait = (finite(organism?.gaitPhase) || individual / 997) % (Math.PI * 2);
  const signatureSource = [
    form, role, length.toFixed(3), width.toFixed(3), eyes, legs,
    Number(tail), Number(antennae), spikes, color, accent,
    sprite ? `${sprite.width}x${sprite.height}:${hashText(sprite.pixels).toString(16)}` : 'vector',
  ].join('|');

  return Object.freeze({
    version: 1,
    entityId: Number(id),
    speciesId: species?.id || organism?.speciesId || null,
    lineageId: organism?.lineageCapsuleId || species?.lineageCapsuleId || null,
    form,
    role,
    length,
    width,
    eyes,
    legs,
    tail,
    antennae,
    spikes,
    color,
    accent,
    flip: individual % 2 ? 1 : -1,
    gait,
    infected: finite(organism?.infected) > 0,
    energy: finite(organism?.energy),
    sprite,
    signature: hashText(signatureSource).toString(16).padStart(8, '0'),
  });
}

export function installCreaturePhenotypes({ planet = window.realitySandboxPlanet } = {}) {
  if (window.realitySandboxCreaturePhenotypes) return window.realitySandboxCreaturePhenotypes;
  const world = planet?.world;
  const biosphere = planet?.biosphere;
  if (!world?.ecs || !biosphere) throw new Error('Creature phenotype dependencies are unavailable.');

  function get(entityId) {
    const id = Number(entityId);
    if (!Number.isFinite(id)) return null;
    const c = world.ecs.components;
    const organism = c.agent?.get(id) || c.predator?.get(id) || c.apex?.get(id);
    if (!organism) return null;
    const role = c.apex?.has(id) ? 'apex' : c.predator?.has(id) ? 'predator' : 'grazer';
    const species = biosphere.getSpeciesForEntity?.(id) || null;
    return phenotypeFor({ id, species, organism, role });
  }

  function entries() {
    const c = world.ecs.components;
    const rows = [];
    for (const id of c.position.keys()) {
      if (c.resource?.has(id)) continue;
      const phenotype = get(id);
      if (phenotype) rows.push([id, phenotype]);
    }
    return rows;
  }

  const api = {
    version: 1,
    model: 'authoritative-dna-lineage-individual-phenotype',
    forms: [...FORMS],
    get,
    entries,
    getSnapshot() {
      return {
        version: 1,
        model: 'authoritative-dna-lineage-individual-phenotype',
        livingPhenotypes: entries().length,
        forms: [...FORMS],
        displayCap: null,
      };
    },
  };

  planet.creaturePhenotypes = api;
  window.realitySandboxCreaturePhenotypes = api;
  window.dispatchEvent(new CustomEvent('eidolon-creature-phenotypes-ready', { detail: api.getSnapshot() }));
  return api;
}

async function start() {
  try {
    if (document.readyState === 'loading') {
      await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    }
    const started = performance.now();
    while (!window.realitySandboxPlanet?.world?.ecs || !window.realitySandboxPlanet?.biosphere) {
      if (performance.now() - started > 15000) throw new Error('Planet did not become ready.');
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    installCreaturePhenotypes();
  } catch (error) {
    console.warn('[creature-phenotype] disabled:', error);
  }
}

if (typeof window !== 'undefined') start();
