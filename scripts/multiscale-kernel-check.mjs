import assert from 'node:assert/strict';
import { RealityKernel } from '../core/multiscale-kernel.js';

function chainRefiner(entries, index = 0) {
  return () => {
    const next = entries[index];
    if (!next) return [];
    return [{
      ...next,
      conserved: { mass: 100, energy: 250 },
      refine: chainRefiner(entries, index + 1),
    }];
  };
}

function makeKernel(seed = 'eidolon-kernel-check') {
  const kernel = new RealityKernel({ seed, maxSubstepsPerNode: 32 });
  kernel.registerSolver({
    id: 'coarse',
    minScale: 1,
    maxScale: Infinity,
    maxDt: 100,
    step: ({ node, dt, random }) => {
      node.state.elapsed = (node.state.elapsed || 0) + dt;
      node.state.noise = (node.state.noise || 0) + random() * 1e-6;
    },
  });
  kernel.registerSolver({
    id: 'fine',
    minScale: 0,
    maxScale: 1,
    maxDt: 1e-6,
    step: ({ node, dt }) => {
      node.state.elapsed = (node.state.elapsed || 0) + dt;
    },
  });

  const levels = [
    { id: 'galaxy', label: 'Galaxy', scale: 1e21, characteristicTime: 1e13 },
    { id: 'star-system', label: 'Star system', scale: 1e13, characteristicTime: 1e7 },
    { id: 'planet', label: 'Planet', scale: 1e7, characteristicTime: 1e4 },
    { id: 'ecosystem', label: 'Ecosystem', scale: 1e3, characteristicTime: 10 },
    { id: 'organism', label: 'Organism', scale: 1, characteristicTime: 0.1 },
    { id: 'cell', label: 'Cell', scale: 1e-5, characteristicTime: 1e-3 },
    { id: 'molecule', label: 'Molecule', scale: 1e-9, characteristicTime: 1e-6 },
  ];

  kernel.addNode({
    id: 'cosmos',
    label: 'Observable domain',
    scale: 1e26,
    characteristicTime: 1e15,
    state: { elapsed: 0 },
    conserved: { mass: 100, energy: 250 },
    refine: chainRefiner(levels),
  });
  return kernel;
}

const first = makeKernel();
const resolved = first.requestResolution({
  observerId: 'microscope',
  nodeId: 'cosmos',
  spatialScale: 1e-9,
  temporalScale: 1e-7,
});
assert.equal(resolved.resolvedNodeId, 'molecule');
assert.deepEqual(resolved.path, ['cosmos', 'galaxy', 'star-system', 'planet', 'ecosystem', 'organism', 'cell', 'molecule']);
assert.equal(first.activeLeaves().map(node => node.id).join(','), 'molecule');

const schedule = first.planStep(1e-5);
assert.equal(schedule.length, 1);
assert.equal(schedule[0].solverId, 'fine');
assert.equal(schedule[0].idealSubsteps, 100);
assert.equal(schedule[0].substeps, 32);
assert.equal(schedule[0].degraded, true);
first.step(1e-5);

const beforeCollapse = JSON.stringify(first.describeNode('molecule').state);
first.clearResolution('microscope', { coarsen: true });
assert.equal(first.describeNode('galaxy').active, false);
const restored = first.requestResolution({
  observerId: 'microscope',
  nodeId: 'cosmos',
  spatialScale: 1e-9,
  temporalScale: 1e-7,
});
assert.equal(restored.resolvedNodeId, 'molecule');
assert.equal(JSON.stringify(first.describeNode('molecule').state), beforeCollapse, 'refinement must restore archived microstate, not regenerate it');

const second = makeKernel();
second.requestResolution({ observerId: 'microscope', nodeId: 'cosmos', spatialScale: 1e-9, temporalScale: 1e-7 });
second.step(1e-5);
assert.equal(JSON.stringify(second.describeNode('molecule').state), beforeCollapse, 'same seed and requests should reproduce the same microstate');

const bad = makeKernel('bad-conservation');
bad.nodes.get('cosmos').refine = () => [{ id: 'bad-child', scale: 1e21, conserved: { mass: 99, energy: 250 } }];
assert.throws(() => bad.refine('cosmos'), /conservation mismatch/);

console.log(JSON.stringify({
  ok: true,
  resolvedPath: resolved.path,
  schedule,
  restoredState: JSON.parse(beforeCollapse),
}, null, 2));
