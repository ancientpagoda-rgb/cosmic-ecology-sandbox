import { createEcologyJournal } from '../core/ecology-journal.js';
import { createSeasonalResourceFields } from '../core/seasonal-resource-fields.js';

const resource = { kind: 'plant', amount: 0.5 };
const world = {
  seed: 'observatory-check',
  tick: 120,
  width: 1200,
  height: 720,
  ecs: { components: { position: new Map([[1, { x: 550, y: 330 }]]), resource: new Map([[1, resource]]) } },
};
const journal = createEcologyJournal(world);
const living = {
  getSeason: () => 0.14,
  sampleDynamicPlanet: () => ({ land: true, biome: 'temperate', temperature: 0.61, rainfall: 0.72 }),
};
const waterCycle = { sample: () => ({ soil: 0.68, river: 0.2, lake: 0 }) };
const fields = createSeasonalResourceFields(world, living, waterCycle, journal);
const sample = fields.sample(550, 330);

if (!(sample.food > 0 && sample.food <= 1)) throw new Error('Seasonal food field was not normalized.');
if (!(fields.getSummary().meanFood > 0)) throw new Error('Seasonal resource summary was not populated.');
if (!Number.isFinite(fields.getSummary().meanFood)) throw new Error('Seasonal resource summary must remain finite when an optional water field is missing.');
fields.step(1.2);
if (!Number.isFinite(resource.seasonalFood)) throw new Error('Seasonal fields did not feed plant state.');
journal.record('Trait divergence', 'A deterministic test lineage shifted its inherited speed.');
if (journal.getEntries(1)[0]?.title !== 'Trait divergence') throw new Error('Evolution journal did not retain an event.');

console.log(`Ecology observatory contract passed: ${Math.round(sample.food * 100)}% local forage.`);
