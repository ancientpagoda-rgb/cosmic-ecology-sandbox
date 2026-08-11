const DEFAULT_TOLERANCE = 1e-9;
const DEFAULT_MAX_SUBSTEPS = 2048;

function assertFinitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a finite positive number`);
}

function stableHash(input) {
  let h = 2166136261 >>> 0;
  const text = String(input);
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRandom(seedText) {
  let state = stableHash(seedText) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

function cloneRecord(record = {}) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, Number(value)]));
}

function nearlyEqual(a, b, tolerance) {
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= tolerance * scale;
}

export class RealityKernel {
  constructor({ seed = 'reality-kernel-v0', conservationTolerance = DEFAULT_TOLERANCE, maxSubstepsPerNode = DEFAULT_MAX_SUBSTEPS } = {}) {
    this.seed = String(seed);
    this.conservationTolerance = conservationTolerance;
    this.maxSubstepsPerNode = maxSubstepsPerNode;
    this.nodes = new Map();
    this.solvers = new Map();
    this.observers = new Map();
    this.time = 0;
    this.stepIndex = 0;
    this.refinementSerial = 0;
    this.lastSchedule = [];
  }

  registerSolver({ id, minScale = 0, maxScale = Infinity, maxDt = Infinity, priority = 0, step }) {
    if (!id || typeof step !== 'function') throw new Error('solver requires id and step()');
    if (!(minScale >= 0) || !(maxScale > minScale)) throw new Error(`invalid solver scale range for ${id}`);
    if (!(maxDt > 0)) throw new Error(`invalid maxDt for ${id}`);
    this.solvers.set(id, { id, minScale, maxScale, maxDt, priority, step });
    return this;
  }

  addNode({ id, parentId = null, label = id, scale, characteristicTime = Infinity, state = {}, conserved = {}, solverId = null, refine = null, coarsen = null }) {
    if (!id || this.nodes.has(id)) throw new Error(`node id must be unique: ${id}`);
    assertFinitePositive(scale, `scale for ${id}`);
    if (characteristicTime !== Infinity) assertFinitePositive(characteristicTime, `characteristicTime for ${id}`);
    if (parentId && !this.nodes.has(parentId)) throw new Error(`parent ${parentId} does not exist`);

    const node = {
      id,
      parentId,
      label,
      scale,
      characteristicTime,
      state,
      conserved: cloneRecord(conserved),
      solverId,
      refine,
      coarsen,
      children: [],
      active: true,
      generation: 0,
      archivedAt: null,
    };
    this.nodes.set(id, node);
    if (parentId) this.nodes.get(parentId).children.push(id);
    return node;
  }

  requestResolution({ observerId, nodeId, spatialScale, temporalScale = Infinity, selectChild = null }) {
    if (!observerId) throw new Error('observerId is required');
    if (!this.nodes.has(nodeId)) throw new Error(`unknown node ${nodeId}`);
    assertFinitePositive(spatialScale, 'spatialScale');
    if (temporalScale !== Infinity) assertFinitePositive(temporalScale, 'temporalScale');
    const request = { observerId, nodeId, spatialScale, temporalScale, selectChild };
    this.observers.set(observerId, request);
    return this.resolveObserver(observerId);
  }

  clearResolution(observerId, { coarsen = true } = {}) {
    const request = this.observers.get(observerId);
    this.observers.delete(observerId);
    if (coarsen && request) this.coarsen(request.nodeId);
  }

  resolveObserver(observerId) {
    const request = this.observers.get(observerId);
    if (!request) throw new Error(`unknown observer ${observerId}`);
    let node = this.nodes.get(request.nodeId);
    const path = [node.id];

    while (node.scale > request.spatialScale && (typeof node.refine === 'function' || node.children.length > 0)) {
      const children = this.refine(node.id);
      if (!children.length) break;
      let next = null;
      if (typeof request.selectChild === 'function') {
        const selected = request.selectChild(children.map(child => this.describeNode(child.id)), this.describeNode(node.id));
        next = selected ? this.nodes.get(selected) : null;
      }
      if (!next) next = children[0];
      node = next;
      path.push(node.id);
    }

    return {
      observerId,
      requestedSpatialScale: request.spatialScale,
      requestedTemporalScale: request.temporalScale,
      resolvedNodeId: node.id,
      resolvedScale: node.scale,
      path,
    };
  }

  refine(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`unknown node ${nodeId}`);

    if (node.children.length) {
      for (const childId of node.children) {
        const child = this.nodes.get(childId);
        if (child) child.active = true;
      }
      node.generation += 1;
      node.archivedAt = null;
      this.assertRefinementConservation(nodeId);
      return node.children.map(id => this.nodes.get(id));
    }
    if (typeof node.refine !== 'function') return [];

    const random = makeRandom(`${this.seed}|${node.id}|refine|${this.refinementSerial}`);
    const descriptors = node.refine({
      node: this.describeNode(node.id),
      random,
      seed: this.seed,
      time: this.time,
    }) || [];
    this.refinementSerial += 1;

    for (let index = 0; index < descriptors.length; index += 1) {
      const descriptor = descriptors[index];
      const childId = descriptor.id || `${node.id}/${index}`;
      this.addNode({ ...descriptor, id: childId, parentId: node.id });
    }
    if (node.children.length) this.assertRefinementConservation(nodeId);
    return node.children.map(id => this.nodes.get(id));
  }

  coarsen(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`unknown node ${nodeId}`);
    if (!node.children.length) return this.describeNode(nodeId);

    this.assertRefinementConservation(nodeId);
    const aggregate = this.sumLeafConserved(nodeId);
    node.conserved = aggregate;
    if (typeof node.coarsen === 'function') {
      const nextState = node.coarsen({
        node: this.describeNode(nodeId),
        children: node.children.map(id => this.describeNode(id)),
        aggregate: cloneRecord(aggregate),
        time: this.time,
      });
      if (nextState !== undefined) node.state = nextState;
    }
    for (const childId of node.children) this.setSubtreeActive(childId, false);
    node.archivedAt = this.time;
    return this.describeNode(nodeId);
  }

  planStep(dt) {
    assertFinitePositive(dt, 'dt');
    const schedule = [];
    for (const node of this.activeLeaves()) {
      const solver = this.selectSolver(node);
      if (!solver) continue;
      const observerDt = this.requiredTemporalScaleForNode(node.id);
      const intrinsicDt = Number.isFinite(node.characteristicTime) ? node.characteristicTime : Infinity;
      const desiredDt = Math.min(dt, solver.maxDt, observerDt, intrinsicDt);
      const idealSubsteps = Math.max(1, Math.ceil((dt / desiredDt) - 1e-12));
      const substeps = Math.min(idealSubsteps, this.maxSubstepsPerNode);
      schedule.push({
        nodeId: node.id,
        solverId: solver.id,
        scale: node.scale,
        desiredDt,
        idealSubsteps,
        substeps,
        actualDt: dt / substeps,
        degraded: idealSubsteps > substeps,
      });
    }
    return schedule;
  }

  step(dt) {
    const schedule = this.planStep(dt);
    for (const item of schedule) {
      const node = this.nodes.get(item.nodeId);
      const solver = this.solvers.get(item.solverId);
      for (let substep = 0; substep < item.substeps; substep += 1) {
        let randomCall = 0;
        const random = () => makeRandom(`${this.seed}|${node.id}|${this.stepIndex}|${substep}|${randomCall++}`)();
        solver.step({
          node,
          dt: item.actualDt,
          time: this.time + item.actualDt * substep,
          random,
          kernel: this,
          degraded: item.degraded,
        });
      }
    }
    this.time += dt;
    this.stepIndex += 1;
    this.lastSchedule = schedule;
    return schedule;
  }

  activeLeaves() {
    const leaves = [];
    for (const node of this.nodes.values()) {
      if (!node.active) continue;
      const hasActiveChild = node.children.some(id => this.nodes.get(id)?.active);
      if (!hasActiveChild) leaves.push(node);
    }
    return leaves;
  }

  selectSolver(node) {
    if (node.solverId) return this.solvers.get(node.solverId) || null;
    return [...this.solvers.values()]
      .filter(solver => node.scale >= solver.minScale && node.scale < solver.maxScale)
      .sort((a, b) => b.priority - a.priority || a.maxScale - b.maxScale)[0] || null;
  }

  requiredTemporalScaleForNode(nodeId) {
    let required = Infinity;
    for (const request of this.observers.values()) {
      if (!Number.isFinite(request.temporalScale)) continue;
      const resolved = this.resolveObserver(request.observerId);
      if (resolved.path.includes(nodeId) || resolved.resolvedNodeId === nodeId) {
        required = Math.min(required, request.temporalScale);
      }
    }
    return required;
  }

  setSubtreeActive(nodeId, active) {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    node.active = active;
    for (const childId of node.children) this.setSubtreeActive(childId, active);
  }

  sumLeafConserved(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`unknown node ${nodeId}`);
    const activeChildren = node.children.filter(id => this.nodes.get(id)?.active);
    const childIds = activeChildren.length ? activeChildren : node.children;
    if (!childIds.length) return cloneRecord(node.conserved);

    const totals = {};
    for (const childId of childIds) {
      const childTotals = this.sumLeafConserved(childId);
      for (const [key, value] of Object.entries(childTotals)) totals[key] = (totals[key] || 0) + value;
    }
    return totals;
  }

  assertRefinementConservation(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node || !node.children.length) return true;
    const children = {};
    for (const childId of node.children) {
      const child = this.nodes.get(childId);
      for (const [key, value] of Object.entries(child.conserved)) children[key] = (children[key] || 0) + value;
    }
    const keys = new Set([...Object.keys(node.conserved), ...Object.keys(children)]);
    for (const key of keys) {
      const parentValue = node.conserved[key] || 0;
      const childValue = children[key] || 0;
      if (!nearlyEqual(parentValue, childValue, this.conservationTolerance)) {
        throw new Error(`conservation mismatch at ${nodeId} for ${key}: parent=${parentValue}, children=${childValue}`);
      }
    }
    return true;
  }

  describeNode(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return null;
    return {
      id: node.id,
      parentId: node.parentId,
      label: node.label,
      scale: node.scale,
      characteristicTime: node.characteristicTime,
      state: node.state,
      conserved: cloneRecord(node.conserved),
      solverId: node.solverId,
      children: [...node.children],
      active: node.active,
      generation: node.generation,
      archivedAt: node.archivedAt,
    };
  }

  snapshot() {
    return {
      seed: this.seed,
      time: this.time,
      stepIndex: this.stepIndex,
      nodes: [...this.nodes.values()].map(node => this.describeNode(node.id)),
      observers: [...this.observers.values()].map(request => ({
        observerId: request.observerId,
        nodeId: request.nodeId,
        spatialScale: request.spatialScale,
        temporalScale: request.temporalScale,
      })),
      lastSchedule: this.lastSchedule.map(item => ({ ...item })),
    };
  }
}
