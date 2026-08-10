const STYLE_ID = 'eidolonGoogridCreatureStyles';
const SVG_NS = 'http://www.w3.org/2000/svg';
const RENDER_INTERVAL_MS = 90;

const FORMS = Object.freeze([
  ['beetle', 'Beetle'],
  ['crawler', 'Crawler'],
  ['hopper', 'Hopper'],
  ['kite', 'Kite'],
  ['glider', 'Glider'],
  ['serpent', 'Serpent'],
  ['tripod', 'Tripod'],
  ['orb', 'Orb'],
]);

function startWhenReady() {
  const start = async () => {
    try {
      if (window.realitySandboxReady) await window.realitySandboxReady;
      const planet = window.realitySandboxPlanet;
      const runtime = window.realitySandboxUnified;
      const canvas = document.getElementById('lofiLivingCanvas');
      if (!planet?.world?.ecs || !planet?.biosphere || !planet?.lineageFoundry || !runtime || !canvas) return;

      const studio = installCreatureStudio(planet.lineageFoundry);
      const renderer = createCreatureRenderer({
        world: planet.world,
        biosphere: planet.biosphere,
        runtime,
        canvas,
      });
      renderer.start();

      planet.googridCreatures = renderer;
      window.realitySandboxGoogridCreatures = renderer;
      window.dispatchEvent(new CustomEvent('eidolon-googrid-creatures-ready', {
        detail: renderer.getSnapshot(),
      }));

      window.addEventListener('pagehide', () => {
        renderer.destroy();
        studio.destroy();
      }, { once: true });
    } catch (error) {
      console.warn('[googrid-creatures] disabled:', error);
    }
  };

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}

export function createCreatureRenderer({ world, biosphere, runtime, canvas }) {
  const host = document.getElementById('world') || canvas.parentElement || document.body;
  injectStyles();

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('eidolon-creatures');
  svg.setAttribute('aria-hidden', 'true');
  host.append(svg);

  let timer = 0;
  let rendered = 0;
  let visible = 0;
  let total = 0;
  let lastRenderAt = 0;
  const mobileProjection = matchMedia('(max-width: 720px), (pointer: coarse)').matches;

  function start() {
    if (timer) return;
    render();
    timer = window.setInterval(render, RENDER_INTERVAL_MS);
  }

  function render() {
    if (document.hidden) return;
    const camera = runtime.getCamera?.();
    const rect = canvas.getBoundingClientRect();
    if (!camera || !rect.width || !rect.height || finite(camera.zoom) < 0.68) {
      svg.replaceChildren();
      rendered = 0;
      visible = 0;
      return;
    }

    syncBounds(rect);
    const projectionFrame = getProjectionFrame(canvas, rect, mobileProjection);

    const components = world.ecs.components;
    const nodes = [];
    total = 0;
    visible = 0;

    for (const [id, position] of components.position.entries()) {
      if (components.resource?.has(id)) continue;
      const organism = components.agent?.get(id) || components.predator?.get(id) || components.apex?.get(id);
      if (!organism) continue;
      total += 1;

      const species = biosphere.getSpeciesForEntity?.(id) || null;
      const role = components.apex?.has(id) ? 'apex' : components.predator?.has(id) ? 'predator' : 'grazer';
      const point = projectToOverlay(position.x / world.width, position.y / world.height, projectionFrame, camera);
      if (!point.visible) continue;
      visible += 1;

      const velocity = components.velocity?.get(id) || { vx: 0, vy: 0 };
      const ahead = projectToOverlay(
        wrap01((position.x + finite(velocity.vx) * 0.7) / world.width),
        clamp((position.y + finite(velocity.vy) * 0.7) / world.height, 0, 1),
        projectionFrame,
        camera,
      );
      const heading = ahead.visible ? Math.atan2(ahead.y - point.y, ahead.x - point.x) : 0;
      const morphology = morphologyFor({ id, species, organism, role });
      nodes.push(creatureNode(point, heading, morphology, organism, camera.zoom));
    }

    svg.replaceChildren(...nodes);
    rendered = nodes.length;
    lastRenderAt = performance.now();
  }

  function syncBounds(rect) {
    const hostRect = host.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    svg.style.left = `${rect.left - hostRect.left}px`;
    svg.style.top = `${rect.top - hostRect.top}px`;
    svg.style.width = `${rect.width}px`;
    svg.style.height = `${rect.height}px`;
  }

  function getSnapshot() {
    return {
      version: 1,
      style: 'googrid-inspired-lineage-morphology',
      projection: 'pixi-backing-space-mapped-to-css',
      totalOrganisms: total,
      visibleOrganisms: visible,
      renderedOrganisms: rendered,
      displayCap: null,
      lastRenderAt,
      forms: FORMS.map(([id]) => id),
    };
  }

  function destroy() {
    if (timer) window.clearInterval(timer);
    timer = 0;
    svg.remove();
  }

  return { start, render, getSnapshot, destroy };
}

export function morphologyFor({ id, species, organism, role }) {
  const dna = organism?.dna || {};
  const speciesKey = species?.id || organism?.speciesId || `${role}:${id}`;
  const seed = hashText(speciesKey);
  const explicit = normalizeForm(species?.visualForm);
  const form = explicit || FORMS[seed % FORMS.length][0];
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
  const color = cssHex(species?.color ?? roleColor(role));
  const accent = cssHex(shiftColor(species?.color ?? roleColor(role), ((seed >>> 9) % 31) - 15));
  const individual = hashText(`${speciesKey}:${id}`);

  return {
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
    gait: (finite(organism?.gaitPhase) || individual / 997) % (Math.PI * 2),
    infected: finite(organism?.infected) > 0,
    energy: finite(organism?.energy),
  };
}

function creatureNode(point, heading, m, organism, zoom) {
  const group = document.createElementNS(SVG_NS, 'g');
  const detail = zoom >= 2.1 ? 2 : zoom >= 1.15 ? 1 : 0;
  const base = clamp(4.4 * Math.sqrt(Math.max(1, finite(zoom))), 4.4, 15);
  const sx = base * m.length;
  const sy = base * m.width;
  const alpha = clamp(0.38 + point.depth * 0.72, 0.28, 1);

  group.setAttribute('transform', `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) rotate(${(heading * 180 / Math.PI).toFixed(2)})`);
  group.setAttribute('opacity', alpha.toFixed(3));
  group.classList.add('eidolon-creature', `is-${m.role}`, `form-${m.form}`);
  if (m.infected) group.classList.add('is-infected');

  drawAppendages(group, m, sx, sy, detail);
  drawBody(group, m, sx, sy);

  if (detail >= 1) drawHead(group, m, sx, sy);
  if (detail >= 2) drawMarkings(group, m, sx, sy);

  return group;
}

function drawBody(group, m, sx, sy) {
  if (m.form === 'kite' || m.form === 'glider') {
    polygon(group, [[-sx * .58, 0], [0, -sy * .62], [sx * .62, 0], [0, sy * .62]], m.color, m.accent);
  } else if (m.form === 'serpent') {
    path(group, `M ${-sx*.7} 0 C ${-sx*.3} ${-sy*.55}, ${sx*.1} ${sy*.55}, ${sx*.68} 0`, m.color, Math.max(2.6, sy * .7));
  } else if (m.form === 'tripod') {
    ellipse(group, 0, 0, sx * .48, sy * .52, m.color, m.accent);
  } else if (m.form === 'orb') {
    ellipse(group, 0, 0, sy * .62, sy * .62, m.color, m.accent);
  } else if (m.form === 'hopper') {
    ellipse(group, -sx * .05, 0, sx * .5, sy * .48, m.color, m.accent);
  } else if (m.form === 'crawler') {
    ellipse(group, 0, 0, sx * .62, sy * .38, m.color, m.accent);
  } else {
    ellipse(group, 0, 0, sx * .54, sy * .5, m.color, m.accent);
    line(group, -sx*.15, -sy*.45, -sx*.15, sy*.45, m.accent, Math.max(.7, sy*.08), .8);
  }
}

function drawAppendages(group, m, sx, sy, detail) {
  const stroke = detail ? Math.max(.8, sy * .1) : Math.max(.7, sy * .08);
  if (m.legs) {
    for (let i = 0; i < m.legs; i++) {
      const side = i % 2 ? 1 : -1;
      const row = Math.floor(i / 2);
      const rows = Math.ceil(m.legs / 2);
      const x = -sx * .3 + (row + .5) / rows * sx * .58;
      const gait = Math.sin(m.gait + i * .9) * sy * .18;
      const y0 = side * sy * .28;
      const y1 = side * (sy * .68 + gait);
      line(group, x, y0, x - sx*.13, y1, m.accent, stroke, .82);
    }
  }
  if (m.tail) {
    path(group, `M ${-sx*.45} 0 Q ${-sx*.72} ${m.flip*sy*.3} ${-sx*.88} ${m.flip*sy*.12}`, m.accent, stroke * 1.15);
  }
  if (m.antennae && detail) {
    line(group, sx*.38, -sy*.18, sx*.72, -sy*.48, m.accent, stroke*.75, .8);
    line(group, sx*.38, sy*.18, sx*.72, sy*.48, m.accent, stroke*.75, .8);
  }
  if (m.spikes && detail) {
    for (let i = 0; i < m.spikes; i++) {
      const t = (i + 1) / (m.spikes + 1);
      const x = -sx*.35 + t*sx*.62;
      polygon(group, [[x-sx*.06, -sy*.35], [x, -sy*.75], [x+sx*.06, -sy*.35]], m.accent, m.accent);
    }
  }
}

function drawHead(group, m, sx, sy) {
  const hx = sx * .43;
  const hr = Math.max(1.2, sy * .25);
  ellipse(group, hx, 0, hr * 1.15, hr, m.accent, m.accent);
  for (let i = 0; i < m.eyes; i++) {
    const offset = (i - (m.eyes - 1) / 2) * hr * .65;
    ellipse(group, hx + hr*.28, offset, Math.max(.65, hr*.2), Math.max(.65, hr*.2), '#f5f1d5', '#f5f1d5');
  }
}

function drawMarkings(group, m, sx, sy) {
  if (m.form === 'glider' || m.form === 'kite') {
    line(group, -sx*.35, 0, sx*.38, 0, m.accent, Math.max(.6, sy*.07), .7);
  } else {
    ellipse(group, sx*.05, 0, sx*.18, sy*.2, m.accent, m.accent, .62);
  }
  if (m.infected) {
    ellipse(group, -sx*.1, -sy*.1, Math.max(1, sy*.14), Math.max(1, sy*.14), '#e6ff76', '#e6ff76', .9);
  }
}

export function installCreatureStudio(lineageFoundry) {
  const panel = document.querySelector('.planet-foundry');
  if (!panel || !lineageFoundry?.create) return { destroy() {} };
  injectStyles();

  const color = panel.querySelector('[data-foundry-color]');
  const row = color?.closest('.planet-foundry__row');
  if (!row || panel.querySelector('[data-foundry-form]')) return { destroy() {} };

  const label = document.createElement('label');
  label.className = 'eidolon-creature-form-control';
  label.innerHTML = `Body <select data-foundry-form aria-label="Creature body form">${FORMS.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select>`;
  row.append(label);
  const select = label.querySelector('[data-foundry-form]');

  const originalCreate = lineageFoundry.create;
  const patchedCreate = function createWithMorphology(spec = {}) {
    const visual = { ...(spec.visual || {}) };
    if (!visual.form) visual.form = select?.value || 'beetle';
    return originalCreate.call(lineageFoundry, { ...spec, visual });
  };
  lineageFoundry.create = patchedCreate;

  const preview = document.createElement('div');
  preview.className = 'eidolon-creature-studio-note';
  preview.textContent = 'Body form is inherited by the released lineage; evolution can still alter color and proportions.';
  row.after(preview);

  return {
    destroy() {
      if (lineageFoundry.create === patchedCreate) lineageFoundry.create = originalCreate;
      label.remove();
      preview.remove();
    },
  };
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .eidolon-creatures{position:absolute;z-index:7;overflow:visible;pointer-events:none;contain:layout style paint}
    .eidolon-creature{vector-effect:non-scaling-stroke;filter:drop-shadow(0 1px 1px rgb(0 0 0/.45))}
    .eidolon-creature.is-infected{filter:drop-shadow(0 0 2px rgb(213 255 104/.55))}
    .eidolon-creature-form-control select{min-width:86px}
    .eidolon-creature-studio-note{margin:-2px 0 7px;color:#9baba0;font:9px/1.3 system-ui,sans-serif}
  `;
  document.head.append(style);
}

export function getProjectionFrame(canvas, rect, mobile = false) {
  // Pixi draws the globe in its backing/render coordinate space, then CSS can
  // stretch that canvas to the current viewport. Project creatures in that
  // same backing space first and only then map x/y independently into CSS
  // pixels. This keeps overlays locked even after resize, DPR/resolution
  // changes, or any non-uniform canvas stretch.
  return {
    sourceWidth: Math.max(1, finite(canvas?.width) || finite(rect?.width) || 1),
    sourceHeight: Math.max(1, finite(canvas?.height) || finite(rect?.height) || 1),
    cssWidth: Math.max(1, finite(rect?.width) || 1),
    cssHeight: Math.max(1, finite(rect?.height) || 1),
    radiusScale: mobile ? 0.42 : 0.43,
  };
}

export function projectToOverlay(worldX, worldY, frame, camera) {
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

function project(worldX, worldY, width, height, camera, radiusScale = 0.43) {
  const radius = Math.min(width, height) * radiusScale * finite(camera.zoom || 1);
  const cx = width * 0.5;
  const cy = height * 0.5;
  const lon = (worldX - 0.5) * Math.PI * 2;
  const lat = (0.5 - worldY) * Math.PI;
  const lon0 = (finite(camera.centerX) - 0.5) * Math.PI * 2;
  const lat0 = (0.5 - finite(camera.centerY)) * Math.PI;
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

function ellipse(group, cx, cy, rx, ry, fill, stroke, opacity = 1) {
  const node = document.createElementNS(SVG_NS, 'ellipse');
  node.setAttribute('cx', cx);
  node.setAttribute('cy', cy);
  node.setAttribute('rx', Math.max(.1, rx));
  node.setAttribute('ry', Math.max(.1, ry));
  node.setAttribute('fill', fill);
  node.setAttribute('stroke', stroke);
  node.setAttribute('stroke-width', '.55');
  node.setAttribute('opacity', opacity);
  group.append(node);
}

function line(group, x1, y1, x2, y2, stroke, width = 1, opacity = 1) {
  const node = document.createElementNS(SVG_NS, 'line');
  node.setAttribute('x1', x1); node.setAttribute('y1', y1);
  node.setAttribute('x2', x2); node.setAttribute('y2', y2);
  node.setAttribute('stroke', stroke);
  node.setAttribute('stroke-width', width);
  node.setAttribute('stroke-linecap', 'round');
  node.setAttribute('opacity', opacity);
  group.append(node);
}

function polygon(group, points, fill, stroke) {
  const node = document.createElementNS(SVG_NS, 'polygon');
  node.setAttribute('points', points.map(([x,y]) => `${x},${y}`).join(' '));
  node.setAttribute('fill', fill);
  node.setAttribute('stroke', stroke);
  node.setAttribute('stroke-width', '.55');
  node.setAttribute('stroke-linejoin', 'round');
  group.append(node);
}

function path(group, d, stroke, width = 1) {
  const node = document.createElementNS(SVG_NS, 'path');
  node.setAttribute('d', d);
  node.setAttribute('fill', 'none');
  node.setAttribute('stroke', stroke);
  node.setAttribute('stroke-width', width);
  node.setAttribute('stroke-linecap', 'round');
  group.append(node);
}

function normalizeForm(value) {
  const text = String(value || '').toLowerCase();
  return FORMS.some(([id]) => id === text) ? text : null;
}

function roleColor(role) {
  return role === 'apex' ? 0xcf8dff : role === 'predator' ? 0xff705e : 0x69d8ff;
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

function hashText(value) {
  let hash = 2166136261;
  const text = String(value ?? '');
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function wrap01(value) {
  return ((value % 1) + 1) % 1;
}

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

startWhenReady();