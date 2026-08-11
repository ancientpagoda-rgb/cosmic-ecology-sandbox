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

This replaces the previous correctness-first pattern of snapshotting every organism before a step and comparing the entire population afterward.

`scanFreePopulationAccounting: true` means **no whole-population before/after reconciliation scan per tick**. The bounded 18×10 landscape grid still updates for primary production, soil state, and decomposition; its cost does not grow with organism population.

The current Eidolon adapter discovers transactions from ECS mutations so the legacy world model does not need to know about the generic kernel. That capture adapter is Eidolon-specific. A future generic transaction package should expose the journal/handler API and direct `transact()` contract, while each host simulation supplies its own event source or calls `transact()` directly.

### Transaction semantics

- `GRAZE`: finite forage is debited before a grazer's requested energy gain is retained; the same finalized transfer moves vegetation nutrient into biomass and detrital waste.
- `PREDATE`: prey destruction is paired with the consuming predator/apex gain; retained energy and nutrients are bounded by the prey transfer.
- `REPRODUCE`: offspring energy cannot exceed energy actually transferred by the parent; tracked body nutrients are partitioned between parent and offspring.
- `DIE`: tracked organism nutrient returns to local detritus; vegetation turnover uses the same transaction with `guild: vegetation`.
- `DECOMPOSE`: local detritus mineralizes into soil nutrient.
- `UPTAKE`: soil nutrient enters vegetation and can limit requested primary production.

## Writable ecological energy

`core/ecological-energy-ledger.js` uses **model ecological-energy units**, not joules. `physicalUnitClaim` is false.

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

## Checks

```bash
npm run check:kernel
npm run check:kernel-browser
```

The headless suite includes `ecological-transactions-check.mjs`, energy-ledger checks, nutrient-cycle checks, the generic multiscale tests, adapter tests, and observer tests. It verifies all six transaction types, conservation behavior, reproduction transfer, nutrient inheritance, grazing/predation flows, decomposition, uptake, and nutrient conservation drift.

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

This Eidolon repository should keep the Eidolon adapter, camera/inspector bridge, ECS mutation capture adapter, ecological ledgers, browser tests, renderers, and UI.

After one more non-ecological cross-scale contract proves the same APIs can serve a different domain, extract the stable generic core into its own repository/package and consume it here as a normal dependency rather than a Git submodule.

## Next experiment

The strongest next test is a **different physical domain**, not another ecology-only layer. A good candidate is local hydrology/erosion: coarse watershed water and sediment reservoirs could refine into local river/terrain processes and exchange explicit `PRECIPITATE`, `FLOW`, `ERODE`, `DEPOSIT`, and `EVAPORATE` transactions. If the same kernel and transaction contracts survive that without ecology-specific changes, the case for splitting the generic kernel into its own repository becomes much stronger.
