import { clamp } from '../utils.js';

const FOOD_MULTIPLIER = {
  spring: 1.05,
  summer: 1.15,
  autumn: 0.95,
  winter: 0.62,
};

const FISH_MULTIPLIER = {
  spring: 1,
  summer: 0.95,
  autumn: 1.05,
  winter: 0.86,
};

export function runProductionSystem(world, dt) {
  const seasonalFood = FOOD_MULTIPLIER[world.season] || 1;
  const seasonalFish = FISH_MULTIPLIER[world.season] || 1;
  for (const [id, settlement] of world.ecs.components.settlement.entries()) {
    const memory = world.ecs.components.memory.get(id);
    const baseFood = settlement.population * 0.045 * seasonalFood * clamp(1 - settlement.fear * 0.2, 0.6, 1.1);
    const fishYield = settlement.harborLevel > 0 ? settlement.harborLevel * 8 * seasonalFish : 0;
    const timberYield = 1 + settlement.harborLevel * 0.5 + settlement.wallLevel * 0.3;
    const oreYield = settlement.kind === 'town' || settlement.kind === 'city' ? 1.8 : 0.8;
    const craftYield = settlement.marketLevel * 2 + settlement.harborLevel * 1.5;

    settlement.foodProduction = baseFood + fishYield;
    settlement.craftProduction = craftYield;
    settlement.foodStored += (baseFood + fishYield) * dt;
    settlement.timberStored += timberYield * dt;
    settlement.oreStored += oreYield * dt;
    settlement.coinStored += craftYield * 0.8 * dt;
    settlement.prosperity = clamp(settlement.prosperity + craftYield * 0.002 - settlement.unrest * 0.003, 0, 1);
    if (memory) memory.tradeMemory = clamp(memory.tradeMemory + craftYield * 0.002, 0, 1);
  }
}
