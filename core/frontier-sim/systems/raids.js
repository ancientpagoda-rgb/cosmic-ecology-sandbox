import { createMobileUnit } from '../spawners.js';
import { clamp, routeEndpoints, unitCargoValue } from '../utils.js';

export function runRaidSystem(world, dt) {
  const ecs = world.ecs;
  const vulnerableSeaLanes = [...ecs.components.route.entries()].filter(([, route]) => route.kind === 'seaLane' && route.danger > 0.32 && route.patrolCoverage < 0.45);
  const raiderShips = [...ecs.components.mobileUnit.entries()].filter(([, unit]) => unit.kind === 'raiderShip');
  const raiderCoves = [...ecs.components.site.entries()].filter(([, site]) => site.kind === 'raiderCove');

  if (world.globals.piracyPressure > 0.55 && raiderShips.length < Math.max(1, raiderCoves.length * 2) && vulnerableSeaLanes.length) {
    const [siteId, site] = raiderCoves[world.tick % raiderCoves.length];
    const sitePosition = ecs.components.position.get(siteId);
    const [, route] = vulnerableSeaLanes[world.tick % vulnerableSeaLanes.length];
    createMobileUnit(ecs, {
      kind: 'raiderShip',
      factionId: site.factionId,
      homeSettlementId: site.settlementId,
      targetId: route.toSettlementId,
      routeId: [...ecs.components.route.entries()].find(([, candidate]) => candidate.fromSettlementId === route.fromSettlementId && candidate.toSettlementId === route.toSettlementId)?.[0] ?? null,
      state: 'raiding',
      crew: 16,
      strength: 18,
      speed: 1.2,
      morale: 0.68,
      maxCapacity: 70,
      goods: {},
      position: { x: sitePosition.x, y: sitePosition.y },
      tileId: sitePosition.tileId,
      worldWidth: world.width,
      worldHeight: world.height,
    });
  }

  for (const [raiderId, raider] of raiderShips) {
    const route = raider.routeId ? ecs.components.route.get(raider.routeId) : null;
    if (!route) continue;
    const endpoints = routeEndpoints(ecs, route);
    if (!endpoints) continue;
    route.danger = clamp(route.danger + 0.015 * dt, 0, 1);

    for (const [unitId, unit] of ecs.components.mobileUnit.entries()) {
      if (unitId === raiderId || unit.routeId !== raider.routeId) continue;
      if (unit.kind !== 'merchantShip' && unit.kind !== 'caravan' && unit.kind !== 'patrolShip') continue;

      const targetCargo = ecs.components.cargo.get(unitId);
      const cargoValue = unitCargoValue(targetCargo?.goods || {});
      if (cargoValue <= 0 && unit.kind !== 'patrolShip') continue;

      if (unit.kind === 'patrolShip') {
        const patrolAdvantage = unit.strength - raider.strength + route.patrolCoverage * 10;
        if (patrolAdvantage > 0) {
          route.danger = clamp(route.danger - 0.08, 0, 1);
          raider.morale = clamp(raider.morale - 0.06, 0, 1);
          if (raider.morale < 0.28) ecs.destroyEntity(raiderId);
        }
        continue;
      }

      const raidPower = raider.strength * raider.morale;
      const defensePower = unit.strength * unit.morale + route.patrolCoverage * 8;
      if (raidPower <= defensePower) continue;

      const settlement = ecs.components.settlement.get(unit.targetId || endpoints.to.id);
      const memory = settlement ? ecs.components.memory.get(unit.targetId || endpoints.to.id) : null;
      const stolenShare = clamp((raidPower - defensePower) / Math.max(12, raidPower), 0.18, 0.7);
      let stolenValue = 0;
      for (const [good, amount] of Object.entries(targetCargo.goods)) {
        const stolen = Math.round((Number(amount) || 0) * stolenShare);
        if (stolen <= 0) continue;
        targetCargo.goods[good] = Math.max(0, (Number(amount) || 0) - stolen);
        stolenValue += stolen;
      }
      settlement.fear = clamp(settlement.fear + stolenValue * 0.01, 0, 1);
      settlement.unrest = clamp(settlement.unrest + stolenValue * 0.007, 0, 1);
      settlement.tradeValue = Math.max(0, settlement.tradeValue - stolenValue * 0.3);
      if (memory) memory.raidMemory = clamp(memory.raidMemory + stolenValue * 0.01 + 0.08, 0, 1);
      const raiderCargo = ecs.components.cargo.get(raiderId);
      raiderCargo.goods.luxury = (raiderCargo.goods.luxury || 0) + Math.round(stolenValue * 0.35);
      raider.morale = clamp(raider.morale + 0.04, 0, 1);
      route.danger = clamp(route.danger + 0.06, 0, 1);
      unit.morale = clamp(unit.morale - 0.08, 0, 1);
    }
  }
}
