import { createWorldState } from './core/world-core/world-state.js';
import { createDemoHistoryModule } from './core/world-core/demo-history-module.js';

const elements = Object.fromEntries(['status','age','ticks','entities','events','timeline','causality','snapshot','step','save','load','determinism'].map(id => [id, document.getElementById(id)]));
let world = makeWorld();
let savedSnapshot = null;

function makeWorld(snapshot = null) {
  const nextWorld = createWorldState({ seed: 'world-core-demo', snapshot });
  const module = createDemoHistoryModule();
  nextWorld.registerModule(module);
  if (snapshot) nextWorld.restoreModules(snapshot);
  return nextWorld;
}

function render(message = 'World Core running') {
  const entities = world.getEntities();
  const timeline = world.history.timeline();
  elements.status.querySelector('span:last-child').textContent = message;
  elements.age.textContent = `${world.getTimeYears().toLocaleString()} yr`;
  elements.ticks.textContent = world.getTick().toLocaleString();
  elements.entities.textContent = entities.length;
  elements.events.textContent = world.history.size;
  elements.timeline.innerHTML = timeline.map(event => `
    <article class="event">
      <strong>${escapeHtml(event.title)}</strong><br>
      <small>${event.time.toLocaleString()} yr · ${escapeHtml(event.type)}</small>
    </article>
  `).join('');
  const latest = timeline.at(-1);
  elements.causality.textContent = latest ? JSON.stringify(world.history.explain(latest.id), null, 2) : 'No events yet.';
  elements.snapshot.textContent = JSON.stringify(world.save(), null, 2);
}

elements.step.addEventListener('click', () => {
  world.step(100);
  render('Advanced 100 simulated years');
});

elements.save.addEventListener('click', () => {
  savedSnapshot = world.save();
  localStorage.setItem('reality-sandbox-world-core-lab', JSON.stringify(savedSnapshot));
  render('Snapshot saved');
});

elements.load.addEventListener('click', () => {
  const snapshot = savedSnapshot || JSON.parse(localStorage.getItem('reality-sandbox-world-core-lab') || 'null');
  if (!snapshot) {
    render('No saved snapshot found');
    return;
  }
  world = makeWorld(snapshot);
  render('Snapshot restored');
});

elements.determinism.addEventListener('click', () => {
  const a = makeWorld();
  const b = makeWorld();
  for (let index = 0; index < 20; index++) {
    a.step(100);
    b.step(100);
  }
  const equal = JSON.stringify(a.save()) === JSON.stringify(b.save());
  render(equal ? 'Determinism test passed' : 'Determinism test failed');
});

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[character]);
}

render();
window.realitySandboxWorldCore = world;
