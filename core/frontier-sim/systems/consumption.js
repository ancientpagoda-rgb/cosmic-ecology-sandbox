import { clamp } from '../utils.js';

const FOOD_NEED = {
  spring: 0.032,
  summer: 0.03,
  autumn: 0.034,
  winter: 0.041,
};

export function runConsumptionSystem(world, dt) {
  const seasonalNeed = FOOD_NEED[world.season] || 0.032;
  for (const [id, settlement] of world.ecs.components.settlement.entries()) {
    const memory = world.ecs.components.memory.get(id);
    const need = settlement.population * seasonalNeed * dt;
    settlement.foodStored -= need;
    settlement.coinStored = Math.max(0, settlement.coinStored - settlement.garrison * 0.025 * dt);

    if (settlement.foodStored < 0) {
      const deficit = Math.abs(settlement.foodStored);
      settlement.foodStored = 0;
      settlement.unrest = clamp(settlement.unrest + deficit * 0.015, 0, 1);
      settlement.fear = clamp(settlement.fear + deficit * 0.008, 0, 1);
      settlement.loyalty = clamp(settlement.loyalty - deficit * 0.01, 0, 1);
      if (memory) memory.hungerMemory = clamp(memory.hungerMemory + deficit * 0.02, 0, 1);
      if (settlement.population > 60 && world.tick % 8 === 0) {
        settlement.population = Math.max(40, settlement.population - Math.ceil(deficit * 0.8));
      }
    } else {
      settlement.unrest = clamp(settlement.unrest - 0.01 * dt, 0, 1);
      settlement.fear = clamp(settlement.fear - 0.005 * dt, 0, 1);
      settlement.loyalty = clamp(settlement.loyalty + 0.004 * dt, 0, 1);
      if (memory) memory.hungerMemory = clamp(memory.hungerMemory - 0.01 * dt, 0, 1);
    }
  }
}
