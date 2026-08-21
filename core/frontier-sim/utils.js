export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function wrapPosition(position, width, height) {
  const x = ((Number(position.x) % width) + width) % width;
  const y = clamp(Number(position.y), 0, height);
  return { x, y };
}

export function shortestWrappedDelta(from, to, period) {
  let delta = to - from;
  if (delta > period * 0.5) delta -= period;
  if (delta < -period * 0.5) delta += period;
  return delta;
}

export function findSettlement(ecs, settlementId) {
  if (!settlementId) return null;
  const settlement = ecs.components.settlement.get(settlementId);
  const position = ecs.components.position.get(settlementId);
  if (!settlement || !position) return null;
  return { id: settlementId, settlement, position };
}

export function routeEndpoints(ecs, route) {
  const from = findSettlement(ecs, route.fromSettlementId);
  const to = findSettlement(ecs, route.toSettlementId);
  return from && to ? { from, to } : null;
}

export function pickBestHarborSettlementId(ecs) {
  let bestId = null;
  let bestScore = -Infinity;
  for (const [id, settlement] of ecs.components.settlement.entries()) {
    const score = settlement.harborLevel * 2 + settlement.marketLevel + settlement.population / 100;
    if (score > bestScore) {
      bestScore = score;
      bestId = id;
    }
  }
  return bestId;
}

export function unitCargoValue(cargo = {}) {
  const weights = {
    grain: 1,
    fish: 1,
    timber: 1.2,
    ore: 1.4,
    salt: 1.3,
    tools: 2.1,
    luxury: 3.3,
  };
  return Object.entries(cargo).reduce((sum, [good, amount]) => sum + (weights[good] || 1) * (Number(amount) || 0), 0);
}
