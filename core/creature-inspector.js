const PANEL_ID = 'eidolon-creature-inspector';
const STYLE_ID = 'eidolon-creature-inspector-style';
const REFRESH_MS = 160;

async function start() {
  try {
    if (document.readyState === 'loading') {
      await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    }
    if (window.realitySandboxReady?.then) await window.realitySandboxReady;
    await waitForCreatureRenderer();
    const planet = window.realitySandboxPlanet;
    if (!planet?.world?.ecs || !planet?.biosphere) throw new Error('Living creature data is unavailable.');

    const api = installCreatureInspector(planet);
    planet.creatureInspector = api;
    window.realitySandboxCreatureInspector = api;
    window.dispatchEvent(new CustomEvent('eidolon-creature-inspector-ready', { detail: api.getSnapshot() }));
    window.addEventListener('pagehide', api.destroy, { once: true });
  } catch (error) {
    console.warn('[creature-inspector] disabled:', error);
  }
}

function waitForCreatureRenderer() {
  if (window.realitySandboxGoogridCreatures) return Promise.resolve();
  return new Promise(resolve => {
    const started = performance.now();
    const poll = () => {
      if (window.realitySandboxGoogridCreatures) return resolve();
      if (performance.now() - started > 10000) return resolve();
      setTimeout(poll, 25);
    };
    poll();
  });
}

export function installCreatureInspector(planet) {
  if (window.realitySandboxCreatureInspector) return window.realitySandboxCreatureInspector;
  injectStyles();

  const { world, biosphere } = planet;
  const panel = createPanel();
  document.body.append(panel.root);

  let selectedEntityId = null;
  let selectionTick = null;
  let selections = 0;
  let refreshes = 0;
  let lastSnapshot = null;
  let active = true;

  const onDocumentClick = event => {
    if (!active) return;
    const target = event.target instanceof Element ? event.target.closest('.eidolon-creature[data-entity-id]') : null;
    if (!target) return;
    const id = Number(target.getAttribute('data-entity-id'));
    if (!Number.isFinite(id)) return;
    event.preventDefault();
    event.stopPropagation();
    select(id);
  };

  const onKeyDown = event => {
    if (event.key !== 'Escape' || selectedEntityId == null) return;
    clear();
  };

  const close = () => clear();
  panel.close.addEventListener('click', close);
  document.addEventListener('click', onDocumentClick, true);
  window.addEventListener('keydown', onKeyDown);

  const timer = window.setInterval(() => {
    if (!active || selectedEntityId == null) return;
    refresh();
  }, REFRESH_MS);

  function select(id) {
    const record = readIndividual(id);
    if (!record) return false;
    selectedEntityId = id;
    selectionTick = world.tick;
    selections += 1;
    panel.root.hidden = false;
    refresh(record);
    window.dispatchEvent(new CustomEvent('eidolon-creature-selected', {
      detail: { entityId: id, tick: world.tick, role: record.role, speciesId: record.speciesId },
    }));
    return true;
  }

  function clear() {
    if (selectedEntityId == null) return;
    const previous = selectedEntityId;
    selectedEntityId = null;
    selectionTick = null;
    lastSnapshot = null;
    panel.root.hidden = true;
    syncSelectedGlyph(null);
    window.dispatchEvent(new CustomEvent('eidolon-creature-selection-cleared', {
      detail: { entityId: previous, tick: world.tick },
    }));
  }

  function refresh(existing = null) {
    if (selectedEntityId == null) return;
    const record = existing || readIndividual(selectedEntityId);
    if (!record) {
      clear();
      return;
    }
    refreshes += 1;
    lastSnapshot = record;
    renderRecord(record);
    syncSelectedGlyph(selectedEntityId);
  }

  function readIndividual(id) {
    const c = world.ecs.components;
    const organism = c.agent?.get(id) || c.predator?.get(id) || c.apex?.get(id);
    if (!organism) return null;
    const role = c.apex?.has(id) ? 'apex' : c.predator?.has(id) ? 'predator' : 'grazer';
    const position = c.position?.get(id) || null;
    const velocity = c.velocity?.get(id) || null;
    const species = biosphere.getSpeciesForEntity?.(id) || null;
    const dna = organism.dna || {};
    const parents = Array.isArray(organism.parentEntityIds)
      ? organism.parentEntityIds.filter(Number.isFinite)
      : Number.isFinite(Number(organism.parentEntityId)) ? [Number(organism.parentEntityId)] : [];
    const ancestry = topAncestry(organism.genomicAncestry || organism.ancestryFractions || organism.geneticAncestry);
    const reward = compactMemory(organism.rewardMemory);
    const danger = compactMemory(organism.dangerMemory);
    const culture = compactCulture(organism);
    const currentBehavior = firstText(
      organism.learnedBehavior,
      organism.currentBehavior,
      organism.behavior,
      organism.dominantBehavior,
      organism.preyGradientTarget ? 'long-range prey dispersal' : null,
      organism.famineMigrationTarget ? 'famine migration' : null,
    );

    return {
      version: 1,
      model: 'exact-ecs-individual-inspection',
      entityId: id,
      worldTick: world.tick,
      role,
      speciesId: species?.id || organism.speciesId || null,
      speciesName: species?.name || species?.label || null,
      lineageId: organism.lineageCapsuleId || species?.lineageCapsuleId || null,
      generation: finite(organism.visualGenome?.generation, finite(species?.generation, null)),
      energy: finite(organism.energy, null),
      age: finite(organism.age, null),
      lifeStage: firstText(organism.lifeStage, inferLifeStage(organism.age)),
      infected: finite(organism.infected, 0) > 0,
      behavior: currentBehavior,
      hunger: finite(organism.hunger, null),
      sociality: finite(organism.sociality, null),
      preferredTemperature: finite(organism.preferredTemperature, null),
      dna: {
        speed: finite(dna.speed, null),
        sense: finite(dna.sense, null),
        metabolism: finite(dna.metabolism, null),
        hueShift: finite(dna.hueShift, null),
      },
      position: position ? { x: round(position.x), y: round(position.y) } : null,
      speed: velocity ? round(Math.hypot(finite(velocity.vx, 0), finite(velocity.vy, 0))) : null,
      parents,
      reproductionMode: firstText(organism.reproductionMode),
      ancestry,
      learning: {
        socialLearningEvents: finite(organism.socialLearningEvents, 0),
        lastTeacherEntityId: Number.isFinite(Number(organism.lastTeacherEntityId)) ? Number(organism.lastTeacherEntityId) : null,
        rewardMemory: reward,
        dangerMemory: danger,
      },
      culture,
      selectionTick,
    };
  }

  function renderRecord(record) {
    panel.title.textContent = record.speciesName || record.speciesId || `${capitalize(record.role)} ${record.entityId}`;
    panel.subtitle.textContent = `${capitalize(record.role)} · entity ${record.entityId}${record.lifeStage ? ` · ${record.lifeStage}` : ''}`;
    panel.rows.replaceChildren();

    addRow(panel.rows, 'Energy', metric(record.energy));
    addRow(panel.rows, 'Age', metric(record.age));
    addRow(panel.rows, 'Behavior', record.behavior || '—');
    addRow(panel.rows, 'Speed', metric(record.speed));
    addRow(panel.rows, 'DNA', dnaText(record.dna));
    addRow(panel.rows, 'Social', socialText(record));
    addRow(panel.rows, 'Parents', record.parents.length ? record.parents.join(' + ') : 'founder / unknown');
    addRow(panel.rows, 'Lineage', record.lineageId || record.speciesId || '—');
    if (record.reproductionMode) addRow(panel.rows, 'Birth', record.reproductionMode);
    if (record.ancestry.length) addRow(panel.rows, 'Ancestry', record.ancestry.map(item => `${item.id} ${Math.round(item.share * 100)}%`).join(' · '));
    addRow(panel.rows, 'Learning', learningText(record.learning));
    addRow(panel.rows, 'Culture', cultureText(record.culture));
    addRow(panel.rows, 'Position', record.position ? `${record.position.x}, ${record.position.y}` : '—');

    panel.tick.textContent = `tick ${Math.round(record.worldTick)}`;
    panel.root.dataset.role = record.role;
    panel.root.dataset.entityId = String(record.entityId);
  }

  function syncSelectedGlyph(id) {
    for (const node of document.querySelectorAll('.eidolon-creature.is-selected')) node.classList.remove('is-selected');
    if (id == null) return;
    document.querySelector(`.eidolon-creature[data-entity-id="${cssEscape(String(id))}"]`)?.classList.add('is-selected');
  }

  function getSnapshot() {
    return {
      version: 1,
      model: 'exact-ecs-individual-inspection',
      selectedEntityId,
      selectionTick,
      selections,
      refreshes,
      visible: !panel.root.hidden,
      individual: lastSnapshot ? structuredCloneSafe(lastSnapshot) : null,
    };
  }

  function destroy() {
    active = false;
    window.clearInterval(timer);
    document.removeEventListener('click', onDocumentClick, true);
    window.removeEventListener('keydown', onKeyDown);
    panel.close.removeEventListener('click', close);
    panel.root.remove();
    syncSelectedGlyph(null);
  }

  return { select, clear, refresh, getSnapshot, destroy };
}

function createPanel() {
  const root = document.createElement('aside');
  root.id = PANEL_ID;
  root.className = 'eidolon-creature-inspector';
  root.hidden = true;
  root.setAttribute('aria-live', 'polite');

  const header = document.createElement('header');
  header.className = 'eidolon-creature-inspector__header';
  const heading = document.createElement('div');
  const title = document.createElement('strong');
  title.className = 'eidolon-creature-inspector__title';
  const subtitle = document.createElement('div');
  subtitle.className = 'eidolon-creature-inspector__subtitle';
  heading.append(title, subtitle);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'eidolon-creature-inspector__close';
  close.setAttribute('aria-label', 'Close creature inspector');
  close.textContent = '×';
  header.append(heading, close);

  const rows = document.createElement('dl');
  rows.className = 'eidolon-creature-inspector__rows';
  const tick = document.createElement('div');
  tick.className = 'eidolon-creature-inspector__tick';
  root.append(header, rows, tick);
  return { root, title, subtitle, close, rows, tick };
}

function addRow(parent, label, value) {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value == null || value === '' ? '—' : String(value);
  parent.append(dt, dd);
}

function compactMemory(memory) {
  if (!memory || !Number.isFinite(Number(memory.strength))) return null;
  return {
    strength: round(memory.strength),
    source: firstText(memory.source),
    teacherId: Number.isFinite(Number(memory.teacherId)) ? Number(memory.teacherId) : null,
  };
}

function compactCulture(organism) {
  const trace = organism.culturalTrace || {};
  const items = [];
  for (const kind of ['reward', 'danger']) {
    const item = trace[kind];
    if (!item?.signature) continue;
    items.push({
      kind,
      signature: item.signature,
      depth: finite(item.depth, 0),
      teacherId: Number.isFinite(Number(item.teacherId)) ? Number(item.teacherId) : null,
    });
  }
  return {
    load: finite(organism.culturalTraditionLoad, 0),
    traditions: items,
  };
}

function topAncestry(value) {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value)
    .map(([id, share]) => ({ id, share: Math.max(0, finite(share, 0)) }))
    .filter(item => item.share > 0.001)
    .sort((a, b) => b.share - a.share)
    .slice(0, 3);
}

function dnaText(dna) {
  const parts = [];
  if (dna.speed != null) parts.push(`move ${metric(dna.speed)}`);
  if (dna.sense != null) parts.push(`sense ${metric(dna.sense)}`);
  if (dna.metabolism != null) parts.push(`met ${metric(dna.metabolism)}`);
  return parts.join(' · ') || '—';
}

function socialText(record) {
  const parts = [];
  if (record.sociality != null) parts.push(`social ${metric(record.sociality)}`);
  if (record.hunger != null) parts.push(`hunger ${metric(record.hunger)}`);
  if (record.infected) parts.push('infected');
  return parts.join(' · ') || '—';
}

function learningText(learning) {
  const parts = [];
  if (learning.socialLearningEvents) parts.push(`${Math.round(learning.socialLearningEvents)} social`);
  if (learning.rewardMemory) parts.push(`reward ${metric(learning.rewardMemory.strength)}${learning.rewardMemory.source ? ` ${learning.rewardMemory.source}` : ''}`);
  if (learning.dangerMemory) parts.push(`danger ${metric(learning.dangerMemory.strength)}${learning.dangerMemory.source ? ` ${learning.dangerMemory.source}` : ''}`);
  if (learning.lastTeacherEntityId != null) parts.push(`teacher ${learning.lastTeacherEntityId}`);
  return parts.join(' · ') || 'none yet';
}

function cultureText(culture) {
  if (!culture?.traditions?.length) return culture?.load ? `${culture.load} active` : 'none yet';
  return culture.traditions.map(item => `${item.kind} depth ${Math.round(item.depth)}`).join(' · ');
}

function inferLifeStage(age) {
  const value = finite(age, null);
  if (value == null) return null;
  return value < 8 ? 'juvenile' : value > 120 ? 'senescent' : 'adult';
}

function metric(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  if (Math.abs(number) >= 100) return String(Math.round(number));
  return String(Math.round(number * 100) / 100);
}

function round(value) {
  const number = finite(value, 0);
  return Math.round(number * 1000) / 1000;
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function capitalize(value) {
  const text = String(value || 'creature');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function structuredCloneSafe(value) {
  try { return structuredClone(value); }
  catch { return JSON.parse(JSON.stringify(value)); }
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .eidolon-creature-inspector{
      position:fixed;top:max(14px,env(safe-area-inset-top));right:max(14px,env(safe-area-inset-right));z-index:10035;
      width:min(310px,calc(100vw - 28px));max-height:min(70vh,560px);overflow:auto;padding:12px 13px 10px;
      border:1px solid rgb(190 255 225/.22);border-radius:15px;background:rgb(5 18 15/.9);color:rgb(239 255 249/.96);
      box-shadow:0 10px 34px rgb(0 0 0/.38);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
      font:12px/1.35 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif
    }
    .eidolon-creature-inspector[hidden]{display:none!important}
    .eidolon-creature-inspector__header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}
    .eidolon-creature-inspector__title{display:block;font-size:14px;line-height:1.2;color:#f3fff9}
    .eidolon-creature-inspector__subtitle{margin-top:3px;color:#9eb5aa;font-size:10px}
    .eidolon-creature-inspector__close{border:0;background:transparent;color:#c6d9d0;font:20px/1 system-ui;cursor:pointer;padding:0 2px}
    .eidolon-creature-inspector__rows{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:5px 10px;margin:0}
    .eidolon-creature-inspector__rows dt{margin:0;color:#8fa89d;font-size:10px;text-transform:uppercase;letter-spacing:.055em}
    .eidolon-creature-inspector__rows dd{margin:0;min-width:0;overflow-wrap:anywhere;color:#e5f4ed;font-variant-numeric:tabular-nums}
    .eidolon-creature-inspector__tick{margin-top:9px;padding-top:7px;border-top:1px solid rgb(190 255 225/.12);color:#769187;font-size:9px;text-align:right;font-variant-numeric:tabular-nums}
    .eidolon-creature-inspector[data-role="predator"]{border-color:rgb(255 132 111/.32)}
    .eidolon-creature-inspector[data-role="apex"]{border-color:rgb(210 153 255/.34)}
    @media (max-width:720px),(pointer:coarse){
      .eidolon-creature-inspector{top:auto;right:max(8px,env(safe-area-inset-right));bottom:max(66px,calc(env(safe-area-inset-bottom) + 58px));left:max(8px,env(safe-area-inset-left));width:auto;max-height:42vh;padding:11px 12px}
    }
  `;
  document.head.append(style);
}

if (typeof window !== 'undefined') start();
