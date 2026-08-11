import assert from 'node:assert/strict';
import { createEidolonKernelAdapter } from '../core/eidolon-kernel-adapter.js';

function makeWorld() {
  const components = {
    position: new Map([
      [1, { x: 10, y: 10 }],
      [2, { x: 610, y: 360 }],
      [3, { x: 12, y: 12 }],
    ]),
    agent: new Map([[1, { energy: 1.25, age: 4, dna: { speed: 1.1 }, caste: 'runner', evolved: true }]]),
    predator: new Map([[2, { energy: 2.2, age: 8, dna: { sense: 1.3 } }]]),
    apex: new Map(),
    resource: new Map([[3, { kind: 'plant', amount: 0.8, age: 12, dna: { branchCount: 4 } }]]),
  };
  return {
    tick: 17,
    width: 1200,
    height: 720,
    planetName: 'Eidolon',
    seed: 'adapter-check',
    regime: 'calm',
    globals: { fertility: 0.6, metabolism: 1 },
    geography: {
      kilometresPerModelUnit: 100,
      nominalRadiusKm: 19098.6,
    },
    ecs: { components },
  };
}

const world = makeWorld();
const biosphere = {
  getSpeciesForEntity(id) {
    return id === 1 ? { id: 'grazer-a', name: 'Test Grazer', generation: 3 } : id === 2 ? { id: 'predator-b', name: 'Test Hunter', generation: 2 } : null;
  },
};
const dynamics = {
  inspect(x, y) {
    return { x, y, title: 'Test region', weather: 'Clear', soilMoisture: 42 };
  },
};

const adapter = createEidolonKernelAdapter({ world, biosphere, dynamics });
assert.equal(adapter.snapshot().kernel.nodes.length, 1, 'boot should allocate only the planet node');

const first = adapter.requestAt({ observerId: 'camera', x: 10, y: 10, spatialScale: 1, temporalScale: 0.06 });
assert.equal(first.path.length, 4, 'entity observation should traverse planet -> region -> patch -> entity');
assert.equal(first.node.id, 'eidolon:entity:grazer:1');
assert.equal(first.node.state.energy, 1.25);
assert.equal(first.node.state.species.name, 'Test Grazer');
const firstLocation = first.target;

world.ecs.components.agent.get(1).energy = 1.75;
world.tick += 1;
const refreshed = adapter.requestAt({ observerId: 'camera', x: 10, y: 10, spatialScale: 1, temporalScale: 0.06 });
assert.equal(refreshed.node.state.energy, 1.75, 'adapter must read current authoritative entity state');
assert.equal(refreshed.node.state.worldTick, 18);

const second = adapter.requestAt({ observerId: 'camera', x: 610, y: 360, spatialScale: 1, temporalScale: 0.06 });
assert.equal(second.node.id, 'eidolon:entity:predator:2');
assert.notEqual(second.target.regionId, firstLocation.regionId, 'test points should occupy different macro regions');
const oldRegion = adapter.kernel.nodes.get(firstLocation.regionId);
assert(oldRegion.children.length > 0, 'old observed region should retain its archived patch structure');
assert(oldRegion.children.every(id => adapter.kernel.nodes.get(id)?.active === false), 'moving away must not reactivate archived fine patches');

const patchOnly = adapter.requestAt({
  observerId: 'camera',
  x: 10,
  y: 10,
  spatialScale: adapter.getScales().patchMetres,
  temporalScale: 60,
});
assert.equal(patchOnly.node.id, firstLocation.patchId, 'patch-scale request should stop before entity resolution');
const archivedEntity = adapter.kernel.nodes.get('eidolon:entity:grazer:1');
assert.equal(archivedEntity.active, false, 'patch observation should not reopen archived entity detail');

adapter.releaseObserver('camera');
const releasedRegion = adapter.kernel.nodes.get(firstLocation.regionId);
assert(releasedRegion.children.every(id => adapter.kernel.nodes.get(id)?.active === false), 'releasing final observer should coarsen its region');

console.log(JSON.stringify({
  ok: true,
  firstPath: first.path,
  secondPath: second.path,
  patchPath: patchOnly.path,
  scales: adapter.getScales(),
  allocatedNodes: adapter.kernel.nodes.size,
}, null, 2));
