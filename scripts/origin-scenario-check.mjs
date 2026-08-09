import { createOriginScenario, originScenarioParams, readOriginScenario } from '../core/origin-scenario.js';

const input = {
  universeSeed: 'contract-check-universe',
  densityFluctuations: 1.21,
  energyThroughput: 0.83,
  selectionPressure: 1.38,
};
const first = createOriginScenario(input);
const second = createOriginScenario(input);
const restored = readOriginScenario(`?${originScenarioParams(first)}`);

if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('Origin scenario must be deterministic for one input.');
if (restored.planetSeed !== first.planetSeed) throw new Error('Origin URL did not preserve the planet seed.');
if (restored.star.id !== first.star.id) throw new Error('Origin URL did not preserve the stellar handoff.');
if (!first.planetSeed.startsWith('eidolon-origin-')) throw new Error('Origin scenario did not produce an Eidolon seed.');

console.log(`Origin scenario contract passed: ${first.planetSeed}`);
