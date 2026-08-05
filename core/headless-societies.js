import { createHeadlessCivilizationEngine as createBaseEngine } from './headless-civilization-engine.js';

export function createHeadlessCivilizationEngine(...args) {
  const engine = createBaseEngine(...args);
  const getBaseRoutes = engine.getRoutes.bind(engine);

  return {
    ...engine,
    getRoutes() {
      return getBaseRoutes().map(route => ({
        ...route,
        id: route.id || route.edgeId,
        kind: route.kind === 'exchange' ? 'trade' : route.kind,
      }));
    },
  };
}
