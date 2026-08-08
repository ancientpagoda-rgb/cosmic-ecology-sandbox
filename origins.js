import { ORIGIN_EPOCHS, createOriginScenario, originScenarioParams } from './core/origin-scenario.js';

const form = document.querySelector('#originForm');
const newUniverse = document.querySelector('#newUniverse');
const seedInput = form.elements.universe;
const fields = ['density', 'energy', 'selection'];
const canvas = document.querySelector('#cosmosCanvas');
const context = canvas.getContext('2d', { alpha: false });
const timeline = document.querySelector('#cosmicTimeline');
const playButton = document.querySelector('#playOrigin');
let cosmicTime = 0;
let playing = false;
let previousFrame = performance.now();

renderEpochs();
loadFromUrl();
refresh();
requestAnimationFrame(animateCosmos);

for (const field of fields) form.elements[field].addEventListener('input', refresh);
seedInput.addEventListener('input', refresh);
timeline.addEventListener('input', () => { cosmicTime = Number(timeline.value) / 1000; playing = false; syncCosmosUi(); });
playButton.addEventListener('click', () => { playing = !playing; playButton.setAttribute('aria-pressed', String(playing)); playButton.textContent = playing ? 'Pause' : 'Play'; });
form.addEventListener('submit', event => {
  event.preventDefault();
  const scenario = currentScenario();
  const url = new URL('./index.html', location.href);
  url.search = originScenarioParams(scenario).toString();
  location.assign(url);
});
newUniverse.addEventListener('click', () => {
  seedInput.value = randomSeed();
  refresh();
});

function currentScenario() {
  return createOriginScenario({
    universeSeed: seedInput.value,
    densityFluctuations: form.elements.density.value,
    energyThroughput: form.elements.energy.value,
    selectionPressure: form.elements.selection.value,
  });
}

function refresh() {
  const scenario = currentScenario();
  seedInput.value = scenario.universeSeed;
  for (const field of fields) document.querySelector(`[data-output="${field}"]`).value = Number(scenario[field === 'density' ? 'densityFluctuations' : field === 'energy' ? 'energyThroughput' : 'selectionPressure']).toFixed(2);
  document.querySelector('#starName').textContent = scenario.star.name;
  document.querySelector('#starClass').textContent = scenario.star.spectralClass;
  document.querySelector('#starMass').textContent = `${scenario.star.mass.toFixed(2)} solar`;
  document.querySelector('#starMetallicity').textContent = `${scenario.star.metallicity >= 0 ? '+' : ''}${scenario.star.metallicity.toFixed(2)} model`;
  document.querySelector('#starAge').textContent = `${scenario.star.age.toFixed(1)} Gyr model`;
  document.querySelector('#planetSeed').textContent = `Planet seed: ${scenario.planetSeed}`;
  syncCosmosUi();
}

function loadFromUrl() {
  const params = new URLSearchParams(location.search);
  seedInput.value = params.get('universe') || 'chaisson-734221';
  for (const field of fields) if (params.has(field)) form.elements[field].value = params.get(field);
}

function renderEpochs() {
  const list = document.querySelector('#epochList');
  list.innerHTML = ORIGIN_EPOCHS.map(([title, detail], index) => `<li style="--delay:${index * 85}ms"><button type="button" data-epoch="${index}"><span>${String(index + 1).padStart(2, '0')}</span><div><strong>${title} epoch</strong><p>${detail}</p></div></button></li>`).join('');
  for (const button of list.querySelectorAll('[data-epoch]')) button.addEventListener('click', () => {
    cosmicTime = Number(button.dataset.epoch) / ORIGIN_EPOCHS.length + 0.015;
    playing = false;
    syncCosmosUi();
  });
}

function randomSeed() {
  const values = new Uint32Array(2);
  crypto.getRandomValues(values);
  return `universe-${[...values].map(value => value.toString(36)).join('-')}`;
}

function syncCosmosUi() {
  const state = cosmicState(cosmicTime);
  timeline.value = Math.round(cosmicTime * 1000);
  document.querySelector('#timelinePercent').value = `${(cosmicTime * 100).toFixed(1)}%`;
  document.querySelector('#epochTitle').textContent = `${state.title} epoch`;
  document.querySelector('#epochDetail').textContent = state.detail;
  document.querySelector('#ageReadout').textContent = state.age;
  document.querySelector('#metricErd').textContent = state.erd >= 1000 ? `${Math.round(state.erd).toLocaleString()}×` : `${state.erd.toFixed(state.erd < 10 ? 2 : 0)}×`;
  document.querySelector('#metricComplexity').textContent = `${Math.round(state.complexity * 100)}%`;
  document.querySelector('#metricEntropy').textContent = `${Math.round(state.entropy * 100)}%`;
  document.querySelector('#metricGradient').textContent = `${Math.round(state.gradient * 100)}%`;
  for (const button of document.querySelectorAll('[data-epoch]')) button.classList.toggle('active', Number(button.dataset.epoch) === state.epoch);
}

function cosmicState(time) {
  const epoch = Math.min(ORIGIN_EPOCHS.length - 1, Math.floor(Math.min(.999999, time) * ORIGIN_EPOCHS.length));
  const progress = time * ORIGIN_EPOCHS.length - epoch;
  const [title, detail] = ORIGIN_EPOCHS[epoch];
  const scenario = currentScenario();
  const baseErd = [.02, .35, 1, 100, 350, 1000, 1000000][epoch];
  const age = formatAge(epoch, progress);
  return {
    epoch, progress, title, detail, age,
    erd: baseErd * scenario.energyThroughput * (.7 + progress * .5),
    complexity: Math.min(1, .02 + time ** .78),
    entropy: Math.min(1, .02 + time ** .68 * .96),
    gradient: Math.min(1, Math.max(0, (.18 + time * .82) * scenario.energyThroughput)),
  };
}

function formatAge(epoch, progress) {
  const ranges = [
    ['first instants', '380 thousand years'], ['380 thousand years', '120 million years'], ['120 million years', '9.2 billion years'],
    ['9.2', '9.3 billion years'], ['9.3', '10.2 billion years'], ['10.2', '13.794 billion years'], ['13.794', '13.8 billion years'],
  ];
  const [from, to] = ranges[epoch];
  return progress < .05 ? `Cosmic age: ${from}` : `Cosmic age: ${from} → ${to}`;
}

function animateCosmos(now) {
  const delta = Math.min(.05, (now - previousFrame) / 1000);
  previousFrame = now;
  if (playing) {
    cosmicTime += delta * .09;
    if (cosmicTime >= 1) { cosmicTime = 1; playing = false; playButton.setAttribute('aria-pressed', 'false'); playButton.textContent = 'Play'; }
    syncCosmosUi();
  }
  drawCosmos(now);
  requestAnimationFrame(animateCosmos);
}

function drawCosmos(now) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(2, devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  const w = rect.width, h = rect.height;
  const state = cosmicState(cosmicTime);
  const random = seededRandom(`${currentScenario().universeSeed}:cosmos:${state.epoch}`);
  const background = context.createRadialGradient(w * .5, h * .45, 0, w * .5, h * .5, Math.max(w, h));
  background.addColorStop(0, state.epoch === 0 ? '#302037' : '#0b1326');
  background.addColorStop(1, '#02030a');
  context.fillStyle = background;
  context.fillRect(0, 0, w, h);
  if (state.epoch === 0) drawPlasma(w, h, state, now, random);
  else if (state.epoch === 1) drawCosmicWeb(w, h, state, now, random);
  else if (state.epoch === 2) drawGalaxy(w, h, state, now, random);
  else if (state.epoch === 3) drawDisk(w, h, state, now, random);
  else if (state.epoch === 4) drawChemistry(w, h, state, now, random);
  else if (state.epoch === 5) drawBiosphere(w, h, state, now, random);
  else drawCulture(w, h, state, now, random);
}

function drawPlasma(w, h, state, now, random) {
  const cx = w * .5, cy = h * .5, radius = Math.min(w, h) * (.12 + state.progress * .42);
  context.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 420; i++) {
    const angle = random() * Math.PI * 2 + now * .0001;
    const distance = Math.sqrt(random()) * radius;
    context.fillStyle = `hsla(${255 + random() * 80} 85% 70% / ${.1 + random() * .45})`;
    context.beginPath(); context.arc(cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance * .7, .4 + random() * 1.5, 0, Math.PI * 2); context.fill();
  }
  context.globalCompositeOperation = 'source-over';
}

function drawCosmicWeb(w, h, state, now, random) {
  const nodes = Array.from({ length: 45 }, () => ({ x: random() * w, y: random() * h, r: 1 + random() * 4 }));
  context.strokeStyle = 'rgba(133,155,255,.23)'; context.lineWidth = 1;
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j], distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (distance < Math.min(w, h) * .2) { context.globalAlpha = 1 - distance / (Math.min(w, h) * .2); context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke(); }
  }
  context.globalAlpha = 1; context.globalCompositeOperation = 'lighter';
  for (const node of nodes) { const glow = context.createRadialGradient(node.x, node.y, 0, node.x, node.y, node.r * 7); glow.addColorStop(0, 'rgba(220,230,255,.9)'); glow.addColorStop(1, 'rgba(90,110,255,0)'); context.fillStyle = glow; context.beginPath(); context.arc(node.x, node.y, node.r * 7, 0, Math.PI * 2); context.fill(); }
  context.globalCompositeOperation = 'source-over';
}

function drawGalaxy(w, h, state, now, random) {
  const cx = w / 2, cy = h / 2, radius = Math.min(w, h) * .45;
  context.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 1100; i++) { const r = Math.sqrt(random()) * radius; const a = random() * Math.PI * 2 + r / radius * 5 + now * .00001; context.fillStyle = `rgba(210,225,255,${.1 + (1 - r / radius) * .55})`; context.beginPath(); context.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r * .4, .3 + random() * 1.5, 0, Math.PI * 2); context.fill(); }
  context.globalCompositeOperation = 'source-over';
}

function drawDisk(w, h, state, now, random) {
  const cx = w / 2, cy = h / 2, scale = Math.min(w, h);
  const glow = context.createRadialGradient(cx, cy, 0, cx, cy, scale * .15); glow.addColorStop(0, '#fff3c8'); glow.addColorStop(.2, '#ffb062'); glow.addColorStop(1, 'rgba(255,120,50,0)'); context.fillStyle = glow; context.beginPath(); context.arc(cx, cy, scale * .15, 0, Math.PI * 2); context.fill();
  context.save(); context.translate(cx, cy); context.scale(1, .38); context.strokeStyle = 'rgba(183,208,255,.25)'; for (let i = 1; i < 7; i++) { context.beginPath(); context.ellipse(0, 0, scale * (.07 + i * .05), scale * (.07 + i * .05), 0, 0, Math.PI * 2); context.stroke(); } context.restore();
  for (let i = 0; i < 5; i++) { const radius = scale * (.12 + i * .055); const angle = now * .00003 / (i + 1) + i; context.fillStyle = i > 2 ? '#8bb0cf' : '#c78f6c'; context.beginPath(); context.arc(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius * .38, 3 + i * 1.5, 0, Math.PI * 2); context.fill(); }
}

function drawChemistry(w, h, state, now, random) {
  context.fillStyle = '#123648'; context.fillRect(0, h * .58, w, h * .42); context.fillStyle = '#1b1b25'; context.fillRect(0, h * .53, w, h * .07);
  context.globalCompositeOperation = 'lighter'; for (let i = 0; i < 220; i++) { const x = random() * w, y = h * .58 + random() * h * .4; context.strokeStyle = random() > .5 ? 'rgba(114,231,255,.5)' : 'rgba(217,156,255,.45)'; context.beginPath(); context.arc(x + Math.sin(now * .001 + i) * 7, y, 2 + random() * 5, 0, Math.PI * 2); context.stroke(); } context.globalCompositeOperation = 'source-over';
}

function drawBiosphere(w, h, state, now, random) {
  const sky = context.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#1b4e73'); sky.addColorStop(.58, '#7bb6c5'); sky.addColorStop(.59, '#174f5e'); sky.addColorStop(1, '#061c22'); context.fillStyle = sky; context.fillRect(0, 0, w, h);
  context.fillStyle = '#285c3c'; context.beginPath(); context.moveTo(0, h); context.lineTo(0, h * .73); for (let x = 0; x <= w; x += 18) context.lineTo(x, h * (.68 + random() * .14)); context.lineTo(w, h); context.closePath(); context.fill();
  context.fillStyle = 'rgba(143,228,145,.72)'; for (let i = 0; i < 95; i++) { const x = random() * w, y = h * (.68 + random() * .25); context.fillRect(x, y - random() * 18, 1.5, 18 + random() * 18); }
}

function drawCulture(w, h, state, now, random) {
  drawBiosphere(w, h, state, now, random); context.globalCompositeOperation = 'screen'; context.fillStyle = 'rgba(255,213,110,.75)'; for (let i = 0; i < 180; i++) { const x = random() * w, y = h * (.6 + random() * .32); context.beginPath(); context.arc(x, y, .8 + random() * 2, 0, Math.PI * 2); context.fill(); } context.globalCompositeOperation = 'source-over';
}

function seededRandom(seed) {
  let value = 2166136261;
  for (const character of seed) { value ^= character.charCodeAt(0); value = Math.imul(value, 16777619); }
  return () => { value += 0x6d2b79f5; let t = value; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
