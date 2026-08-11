# Multiscale Reality Kernel v4 experiment

This branch adds a general multiscale orchestration kernel around the existing Eidolon living planet. The public simulation still has one authoritative world, one fixed simulation clock, and one renderer. The kernel now supports observer-driven resolution plus two writable ecological contracts: energy transfer and nutrient cycling.

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

## Writable ecological energy contract

`core/ecological-energy-ledger.js` uses **model ecological-energy units**, not joules. `physicalUnitClaim` is explicitly false.

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
              |
              v
          predators
              |
              v
             apex
```

A grazer cannot retain landscape-derived energy unless its coarse forage cell loses stock. Exhausted cells stop providing forage. Primary production replenishes stock from the existing seasonal productivity model. Predator and apex stored energy are also reconciled so reproduction cannot create more trophic energy than previous stored energy plus bounded transfer from prey that actually disappeared.

## Writable nutrient cycle

`core/ecological-nutrient-cycle.js` adds a separate **model-nutrient** ledger. These units are not moles, grams, nitrogen, phosphorus, or any other claimed physical chemical unit; `physicalUnitClaim` is false.

The nutrient reservoirs are:

```text
             soil minerals
                  |
             plant uptake
                  v
       vegetation nutrients
             /          \
        grazing       turnover
           |              |
           v              v
     mobile biota ---> detritus
           |              |
       predation      decomposition
           |              |
           +--------------+
                  |
                  v
             soil minerals
```

The nutrient layer is installed before the energy ledger wraps the seasonal resource field. Soil availability therefore changes the productivity seen by coarse vegetation. After the energy ledger is installed, the nutrient layer attaches outside that same authoritative `world.step()` and observes the energy ledger's per-cell flow counters. It does not create a second clock.

### Nutrient transfers

- Initial soil and existing biomass are explicit initial conditions.
- Existing coarse forage stock receives a corresponding initial vegetation-nutrient reservoir by transferring nutrient from soil.
- Primary-production flow moves nutrient from soil into vegetation.
- Grazing moves vegetation nutrient into mobile biota and detrital waste.
- Seasonal vegetation turnover moves vegetation nutrient into detritus.
- Prey removal transfers only a bounded fraction of prey nutrient matter into the next trophic level; the remainder becomes detritus at the prey location.
- Starvation or top-level death returns the tracked organism nutrient reservoir to local detritus.
- Decomposition mineralizes detritus back into soil, accelerated by warm/moist conditions and slowed by cold/dry conditions.
- Nutrient reservoirs are checked for conservation drift independently from ecological energy.

This closes the first model nutrient loop without pretending the simulation already contains detailed elemental stoichiometry, microbial food webs, or molecular chemistry.

## Browser API

```js
await window.realitySandboxKernelReady;
const kernel = window.realitySandboxRealityKernel;

console.log(kernel.snapshot());
console.log(kernel.ecologicalEnergy.snapshot());
console.log(kernel.ecologicalNutrients.snapshot());
```

A manual observation returns local energy and nutrient state:

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
console.log(result.ecologicalNutrients);
```

Useful calls include:

```js
kernel.getScales();
kernel.snapshot();
kernel.refresh();
kernel.observation.syncCamera();
kernel.observation.syncInspector();
kernel.ecologicalEnergy.getCell(600, 360);
kernel.ecologicalNutrients.getCell(600, 360);
kernel.releaseObserver('microscope');
```

## Checks

```bash
npm run check:kernel
npm run check:kernel-browser
```

The headless kernel suite covers:

```text
scripts/multiscale-kernel-check.mjs
scripts/eidolon-kernel-adapter-check.mjs
scripts/reality-observer-level-check.mjs
scripts/ecological-energy-ledger-check.mjs
scripts/ecological-nutrient-cycle-check.mjs
```

It verifies deterministic refinement, temporal scheduling, collapse/restore, conservation rejection, lazy Eidolon resolution, zoom-to-resolution behavior, forage depletion/recovery, trophic energy anti-creation, nutrient transfer through grazing and predation, detrital mineralization, soil-to-vegetation uptake, and nutrient conservation drift.

The Chromium check verifies both writable ledgers are installed in the production build, then drives the public runtime through planet -> region -> patch -> actual ECS entity -> inspector -> coarsening while retaining the existing iPhone, renderer, performance, Surface Mode, and runtime diagnostics.

## Fidelity boundary

This is not a claim that Eidolon performs molecular dynamics, stellar evolution, complete thermodynamic accounting, or elemental biogeochemistry. Energy and nutrient contracts deliberately use separate model units. Cross-scale authority expands only when units, conservation rules, handoff semantics, and tests are explicit.

## Repository boundary

The generic orchestration core is becoming reusable enough to deserve its own repository, but the split should happen at a stable interface rather than by moving every experimental file now.

A future kernel repository should contain only things that do not know what Eidolon, Pixi, vegetation, grazers, or this specific ECS are:

```text
multiscale-reality-kernel/
  src/kernel/
    node tree
    refinement / coarsening
    solver registry
    scheduler
    deterministic state archive
    conservation contracts
  tests/
  package.json
```

This repository should keep:

```text
Eidolon adapter
camera / inspector bridge
ecological energy ledger
ecological nutrient cycle
browser integration tests
renderers and UI
```

Once the generic API survives another one or two writable cross-scale contracts without changing shape, extract `core/multiscale-kernel.js` and its synthetic tests into a dedicated package/repository and consume it here as a dependency. Avoid a Git submodule; a normal package or Git dependency keeps the application boundary cleaner.

## Next experiment

The next high-value step is to replace correctness-first whole-population reconciliation with explicit ecological transaction events. Grazing, predation, death, reproduction, and decomposition should publish deterministic transfers directly to the ledgers. That preserves the same conservation rules while scaling better as populations grow without an artificial cap. After that, individual nutrient inheritance and explicit carbon/nitrogen/phosphorus-style reservoirs can be considered without conflating them with the current generic model-nutrient units.
