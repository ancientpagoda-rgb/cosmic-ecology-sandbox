export function recomputeFrontierPressures(world) {
  const settlements = [...world.ecs.components.settlement.values()];
  const routes = [...world.ecs.components.route.values()];
  const units = [...world.ecs.components.mobileUnit.values()];
  const sites = [...world.ecs.components.site.values()];

  let seaTradeValue = 0;
  let weakSeaLanes = 0;
  let chokepoints = 0;
  let raiders = 0;
  let castles = 0;

  for (const route of routes) {
    if (route.kind !== 'seaLane') continue;
    const laneValue = route.capacity * (1 + route.activeTrade.reduce((sum, trade) => sum + trade.value, 0));
    seaTradeValue += laneValue;
    if (route.patrolCoverage < 0.35 && route.danger > 0.3) weakSeaLanes += 1;
    chokepoints += route.chokepointScore;
  }

  for (const unit of units) {
    if (unit.kind === 'raiderShip') raiders += 1;
  }

  for (const site of sites) {
    if (site.kind === 'castle') castles += 1;
  }

  const totalPopulation = settlements.reduce((sum, settlement) => sum + settlement.population, 0);
  const totalTradeValue = settlements.reduce((sum, settlement) => sum + settlement.tradeValue, 0);

  world.globals.foodStress = settlements.length
    ? settlements.reduce((sum, settlement) => sum + settlement.unrest + settlement.fear, 0) / settlements.length
    : 0;
  world.globals.piracyPressure = seaTradeValue * 0.045 + weakSeaLanes * 0.12 + raiders * 0.1;
  world.globals.castlePressure = weakSeaLanes * 0.1 + chokepoints * 0.08 + castles * 0.05;
  world.globals.statePressure = world.globals.piracyPressure * 0.6 + world.globals.castlePressure * 0.8 + totalPopulation / 4000;

  world.stats.totalPopulation = totalPopulation;
  world.stats.totalTradeValue = totalTradeValue;
  world.stats.activeRaiders = raiders;
  world.stats.castles = castles;
  world.stats.factions = world.ecs.components.faction.size;
}
