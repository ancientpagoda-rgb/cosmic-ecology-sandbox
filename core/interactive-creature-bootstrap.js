import { createCreatureRenderer } from './googrid-creatures.js?v=20260810-googrid-creatures-v3-interactive-ids';
import { installCreatureInspector } from './creature-inspector.js?v=20260810-creature-inspector-v1';

const START_TIMEOUT_MS = 12000;

async function start() {
  try {
    await domReady();
    const ready = await waitForSandboxReadyHandle();
    if (ready?.then) await ready;
    await waitForWorld();

    const planet = window.realitySandboxPlanet;
    const runtime = window.realitySandboxUnified;
    const canvas = document.getElementById('lofiLivingCanvas');
    if (!planet?.world?.ecs || !planet?.biosphere || !runtime || !canvas) {
      throw new Error('Interactive creature dependencies never became available.');
    }

    let recoveredRenderer = false;
    if (!window.realitySandboxGoogridCreatures) {
      const renderer = createCreatureRenderer({
        world: planet.world,
        biosphere: planet.biosphere,
        runtime,
        canvas,
      });
      renderer.start();
      planet.googridCreatures = renderer;
      window.realitySandboxGoogridCreatures = renderer;
      recoveredRenderer = true;
      window.dispatchEvent(new CustomEvent('eidolon-googrid-creatures-ready', {
        detail: renderer.getSnapshot(),
      }));
      window.addEventListener('pagehide', renderer.destroy, { once: true });
    }

    let recoveredInspector = false;
    if (!window.realitySandboxCreatureInspector) {
      const inspector = installCreatureInspector(planet);
      planet.creatureInspector = inspector;
      window.realitySandboxCreatureInspector = inspector;
      recoveredInspector = true;
      window.dispatchEvent(new CustomEvent('eidolon-creature-inspector-ready', {
        detail: inspector.getSnapshot(),
      }));
      window.addEventListener('pagehide', inspector.destroy, { once: true });
    }

    const api = {
      getSnapshot() {
        return {
          version: 1,
          model: 'ready-world-idempotent-interactive-creature-bootstrap',
          rendererReady: Boolean(window.realitySandboxGoogridCreatures),
          inspectorReady: Boolean(window.realitySandboxCreatureInspector),
          renderer: window.realitySandboxGoogridCreatures?.getSnapshot?.() || null,
          inspector: window.realitySandboxCreatureInspector?.getSnapshot?.() || null,
          recoveredRenderer,
          recoveredInspector,
        };
      },
    };
    planet.interactiveCreatureBootstrap = api;
    window.realitySandboxInteractiveCreatureBootstrap = api;
    window.dispatchEvent(new CustomEvent('eidolon-interactive-creature-bootstrap-ready', {
      detail: api.getSnapshot(),
    }));
  } catch (error) {
    window.realitySandboxInteractiveCreatureBootstrapError = String(error?.message || error);
    console.warn('[interactive-creature-bootstrap] disabled:', error);
  }
}

function domReady() {
  if (document.readyState !== 'loading') return Promise.resolve();
  return new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
}

function waitForSandboxReadyHandle() {
  if (window.realitySandboxReady) return Promise.resolve(window.realitySandboxReady);
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const poll = () => {
      if (window.realitySandboxReady) return resolve(window.realitySandboxReady);
      if (performance.now() - started >= START_TIMEOUT_MS) return reject(new Error('Sandbox ready promise was never published.'));
      setTimeout(poll, 20);
    };
    poll();
  });
}

function waitForWorld() {
  if (worldReady()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const poll = () => {
      if (worldReady()) return resolve();
      if (performance.now() - started >= START_TIMEOUT_MS) return reject(new Error('Living world globals were never published.'));
      setTimeout(poll, 20);
    };
    poll();
  });
}

function worldReady() {
  return Boolean(
    window.realitySandboxPlanet?.world?.ecs &&
    window.realitySandboxPlanet?.biosphere &&
    window.realitySandboxUnified &&
    document.getElementById('lofiLivingCanvas')
  );
}

if (typeof window !== 'undefined') start();
