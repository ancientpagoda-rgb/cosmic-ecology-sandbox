# Multiscale Reality Kernel v2 experiment

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

## Camera and inspector coupling

The existing Pixi camera and selected-region inspector now act as kernel observers. They do not step the kernel or change the simulation; they only change how much of the authoritative state is materialized in the multiscale tree.

Camera resolution bands:

```text
zoom <= 1.25   planet-only overview
zoom >  1.25   macro region
zoom >= 3.5    local patch
zoom >= 8.0    nearest actual ECS entity
```

The inspector is an explicit observer only after a real click/tap or programmatic selection. This keeps the normal 1x startup at a single planet node instead of eagerly allocating regional detail.

Once the inspector is active, its resolution follows the viewing context:

```text
overview          selected macro region
moderate/close    selected local patch
very close        nearest actual ECS entity
```

Zooming back out releases the camera observer and coarsens an active inspector from entity/patch detail back to its macro region. Fine descendants remain archived rather than deleted, so returning to the same area can recover the same branch instead of inventing unrelated state.

Mouse wheel zoom, pinch/drag camera movement, keyboard camera controls, click/tap selection, and the runtime's public `setCamera`, `resetCamera`, and `selectAtClientPoint` methods all feed the observer bridge. The bridge is event-driven and does not add a second simulation clock or continuous animation loop.

## Adaptive behavior

Only the hierarchy needed by an observer is refined. If the observer moves to another macro region, the old region's patch/entity descendants are archived and remain inactive. Returning to patch-level resolution does not automatically reactivate entity-level detail.

The adapter deliberately has no population or display cap. It materializes every authoritative ECS entity currently inside the observed patch. This does not change or cap the underlying simulation population.

## Browser API

After the authoritative world is ready:

```js
await window.realitySandboxKernelReady;

const kernel = window.realitySandboxRealityKernel;
console.log(kernel.observation.snapshot());
console.log(kernel.snapshot());
```

Manual observations remain available:

```js
const result = kernel.requestAt({
  observerId: 'microscope',
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
kernel.getScales();
kernel.snapshot();
kernel.refresh();
kernel.observation.syncCamera();
kernel.observation.syncInspector();
kernel.releaseObserver('microscope');
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
npm run check:kernel-browser
```

The headless kernel suite runs:

```text
scripts/multiscale-kernel-check.mjs
scripts/eidolon-kernel-adapter-check.mjs
scripts/reality-observer-level-check.mjs
```

It checks deterministic refinement, temporal scheduling, collapse/restore behavior, computation-budget degradation, rejection of non-conservative refinement, lazy planet -> region -> patch -> real-entity resolution, live ECS reads, observer movement, archived fine branches, and the zoom-to-resolution contract.

The Chromium check drives the real public runtime through:

```text
1x overview
 -> 2x region
 -> 4x patch
 -> 9x actual ECS entity
 -> selected inspector patch
 -> zoom out / coarsen
```

It also verifies that existing Eidolon runtime diagnostics remain green. The pull-request browser workflow gates on this check before declaring the browser status successful.

## Next experiment

The next meaningful step is to expose the active kernel resolution in the inspector/debug UI and then choose one narrow process for the first writable cross-scale coupling. A good candidate is a local ecological resource/energy ledger, because it can be reconciled against existing organism and forage state without pretending that the current sandbox already has full physical mass-energy conservation.
