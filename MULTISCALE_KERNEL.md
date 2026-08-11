# Multiscale Reality Kernel v5 experiment

This branch adds a general multiscale orchestration kernel around the existing Eidolon living planet. The public simulation still has one authoritative world, one fixed simulation clock, and one renderer.

v5 has three connected capabilities:

1. observer-driven spatial/temporal resolution,
2. writable ecological energy and nutrient contracts,
3. an event-driven ecological transaction layer that removes per-tick whole-population reconciliation scans.

## Core multiscale behavior

- A single node tree spans arbitrary orders of magnitude using physical scale values in metres.
- Observers request finer spatial and temporal resolution.
- Refinement is deterministic from the universe seed and node/refinement history.
- Coarsened fine state is archived and restored instead of regenerated unrelatedly.
- Parent/child conserved quantities are checked at refinement boundaries.
- Different solvers can own different scale ranges and timestep limits.
- The scheduler reports computation-budget degradation rather than silently pretending full fidelity.

## Eidolon resolution hierarchy

```text
Eidolon planet
  -> macro region
      -> local patch
          -> existing ECS entity
```

Approximate representation scales:

```text
~3.82e7 m   planet diameter
~6.00e6 m   macro region
~6.00e5 m   local patch
0.5-4 m     current entity representation
```

These are representation scales, not measurement-accuracy claims.

The existing Pixi camera and inspector are kernel observers:

```text
zoom <= 1.25   planet overview
zoom >  1.25   macro region
zoom >= 3.5    local patch
zoom >= 8.0    nearest actual ECS entity when one exists
```

An empty close-up patch remains a patch. The kernel never fabricates an organism merely to satisfy requested detail.

## v5 ecological transactions

`core/ecological-transactions.js` is the new mutation boundary between organism-scale actions and coarse ecological ledgers.

The authoritative transaction vocabulary is:

```text
GRAZE
PREDATE
DIE
REPRODUCE
DECOMPOSE
UPTAKE
```

Creature energy mutations and entity destruction are captured at the ECS mutation boundary during the existing authoritative `world.step()`. The transaction layer assigns deterministic sequence numbers and invokes registered conservation handlers in priority order.

```text
world.step()
    |
    +-- organism mutation
    |       |
    |       +--> GRAZE / PREDATE / REPRODUCE / DIE
    |
    +-- fixed-grid ecological hooks
            |
            +--> DECOMPOSE / UPTAKE
                    |
                    v
              conservation handlers
                    |
          +---------+---------+
          |                   |
     energy ledger       nutrient ledger
```

This replaces the previous correctness-first pattern of snapshotting every organism before a step and comparing the entire population afterward.

`scanFreePopulationAccounting: true` therefore means **no whole-population before/after reconciliation scan per tick**. The bounded 18×10 landscape grid still updates for primary production, soil state, and decomposition; its cost does not grow with organism population.

The current Eidolon adapter discovers transactions from ECS mutations so the legacy world model does not need to know about the generic kernel. That capture adapter is Eidolon-specific. A future generic transaction package should expose the journal/handler API, while each host simulation supplies its own event source or calls `transact()` directly.

### Transaction semantics

- `GRAZE` is emitted when a grazer attempts to increase stored energy. The energy ledger first debits finite coarse forage stock and can reduce the allowed gain before it reaches the organism. The nutrient ledger receives the same finalized transfer and moves vegetation nutrient into grazer biomass plus detrital waste.
- `PREDATE` pairs prey destruction with the immediately consuming predator/apex energy gain. The energy ledger limits retained energy by prey energy and trophic efficiency. The nutrient ledger transfers tracked prey nutrients into consumer biomass and detritus.
- `REPRODUCE` pairs a new same-guild entity with the parent energy transfer. Offspring energy cannot exceed the energy actually transferred by the parent. Tracked body nutrients are divided between parent and offspring rather than created.
- `DIE` returns tracked organism nutrients to local detritus. The same transaction type also represents coarse vegetation turnover with `guild: vegetation`.
- `DECOMPOSE` mineralizes local detritus into soil nutrient.
- `UPTAKE` moves soil nutrient into vegetation and can limit requested primary-production energy when nutrients are insufficient.

## Writable ecological energy

`core/ecological-energy-ledger.js` uses **model ecological-energy units**, not joules. `physicalUnitClaim` is false.

```text
seasonal climate / water
          |
          v
 finite vegetation energy
          |
        GRAZE
          v
       grazer
          |
       PREDATE
          v
      predator
          |
       PREDATE
          v
        apex
```

A grazer cannot retain landscape-derived energy unless the corresponding coarse forage cell loses stock. Exhausted cells stop feeding organisms. Primary production replenishes stock only through an `UPTAKE` transaction. Predator/apex gains are bounded by energy actually removed with prey, and reproduction cannot create additional stored energy.

## Writable nutrient cycle

`core/ecological-nutrient-cycle.js` uses separate **model-nutrient units**, not grams, moles, carbon, nitrogen, phosphorus, or another physical chemical unit. `physicalUnitClaim` is false.

```text
soil minerals
    |
  UPTAKE
    v
vegetation
    |
   GRAZE
    v
mobile biota
    |
PREDATE / DIE
    v
detritus
    |
DECOMPOSE
    v
soil minerals
```

Initial soil and existing biomass are explicit initial conditions. Existing coarse forage receives an initial nutrient allocation from soil. Thereafter nutrient matter moves between the four reservoirs rather than being created by primary production.

Warm/moist cells mineralize detritus faster than cold/dry cells. Nutrient availability feeds back into vegetation productivity, and total model nutrient matter is checked for conservation drift.

## Browser API

```js
await window.realitySandboxKernelReady;
const kernel = window.realitySandboxRealityKernel;

console.log(kernel.snapshot());
console.log(kernel.ecologicalTransactions.snapshot());
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
```

Useful calls:

```js
kernel.getScales();
kernel.snapshot();
kernel.refresh();
kernel.observation.syncCamera();
kernel.observation.syncInspector();
kernel.ecologicalTransactions.snapshot();
kernel.ecologicalEnergy.getCell(600, 360);
kernel.ecologicalNutrients.getCell(600, 360);
kernel.releaseObserver('microscope');
```

## Checks

```bash
npm run check:kernel
npm run check:kernel-browser
```

The kernel suite includes:

```text
scripts/multiscale-kernel-check.mjs
scripts/eidolon-kernel-adapter-check.mjs
scripts/reality-observer-level-check.mjs
scripts/ecological-transactions-check.mjs
scripts/ecological-energy-ledger-check.mjs
scripts/ecological-nutrient-cycle-check.mjs
```

It verifies deterministic refinement, temporal scheduling, collapse/restore, conservation rejection, lazy Eidolon resolution, all six ecological transaction types, forage depletion, trophic anti-creation, reproduction transfer, nutrient inheritance, grazing/predation nutrient flows, decomposition, soil uptake, and nutrient conservation drift.

The Chromium test verifies the transaction layer and both writable ledgers in the production build, then drives the public runtime through planet -> region -> patch -> actual ECS entity -> inspector -> coarsening while retaining the existing iPhone, renderer, performance, Surface Mode, and runtime diagnostics.

## Fidelity boundary

This is not a claim that Eidolon performs molecular dynamics, stellar evolution, complete thermodynamics, or elemental biogeochemistry. Energy and nutrients deliberately use separate model units. Cross-scale authority expands only when units, conservation rules, handoff semantics, and tests are explicit.

## Repository boundary

The generic orchestration core is now clearly reusable enough to deserve its own repository, but the split should occur at a stable API boundary.

A future repository should contain generic machinery only:

```text
multiscale-reality-kernel/
  src/
    kernel/
      node tree
      refinement / coarsening
      solver registry
      scheduler
      deterministic state archive
      conservation contracts
    transactions/
      deterministic transaction journal
      handler ordering
      generic transfer contracts
  tests/
  package.json
```

This Eidolon repository should keep:

```text
Eidolon adapter
camera / inspector bridge
ECS mutation capture adapter
ecological energy ledger
ecological nutrient cycle
browser integration tests
renderers and UI
```

The **journal/handler mechanism** can eventually move to the generic repository; the code that knows `grazer`, `predator`, `apex`, Eidolon's ECS maps, or forage cells should not.

After one more non-ecological cross-scale contract proves the same APIs can serve a different domain, extract the stable generic core into its own repository/package and consume it here as a normal dependency rather than a Git submodule.

## Next experiment

The strongest next test is a **different physical domain**, not another ecology-only layer. A good candidate is local hydrology/erosion: coarse watershed water and sediment reservoirs could refine into local river/terrain processes and exchange explicit `PRECIPITATE`, `FLOW`, `ERODE`, `DEPOSIT`, and `EVAPORATE` transactions. If the same kernel and transaction contracts survive that without ecology-specific changes, the case for splitting the generic kernel into its own repository becomes much stronger.
