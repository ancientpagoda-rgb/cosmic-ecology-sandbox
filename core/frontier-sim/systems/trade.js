import { createMobileUnit } from '../spawners.js';
import { clamp, findSettlement, routeEndpoints } from '../utils.js';

const TRADE_GOOD_BY_ROUTE = {
  road: ['grain', 'timber', 'ore'],
  river: ['grain', 'salt', 'timber'],
  seaLane: ['grain', 'tools', 'luxury', 'salt'],
};

export function runTradeSystem(world, dt) {
  const ecs = world.ecs;
  const activeRouteIds = new Set();

  for (const settlement of ecs.components.settlement.values()) {
    settlement.tradeValue = 0;
  }

  for (const [routeId, route] of ecs.components.route.entries()) {
    const endpoints = routeEndpoints(ecs, route);
    if (!endpoints) continue;
    const { from, to } = endpoints;
    const surplusGap = Math.max(0, from.settlement.foodStored - to.settlement.foodStored);
    const coinGap = Math.max(0, to.settlement.coinStored - from.settlement.coinStored);
    const riskPenalty = clamp(route.danger * 0.7 - route.patrolCoverage * 0.5, 0, 1);
    const routeValue = Math.max(0, surplusGap * 0.02 + coinGap * 0.015 - riskPenalty * 4);
    const goods = buildTradeManifest(route.kind, routeValue);

    route.activeTrade = goods.length ? [{ good: goods[0].good, volume: goods[0].amount, value: routeValue }] : [];
    from.settlement.tradeValue += routeValue;
    to.settlement.tradeValue += routeValue * 0.8;
    activeRouteIds.add(routeId);

    if (routeValue <= 0.8) continue;
    const alreadyAssigned = [...ecs.components.mobileUnit.values()].some(unit => unit.routeId === routeId && (unit.kind === 'caravan' || unit.kind === 'merchantShip'));
    if (alreadyAssigned) continue;

    const kind = route.kind === 'seaLane' ? 'merchantShip' : 'caravan';
    createMobileUnit(ecs, {
      kind,
      factionId: from.settlement.factionId,
      homeSettlementId: from.id,
      targetId: to.id,
      routeId,
      state: 'trading',
      crew: kind === 'merchantShip' ? 18 : 8,
      strength: kind === 'merchantShip' ? 10 : 5,
      speed: kind === 'merchantShip' ? 1.08 : 0.72,
      morale: 0.7,
      goods: Object.fromEntries(goods.map(item => [item.good, item.amount])),
      maxCapacity: kind === 'merchantShip' ? 90 : 40,
      position: { x: from.position.x, y: from.position.y },
      tileId: from.position.tileId,
      worldWidth: world.width,
      worldHeight: world.height,
    });
  }

  for (const [id, unit] of ecs.components.mobileUnit.entries()) {
    if (!activeRouteIds.has(unit.routeId) && (unit.kind === 'merchantShip' || unit.kind === 'caravan')) {
      unit.state = 'returning';
    }
  }
}

function buildTradeManifest(kind, routeValue) {
  const goods = TRADE_GOOD_BY_ROUTE[kind] || ['grain'];
  return goods.slice(0, Math.max(1, Math.min(2, Math.round(routeValue / 3)))).map((good, index) => ({
    good,
    amount: Math.max(6, Math.round(routeValue * (index === 0 ? 9 : 5))),
  }));
}
