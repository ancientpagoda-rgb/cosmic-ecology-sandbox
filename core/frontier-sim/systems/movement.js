import { clamp, findSettlement, routeEndpoints, shortestWrappedDelta } from '../utils.js';

export function runMovementSystem(world, dt) {
  const ecs = world.ecs;
  for (const [id, unit] of ecs.components.mobileUnit.entries()) {
    const position = ecs.components.position.get(id);
    if (!position) continue;

    const route = unit.routeId ? ecs.components.route.get(unit.routeId) : null;
    if (!route) {
      unit.progress = 0;
      continue;
    }

    const endpoints = routeEndpoints(ecs, route);
    if (!endpoints) continue;

    const { from, to } = endpoints;
    const origin = unit.state === 'returning' ? to.position : from.position;
    const target = unit.state === 'returning' ? from.position : to.position;
    const direction = {
      x: shortestWrappedDelta(origin.x, target.x, world.width),
      y: target.y - origin.y,
    };
    const distance = Math.hypot(direction.x, direction.y) || 1;

    unit.progress = clamp(unit.progress + (unit.speed / Math.max(1, route.distance)) * 18 * dt, 0, 1);
    position.x = (origin.x + direction.x * unit.progress + world.width) % world.width;
    position.y = clamp(origin.y + direction.y * unit.progress, 0, world.height);

    if (unit.progress < 1) continue;

    unit.progress = 0;
    if (unit.state === 'trading') {
      settleTradeArrival(ecs, unit, to.id, route);
      unit.state = 'returning';
      unit.targetId = from.id;
    } else if (unit.state === 'returning') {
      settleHomeArrival(ecs, unit, from.id);
      unit.state = unit.kind === 'patrolShip' ? 'patrolling' : 'trading';
      unit.targetId = to.id;
    } else if (unit.state === 'patrolling') {
      unit.targetId = unit.targetId === to.id ? from.id : to.id;
    } else if (unit.state === 'raiding') {
      unit.targetId = unit.targetId === to.id ? from.id : to.id;
    }
  }
}

function settleTradeArrival(ecs, unit, settlementId, route) {
  const settlement = ecs.components.settlement.get(settlementId);
  const cargo = ecs.components.cargo.get(unit.id);
  if (!settlement || !cargo) return;
  let value = 0;
  for (const amount of Object.values(cargo.goods)) value += Number(amount) || 0;
  settlement.coinStored += value * (route.kind === 'seaLane' ? 0.7 : 0.45);
  settlement.foodStored += (cargo.goods.grain || 0) * 0.25;
  settlement.tradeValue += value * 0.5;
}

function settleHomeArrival(ecs, unit, settlementId) {
  const settlement = ecs.components.settlement.get(settlementId);
  if (!settlement) return;
  settlement.prosperity = clamp(settlement.prosperity + 0.02, 0, 1);
  if (unit.kind === 'patrolShip') {
    settlement.fear = clamp(settlement.fear - 0.03, 0, 1);
  }
}
