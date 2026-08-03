import { createWorldState } from './core/world-core/world-state.js';
import { createGridState, clamp } from './core/world-core/grid-state.js';
import { createGeologyModule } from './core/world-core/modules/geology.js';
import { createHydrologyModule } from './core/world-core/modules/hydrology.js';
import { createEcologyModule, createFireModule } from './core/world-core/modules/ecology.js';
import { createAgricultureModule, createSettlementModule, createRoadTradeModule } from './core/world-core/modules/civilization.js';
import { createCanvasSphereView } from './core/world-core/canvas-sphere-view.js';

const canvas = document.getElementById('world');
const controls = Object.fromEntries(['uplift','rain','temp','speed'].map(id => [id, document.getElementById(id)]));
const stats = Object.fromEntries(['age','rivers','forest','cities','population','farms','roads','fires','floods','collapsed'].map(id => [id, document.getElementById(id)]));
let world, grid, sphereView;
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
  sphereView = createCanvasSphereView(canvas, grid);
  window.realitySandboxEmergence = { world, grid, sphereView };
}

function colorForCell(i, x) {
  const river = grid.flow[i] > 0.08;
  let color;
  if (grid.elevation[i] < grid.seaLevel) color = [18,61,91];
  else if (grid.elevation[i] < grid.seaLevel + 0.05) color = [72,92,76];
  else if (grid.elevation[i] > 0.78) color = [172,170,159];
  else {
    const green = grid.vegetation[i];
    const dry = 1 - grid.moisture[i];
    color = [72 + dry * 70 - green * 28, 88 + green * 80 - dry * 26, 57 + green * 30];
  }
  if (grid.farms[i] > 0.05) color = mix(color,[182,155,88],grid.farms[i]*0.8);
  if (grid.flood[i] > 0.12) color = mix(color,[53,113,137],grid.flood[i]*0.55);
  if (river && grid.elevation[i] >= grid.seaLevel) color = [28,106,151];
  if (grid.fire[i] > 0.08) color = mix(color,[197,86,42],grid.fire[i]);
  const shade = clamp(0.78 + (x ? grid.elevation[i] - grid.elevation[i - 1] : 0) * 7, 0.55, 1.18);
  return color.map(value => clamp(Math.round(value * shade), 0, 255));
}

function updateStats() {
  let rivers=0, forest=0, farms=0, fires=0, floods=0;
  for (let i=0;i<grid.size;i++) {
    if (grid.flow[i] > 0.08) rivers++;
    if (grid.fire[i] > 0.08) fires++;
    if (grid.flood[i] > 0.12) floods++;
    forest += grid.vegetation[i];
    farms += grid.farms[i];
  }
  const alive = grid.settlements.filter(city => city.alive);
  stats.age.textContent = `${Math.round(world.getTimeYears()).toLocaleString()} yr`;
  stats.rivers.textContent = rivers.toLocaleString();
  stats.forest.textContent = `${Math.round(forest / grid.size * 100)}%`;
  stats.cities.textContent = alive.length;
  stats.population.textContent = Math.round(alive.reduce((sum, city) => sum + city.population, 0)).toLocaleString();
  stats.farms.textContent = `${Math.round(farms / grid.size * 100)}%`;
  stats.roads.textContent = grid.roads.length;
  stats.fires.textContent = fires;
  stats.floods.textContent = floods;
  stats.collapsed.textContent = grid.collapsedCount;
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const speed = Number(controls.speed.value);
  if (speed > 0) {
    accumulator += dt * speed;
    while (accumulator >= 0.18) { world.step(20); accumulator -= 0.18; }
  }
  sphereView.render(colorForCell);
  updateStats();
}

document.getElementById('reset').addEventListener('click', () => {
  seed = `emergence-${Date.now()}-${Math.random()}`;
  buildWorld();
});
document.getElementById('step').addEventListener('click', () => {
  for (let i=0;i<5;i++) world.step(20);
  sphereView.render(colorForCell);
  updateStats();
});

function mix(a,b,t){return a.map((value,index)=>value+(b[index]-value)*clamp(t,0,1));}

buildWorld();
sphereView.render(colorForCell);
updateStats();
requestAnimationFrame(frame);
