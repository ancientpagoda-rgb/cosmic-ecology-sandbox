import { clamp } from '../utils.js';

export function runFactionSystem(world, dt) {
  const ecs = world.ecs;
  for (const [factionId, faction] of ecs.components.faction.entries()) {
    const settlements = [...ecs.components.settlement.values()].filter(settlement => settlement.factionId === factionId);
    const ports = settlements.filter(settlement => settlement.harborLevel > 0).length;
    const wealth = settlements.reduce((sum, settlement) => sum + settlement.coinStored, 0);
    const unrest = settlements.length
      ? settlements.reduce((sum, settlement) => sum + settlement.unrest, 0) / settlements.length
      : 0;

    faction.treasury += wealth * faction.taxRate * 0.01 * dt;
    faction.cohesion = clamp(faction.cohesion + ports * 0.002 - unrest * 0.01, 0, 1);
    faction.authority = clamp(faction.authority + (settlements.length > 1 ? 0.002 : -0.002) * dt, 0, 1);
    faction.navalCapacity = clamp(faction.navalCapacity + ports * 0.003 - faction.patrolBudget * 0.001, 0, 1);
    faction.militaryCapacity = clamp(faction.militaryCapacity + settlements.length * 0.002 - unrest * 0.008, 0, 1);

    if (faction.treasury > 260 && faction.navalCapacity < 0.75) {
      faction.patrolBudget = clamp(faction.patrolBudget + 0.01, 0, 1);
      faction.navalCapacity = clamp(faction.navalCapacity + 0.01, 0, 1);
    }
  }
}
