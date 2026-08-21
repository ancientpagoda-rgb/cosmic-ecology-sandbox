import { createFrontierWorld, seedFrontierWorld, stepFrontierWorld } from './core/frontier-sim/index.js';

const canvas = document.getElementById('frontier-canvas');
const context = canvas.getContext('2d');

const elements = {
  season: document.getElementById('stat-season'),
  population: document.getElementById('stat-population'),
  trade: document.getElementById('stat-trade'),
  raiders: document.getElementById('stat-raiders'),
  castles: document.getElementById('stat-castles'),
  pressure: document.getElementById('stat-pressure'),
  piracy: document.getElementById('bar-piracy'),
  castle: document.getElementById('bar-castle'),
  food: document.getElementById('bar-food'),
  run: document.getElementById('toggle-run'),
  step: document.getElementById('step-once'),
  reset: document.getElementById('reset-world'),
  speed: document.getElementById('speed-range'),
  speedReadout: document.getElementById('speed-readout'),
  routes: document.getElementById('toggle-routes'),
  units: document.getElementById('toggle-units'),
  sites: document.getElementById('toggle-sites'),
  notes: document.getElementById('toggle-notes'),
  inspectorTitle: document.getElementById('inspector-title'),
  inspectorSubtitle: document.getElementById('inspector-subtitle'),
  inspectorGrid: document.getElementById('inspector-grid'),
};

const overlayState = {
  routes: true,
  units: true,
  sites: true,
  notes: true,
};

let world = buildWorld();
let running = true;
let speed = Number(elements.speed.value) || 4;
let lastFrame = performance.now();
let accumulator = 0;
let selection = null;
let hovered = null;
let hitTargets = [];

function buildWorld() {
  const nextWorld = createFrontierWorld({ width: 1200, height: 720 });
  seedFrontierWorld(nextWorld);
  return nextWorld;
}

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function worldToScreen(position) {
  return {
    x: position.x / world.width * window.innerWidth,
    y: position.y / world.height * window.innerHeight,
  };
}

function render() {
  context.clearRect(0, 0, window.innerWidth, window.innerHeight);
  hitTargets = [];
  drawSea();
  drawRegions();
  if (overlayState.routes) drawRoutes();
  if (overlayState.sites) drawSites();
  drawSettlements();
  if (overlayState.units) drawUnits();
  if (overlayState.notes) drawNotes();
  drawSelection();
  updateHud();
}

function drawSea() {
  const gradient = context.createRadialGradient(
    window.innerWidth * 0.5,
    window.innerHeight * 0.45,
    40,
    window.innerWidth * 0.5,
    window.innerHeight * 0.45,
    Math.max(window.innerWidth, window.innerHeight) * 0.7,
  );
  gradient.addColorStop(0, 'rgba(31, 57, 59, 0.95)');
  gradient.addColorStop(0.45, 'rgba(14, 27, 31, 0.98)');
  gradient.addColorStop(1, 'rgba(6, 14, 18, 1)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, window.innerWidth, window.innerHeight);
}

function drawRegions() {
  for (const region of world.mapFeatures.regions || []) {
    const x = region.x / world.width * window.innerWidth;
    const y = region.y / world.height * window.innerHeight;
    const width = region.width / world.width * window.innerWidth;
    const height = region.height / world.height * window.innerHeight;
    context.save();
    context.translate(x + width * 0.5, y + height * 0.5);
    context.rotate(region.rotation || 0);
    const fill = region.kind === 'island'
      ? 'rgba(84, 104, 82, 0.72)'
      : region.kind === 'river-basin'
        ? 'rgba(88, 124, 94, 0.58)'
        : region.kind === 'plain'
          ? 'rgba(112, 135, 86, 0.52)'
          : 'rgba(70, 94, 88, 0.66)';
    context.fillStyle = fill;
    roundRect(context, -width * 0.5, -height * 0.5, width, height, Math.min(width, height) * 0.25);
    context.fill();
    context.strokeStyle = 'rgba(203, 233, 220, 0.08)';
    context.lineWidth = 1;
    context.stroke();
    context.restore();
  }
}

function drawRoutes() {
  for (const [routeId, route] of world.ecs.components.route.entries()) {
    const from = world.ecs.components.position.get(route.fromSettlementId);
    const to = world.ecs.components.position.get(route.toSettlementId);
    if (!from || !to) continue;
    const start = worldToScreen(from);
    const end = worldToScreen(to);
    const control = {
      x: (start.x + end.x) * 0.5,
      y: (start.y + end.y) * 0.5 - 24 - route.chokepointScore * 30,
    };

    context.save();
    context.lineWidth = route.kind === 'seaLane' ? 2.2 : 1.5;
    context.setLineDash(route.kind === 'seaLane' ? [10, 8] : [5, 5]);
    context.strokeStyle = route.kind === 'seaLane'
      ? `rgba(123, 179, 156, ${0.24 + route.capacity * 0.35})`
      : `rgba(190, 176, 142, ${0.18 + route.capacity * 0.3})`;
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.quadraticCurveTo(control.x, control.y, end.x, end.y);
    context.stroke();

    if (route.activeTrade?.length) {
      const t = ((world.tick % 100) / 100);
      const pulse = sampleQuadratic(start, control, end, t);
      context.fillStyle = route.kind === 'seaLane' ? 'rgba(216, 175, 104, 0.92)' : 'rgba(220, 220, 198, 0.88)';
      context.beginPath();
      context.arc(pulse.x, pulse.y, 3 + route.capacity * 3, 0, Math.PI * 2);
      context.fill();
    }

    const isSelected = matchesHit(selection, 'route', routeId);
    const isHovered = matchesHit(hovered, 'route', routeId);
    if (isSelected || isHovered) {
      context.lineDashOffset = 0;
      context.lineWidth = route.kind === 'seaLane' ? 4.2 : 3.4;
      context.strokeStyle = isSelected
        ? 'rgba(255, 241, 196, 0.96)'
        : 'rgba(216, 175, 104, 0.92)';
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.quadraticCurveTo(control.x, control.y, end.x, end.y);
      context.stroke();
    }
    context.restore();
    hitTargets.push({
      type: 'route',
      id: routeId,
      start,
      control,
      end,
      x: control.x,
      y: control.y,
      radius: 14,
    });
  }
}

function drawSettlements() {
  for (const [id, settlement] of world.ecs.components.settlement.entries()) {
    const position = world.ecs.components.position.get(id);
    if (!position) continue;
    const point = worldToScreen(position);
    const radius = 7 + settlement.population / 90;
    context.save();
    context.fillStyle = settlement.harborLevel > 0 ? '#d8af68' : '#a3c8b0';
    context.strokeStyle = settlement.wallLevel >= 2 ? '#f1efe5' : 'rgba(238, 244, 239, 0.35)';
    context.lineWidth = settlement.wallLevel >= 2 ? 2 : 1;
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    if (settlement.wallLevel > 0) {
      context.strokeStyle = settlement.wallLevel >= 3 ? '#efe5c4' : 'rgba(239, 235, 220, 0.7)';
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(point.x, point.y, radius + 5 + settlement.wallLevel * 2, 0, Math.PI * 2);
      context.stroke();
    }
    if (overlayState.notes) {
      context.fillStyle = 'rgba(237, 244, 239, 0.9)';
      context.font = '600 11px "IBM Plex Sans", system-ui, sans-serif';
      context.fillText(settlement.name, point.x + radius + 8, point.y - 4);
    }
    if (matchesHit(selection, 'settlement', id) || matchesHit(hovered, 'settlement', id)) {
      context.strokeStyle = matchesHit(selection, 'settlement', id)
        ? 'rgba(255, 241, 196, 0.95)'
        : 'rgba(216, 175, 104, 0.9)';
      context.lineWidth = matchesHit(selection, 'settlement', id) ? 2.4 : 1.8;
      context.beginPath();
      context.arc(point.x, point.y, radius + 8 + settlement.wallLevel * 1.5, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
    hitTargets.push({ type: 'settlement', id, x: point.x, y: point.y, radius: radius + 10 });
  }
}

function drawSites() {
  for (const [id, site] of world.ecs.components.site.entries()) {
    const position = world.ecs.components.position.get(id);
    if (!position) continue;
    const point = worldToScreen(position);
    context.save();
    if (site.kind === 'raiderCove') {
      context.fillStyle = 'rgba(217, 121, 97, 0.88)';
      context.beginPath();
      context.moveTo(point.x, point.y - 8);
      context.lineTo(point.x + 9, point.y + 8);
      context.lineTo(point.x - 9, point.y + 8);
      context.closePath();
      context.fill();
    } else {
      context.fillStyle = site.kind === 'castle' ? '#efe5c4' : 'rgba(228, 232, 220, 0.82)';
      context.fillRect(point.x - 7, point.y - 7, 14, 14);
      context.strokeStyle = 'rgba(25, 28, 31, 0.6)';
      context.strokeRect(point.x - 7, point.y - 7, 14, 14);
    }
    if (matchesHit(selection, 'site', id) || matchesHit(hovered, 'site', id)) {
      context.strokeStyle = matchesHit(selection, 'site', id)
        ? 'rgba(255, 241, 196, 0.95)'
        : 'rgba(216, 175, 104, 0.9)';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(point.x, point.y, 16, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
    hitTargets.push({ type: 'site', id, x: point.x, y: point.y, radius: 12 });
  }
}

function drawUnits() {
  for (const [id, unit] of world.ecs.components.mobileUnit.entries()) {
    const position = world.ecs.components.position.get(id);
    if (!position) continue;
    const point = worldToScreen(position);
    context.save();
    if (unit.kind === 'raiderShip') {
      context.fillStyle = '#d97961';
      context.beginPath();
      context.moveTo(point.x + 10, point.y);
      context.lineTo(point.x - 7, point.y - 6);
      context.lineTo(point.x - 3, point.y);
      context.lineTo(point.x - 7, point.y + 6);
      context.closePath();
      context.fill();
    } else if (unit.kind === 'patrolShip') {
      context.fillStyle = '#b6d3d0';
      context.beginPath();
      context.moveTo(point.x + 10, point.y);
      context.lineTo(point.x - 6, point.y - 5);
      context.lineTo(point.x - 6, point.y + 5);
      context.closePath();
      context.fill();
    } else if (unit.kind === 'merchantShip') {
      context.fillStyle = '#daae65';
      context.beginPath();
      context.moveTo(point.x + 9, point.y);
      context.lineTo(point.x - 6, point.y - 5);
      context.lineTo(point.x - 1, point.y);
      context.lineTo(point.x - 6, point.y + 5);
      context.closePath();
      context.fill();
    } else {
      context.fillStyle = '#d9d6c3';
      context.fillRect(point.x - 4, point.y - 4, 8, 8);
    }
    if (matchesHit(selection, 'unit', id) || matchesHit(hovered, 'unit', id)) {
      context.strokeStyle = matchesHit(selection, 'unit', id)
        ? 'rgba(255, 241, 196, 0.95)'
        : 'rgba(216, 175, 104, 0.9)';
      context.lineWidth = 1.8;
      context.beginPath();
      context.arc(point.x, point.y, 14, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
    hitTargets.push({ type: 'unit', id, x: point.x, y: point.y, radius: 10 });
  }
}

function drawNotes() {
  context.save();
  context.fillStyle = 'rgba(197, 214, 208, 0.6)';
  context.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
  for (const note of world.mapFeatures.notes || []) {
    const point = worldToScreen(note);
    context.fillText(note.text, point.x, point.y);
  }
  context.restore();
}

function drawSelection() {
  const hoveredTarget = hovered && (!selection || !matchesHit(selection, hovered.type, hovered.id)) ? hovered : null;
  if (selection) drawTargetRing(selection, 'rgba(255, 241, 196, 0.95)', 2.4);
  if (hoveredTarget) drawTargetRing(hoveredTarget, 'rgba(216, 175, 104, 0.86)', 1.8);
}

function updateHud() {
  elements.season.textContent = `${world.season} · year ${world.year}`;
  elements.population.textContent = world.stats.totalPopulation.toLocaleString();
  elements.trade.textContent = world.stats.totalTradeValue.toFixed(1);
  elements.raiders.textContent = `${world.stats.activeRaiders}`;
  elements.castles.textContent = `${world.stats.castles}`;
  elements.pressure.textContent = world.globals.statePressure.toFixed(2);
  elements.piracy.style.setProperty('--value', Math.min(1, world.globals.piracyPressure));
  elements.castle.style.setProperty('--value', Math.min(1, world.globals.castlePressure));
  elements.food.style.setProperty('--value', Math.min(1, world.globals.foodStress));
  elements.speedReadout.textContent = `${speed}×`;
  updateInspector();
}

function updateInspector() {
  if (!selection) {
    elements.inspectorTitle.textContent = 'No selection';
    elements.inspectorSubtitle.textContent = 'Pick a settlement, site, or ship.';
    elements.inspectorGrid.replaceChildren();
    return;
  }

  const rows = [];
  if (selection.type === 'settlement') {
    const settlement = world.ecs.components.settlement.get(selection.id);
    const memory = world.ecs.components.memory.get(selection.id);
    if (!settlement) return;
    const connectedRoutes = [...world.ecs.components.route.values()].filter(route => route.fromSettlementId === selection.id || route.toSettlementId === selection.id);
    const seaLaneCount = connectedRoutes.filter(route => route.kind === 'seaLane').length;
    const roadCount = connectedRoutes.filter(route => route.kind === 'road').length;
    elements.inspectorTitle.textContent = settlement.name;
    elements.inspectorSubtitle.textContent = `${settlement.kind} · faction ${settlement.factionId ?? 'independent'}`;
    rows.push(['Population', settlement.population]);
    rows.push(['Stores', `food ${Math.round(settlement.foodStored)} · coin ${Math.round(settlement.coinStored)}`]);
    rows.push(['Defense', `walls ${settlement.wallLevel} · garrison ${settlement.garrison}`]);
    rows.push(['Mood', `fear ${settlement.fear.toFixed(2)} · unrest ${settlement.unrest.toFixed(2)}`]);
    rows.push(['Trade', settlement.tradeValue.toFixed(2)]);
    rows.push(['Links', `${connectedRoutes.length} total · ${seaLaneCount} sea · ${roadCount} road`]);
    rows.push(['Raid Memory', memory ? memory.raidMemory.toFixed(2) : '0']);
  } else if (selection.type === 'site') {
    const site = world.ecs.components.site.get(selection.id);
    if (!site) return;
    const linkedSettlement = getSettlementName(site.settlementId);
    elements.inspectorTitle.textContent = site.kind;
    elements.inspectorSubtitle.textContent = `${site.hidden ? 'hidden ' : ''}site`;
    rows.push(['Level', site.level]);
    rows.push(['Garrison', site.garrison]);
    rows.push(['Radius', site.controlRadius]);
    rows.push(['Linked', linkedSettlement]);
  } else if (selection.type === 'unit') {
    const unit = world.ecs.components.mobileUnit.get(selection.id);
    const cargo = world.ecs.components.cargo.get(selection.id);
    if (!unit) return;
    elements.inspectorTitle.textContent = unit.kind;
    elements.inspectorSubtitle.textContent = `${unit.state} · crew ${unit.crew}`;
    rows.push(['Strength', `${unit.strength} · morale ${unit.morale.toFixed(2)}`]);
    rows.push(['Home', getSettlementName(unit.homeSettlementId)]);
    rows.push(['Route', unit.routeId ?? 'none']);
    rows.push(['Target', unit.targetId ?? 'none']);
    rows.push(['Cargo', summarizeCargo(cargo?.goods || {})]);
  } else if (selection.type === 'route') {
    const route = world.ecs.components.route.get(selection.id);
    if (!route) return;
    elements.inspectorTitle.textContent = `${route.kind} route`;
    elements.inspectorSubtitle.textContent = `${getSettlementName(route.fromSettlementId)} → ${getSettlementName(route.toSettlementId)}`;
    rows.push(['Distance', route.distance.toFixed(0)]);
    rows.push(['Capacity', route.capacity.toFixed(2)]);
    rows.push(['Danger', route.danger.toFixed(2)]);
    rows.push(['Patrol', route.patrolCoverage.toFixed(2)]);
    rows.push(['Chokepoint', route.chokepointScore.toFixed(2)]);
  }
  renderInspectorRows(rows);
}

function renderInspectorRows(rows) {
  elements.inspectorGrid.replaceChildren();
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = String(value);
    elements.inspectorGrid.append(dt, dd);
  }
}

function summarizeCargo(goods) {
  const entries = Object.entries(goods).filter(([, amount]) => Number(amount) > 0);
  return entries.length ? entries.map(([good, amount]) => `${good} ${amount}`).join(' · ') : 'empty';
}

function getSettlementName(id) {
  if (!id) return 'unknown';
  return world.ecs.components.settlement.get(id)?.name ?? id;
}

function matchesHit(target, type, id) {
  return Boolean(target && target.type === type && target.id === id);
}

function drawTargetRing(target, color, lineWidth) {
  const hit = hitTargets.find(item => item.type === target.type && item.id === target.id);
  if (!hit) return;
  context.save();
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  if (hit.start && hit.control && hit.end) {
    context.beginPath();
    context.moveTo(hit.start.x, hit.start.y);
    context.quadraticCurveTo(hit.control.x, hit.control.y, hit.end.x, hit.end.y);
    context.stroke();
  } else {
    context.beginPath();
    context.arc(hit.x, hit.y, hit.radius + 6, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();
}

function findTopmostHit(x, y) {
  for (let index = hitTargets.length - 1; index >= 0; index -= 1) {
    const target = hitTargets[index];
    if (target.start && target.control && target.end) {
      if (distanceToQuadratic(target.start, target.control, target.end, x, y) <= target.radius) return target;
      continue;
    }
    if (Math.hypot(target.x - x, target.y - y) <= target.radius) return target;
  }
  return null;
}

function distanceToQuadratic(start, control, end, x, y, segments = 24) {
  let closest = Infinity;
  let previous = start;
  for (let index = 1; index <= segments; index += 1) {
    const point = sampleQuadratic(start, control, end, index / segments);
    closest = Math.min(closest, distanceToSegment(previous, point, x, y));
    previous = point;
  }
  return closest;
}

function distanceToSegment(start, end, x, y) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(x - start.x, y - start.y);
  let t = ((x - start.x) * dx + (y - start.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  const px = start.x + t * dx;
  const py = start.y + t * dy;
  return Math.hypot(x - px, y - py);
}

function loop(now) {
  requestAnimationFrame(loop);
  const delta = Math.min(0.12, (now - lastFrame) / 1000);
  lastFrame = now;
  if (running) {
    accumulator += delta * speed;
    while (accumulator >= 0.25) {
      stepFrontierWorld(world, 1);
      accumulator -= 0.25;
    }
  }
  render();
}

function sampleQuadratic(start, control, end, t) {
  const oneMinus = 1 - t;
  return {
    x: oneMinus * oneMinus * start.x + 2 * oneMinus * t * control.x + t * t * end.x,
    y: oneMinus * oneMinus * start.y + 2 * oneMinus * t * control.y + t * t * end.y,
  };
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width * 0.5, height * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function resetWorld() {
  world = buildWorld();
  selection = null;
  hovered = null;
  accumulator = 0;
  render();
}

function updateHovered(hit) {
  const next = hit ? { type: hit.type, id: hit.id } : null;
  if (sameTarget(hovered, next)) return;
  hovered = next;
  canvas.style.cursor = hovered ? 'pointer' : 'default';
  render();
}

function sameTarget(a, b) {
  return a?.type === b?.type && a?.id === b?.id;
}

canvas.addEventListener('pointermove', event => {
  updateHovered(findTopmostHit(event.clientX, event.clientY));
});

canvas.addEventListener('pointerleave', () => {
  updateHovered(null);
});

canvas.addEventListener('click', event => {
  const hit = findTopmostHit(event.clientX, event.clientY);
  selection = hit ? { type: hit.type, id: hit.id } : null;
  updateInspector();
});

elements.run.addEventListener('click', () => {
  running = !running;
  elements.run.textContent = running ? 'Pause' : 'Resume';
});
elements.step.addEventListener('click', () => {
  stepFrontierWorld(world, 1);
  render();
});
elements.reset.addEventListener('click', resetWorld);
elements.speed.addEventListener('input', () => {
  speed = Number(elements.speed.value) || 4;
  elements.speedReadout.textContent = `${speed}×`;
});
elements.routes.addEventListener('change', () => { overlayState.routes = elements.routes.checked; });
elements.units.addEventListener('change', () => { overlayState.units = elements.units.checked; });
elements.sites.addEventListener('change', () => { overlayState.sites = elements.sites.checked; });
elements.notes.addEventListener('change', () => { overlayState.notes = elements.notes.checked; });
window.addEventListener('resize', () => {
  resizeCanvas();
  render();
});

resizeCanvas();
render();
requestAnimationFrame(loop);
