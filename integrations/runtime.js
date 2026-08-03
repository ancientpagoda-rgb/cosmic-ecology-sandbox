import { integrationCatalog } from './catalog.js';
import { createReboundAdapter } from './rebound-adapter.js';

export function registerCurrentModules(host, systems) {
  const catalog = new Map(integrationCatalog.map(item => [item.id, item]));

  host.register(moduleFromCatalog(catalog.get('render.three'), {
    provides: ['rendering.globe', 'rendering.webgl'],
    initialize({ provideCapability }) {
      provideCapability('rendering.globe', systems.globe);
      provideCapability('rendering.webgl', systems.globe);
    },
  }));

  host.register(createLazyRapierModule());
  host.register(createReboundAdapter({ endpoint: systems.reboundEndpoint || null }));
  host.register(createLazyGdalModule());

  if (systems.orbitalSystem) {
    host.register({
      ...systems.orbitalSystem,
      initialize({ provideCapability }) {
        provideCapability('orbits.system', systems.orbitalSystem);
        provideCapability('climate.seasons', systems.orbitalSystem);
        provideCapability('hydrology.tides', systems.orbitalSystem);
      },
    });
  }

  host.register({
    id: 'hydrology.browser',
    name: 'Browser Water Cycle',
    version: '1.1.0',
    execution: 'browser-worker-ready',
    source: 'Reality Sandbox; D8 routing and semi-Lagrangian-style transport concepts',
    license: 'Project license',
    provides: ['hydrology.surface', 'atmosphere.moisture'],
    requires: systems.orbitalSystem ? ['climate.seasons', 'hydrology.tides'] : [],
    initialize({ provideCapability }) {
      provideCapability('hydrology.surface', systems.waterCycle);
      provideCapability('atmosphere.moisture', systems.waterCycle);
    },
    step(dt) { systems.waterCycle.step(dt); },
  });

  host.register({
    id: 'ecology.browser',
    name: 'Living Biosphere',
    version: '1.0.0',
    execution: 'browser',
    provides: ['ecology.species', 'vegetation.dynamic'],
    requires: ['hydrology.surface'],
    initialize({ provideCapability }) {
      provideCapability('ecology.species', systems.biosphere);
      provideCapability('vegetation.dynamic', systems.living);
    },
    step(dt) {
      systems.living.step(dt);
      systems.biosphere.step(dt);
    },
  });

  host.register({
    id: 'planet.dynamics',
    name: 'Planet Dynamics',
    version: '1.0.0',
    execution: 'browser',
    provides: ['planet.weather', 'planet.geology'],
    requires: ['hydrology.surface'],
    initialize({ provideCapability }) {
      provideCapability('planet.weather', systems.dynamics);
      provideCapability('planet.geology', systems.dynamics);
    },
    step(dt) { systems.dynamics.step(dt); },
  });

  return host;
}

function createLazyRapierModule() {
  let adapterPromise = null;
  let adapter = null;

  async function load() {
    if (adapter) return adapter;
    if (!adapterPromise) {
      adapterPromise = import('./rapier-adapter.js')
        .then(({ createRapierAdapter }) => createRapierAdapter())
        .then(async instance => {
          await instance.initialize({ provideCapability() {} });
          adapter = instance;
          return instance;
        });
    }
    return adapterPromise;
  }

  return {
    id: 'physics.rapier',
    name: 'Rapier Physics (on demand)',
    version: '0.19.3',
    execution: 'lazy-wasm',
    source: '@dimforge/rapier3d-compat',
    license: 'Apache-2.0',
    provides: ['physics.loader'],
    initialize({ provideCapability }) {
      provideCapability('physics.loader', { load });
    },
    step(dt) { adapter?.step(dt); },
    loadEngine: load,
    isLoaded: () => Boolean(adapter),
  };
}

function createLazyGdalModule() {
  let adapterPromise = null;

  async function load() {
    if (!adapterPromise) {
      adapterPromise = import('./gdal-adapter.js')
        .then(({ createGdalAdapter }) => createGdalAdapter());
    }
    return adapterPromise;
  }

  return {
    id: 'gis.gdal',
    name: 'GDAL GIS (on demand)',
    version: '2.8.1',
    execution: 'lazy-wasm-worker',
    source: 'gdal3.js / GDAL',
    license: 'MIT and GDAL MIT/X-style',
    provides: ['gis.loader'],
    initialize({ provideCapability }) {
      provideCapability('gis.loader', { load });
    },
    loadEngine: load,
  };
}

function moduleFromCatalog(item, overrides = {}) {
  return {
    id: item.id,
    name: item.name,
    version: '1.0.0',
    execution: item.execution,
    source: item.upstream.join(', '),
    license: 'See THIRD_PARTY_NOTICES.md',
    provides: item.capabilities,
    ...overrides,
  };
}
