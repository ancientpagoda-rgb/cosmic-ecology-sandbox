import { createOpenSpaceAdapter } from './core/adapters/openspace-adapter.js';

const ui = Object.fromEntries(['status','endpoint','connect','sync','download','asset','time','objects'].map(id => [id, document.getElementById(id)]));
let years = 0;
let adapter = createAdapter();
let connected = false;

const snapshot = () => ({
  version: 1,
  seed: 'reality-sandbox-main',
  time: { years, scale: 1 },
  camera: { position: [0, 0, 3.2], target: [0, 0, 0], scale: 1 },
  objects: [{
    id: 'RealitySandboxPlanet',
    type: 'planet',
    position: [0, 0, 0],
    radius: 1,
    scale: 1,
    renderer: 'potree',
    attributes: { procedural: true, pointCloud: true, livingSimulation: true },
  }],
});

function createAdapter() {
  const next = createOpenSpaceAdapter({ endpoint: ui.endpoint.value.trim() });
  next.subscribe(event => {
    connected = event.status === 'connected';
    ui.status.textContent = label(event.status);
    ui.status.className = `status ${event.status}`;
    ui.connect.textContent = connected ? 'Disconnect' : 'Connect';
  });
  return next;
}

ui.connect.addEventListener('click', () => {
  if (connected) {
    adapter.disconnect();
    return;
  }
  adapter.disconnect();
  adapter = createAdapter();
  adapter.connect();
});

ui.sync.addEventListener('click', () => {
  const state = snapshot();
  adapter.syncKernel(state);
  adapter.setTime(years);
  ui.asset.value = adapter.exportOpenSpaceAsset(state);
});

ui.download.addEventListener('click', () => {
  const text = adapter.exportOpenSpaceAsset(snapshot());
  ui.asset.value = text;
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'reality-sandbox-planet.asset';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

setInterval(() => {
  years += 20;
  ui.time.textContent = `${years.toLocaleString()} yr`;
  ui.objects.textContent = snapshot().objects.length;
  if (connected) adapter.setTime(years);
}, 1000);

ui.asset.value = adapter.exportOpenSpaceAsset(snapshot());

function label(status) {
  return ({ connected: 'Connected', connecting: 'Connecting…', error: 'Connection error', disconnected: 'Disconnected' })[status] || status;
}
