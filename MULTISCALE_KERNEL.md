# Multiscale Reality Kernel v1 experiment

This branch adds a general multiscale orchestration kernel plus a read-only adapter around the existing Eidolon living planet. The public simulation still has one authoritative world, one fixed simulation clock, and one renderer; the kernel observes that state and materializes additional resolution only when an observer requests it.

## What the core kernel proves

- A single node tree can span arbitrary orders of magnitude using physical scale values in metres rather than hard-coded game LOD numbers.
- An observer can request finer spatial and temporal resolution.
- Refinement is deterministic from the universe seed and node/refinement history.
- A refined subtree can be coarsened without deleting its microstate, then restored instead of inventing unrelated detail when the observer returns.
- Parent/child refinement boundaries are rejected if declared conserved quantities do not reconcile.
- Different solvers can own different scale ranges and timestep limits.
- The scheduler reports when a requested timestep would exceed the configured computation budget (`degraded: true`) instead of silently pretending full fidelity.
- Re-opening a parent only activates its immediate children; archived microscopic descendants remain coarse until the observer descends into that branch again.

## Eidolon adapter

The adapter uses the current `window.realitySandboxPlanet` world as its source of truth. It does not call `world.step()`, `moduleHost.step()`, or any renderer.

On boot it allocates only one node:

```text
Eidolon planet
```

An observation progressively materializes:

```text
Eidolon planet
  -> macro region
      -> local patch
          -> existing ECS entity
```

The region and patch nodes read current environmental inspection data. Entity nodes are projections of the actual ECS positions and current grazer, predator, apex, or resource components, including lineage data where the biosphere exposes it.

With the current geographic interpretation the hierarchy is approximately:

```text
~3.82e7 m   planet diameter
~6.00e6 m   macro region
~6.00e5 m   local patch
0.5-4 m     current entity representation
```

These are representation scales, not claims of physical measurement accuracy.

## Adaptive behavior

Only the hierarchy needed by an observer is refined. If the observer moves to another macro region, the old region's patch/entity descendants are archived and remain inactive. Returning to patch-level resolution does not automatically reactivate entity-level detail.

The adapter deliberately has no population or display cap. It materializes every authoritative ECS entity currently inside the observed patch. This does not change or cap the underlying simulation population.

## Browser API

After the authoritative world is ready:

```js
await window.realitySandboxKernelReady;

const result = window.realitySandboxRealityKernel.requestAt({
  observerId: 'camera',
  x: 600,
  y: 360,
  spatialScale: 1,
  temporalScale: 0.06,
});

console.log(result.path);
console.log(result.node);
```

Useful calls:

```js
realitySandboxRealityKernel.getScales();
realitySandboxRealityKernel.snapshot();
realitySandboxRealityKernel.refresh();
realitySandboxRealityKernel.releaseObserver('camera');
```

## General kernel scale test

The standalone synthetic fixture still spans:

```text
10^26 m  observable domain
10^21 m  galaxy
10^13 m  star system
10^7  m  planet
10^3  m  ecosystem
10^0  m  organism
10^-5 m  cell
10^-9 m  molecule
```

Those labels are only a test fixture; solver selection is numerical.

## Fidelity boundary

This is not a claim that Eidolon now performs molecular dynamics, stellar evolution, or cosmology. The adapter is intentionally read-only because the current living planet does not expose physically conserved mass/energy budgets suitable for honest cross-scale coupling. Real lower- and higher-scale solvers should only become authoritative after their units, conservation contracts, handoff rules, and validation are explicit.

## Checks

```bash
npm run check:kernel
```

This runs:

```text
scripts/multiscale-kernel-check.mjs
scripts/eidolon-kernel-adapter-check.mjs
```

The first checks deterministic refinement, temporal scheduling, collapse/restore behavior, computation-budget degradation, and rejection of a deliberately non-conservative refinement. The second checks lazy planet -> region -> patch -> real-entity resolution, live reads from the authoritative ECS, observer movement, and preservation of archived fine branches.

The pull-request browser workflow also runs `npm run check:kernel` before building and executing the existing living-planet browser diagnostics.

## Next experiment

The next step should connect the existing camera or selected-region inspector to `requestAt()` so visible zoom/inspection becomes an actual simulation-resolution request. That remains read-only initially. Only after that behavior is stable should one scale become writable/authoritative under the kernel scheduler.
