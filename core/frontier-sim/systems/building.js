import { createSite } from '../spawners.js';
import { clamp } from '../utils.js';

export function runBuildingSystem(world, dt) {
  const ecs = world.ecs;
  for (const [id, settlement] of ecs.components.settlement.entries()) {
    const memory = ecs.components.memory.get(id);
    const position = ecs.components.position.get(id);
    if (!memory || !position) continue;

    if (memory.raidMemory > 0.55 && settlement.wallLevel < 1 && settlement.timberStored >= 24) {
      settlement.wallLevel = 1;
      settlement.timberStored -= 24;
      settlement.garrison += 4;
      continue;
    }

    if (memory.raidMemory > 0.75 && settlement.wallLevel < 2 && settlement.oreStored >= 18 && settlement.coinStored >= 40) {
      settlement.wallLevel = 2;
      settlement.oreStored -= 18;
      settlement.coinStored -= 40;
      settlement.garrison += 6;
      createSite(ecs, { id: `${position.tileId}-fort`, x: position.x + 10, y: position.y + 8 }, {
        kind: 'fort',
        factionId: settlement.factionId,
        settlementId: id,
        level: 1,
        garrison: settlement.garrison,
        controlRadius: 110,
      });
      continue;
    }

    const canRaiseCastle = memory.raidMemory > 0.92
      && settlement.wallLevel >= 2
      && settlement.coinStored >= 110
      && settlement.oreStored >= 46
      && settlement.population >= 180;
    const alreadyHasCastle = [...ecs.components.site.values()].some(site => site.kind === 'castle' && site.settlementId === id);
    if (canRaiseCastle && !alreadyHasCastle) {
      settlement.coinStored -= 110;
      settlement.oreStored -= 46;
      settlement.wallLevel = 3;
      settlement.garrison += 12;
      settlement.fear = clamp(settlement.fear - 0.16, 0, 1);
      createSite(ecs, { id: `${position.tileId}-castle`, x: position.x - 12, y: position.y - 6 }, {
        kind: 'castle',
        factionId: settlement.factionId,
        settlementId: id,
        level: 1,
        garrison: settlement.garrison,
        upkeep: 8,
        controlRadius: 160,
      });
    }

    memory.raidMemory = clamp(memory.raidMemory - 0.01 * dt, 0, 1);
  }
}
