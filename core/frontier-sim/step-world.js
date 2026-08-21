import { recomputeFrontierPressures } from './pressures.js';
import { runBuildingSystem } from './systems/building.js';
import { runConsumptionSystem } from './systems/consumption.js';
import { runFactionSystem } from './systems/factions.js';
import { runMovementSystem } from './systems/movement.js';
import { runProductionSystem } from './systems/production.js';
import { runRaidSystem } from './systems/raids.js';
import { runSeasonSystem } from './systems/season.js';
import { runTradeSystem } from './systems/trade.js';

export function stepFrontierWorld(world, dt = 1) {
  const amount = Math.max(0, Number(dt) || 0);
  world.tick += 1;
  runSeasonSystem(world, amount);
  runProductionSystem(world, amount);
  runConsumptionSystem(world, amount);
  runTradeSystem(world, amount);
  runMovementSystem(world, amount);
  runRaidSystem(world, amount);
  runBuildingSystem(world, amount);
  runFactionSystem(world, amount);
  recomputeFrontierPressures(world);
  return world;
}
