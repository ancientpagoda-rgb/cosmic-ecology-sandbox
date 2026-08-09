import { createRng } from '../core/rng.js';
import { createWorld } from '../core/world.js';
import { createBiosphere } from '../core/biosphere.js';
import { createLineageFoundry } from '../core/lineage-foundry.js';

const rng = createRng('lineage-foundry-check');
const world = createWorld(rng);
const biosphere = createBiosphere(world, rng);
const journal = { record() {} };
const foundry = createLineageFoundry({ world, biosphere, journal, seed: 'lineage-foundry-check' });

const capsule = foundry.create({
  name: 'Glass Minnow',
  guild: 'grazer',
  visual: { color: '#8df5e7', form: 'kite' },
  traits: { speed: 1.18, sense: 1.31, metabolism: 0.84, thermal: 0.62 },
});
if (capsule.format !== 'nysa-lineage-1' || capsule.name !== 'Glass Minnow') throw new Error('Foundry did not create a portable lineage capsule.');
const imported = foundry.import(foundry.export(capsule.id));
if (imported.id !== capsule.id) throw new Error('Export/import did not preserve capsule identity.');
const before = world.ecs.components.agent.size;
const released = foundry.release(capsule.id, { x: 600, y: 360 });
if (world.ecs.components.agent.size < before + 3) throw new Error('Releasing a lineage did not create bounded ecosystem organisms.');
if (!biosphere.getSpeciesForEntity([...world.ecs.components.agent.keys()].at(-1))?.lineageCapsuleId) throw new Error('Released organisms lost lineage provenance.');
if (released.species.name !== capsule.name) throw new Error('Released species lost the capsule identity.');
const descendant = foundry.create({ name: 'Glass Minnow Echo', guild: 'grazer', ancestry: { parentId: capsule.id } });
const descendantRelease = foundry.release(descendant.id, { x: 620, y: 360 });
if (!biosphere.getAncestry().some(link => link.parentId === released.species.id && link.childId === descendantRelease.species.id)) throw new Error('Released lineage ancestry was not preserved.');

console.log(`Lineage Foundry contract passed: ${capsule.id} released as ${released.species.name}.`);
