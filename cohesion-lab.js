import { createScaleRuntime } from './core/scale-runtime.js';

const status = document.getElementById('status');
const distanceInput = document.getElementById('distance');
const distanceValue = document.getElementById('distanceValue');
const lodRoot = document.getElementById('lod');
const tier = document.getElementById('tier');
const altitude = document.getElementById('altitude');
const longitude = document.getElementById('longitude');
const latitude = document.getElementById('latitude');
const tile = document.getElementById('tile');
const entity = document.getElementById('entity');
const budget = document.getElementById('budget');
const snapshot = document.getElementById('snapshot');

const lodNames = ['surface', 'region', 'planet', 'system', 'galaxy'];
const lodRows = new Map();

for (const name of lodNames) {
  const row = document.createElement('div');
  row.className = 'lod-row';
  row.innerHTML = `<span>${name}</span><div class="track"><div class="fill"></div></div><output>0%</output>`;
  lodRoot.append(row);
  lodRows.set(name, {
    fill: row.querySelector('.fill'),
    output: row.querySelector('output'),
  });
}

try {
  const runtime = createScaleRuntime({ planetId: 'gaia', distance: Number(distanceInput.value) });
  runtime.registerEntity({ id: 'milky-way', scale: 'galaxy', kind: 'galaxy' });
  runtime.registerEntity({ id: 'sol', scale: 'system', kind: 'star' });
  runtime.registerEntity({ id: 'gaia', scale: 'planet', kind: 'planet' });
  runtime.registerEntity({ id: 'surface-player', scale: 'surface', kind: 'character' });
  runtime.aggregateEntity('gaia', { scale: 'system', type: 'orbit-dot' });
  runtime.aggregateEntity('gaia', { scale: 'planet', type: 'globe' });
  runtime.aggregateEntity('gaia', { scale: 'surface', type: 'terrain' });

  function render() {
    const distance = Number(distanceInput.value);
    const rotationY = Math.sin(distance * 0.13) * 0.7;
    const rotationX = Math.cos(distance * 0.09) * 0.35;
    const state = runtime.updateCamera({ distance, rotationX, rotationY });
    const address = runtime.geospatialAddress(
      Math.max(0, Math.min(12, Math.round(14 - Math.log2(Math.max(1.01, distance))))),
      state.camera.longitude,
      state.camera.latitude,
    );

    distanceValue.textContent = distance.toFixed(2);
    for (const name of lodNames) {
      const value = state.lod[name] || 0;
      const row = lodRows.get(name);
      row.fill.style.width = `${(value * 100).toFixed(2)}%`;
      row.output.textContent = `${Math.round(value * 100)}%`;
    }

    tier.textContent = state.activeTier;
    altitude.textContent = state.camera.altitude.toFixed(3);
    longitude.textContent = `${(state.camera.longitude * 180 / Math.PI).toFixed(2)}°`;
    latitude.textContent = `${(state.camera.latitude * 180 / Math.PI).toFixed(2)}°`;
    tile.textContent = address.key;

    const gaia = runtime.getEntity('gaia');
    const persistenceOk = Boolean(
      gaia &&
      gaia.representations?.system &&
      gaia.representations?.planet &&
      gaia.representations?.surface
    );
    entity.textContent = persistenceOk ? 'PASS' : 'FAIL';
    entity.className = persistenceOk ? 'good' : 'bad';
    budget.textContent = JSON.stringify(runtime.simulationBudget(), null, 2);
    snapshot.textContent = JSON.stringify({
      camera: state.camera,
      lod: state.lod,
      activeTier: state.activeTier,
      lighting: state.lighting,
      tile: address,
    }, null, 2);
  }

  distanceInput.addEventListener('input', render, { passive: true });
  render();
  status.querySelector('span:last-child').textContent = 'Runtime loaded successfully';
  window.realitySandboxCohesionLab = runtime;
} catch (error) {
  status.classList.add('error');
  status.querySelector('span:last-child').textContent = `Runtime failed: ${error?.message || error}`;
  snapshot.textContent = error?.stack || String(error);
}
