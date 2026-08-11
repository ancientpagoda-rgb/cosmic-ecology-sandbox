const SVG_NS = 'http://www.w3.org/2000/svg';
const STYLE_ID = 'eidolon-unified-creature-lod-style';
const OVERVIEW_CLASS = 'eidolon-unified-creatures';
const SURFACE_CLASS = 'eidolon-surface-creatures';
const RENDER_MS = 90;
const SURFACE_CULL_DISTANCE = 185;
const SURFACE_VFOV = 100 * Math.PI / 180;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const wrap01 = value => ((value % 1) + 1) % 1;

function shortestWrappedDelta(value, origin, size) {
  let delta = value - origin;
  if (delta > size * 0.5) delta -= size;
  else if (delta < -size * 0.5) delta += size;
  return delta;
}

async function waitForStack() {
  const started = performance.now();
  while (performance.now() - started < 16000) {
    const planet = window.realitySandboxPlanet;
    const phenotypes = window.realitySandboxCreaturePhenotypes;
    const oldRenderer = window.realitySandboxGoogridCreatures;
    const runtime = window.realitySandboxUnified;
    const mode = window.realitySandboxSurfaceMode;
    const canvas = document.getElementById('lofiLivingCanvas');
    const surfaceLayer = document.getElementById('surfaceModeLayer');
    if (planet?.world?.ecs && phenotypes?.get && oldRenderer && runtime?.getCamera && mode?.getPlayer && canvas && surfaceLayer) {
      return { planet, phenotypes, runtime, mode, canvas, surfaceLayer };
    }
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  return null;
}

function svgElement(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function appendLine(parent, x1, y1, x2, y2, stroke, width = .09, opacity = 1) {
  parent.append(svgElement('line', { x1, y1, x2, y2, stroke, 'stroke-width': width, 'stroke-linecap': 'round', opacity }));
}

function appendEllipse(parent, cx, cy, rx, ry, fill, stroke = fill, opacity = 1) {
  parent.append(svgElement('ellipse', { cx, cy, rx, ry, fill, stroke, 'stroke-width': .055, opacity }));
}

function appendPolygon(parent, points, fill, stroke = fill, opacity = 1) {
  parent.append(svgElement('polygon', { points: points.map(p => p.join(',')).join(' '), fill, stroke, 'stroke-width': .055, opacity }));
}

function appendPath(parent, d, stroke, width = .16, opacity = 1) {
  parent.append(svgElement('path', { d, fill: 'none', stroke, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity }));
}

function drawPixelGenome(parent, phenotype) {
  const sprite = phenotype.sprite;
  if (!sprite) return false;
  const cell = 1 / Math.max(sprite.width, sprite.height);
  const ox = -sprite.width * cell * .5;
  const oy = -sprite.height * cell * .5;
  for (let y = 0; y < sprite.height; y++) {
    for (let x = 0; x < sprite.width; x++) {
      const value = sprite.pixels[y * sprite.width + x];
      if (value === '0') continue;
      parent.append(svgElement('rect', {
        x: ox + x * cell,
        y: oy + y * cell,
        width: cell * 1.03,
        height: cell * 1.03,
        rx: cell * .08,
        fill: value === '2' ? phenotype.accent : phenotype.color,
      }));
    }
  }
  return true;
}

function drawVectorPhenotype(parent, p, detail) {
  const body = svgElement('g');
  parent.append(body);

  if (p.legs) {
    for (let i = 0; i < p.legs; i++) {
      const side = i % 2 ? 1 : -1;
      const row = Math.floor(i / 2);
      const rows = Math.ceil(p.legs / 2);
      const x = -.34 + (row + .5) / rows * .68;
      const gait = Math.sin(p.gait + i * .9) * .12;
      appendLine(body, x, side * .22, x - .14, side * (.62 + gait), p.accent, detail ? .075 : .06, .88);
    }
  }
  if (p.tail) appendPath(body, 'M -.43 0 Q -.72 .26 -.88 .11', p.accent, .085, .9);

  if (p.form === 'kite' || p.form === 'glider') {
    appendPolygon(body, [[-.6,0],[0,-.58],[.62,0],[0,.58]], p.color, p.accent);
  } else if (p.form === 'serpent') {
    appendPath(body, 'M -.7 0 C -.32 -.48 .12 .48 .7 0', p.color, .32);
  } else if (p.form === 'orb') {
    appendEllipse(body, 0, 0, .56, .56, p.color, p.accent);
  } else if (p.form === 'tripod') {
    appendEllipse(body, -.02, 0, .5, .54, p.color, p.accent);
  } else if (p.form === 'hopper') {
    appendEllipse(body, -.05, 0, .54, .46, p.color, p.accent);
  } else if (p.form === 'crawler') {
    appendEllipse(body, 0, 0, .64, .36, p.color, p.accent);
  } else {
    appendEllipse(body, 0, 0, .55, .49, p.color, p.accent);
    appendLine(body, -.15, -.43, -.15, .43, p.accent, .055, .8);
  }

  if (detail >= 1) {
    appendEllipse(body, .46, 0, .23, .22, p.accent, p.accent);
    for (let i = 0; i < p.eyes; i++) {
      const off = (i - (p.eyes - 1) / 2) * .13;
      appendEllipse(body, .52, off, .045, .045, '#f5f1d5', '#f5f1d5');
    }
    if (p.antennae) {
      appendLine(body, .48, -.12, .79, -.42, p.accent, .05, .85);
      appendLine(body, .48, .12, .79, .42, p.accent, .05, .85);
    }
    if (p.spikes) {
      for (let i = 0; i < p.spikes; i++) {
        const t = (i + 1) / (p.spikes + 1);
        const x = -.34 + t * .62;
        appendPolygon(body, [[x-.055,-.31],[x,-.7],[x+.055,-.31]], p.accent, p.accent, .92);
      }
    }
  }

  if (detail >= 2) {
    if (p.form === 'glider' || p.form === 'kite') appendLine(body, -.36, 0, .36, 0, p.accent, .045, .75);
    else appendEllipse(body, .04, 0, .19, .18, p.accent, p.accent, .58);
    if (p.infected) appendEllipse(body, -.08, -.1, .085, .085, '#e6ff76', '#e6ff76', .95);
  }
}

function creatureGlyph(id, p, detail, baseScale, interactive, transform = '') {
  const outer = svgElement('g', {
    'data-entity-id': id,
    'data-role': p.role,
    'data-form': p.form,
    'data-phenotype-signature': p.signature,
    class: `eidolon-creature eidolon-unified-creature is-${p.role} form-${p.form}`,
    transform,
  });
  outer.style.pointerEvents = interactive ? 'all' : 'none';
  outer.style.cursor = interactive ? 'pointer' : 'default';

  const scaleX = baseScale * p.length;
  const scaleY = baseScale * p.width;
  const glyph = svgElement('g', { transform: `scale(${scaleX.toFixed(3)} ${scaleY.toFixed(3)})` });
  outer.append(glyph);

  if (!drawPixelGenome(glyph, p)) drawVectorPhenotype(glyph, p, detail);
  return outer;
}

function install({ planet, phenotypes, runtime, mode, canvas, surfaceLayer }) {
  if (window.realitySandboxUnifiedCreatureLOD) return window.realitySandboxUnifiedCreatureLOD;
  injectStyles();
  const world = planet.world;
  const host = document.getElementById('world') || canvas.parentElement || document.body;

  const overview = svgElement('svg', { 'aria-label': 'Unified phenotype creature layer' });
  overview.classList.add(OVERVIEW_CLASS);
  host.append(overview);

  const surface = svgElement('svg', { 'aria-hidden': 'true' });
  surface.classList.add(SURFACE_CLASS);
  surfaceLayer.append(surface);

  let overviewRendered = 0;
  let surfaceRendered = 0;
  let phenotypeMismatches = 0;
  let lastRenderAt = 0;
  let active = true;

  function syncOverviewBounds() {
    const rect = canvas.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    overview.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    overview.style.left = `${rect.left - hostRect.left}px`;
    overview.style.top = `${rect.top - hostRect.top}px`;
    overview.style.width = `${rect.width}px`;
    overview.style.height = `${rect.height}px`;
    return rect;
  }

  function renderOverview() {
    const rect = syncOverviewBounds();
    const camera = runtime.getCamera?.();
    if (!rect || !camera || finite(camera.zoom) < .68 || document.documentElement.dataset.surfaceMode === 'active') {
      overview.replaceChildren();
      overviewRendered = 0;
      return;
    }

    const oldNodes = [...document.querySelectorAll('.eidolon-creatures .eidolon-creature[data-entity-id]')];
    const nodes = [];
    for (const old of oldNodes) {
      const id = Number(old.getAttribute('data-entity-id'));
      const p = phenotypes.get(id);
      if (!p) continue;
      const zoom = finite(camera.zoom) || 1;
      const detail = zoom >= 2.1 ? 2 : zoom >= 1.15 ? 1 : 0;
      const base = clamp(4.4 * Math.sqrt(Math.max(1, zoom)), 4.4, 15);
      const node = creatureGlyph(id, p, detail, base, true, old.getAttribute('transform') || '');
      const opacity = old.getAttribute('opacity');
      if (opacity != null) node.setAttribute('opacity', opacity);
      nodes.push(node);
    }
    overview.replaceChildren(...nodes);
    overviewRendered = nodes.length;
  }

  function projectSurface(position, player, rect) {
    const dx = shortestWrappedDelta(position.x, player.x, world.width);
    const dz = position.y - player.y;
    const distance = Math.hypot(dx, dz);
    if (distance < .75 || distance > SURFACE_CULL_DISTANCE) return null;

    const yaw = finite(player.yaw);
    const forward = dx * Math.cos(yaw) + dz * Math.sin(yaw);
    const right = -dx * Math.sin(yaw) + dz * Math.cos(yaw);
    if (forward <= .65) return null;

    const aspect = Math.max(.5, rect.width / Math.max(1, rect.height));
    const tanV = Math.tan(SURFACE_VFOV * .5);
    const tanH = tanV * aspect;
    const ndcX = right / (forward * tanH);
    if (Math.abs(ndcX) > 1.12) return null;

    const altitude = Math.max(3.6, finite(player.altitude) || 3.6);
    const groundAngle = Math.atan2(-altitude, Math.max(1, forward));
    const viewAngle = groundAngle + finite(player.pitch);
    const ndcY = Math.tan(viewAngle) / tanV;
    if (ndcY < -1.35 || ndcY > 1.35) return null;

    return {
      x: rect.width * (.5 + ndcX * .5),
      y: rect.height * (.5 - ndcY * .5),
      distance,
      forward,
      right,
    };
  }

  function renderSurface() {
    const activeSurface = mode.isActive?.() && document.documentElement.dataset.surfaceMode === 'active';
    if (!activeSurface) {
      surface.replaceChildren();
      surfaceRendered = 0;
      return;
    }
    const rect = surfaceLayer.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    surface.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    surface.style.width = `${rect.width}px`;
    surface.style.height = `${rect.height}px`;

    const player = mode.getPlayer();
    const c = world.ecs.components;
    const projected = [];
    for (const [id, position] of c.position.entries()) {
      if (c.resource?.has(id)) continue;
      const p = phenotypes.get(id);
      if (!p) continue;
      const point = projectSurface(position, player, rect);
      if (!point) continue;
      projected.push({ id, p, point });
    }
    projected.sort((a, b) => b.point.distance - a.point.distance);

    const nodes = [];
    for (const row of projected) {
      const { id, p, point } = row;
      const detail = point.distance < 34 ? 2 : point.distance < 88 ? 1 : 0;
      const base = clamp(1050 / (point.distance + 8), 3.6, 82);
      const wrapper = svgElement('g', {
        transform: `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)})`,
        'data-surface-entity-id': id,
        'data-phenotype-signature': p.signature,
        class: 'eidolon-surface-creature-anchor',
      });
      const shadowScale = clamp(base * p.length, 4, 72);
      wrapper.append(svgElement('ellipse', {
        cx: 0, cy: Math.max(3, base * p.width * .48), rx: shadowScale * .7, ry: Math.max(2, base * p.width * .13),
        fill: 'rgba(4,9,7,.36)',
      }));
      const velocity = c.velocity?.get(id) || { vx: 0, vy: 0 };
      const facing = (finite(velocity.vx) * (-Math.sin(finite(player.yaw))) + finite(velocity.vy) * Math.cos(finite(player.yaw))) >= 0 ? 1 : -1;
      const glyph = creatureGlyph(id, p, detail, base, false, `scale(${facing} 1)`);
      wrapper.append(glyph);
      nodes.push(wrapper);
    }
    surface.replaceChildren(...nodes);
    surfaceRendered = nodes.length;
  }

  function verifyParity() {
    phenotypeMismatches = 0;
    for (const node of surface.querySelectorAll('[data-surface-entity-id]')) {
      const id = Number(node.getAttribute('data-surface-entity-id'));
      const p = phenotypes.get(id);
      if (!p || node.getAttribute('data-phenotype-signature') !== p.signature) phenotypeMismatches++;
    }
  }

  function render() {
    if (!active || document.hidden) return;
    renderOverview();
    renderSurface();
    verifyParity();
    lastRenderAt = performance.now();
    document.documentElement.dataset.unifiedCreatureOverview = String(overviewRendered);
    document.documentElement.dataset.unifiedCreatureSurface = String(surfaceRendered);
  }

  const timer = window.setInterval(render, RENDER_MS);
  render();

  const api = {
    version: 1,
    model: 'shared-phenotype-multi-lod-overview-and-surface',
    render,
    getSnapshot() {
      return {
        version: 1,
        model: 'shared-phenotype-multi-lod-overview-and-surface',
        overviewRendered,
        surfaceRendered,
        phenotypeMismatches,
        surfaceCullDistance: SURFACE_CULL_DISTANCE,
        displayCap: null,
        overviewSource: 'existing-projection-shared-phenotype-glyph',
        surfaceSource: 'first-person-frustum-shared-phenotype-glyph',
        legacyOverviewHidden: true,
        lastRenderAt,
      };
    },
    destroy() {
      active = false;
      clearInterval(timer);
      overview.remove();
      surface.remove();
    },
  };

  planet.unifiedCreatureLOD = api;
  window.realitySandboxUnifiedCreatureLOD = api;
  window.dispatchEvent(new CustomEvent('eidolon-unified-creature-lod-ready', { detail: api.getSnapshot() }));
  return api;
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .eidolon-creatures,.eidolon-individual-sprites,.eidolon-custom-sprites{display:none!important}
    .${OVERVIEW_CLASS}{position:absolute;z-index:10;overflow:visible;pointer-events:none}
    .${OVERVIEW_CLASS} .eidolon-creature{pointer-events:all}
    .${SURFACE_CLASS}{position:absolute;inset:0;z-index:1;overflow:hidden;pointer-events:none}
    .eidolon-unified-creature{filter:drop-shadow(0 1px 1px rgb(0 0 0/.45))}
    .eidolon-surface-creature-anchor .eidolon-unified-creature{filter:drop-shadow(0 2px 2px rgb(0 0 0/.62))}
  `;
  document.head.append(style);
}

async function boot() {
  try {
    if (document.readyState === 'loading') {
      await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    }
    const state = await waitForStack();
    if (!state) throw new Error('Unified creature LOD dependencies did not become ready.');
    install(state);
  } catch (error) {
    console.warn('[unified-creature-lod] disabled:', error);
  }
}

if (typeof window !== 'undefined') boot();
