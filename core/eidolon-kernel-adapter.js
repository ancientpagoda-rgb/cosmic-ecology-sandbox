import { RealityKernel } from './multiscale-kernel.js';

const DEFAULT_REGION_COLUMNS = 24;
const DEFAULT_REGION_ROWS = 12;
const DEFAULT_PATCH_COLUMNS = 10;
const DEFAULT_PATCH_ROWS = 10;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wrap(value, extent) {
  if (!Number.isFinite(value) || !Number.isFinite(extent) || extent <= 0) return 0;
  return ((value % extent) + extent) % extent;
}

function shallowClone(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(shallowClone);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, entry && typeof entry === 'object' ? shallowClone(entry) : entry]));
}

function compactSpecies(species) {
  if (!species) return null;
  const keys = ['id', 'name', 'parentId', 'ancestorId', 'generation', 'population', 'diet', 'trophicRole'];
  const result = {};
  for (const key of keys) if (species[key] !== undefined) result[key] = shallowClone(species[key]);
  return Object.keys(result).length ? result : { id: species.id ?? null };
}

function countWorldEntities(world) {
  const c = world.ecs.components;
  return {
    resources: c.resource?.size || 0,
    grazers: c.agent?.size || 0,
    predators: c.predator?.size || 0,
    apex: c.apex?.size || 0,
    living: (c.agent?.size || 0) + (c.predator?.size || 0) + (c.apex?.size || 0),
  };
}

function classifyEntity(components, id) {
  if (components.agent?.has(id)) return 'grazer';
  if (components.predator?.has(id)) return 'predator';
  if (components.apex?.has(id)) return 'apex';
  if (components.resource?.has(id)) return 'resource';
  return null;
}

function entityScaleMetres(kind) {
  if (kind === 'apex') return 4;
  if (kind === 'predator') return 3;
  if (kind === 'grazer') return 2;
  return 0.5;
}

function pointInBounds(point, bounds) {
  return point.x >= bounds.x0 && point.x < bounds.x1 && point.y >= bounds.y0 && point.y < bounds.y1;
}

function centerOf(bounds) {
  return { x: (bounds.x0 + bounds.x1) * 0.5, y: (bounds.y0 + bounds.y1) * 0.5 };
}

function modelDistanceSquared(a, b, width) {
  let dx = Math.abs(a.x - b.x);
  dx = Math.min(dx, Math.max(0, width - dx));
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function deleteSubtree(kernel, nodeId) {
  const node = kernel.nodes.get(nodeId);
  if (!node) return;
  for (const childId of [...node.children]) deleteSubtree(kernel, childId);
  kernel.nodes.delete(nodeId);
}

export function createEidolonKernelAdapter({
  world,
  biosphere = null,
  dynamics = null,
  kernel = null,
  regionColumns = DEFAULT_REGION_COLUMNS,
  regionRows = DEFAULT_REGION_ROWS,
  patchColumns = DEFAULT_PATCH_COLUMNS,
  patchRows = DEFAULT_PATCH_ROWS,
} = {}) {
  if (!world?.ecs?.components || !Number.isFinite(world.width) || !Number.isFinite(world.height)) {
    throw new Error('Eidolon kernel adapter requires the authoritative world and ECS components.');
  }

  const metresPerModelUnit = Math.max(1, Number(world.geography?.kilometresPerModelUnit || 1) * 1000);
  const nominalRadiusMetres = Math.max(
    world.width * metresPerModelUnit / (Math.PI * 2),
    Number(world.geography?.nominalRadiusKm || 0) * 1000,
  );
  const planetScaleMetres = nominalRadiusMetres * 2;
  const regionWidth = world.width / regionColumns;
  const regionHeight = world.height / regionRows;
  const patchWidth = regionWidth / patchColumns;
  const patchHeight = regionHeight / patchRows;
  const regionScaleMetres = Math.max(regionWidth, regionHeight) * metresPerModelUnit;
  const patchScaleMetres = Math.max(patchWidth, patchHeight) * metresPerModelUnit;
  const planetId = 'eidolon:planet';
  const realityKernel = kernel || new RealityKernel({ seed: world.seed || 'eidolon' });
  const observerLocations = new Map();

  function planetState() {
    return {
      source: 'eidolon-authoritative-world',
      readOnly: true,
      planetName: world.planetName || 'Eidolon',
      seed: world.seed || null,
      worldTick: world.tick,
      modelWidth: world.width,
      modelHeight: world.height,
      metresPerModelUnit,
      nominalRadiusMetres,
      counts: countWorldEntities(world),
      regime: world.regime,
      globals: shallowClone(world.globals),
    };
  }

  function regionBounds(column, row) {
    return {
      x0: column * regionWidth,
      x1: (column + 1) * regionWidth,
      y0: row * regionHeight,
      y1: (row + 1) * regionHeight,
    };
  }

  function patchBounds(regionColumn, regionRow, patchColumn, patchRow) {
    const region = regionBounds(regionColumn, regionRow);
    return {
      x0: region.x0 + patchColumn * patchWidth,
      x1: region.x0 + (patchColumn + 1) * patchWidth,
      y0: region.y0 + patchRow * patchHeight,
      y1: region.y0 + (patchRow + 1) * patchHeight,
    };
  }

  const regionId = (column, row) => `eidolon:region:${column}:${row}`;
  const patchId = (regionColumn, regionRow, patchColumn, patchRow) => `eidolon:patch:${regionColumn}:${regionRow}:${patchColumn}:${patchRow}`;

  function baseAreaState(level, bounds, indices) {
    const center = centerOf(bounds);
    return {
      source: 'eidolon-authoritative-world',
      readOnly: true,
      level,
      ...indices,
      bounds: { ...bounds },
      center,
      worldTick: world.tick,
      summary: null,
    };
  }

  function createRegionDescriptors() {
    const descriptors = [];
    for (let row = 0; row < regionRows; row += 1) {
      for (let column = 0; column < regionColumns; column += 1) {
        const bounds = regionBounds(column, row);
        descriptors.push({
          id: regionId(column, row),
          label: `Eidolon region ${column},${row}`,
          scale: regionScaleMetres,
          characteristicTime: 3600,
          state: baseAreaState('region', bounds, { column, row }),
          conserved: {},
          refine: () => createPatchDescriptors(column, row),
        });
      }
    }
    return descriptors;
  }

  function createPatchDescriptors(regionColumn, regionRow) {
    const descriptors = [];
    for (let patchRow = 0; patchRow < patchRows; patchRow += 1) {
      for (let patchColumn = 0; patchColumn < patchColumns; patchColumn += 1) {
        const bounds = patchBounds(regionColumn, regionRow, patchColumn, patchRow);
        descriptors.push({
          id: patchId(regionColumn, regionRow, patchColumn, patchRow),
          label: `Eidolon patch ${regionColumn},${regionRow}/${patchColumn},${patchRow}`,
          scale: patchScaleMetres,
          characteristicTime: 60,
          state: baseAreaState('patch', bounds, { regionColumn, regionRow, patchColumn, patchRow }),
          conserved: {},
        });
      }
    }
    return descriptors;
  }

  function collectEntities(bounds) {
    const c = world.ecs.components;
    const entities = [];
    for (const [id, position] of c.position.entries()) {
      if (!pointInBounds(position, bounds)) continue;
      const kind = classifyEntity(c, id);
      if (!kind) continue;
      const component = kind === 'grazer'
        ? c.agent.get(id)
        : kind === 'predator'
          ? c.predator.get(id)
          : kind === 'apex'
            ? c.apex.get(id)
            : c.resource.get(id);
      const species = kind === 'resource' || typeof biosphere?.getSpeciesForEntity !== 'function'
        ? null
        : compactSpecies(biosphere.getSpeciesForEntity(id));
      entities.push({
        id,
        kind,
        x: position.x,
        y: position.y,
        component,
        species,
      });
    }
    return entities;
  }

  function summarizeArea(bounds) {
    const entities = collectEntities(bounds);
    const counts = { resources: 0, grazers: 0, predators: 0, apex: 0, living: 0 };
    for (const entity of entities) {
      if (entity.kind === 'resource') counts.resources += 1;
      else {
        counts[entity.kind === 'grazer' ? 'grazers' : entity.kind === 'predator' ? 'predators' : 'apex'] += 1;
        counts.living += 1;
      }
    }
    const center = centerOf(bounds);
    let environment = null;
    try {
      environment = typeof dynamics?.inspect === 'function' ? shallowClone(dynamics.inspect(center.x, center.y)) : null;
    } catch {
      environment = null;
    }
    return { counts, environment, entityCount: entities.length };
  }

  function refreshAreaNode(nodeId) {
    const node = realityKernel.nodes.get(nodeId);
    const bounds = node?.state?.bounds;
    if (!node || !bounds) return null;
    node.state = {
      ...node.state,
      worldTick: world.tick,
      summary: summarizeArea(bounds),
    };
    return node;
  }

  function entityState(entity) {
    const common = {
      source: 'eidolon-authoritative-world',
      readOnly: true,
      level: 'entity',
      entityId: entity.id,
      kind: entity.kind,
      x: entity.x,
      y: entity.y,
      worldTick: world.tick,
      species: entity.species,
    };
    const component = entity.component || {};
    if (entity.kind === 'resource') {
      return {
        ...common,
        amount: component.amount ?? null,
        resourceKind: component.kind ?? null,
        age: component.age ?? null,
        dna: shallowClone(component.dna),
      };
    }
    return {
      ...common,
      energy: component.energy ?? null,
      age: component.age ?? null,
      dna: shallowClone(component.dna),
      caste: component.caste ?? null,
      evolved: component.evolved ?? null,
    };
  }

  function syncPatchEntities(targetPatchId) {
    const patch = realityKernel.nodes.get(targetPatchId);
    if (!patch?.state?.bounds) return [];
    const entities = collectEntities(patch.state.bounds);
    const desiredIds = new Set(entities.map(entity => `eidolon:entity:${entity.kind}:${entity.id}`));

    for (const childId of [...patch.children]) {
      if (desiredIds.has(childId)) continue;
      deleteSubtree(realityKernel, childId);
      patch.children = patch.children.filter(id => id !== childId);
    }

    for (const entity of entities) {
      const nodeId = `eidolon:entity:${entity.kind}:${entity.id}`;
      const state = entityState(entity);
      const existing = realityKernel.nodes.get(nodeId);
      if (existing) {
        existing.state = state;
        existing.scale = entityScaleMetres(entity.kind);
        existing.active = true;
      } else {
        realityKernel.addNode({
          id: nodeId,
          parentId: targetPatchId,
          label: `${entity.kind} ${entity.id}`,
          scale: entityScaleMetres(entity.kind),
          characteristicTime: entity.kind === 'resource' ? 10 : 0.06,
          state,
          conserved: {},
        });
      }
    }

    patch.state = {
      ...patch.state,
      worldTick: world.tick,
      summary: summarizeArea(patch.state.bounds),
    };
    return entities;
  }

  function locate(x, y) {
    const normalizedX = wrap(x, world.width);
    const normalizedY = clamp(Number(y) || 0, 0, Math.max(0, world.height - Number.EPSILON));
    const regionColumn = Math.min(regionColumns - 1, Math.floor(normalizedX / regionWidth));
    const regionRow = Math.min(regionRows - 1, Math.floor(normalizedY / regionHeight));
    const withinRegionX = normalizedX - regionColumn * regionWidth;
    const withinRegionY = normalizedY - regionRow * regionHeight;
    const patchColumn = Math.min(patchColumns - 1, Math.floor(withinRegionX / patchWidth));
    const patchRow = Math.min(patchRows - 1, Math.floor(withinRegionY / patchHeight));
    return {
      x: normalizedX,
      y: normalizedY,
      regionColumn,
      regionRow,
      patchColumn,
      patchRow,
      regionId: regionId(regionColumn, regionRow),
      patchId: patchId(regionColumn, regionRow, patchColumn, patchRow),
    };
  }

  function observersUsing({ region, patch, excluding }) {
    for (const [observerId, location] of observerLocations.entries()) {
      if (observerId === excluding) continue;
      if (patch && location.patchId === patch) return true;
      if (!patch && region && location.regionId === region) return true;
    }
    return false;
  }

  function coarsenPrevious(observerId, nextLocation) {
    const previous = observerLocations.get(observerId);
    if (!previous) return;
    if (previous.regionId !== nextLocation.regionId) {
      if (!observersUsing({ region: previous.regionId, excluding: observerId })) realityKernel.coarsen(previous.regionId);
    } else if (previous.patchId !== nextLocation.patchId) {
      if (!observersUsing({ patch: previous.patchId, excluding: observerId })) realityKernel.coarsen(previous.patchId);
    }
  }

  function requestAt({ observerId = 'observer', x, y, spatialScale = patchScaleMetres, temporalScale = Infinity } = {}) {
    const location = locate(x, y);
    coarsenPrevious(observerId, location);
    realityKernel.nodes.get(planetId).state = planetState();

    // Materialize only the hierarchy required by this observation.
    realityKernel.refine(planetId);
    refreshAreaNode(location.regionId);
    const region = realityKernel.nodes.get(location.regionId);
    if (spatialScale < region.scale) realityKernel.refine(location.regionId);
    const patch = realityKernel.nodes.get(location.patchId);
    if (patch) {
      refreshAreaNode(location.patchId);
      if (spatialScale < patch.scale) syncPatchEntities(location.patchId);
    }

    const resolved = realityKernel.requestResolution({
      observerId,
      nodeId: planetId,
      spatialScale,
      temporalScale,
      selectChild(children, parent) {
        if (parent.id === planetId) return location.regionId;
        if (parent.id === location.regionId) return location.patchId;
        if (parent.id === location.patchId) {
          let nearest = null;
          let nearestDistance = Infinity;
          for (const child of children) {
            const state = child.state || {};
            const distance = modelDistanceSquared({ x: state.x, y: state.y }, location, world.width);
            if (distance < nearestDistance) {
              nearestDistance = distance;
              nearest = child.id;
            }
          }
          return nearest;
        }
        return children[0]?.id || null;
      },
    });
    observerLocations.set(observerId, location);
    return {
      ...resolved,
      target: location,
      node: realityKernel.describeNode(resolved.resolvedNodeId),
      scales: getScales(),
    };
  }

  function releaseObserver(observerId) {
    const previous = observerLocations.get(observerId);
    observerLocations.delete(observerId);
    realityKernel.observers.delete(observerId);
    if (!previous) return;
    if (!observersUsing({ region: previous.regionId })) realityKernel.coarsen(previous.regionId);
    else if (!observersUsing({ patch: previous.patchId })) realityKernel.coarsen(previous.patchId);
  }

  function refresh() {
    const planet = realityKernel.nodes.get(planetId);
    if (planet) planet.state = planetState();
    for (const location of observerLocations.values()) {
      refreshAreaNode(location.regionId);
      if (realityKernel.nodes.has(location.patchId)) {
        syncPatchEntities(location.patchId);
        refreshAreaNode(location.patchId);
      }
    }
    return snapshot();
  }

  function getScales() {
    return {
      planetMetres: planetScaleMetres,
      regionMetres: regionScaleMetres,
      patchMetres: patchScaleMetres,
      entityMetres: { resource: 0.5, grazer: 2, predator: 3, apex: 4 },
      metresPerModelUnit,
    };
  }

  function snapshot() {
    return {
      version: 1,
      readOnly: true,
      worldTick: world.tick,
      counts: countWorldEntities(world),
      scales: getScales(),
      observers: [...observerLocations.entries()].map(([observerId, location]) => ({ observerId, ...location })),
      kernel: realityKernel.snapshot(),
    };
  }

  realityKernel.addNode({
    id: planetId,
    label: world.planetName || 'Eidolon',
    scale: planetScaleMetres,
    characteristicTime: 86400,
    state: planetState(),
    conserved: {},
    refine: createRegionDescriptors,
  });

  return {
    version: 1,
    readOnly: true,
    kernel: realityKernel,
    planetId,
    requestAt,
    releaseObserver,
    refresh,
    locate,
    snapshot,
    getScales,
  };
}
