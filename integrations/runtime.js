import { integrationCatalog } from './catalog.js';

export function registerCurrentModules(host, systems) {
  const catalog = new Map(integrationCatalog.map(item => [item.id, item]));

  host.register(moduleFromCatalog(catalog.get('render.three'), {
    provides: ['rendering.globe', 'rendering.webgl'],
    initialize({ provideCapability }) {
      provideCapability('rendering.globe', systems.globe);
      provideCapability('rendering.webgl', systems.globe);
    },
  }));

  host.register({
    id: 'hydrology.browser',
    name: 'Browser Water Cycle',
    version: '1.0.0',
    execution: 'browser-worker-ready',
    source: 'Reality Sandbox; D8 routing and semi-Lagrangian-style transport concepts',
    license: 'Project license',
    provides: ['hydrology.surface', 'atmosphere.moisture'],
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
