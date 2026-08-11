# Multiscale Reality Kernel v3 experiment

This branch adds a general multiscale orchestration kernel around the existing Eidolon living planet. The public simulation still has one authoritative world, one fixed simulation clock, and one renderer. The kernel now has two roles: observer-driven resolution and one deliberately narrow writable ecological-energy contract.

## What the core kernel proves

- A single node tree can span arbitrary orders of magnitude using physical scale values in metres rather than hard-coded game LOD numbers.
- Observers can request finer spatial and temporal resolution.
- Refinement is deterministic from the universe seed and node/refinement history.
- A refined subtree can be coarsened without deleting its microstate, then restored instead of inventing unrelated detail when the observer returns.
- Parent/child refinement boundaries are rejected if declared conserved quantities do not reconcile.
- Different solvers can own different scale ranges and timestep limits.
- The scheduler reports computation-budget degradation instead of pretending full fidelity.
- Re-opening a parent only activates its immediate children; archived microscopic descendants remain coarse until requested again.

## Eidolon resolution hierarchy

The adapter uses `window.realitySandboxPlanet` as its source of truth and materializes:

```text
Eidolon planet
  -> macro region
      -> local patch
          -> existing ECS entity
```

Approximate representation scales are:

```text
~3.82e7 m   planet diameter
~6.00e6 m   macro region
~6.00e5 m   local patch
0.5-4 m     current entity representation
```

These are representation scales, not claims of measurement accuracy.

## Camera and inspector coupling

The existing Pixi camera and selected-region inspector act as kernel observers without adding another animation loop or simulation clock.

```text
zoom <= 1.25   planet-only overview
zoom >  1.25   macro region
zoom >= 3.5    local patch
zoom >= 8.0    nearest actual ECS entity, when one exists
```

An empty close-up patch honestly remains a patch. The kernel never fabricates an entity to satisfy requested resolution.

The inspector becomes an observer only after an actual click/tap or programmatic selection. Zooming back out releases or coarsens observers and archives fine descendants.

## First writable cross-scale contract

`core/ecological-energy-ledger.js` is the first kernel-adjacent component allowed to alter authoritative simulation state.

It deliberately uses **model ecological-energy units**, not joules. `physicalUnitClaim` is explicitly false.

The contract is:

```text
seasonal climate / water / vegetation
              |
              v
      coarse forage cell stock
              |
         actual withdrawal
              v
        individual grazer
          stored energy
```

A grazer can no longer retain energy gained from landscape forage unless its coarse landscape cell loses stock. When a cell is exhausted, the resource field reports no available forage and further browsing cannot create organism energy. Stock returns only through modeled primary production, bounded by the current seasonal resource productivity.

The wrapper is installed around the existing authoritative `world.step()`; `createSphericalStepper`, the module host, renderer, and fixed timestep still call the same world clock.

### Trophic anti-creation reconciliation

The ledger also closes a pre-existing bookkeeping leak in predator/apex reproduction. After each authoritative step:

```text
predator stored energy
<= previous predator stored energy
 + bounded transfer from grazers that actually disappeared

apex stored energy
<= previous apex stored energy
 + bounded transfer from predators that actually disappeared
```

If reproduction or another fine-scale rule would create stored trophic energy beyond that ceiling, the ledger removes the excess, preferring newly created entities first. Unassimilated prey energy is recorded as trophic waste rather than silently appearing in the consumer.

This is still an ecological model contract, not universal thermodynamics. Metabolic heat, detrital chemistry, elemental mass, photons, and SI-unit energy are not yet fully modeled.

## Browser API

```js
await window.realitySandboxKernelReady;
const kernel = window.realitySandboxRealityKernel;

console.log(kernel.snapshot());
console.log(kernel.ecologicalEnergy.snapshot());
```

A manual observation also returns the local ecological-energy cell state:

```js
const result = kernel.requestAt({
  observerId: 'microscope',
  x: 600,
  y: 360,
  spatialScale: 1,
  temporalScale: 0.06,
});

console.log(result.node);
console.log(result.ecologicalEnergy);
```

Useful calls include:

```js
kernel.getScales();
kernel.snapshot();
kernel.refresh();
kernel.observation.syncCamera();
kernel.observation.syncInspector();
kernel.ecologicalEnergy.getCell(600, 360);
kernel.releaseObserver('microscope');
```

## General synthetic scale test

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

Those labels are a test fixture; solver selection is numerical.

## Checks

```bash
npm run check:kernel
npm run check:kernel-browser
```

The headless suite now covers:

```text
scripts/multiscale-kernel-check.mjs
scripts/eidolon-kernel-adapter-check.mjs
scripts/reality-observer-level-check.mjs
scripts/ecological-energy-ledger-check.mjs
```

It verifies deterministic refinement, temporal scheduling, collapse/restore, conservation rejection, lazy Eidolon resolution, zoom-to-resolution behavior, coarse forage depletion, zero energy gain from an exhausted cell, primary-production recovery, and rejection of deliberately created predator reproduction energy.

The Chromium check verifies the writable ledger is installed in the real production build, then drives the public runtime through planet -> region -> patch -> actual ECS entity -> inspector -> coarsening while retaining all existing runtime diagnostics.

## Fidelity boundary

This is not a claim that Eidolon performs molecular dynamics, stellar evolution, or complete thermodynamic accounting. The first writable contract is intentionally narrow because cross-scale authority should only expand when units, conservation rules, handoff semantics, and tests are explicit.

## Next experiment

The next useful extension is a **detritus / nutrient return pool**. Metabolic loss, failed assimilation, predation waste, and dead organisms could enter a local coarse nutrient reservoir; vegetation productivity could then consume that reservoir. That would close the first ecological cycle instead of treating primary production and waste as one-way bookkeeping endpoints.
