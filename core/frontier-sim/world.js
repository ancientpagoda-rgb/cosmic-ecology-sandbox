import { createFrontierEcs } from './ecs.js';

export const FRONTIER_SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const FRONTIER_GOODS = ['grain', 'fish', 'timber', 'ore', 'salt', 'tools', 'luxury'];
export const SETTLEMENT_KINDS = ['hamlet', 'village', 'town', 'port', 'city'];
export const ROUTE_KINDS = ['road', 'river', 'seaLane'];
export const SITE_KINDS = ['watchtower', 'fort', 'castle', 'raiderCove', 'shipyard', 'market'];
export const UNIT_KINDS = ['caravan', 'merchantShip', 'patrolShip', 'raiderShip', 'militia'];

export function createFrontierWorld(options = {}) {
  const width = Math.max(1, Math.round(options.width || 1200));
  const height = Math.max(1, Math.round(options.height || 720));
  return {
    id: 'frontier.pirates-castles-sim',
    tick: 0,
    year: 0,
    seasonIndex: 0,
    season: FRONTIER_SEASONS[0],
    width,
    height,
    ecs: createFrontierEcs(),
    globals: {
      foodStress: 0,
      piracyPressure: 0,
      castlePressure: 0,
      statePressure: 0,
    },
    stats: {
      totalPopulation: 0,
      totalTradeValue: 0,
      activeRaiders: 0,
      castles: 0,
      factions: 0,
    },
    mapFeatures: {
      regions: [],
      notes: [],
    },
  };
}
