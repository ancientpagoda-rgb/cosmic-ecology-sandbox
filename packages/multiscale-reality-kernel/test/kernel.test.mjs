import assert from 'node:assert/strict';
import { RealityKernel } from '../src/index.js';

function chainRefiner(entries, index = 0) {
  return () => {
    const next = entries[index];
    if (!next) return [];
    return [{ ...next, conserved: { mass: 100, energy: 250 }, refine: chainRefiner(entries, index + 1) }];
  };
}

function makeKernel(seed = 'portable-kernel-check') {
  const kernel = new RealityKernel({ seed, maxSubstepsPerNode: 32 });
  kernel.registerSolver({
    id: 'coarse', minScale: 1, maxScale: Infinity, maxDt: 100,
    step: ({ node, dt, random }) => {
      node.state.elapsed = (node.state.elapsed || 0) + dt;
      node.state.noise = (node.state.noise || 0) + random() * 1e-6;
    },
  });
  kernel.registerSolver({
    id: 'fine', minScale: 0, maxScale: 1, maxDt: 1e-6,
    step: ({ node, dt }) => { node.state.elapsed = (node.state.elapsed || 0) + dt; },
  });

  const levels = [
    { id: 'planet', scale: 1e7, characteristicTime: 1e4 },
    { id: 'ecosystem', scale: 1e3, characteristicTime: 10 },
    { id: 'organism', scale: 1, characteristicTime: 0.1 },
    { id: 'cell', scale: 1e-5, characteristicTime: 1e-3 },
    { id: 'molecule', scale: 1e-9, characteristicTime: 1e-6 },
  ];
  kernel.addNode({
    id: 'cosmos', scale: 1e26, characteristicTime: 1e15,
    state: { elapsed: 0 }, conserved: { mass: 100, energy: 250 }, refine: chainRefiner(levels),
  });
  return kernel;
}

const first = makeKernel();
const resolved = first.requestResolution({ observerId: 'observer', nodeId: 'cosmos', spatialScale: 1e-9, temporalScale: 1e-7 });
assert.equal(resolved.resolvedNodeId, 'molecule');
assert.equal(first.activeLeaves()[0].id, 'molecule');

const schedule = first.planStep(1e-5);
assert.equal(schedule[0].solverId, 'fine');
assert.equal(schedule[0].idealSubsteps, 100);
assert.equal(schedule[0].substeps, 32);
assert.equal(schedule[0].degraded, true);
first.step(1e-5);

const archived = JSON.stringify(first.describeNode('molecule').state);
first.clearResolution('observer', { coarsen: true });
first.requestResolution({ observerId: 'observer', nodeId: 'cosmos', spatialScale: 1e-9, temporalScale: 1e-7 });
assert.equal(JSON.stringify(first.describeNode('molecule').state), archived);

const second = makeKernel();
second.requestResolution({ observerId: 'observer', nodeId: 'cosmos', spatialScale: 1e-9, temporalScale: 1e-7 });
second.step(1e-5);
assert.equal(JSON.stringify(second.describeNode('molecule').state), archived);

const bad = makeKernel('bad');
bad.nodes.get('cosmos').refine = () => [{ id: 'bad-child', scale: 1e7, conserved: { mass: 99, energy: 250 } }];
assert.throws(() => bad.refine('cosmos'), /conservation mismatch/);

console.log(JSON.stringify({ ok: true, package: 'multiscale-reality-kernel', resolved: resolved.resolvedNodeId, degraded: schedule[0].degraded }, null, 2));
