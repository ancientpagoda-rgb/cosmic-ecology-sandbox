import { createWorldState } from './core/world-core/world-state.js';
import { createGridState, clamp } from './core/world-core/grid-state.js';
import { createGeologyModule } from './core/world-core/modules/geology.js';
import { createHydrologyModule } from './core/world-core/modules/hydrology.js';
import { createEcologyModule, createFireModule } from './core/world-core/modules/ecology.js';
import { createAgricultureModule, createSettlementModule, createRoadTradeModule } from './core/world-core/modules/civilization.js';

const canvas = document.getElementById('world');
const ctx = canvas.getContext('2d', { alpha: false });
const controls = Object.fromEntries(['uplift','rain','temp','speed'].map(id => [id, document.getElementById(id)]));
const stats = Object.fromEntries(['age','rivers','forest','cities','population','farms','roads','fires','floods','collapsed'].map(id => [id, document.getElementById(id)]));
let world;
let grid;
let accumulator = 0;
let last = performance.now();
let seed = `emergence-${Date.now()}`;

function buildWorld() {
  grid = createGridState(128, 88);
  world = createWorldState({ seed });
  world.registerModule(createGeologyModule(grid, { uplift: Number(controls.uplift.value) }));
  world.registerModule(createHydrologyModule(grid, { rainfall: Number(controls.rain.value) }));
  world.registerModule(createEcologyModule(grid, { temperature: Number(controls.temp.value) }));
  world.registerModule(createFireModule(grid, { temperature: Number(controls.temp.value) }));
  world.registerModule(createAgricultureModule(grid));
  world.registerModule(createSettlementModule(grid));
  world.registerModule(createRoadTradeModule(grid));
  window.realitySandboxEmergence = { world, grid };
}

function step(years = 20) {
  world.step(years);
}

function render() {
  const image = ctx.createImageData(grid.width, grid.height);
  let riverCells = 0, forestSum = 0, farmSum = 0, activeFires = 0, floodedCells = 0;
  for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) {
    const i = grid.index(x, y);
    const river = grid.flow[i] > 0.08;
    if (river) riverCells++;
    if (grid.fire[i] > 0.08) activeFires++;
    if (grid.flood[i] > 0.12) floodedCells++;
    forestSum += grid.vegetation[i];
    farmSum += grid.farms[i];
    let color;
    if (grid.elevation[i] < grid.seaLevel) color = [18, 61, 91];
    else if (grid.elevation[i] < grid.seaLevel + 0.05) color = [72, 92, 76];
    else if (grid.elevation[i] > 0.78) color = [172, 170, 159];
    else {
      const green = grid.vegetation[i];
      const dry = 1 - grid.moisture[i];
      color = [72 + dry * 70 - green * 28, 88 + green * 80 - dry * 26, 57 + green * 30];
    }
    if (grid.farms[i] > 0.05) color = mix(color, [182, 155, 88], grid.farms[i] * 0.8);
    if (grid.flood[i] > 0.12) color = mix(color, [53, 113, 137], grid.flood[i] * 0.55);
    if (river && grid.elevation[i] >= grid.seaLevel) color = [28, 106, 151];
    if (grid.fire[i] > 0.08) color = mix(color, [197, 86, 42], grid.fire[i]);
    const shade = clamp(0.78 + (x ? grid.elevation[i] - grid.elevation[grid.index(x - 1, y)] : 0) * 7, 0.55, 1.18);
    const p = i * 4;
    image.data[p] = clamp(color[0] * shade, 0, 255);
    image.data[p + 1] = clamp(color[1] * shade, 0, 255);
    image.data[p + 2] = clamp(color[2] * shade, 0, 255);
    image.data[p + 3] = 255;
  }
  const buffer = document.createElement('canvas');
  buffer.width = grid.width;
  buffer.height = grid.height;
  buffer.getContext('2d').putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(buffer, 0, 0, canvas.width, canvas.height);
  drawRoads();
  drawCities();

  const alive = grid.settlements.filter(city => city.alive);
  stats.age.textContent = `${Math.round(world.getTimeYears()).toLocaleString()} yr`;
  stats.rivers.textContent = riverCells.toLocaleString();
  stats.forest.textContent = `${Math.round(forestSum / grid.size * 100)}%`;
  stats.cities.textContent = alive.length;
  stats.population.textContent = Math.round(alive.reduce((sum, city) => sum + city.population, 0)).toLocaleString();
  stats.farms.textContent = `${Math.round(farmSum / grid.size * 100)}%`;
  stats.roads.textContent = grid.roads.length;
  stats.fires.textContent = activeFires;
  stats.floods.textContent = floodedCells;
  stats.collapsed.textContent = grid.collapsedCount;
}

function drawRoads() {
  ctx.strokeStyle = 'rgba(150,155,160,.55)';
  ctx.lineWidth = 1.4;
  for (const road of grid.roads) {
    const a = grid.settlements.find(city => city.id === road.aId);
    const b = grid.settlements.find(city => city.id === road.bId);
    if (!a?.alive || !b?.alive) continue;
    ctx.beginPath();
    ctx.moveTo((a.x + 0.5) / grid.width * canvas.width, (a.y + 0.5) / grid.height * canvas.height);
    ctx.lineTo((b.x + 0.5) / grid.width * canvas.width, (b.y + 0.5) / grid.height * canvas.height);
    ctx.stroke();
  }
}

function drawCities() {
  for (const city of grid.settlements) {
    const x = (city.x + 0.5) / grid.width * canvas.width;
    const y = (city.y + 0.5) / grid.height * canvas.height;
    const size = 2.5 + Math.log10(city.population + 1) * 2.3;
    ctx.beginPath(); ctx.arc(x, y, size + 3, 0, Math.PI * 2);
    ctx.fillStyle = city.alive ? 'rgba(255,205,120,.18)' : 'rgba(80,80,80,.16)'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fillStyle = city.alive ? '#f0c27b' : '#55585c'; ctx.fill();
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const speed = Number(controls.speed.value);
  if (speed > 0) {
    accumulator += dt * speed;
    while (accumulator >= 0.18) { step(20); accumulator -= 0.18; }
  }
  render();
}

canvas.addEventListener('pointerdown', event => {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) / rect.width * grid.width);
  const y = Math.floor((event.clientY - rect.top) / rect.height * grid.height);
  const i = grid.safeIndex(x, y);
  if (i >= 0) grid.elevation[i] = clamp(grid.elevation[i] + 0.08, 0, 1.4);
});
document.getElementById('reset').addEventListener('click', () => { seed = `emergence-${Date.now()}-${Math.random()}`; buildWorld(); render(); });
document.getElementById('step').addEventListener('click', () => { for (let i = 0; i < 5; i++) step(20); render(); });

function mix(a, b, t) { return a.map((value, index) => value + (b[index] - value) * clamp(t, 0, 1)); }

buildWorld();
render();
requestAnimationFrame(frame);
