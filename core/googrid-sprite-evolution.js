const SVG_NS = 'http://www.w3.org/2000/svg';
const STYLE_ID = 'eidolonSpriteEvolutionStyles';
const GRID_SIZE = 12;
const PIXEL_COUNT = GRID_SIZE * GRID_SIZE;
const RENDER_MS = 90;

async function start() {
  try {
    if (window.realitySandboxReady) await window.realitySandboxReady;
    const planet = window.realitySandboxPlanet;
    const runtime = window.realitySandboxUnified;
    const canvas = document.getElementById('lofiLivingCanvas');
    if (!planet?.world?.ecs || !planet?.biosphere || !planet?.lineageFoundry || !runtime || !canvas) return;

    installStyles();
    const editor = installSpriteEditor(planet.lineageFoundry);
    const overlay = installSpriteOverlay({
      world: planet.world,
      biosphere: planet.biosphere,
      foundry: planet.lineageFoundry,
      runtime,
      canvas,
    });

    planet.creatureSpriteEvolution = { editor, overlay };
    window.realitySandboxCreatureSpriteEvolution = planet.creatureSpriteEvolution;
    window.dispatchEvent(new CustomEvent('eidolon-creature-sprite-evolution-ready', {
      detail: overlay.getSnapshot(),
    }));

    window.addEventListener('pagehide', () => {
      editor.destroy();
      overlay.destroy();
    }, { once: true });
  } catch (error) {
    console.warn('[googrid-sprite-evolution] disabled:', error);
  }
}

export function installSpriteEditor(foundry) {
  const panel = document.querySelector('.planet-foundry');
  if (!panel || panel.querySelector('[data-creature-sprite-editor]')) return { destroy() {} };

  const colorInput = panel.querySelector('[data-foundry-color]');
  const catalog = panel.querySelector('[data-foundry-catalog]');
  const anchor = colorInput?.closest('.planet-foundry__row') || panel.querySelector('.planet-foundry__traits');
  if (!anchor) return { destroy() {} };

  const section = document.createElement('section');
  section.className = 'eidolon-sprite-editor';
  section.dataset.creatureSpriteEditor = 'true';
  section.innerHTML = `
    <div class="eidolon-sprite-editor__heading"><b>Draw creature</b><span>12×12 · inherited</span></div>
    <div class="eidolon-sprite-editor__tools" role="toolbar" aria-label="Creature drawing tools">
      <button type="button" data-pixel-tool="1" aria-pressed="true">Body</button>
      <button type="button" data-pixel-tool="2" aria-pressed="false">Accent</button>
      <button type="button" data-pixel-tool="0" aria-pressed="false">Erase</button>
      <button type="button" data-pixel-seed>Seed</button>
      <button type="button" data-pixel-clear>Clear</button>
    </div>
    <div class="eidolon-sprite-grid" data-pixel-grid role="grid" aria-label="12 by 12 creature drawing grid"></div>
    <p class="eidolon-sprite-editor__note">Blank = procedural body. Painted pixels become part of the lineage capsule; natural descendants retain the drawing and acquire small visual mutations.</p>`;
  anchor.after(section);

  const grid = section.querySelector('[data-pixel-grid]');
  const toolButtons = [...section.querySelectorAll('[data-pixel-tool]')];
  const seedButton = section.querySelector('[data-pixel-seed]');
  const clearButton = section.querySelector('[data-pixel-clear]');
  const cells = [];
  let pixels = Array(PIXEL_COUNT).fill('0');
  let tool = '1';
  let painting = false;

  for (let index = 0; index < PIXEL_COUNT; index += 1) {
    const cell = document.createElement('span');
    cell.className = 'eidolon-sprite-cell';
    cell.dataset.index = String(index);
    cell.dataset.state = '0';
    cell.setAttribute('role', 'gridcell');
    grid.append(cell);
    cells.push(cell);
  }

  function render() {
    section.style.setProperty('--sprite-body', colorInput?.value || '#69d8ff');
    for (let index = 0; index < PIXEL_COUNT; index += 1) cells[index].dataset.state = pixels[index];
  }

  function setTool(next) {
    tool = String(next);
    for (const button of toolButtons) button.setAttribute('aria-pressed', String(button.dataset.pixelTool === tool));
  }

  function paint(event) {
    const rect = grid.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const column = clamp(Math.floor((event.clientX - rect.left) / rect.width * GRID_SIZE), 0, GRID_SIZE - 1);
    const row = clamp(Math.floor((event.clientY - rect.top) / rect.height * GRID_SIZE), 0, GRID_SIZE - 1);
    const index = row * GRID_SIZE + column;
    pixels[index] = tool;
    cells[index].dataset.state = tool;
  }

  function getSprite() {
    const value = pixels.join('');
    return /[12]/.test(value) ? { width: GRID_SIZE, height: GRID_SIZE, pixels: value } : null;
  }

  function loadCapsule(capsule) {
    const sprite = normalizeSprite(capsule?.visual?.sprite);
    pixels = (sprite?.pixels || '0'.repeat(PIXEL_COUNT)).split('');
    render();
  }

  const stopPainting = event => {
    painting = false;
    try { grid.releasePointerCapture?.(event.pointerId); } catch {}
  };

  grid.addEventListener('contextmenu', event => event.preventDefault());
  grid.addEventListener('pointerdown', event => {
    event.preventDefault();
    painting = true;
    grid.setPointerCapture?.(event.pointerId);
    paint(event);
  });
  grid.addEventListener('pointermove', event => { if (painting) paint(event); });
  grid.addEventListener('pointerup', stopPainting);
  grid.addEventListener('pointercancel', stopPainting);
  for (const button of toolButtons) button.addEventListener('click', () => setTool(button.dataset.pixelTool));
  seedButton.addEventListener('click', () => { pixels = seededSprite().split(''); render(); });
  clearButton.addEventListener('click', () => { pixels = Array(PIXEL_COUNT).fill('0'); render(); });
  colorInput?.addEventListener('input', render);

  const previousCreate = foundry.create;
  const patchedCreate = function createWithSprite(draft = {}) {
    const visual = { ...(draft.visual || {}) };
    if (!visual.sprite) visual.sprite = getSprite();
    return previousCreate.call(foundry, { ...draft, visual });
  };
  foundry.create = patchedCreate;

  const onCatalogChange = () => {
    const capsule = foundry.list?.().find(item => item.id === catalog?.value);
    if (capsule) loadCapsule(capsule);
  };
  catalog?.addEventListener('change', onCatalogChange);

  render();
  return {
    getSprite,
    loadCapsule,
    destroy() {
      if (foundry.create === patchedCreate) foundry.create = previousCreate;
      catalog?.removeEventListener('change', onCatalogChange);
      colorInput?.removeEventListener('input', render);
      section.remove();
    },
  };
}

export function installSpriteOverlay({ world, biosphere, foundry, runtime, canvas }) {
  const host = document.getElementById('world') || canvas.parentElement || document.body;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('eidolon-custom-sprites');
  svg.setAttribute('aria-hidden', 'true');
  host.append(svg);

  const mobile = matchMedia('(max-width: 720px), (pointer: coarse)').matches;
  let timer = 0;
  let rendered = 0;
  let lastRenderAt = 0;

  function render() {
    if (document.hidden) return;
    const camera = runtime.getCamera?.();
    const rect = canvas.getBoundingClientRect();
    if (!camera || !rect.width || !rect.height || finite(camera.zoom) < 0.68) {
      svg.replaceChildren();
      rendered = 0;
      return;
    }

    const hostRect = host.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
    svg.style.left = `${rect.left - hostRect.left}px`;
    svg.style.top = `${rect.top - hostRect.top}px`;
    svg.style.width = `${rect.width}px`;
    svg.style.height = `${rect.height}px`;

    const frame = projectionFrame(canvas, rect, mobile);
    const visuals = new Map((foundry.list?.() || []).map(capsule => [capsule.id, capsule.visual || {}]));
    const components = world.ecs.components;
    const nodes = [];

    for (const [id, position] of components.position.entries()) {
      const organism = components.agent?.get(id) || components.predator?.get(id) || components.apex?.get(id);
      if (!organism) continue;
      const species = biosphere.getSpeciesForEntity?.(id);
      const baseSprite = normalizeSprite(visuals.get(species?.lineageCapsuleId)?.sprite);
      if (!baseSprite) continue;

      const point = projectToOverlay(position.x / world.width, position.y / world.height, frame, camera);
      if (!point.visible) continue;
      const velocity = components.velocity?.get(id) || { vx: 0, vy: 0 };
      const ahead = projectToOverlay(
        wrap01((position.x + finite(velocity.vx) * .7) / world.width),
        clamp((position.y + finite(velocity.vy) * .7) / world.height, 0, 1),
        frame,
        camera,
      );
      const heading = ahead.visible ? Math.atan2(ahead.y - point.y, ahead.x - point.x) : 0;
      const generation = Math.max(0, finite(species?.generation));
      const sprite = mutateSprite(baseSprite, species?.id || species?.lineageCapsuleId || id, generation);
      const roleScale = components.apex?.has(id) ? 1.45 : components.predator?.has(id) ? 1.2 : 1;
      const dna = organism.dna || {};
      const length = clamp(.9 + finite(dna.speed, 1) * .25, .95, 1.55) * roleScale;
      const width = clamp(1.25 - finite(dna.metabolism, 1) * .2, .75, 1.25) * roleScale;
      const color = cssHex(species?.color ?? 0x69d8ff);
      const accent = cssHex(shiftColor(species?.color ?? 0x69d8ff, (hashText(species?.id || id) % 31) - 15));
      nodes.push(spriteNode(point, heading, sprite, color, accent, length, width, camera.zoom, finite(organism.infected) > 0));
    }

    svg.replaceChildren(...nodes);
    rendered = nodes.length;
    lastRenderAt = performance.now();
  }

  function startOverlay() {
    if (timer) return;
    render();
    timer = window.setInterval(render, RENDER_MS);
  }

  function getSnapshot() {
    return {
      version: 1,
      renderer: 'semantic-pixel-lineage-overlay',
      grid: `${GRID_SIZE}x${GRID_SIZE}`,
      rendered,
      lastRenderAt,
      inheritance: 'lineageCapsuleId',
      mutation: 'deterministic-generation-marking',
      projection: 'pixi-backing-space-mapped-to-css',
    };
  }

  function destroy() {
    if (timer) clearInterval(timer);
    timer = 0;
    svg.remove();
  }

  startOverlay();
  return { render, getSnapshot, destroy };
}

function spriteNode(point, heading, sprite, color, accent, length, width, zoom, infected) {
  const group = document.createElementNS(SVG_NS, 'g');
  const base = clamp(6.3 * Math.sqrt(Math.max(1, finite(zoom))), 6.3, 21);
  const sx = base * length * 1.65;
  const sy = base * width * 1.65;
  const cellW = sx / sprite.width;
  const cellH = sy / sprite.height;
  const left = -sx * .5;
  const top = -sy * .5;
  group.setAttribute('transform', `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) rotate(${(heading * 180 / Math.PI).toFixed(2)})`);
  group.setAttribute('opacity', clamp(.45 + point.depth * .58, .35, 1).toFixed(3));

  for (let index = 0; index < sprite.pixels.length; index += 1) {
    const state = sprite.pixels[index];
    if (state === '0') continue;
    const x = index % sprite.width;
    const y = Math.floor(index / sprite.width);
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', left + x * cellW);
    rect.setAttribute('y', top + y * cellH);
    rect.setAttribute('width', cellW + .12);
    rect.setAttribute('height', cellH + .12);
    rect.setAttribute('fill', state === '2' ? accent : color);
    rect.setAttribute('shape-rendering', 'crispEdges');
    group.append(rect);
  }

  if (infected) {
    const ring = document.createElementNS(SVG_NS, 'ellipse');
    ring.setAttribute('cx', '0');
    ring.setAttribute('cy', '0');
    ring.setAttribute('rx', sx * .58);
    ring.setAttribute('ry', sy * .58);
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', '#e6ff76');
    ring.setAttribute('stroke-width', '1');
    ring.setAttribute('opacity', '.7');
    group.append(ring);
  }
  return group;
}

function normalizeSprite(input) {
  if (!input || finite(input.width) !== GRID_SIZE || finite(input.height) !== GRID_SIZE) return null;
  const pixels = String(input.pixels || '').replace(/[^012]/g, '').slice(0, PIXEL_COUNT);
  if (pixels.length !== PIXEL_COUNT || !/[12]/.test(pixels)) return null;
  return { width: GRID_SIZE, height: GRID_SIZE, pixels };
}

function mutateSprite(sprite, key, generation) {
  if (!sprite || generation <= 0) return sprite;
  const pixels = sprite.pixels.split('');
  const mutations = Math.min(6, Math.floor(generation));
  for (let step = 0; step < mutations; step += 1) {
    let index = hashText(`${key}:sprite:${step}`) % pixels.length;
    for (let scan = 0; scan < pixels.length && pixels[index] === '0'; scan += 1) index = (index + 1) % pixels.length;
    if (pixels[index] === '1') pixels[index] = '2';
    else if (pixels[index] === '2') pixels[index] = '1';
  }
  return { ...sprite, pixels: pixels.join('') };
}

function seededSprite() {
  return [
    '000000000000',
    '000011110000',
    '000112211000',
    '001111111100',
    '011121121110',
    '111111111111',
    '111111111111',
    '011121121110',
    '001111111100',
    '000112211000',
    '000011110000',
    '000000000000',
  ].join('');
}

function projectionFrame(canvas, rect, mobile) {
  return {
    sourceWidth: Math.max(1, finite(canvas.width) || rect.width),
    sourceHeight: Math.max(1, finite(canvas.height) || rect.height),
    cssWidth: Math.max(1, rect.width),
    cssHeight: Math.max(1, rect.height),
    radiusScale: mobile ? .42 : .43,
  };
}

function projectToOverlay(worldX, worldY, frame, camera) {
  const source = project(worldX, worldY, frame.sourceWidth, frame.sourceHeight, camera, frame.radiusScale);
  return {
    ...source,
    x: source.x / frame.sourceWidth * frame.cssWidth,
    y: source.y / frame.sourceHeight * frame.cssHeight,
  };
}

function project(worldX, worldY, width, height, camera, radiusScale) {
  const radius = Math.min(width, height) * radiusScale * finite(camera.zoom, 1);
  const cx = width * .5;
  const cy = height * .5;
  const lon = (worldX - .5) * Math.PI * 2;
  const lat = (.5 - worldY) * Math.PI;
  const lon0 = (finite(camera.centerX, .5) - .5) * Math.PI * 2;
  const lat0 = (.5 - finite(camera.centerY, .5)) * Math.PI;
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

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .eidolon-custom-sprites{position:absolute;z-index:7;overflow:visible;pointer-events:none;contain:layout style paint}
    .eidolon-sprite-editor{display:grid;gap:6px;margin:8px 0 2px;padding:7px;border:1px solid rgb(117 157 135/.22);border-radius:9px;background:rgb(8 13 12/.42)}
    .eidolon-sprite-editor__heading{display:flex;justify-content:space-between;gap:8px;color:#c8d6cd;font:8px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;letter-spacing:.05em}
    .eidolon-sprite-editor__heading span{color:#85958a}
    .eidolon-sprite-editor__tools{display:grid;grid-template-columns:repeat(5,1fr);gap:4px}
    .eidolon-sprite-editor__tools button[aria-pressed="true"]{background:rgb(218 174 101/.28);border-color:rgb(218 174 101/.65)}
    .eidolon-sprite-grid{display:grid;grid-template-columns:repeat(12,1fr);aspect-ratio:1;max-width:216px;width:100%;margin:auto;border:1px solid rgb(117 157 135/.35);background:#0a0e0d;touch-action:none;user-select:none}
    .eidolon-sprite-cell{display:block;min-width:0;min-height:0;border-right:1px solid rgb(117 157 135/.08);border-bottom:1px solid rgb(117 157 135/.08);background:transparent}
    .eidolon-sprite-cell[data-state="1"]{background:var(--sprite-body,#69d8ff)}
    .eidolon-sprite-cell[data-state="2"]{background:#f0ddb0}
    .eidolon-sprite-editor__note{margin:0;color:#9baba0;font:9px/1.3 system-ui,sans-serif}
  `;
  document.head.append(style);
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

function cssHex(value) { return `#${(Number(value) >>> 0).toString(16).padStart(6, '0').slice(-6)}`; }
function shiftColor(color, amount) {
  const c = Number(color) || 0x69d8ff;
  const r = clamp(((c >> 16) & 255) + amount, 0, 255);
  const g = clamp(((c >> 8) & 255) + amount, 0, 255);
  const b = clamp((c & 255) - amount, 0, 255);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}
function wrap01(value) { return ((value % 1) + 1) % 1; }
function finite(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();