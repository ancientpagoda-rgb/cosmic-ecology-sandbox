# Multiscale Reality Kernel v6 experiment

This branch adds a general multiscale orchestration kernel around the existing Eidolon living planet. The public simulation still has one authoritative world, one fixed simulation clock, and one renderer.

v6 now demonstrates four connected capabilities:

1. observer-driven spatial/temporal resolution,
2. writable ecological energy and nutrient contracts,
3. scan-free organism accounting through explicit transactions,
4. a non-ecological hydrology/erosion contract using the **same transaction API**.

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

## Shared reality transactions

`core/ecological-transactions.js` began as an ecological event adapter. In v6 its generic API is unchanged but its vocabulary now spans two domains. `ECOLOGICAL_TRANSACTION_TYPES` remains a compatibility alias; the canonical vocabulary is `REALITY_TRANSACTION_TYPES`.

```text
Ecology
  GRAZE
  PREDATE
  DIE
  REPRODUCE
  DECOMPOSE
  UPTAKE

Hydrology / geomorphology
  PRECIPITATE
  FLOW
  ERODE
  DEPOSIT
  EVAPORATE
```

The common API remains:

```text
transact(type, payload, result)
register(type, handler, priority)
beforeStep(handler, priority)
afterStep(handler, priority)
snapshot()
```

Transactions receive deterministic sequence numbers and are journaled in one ordered stream. Organism-scale events are discovered through the Eidolon ECS mutation adapter; hydrology publishes directly from its domain contract. This separation is important: the generic journal does not need to know what a grazer, river, or sediment cell is.

`scanFreePopulationAccounting: true` means no whole-population before/after reconciliation scan per tick. Fixed environmental grids still update at bounded cost independent of organism population.

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

## v6 hydrology / erosion contract

The existing `core/water-cycle.js` remains the authoritative dynamic water model. It already evolves a 180×90 grid of vapor, cloud, precipitation, snowpack, soil moisture, surface water, runoff, floods, droughts, rivers, lakes, and tides.

`core/hydrology-erosion-contract.js` does **not** create another water simulation. It wraps that existing water-cycle object and samples it on a bounded 60×30 geomorphic grid every 0.48 simulated seconds.

```text
existing dynamic water cycle
           |
     PRECIPITATE
           v
       runoff / flow
           |
         ERODE
           v
  suspended sediment
           |
          FLOW
           v
        DEPOSIT
           |
           v
  floodplain / basin sediment
```

### Sediment conservation

The contract owns three explicit **model-sediment** reservoirs:

```text
erodible terrain
      |
    ERODE
      v
suspended sediment
      |
 FLOW / transport
      v
 deposited sediment
```

Erosion, transport, and deposition move sediment between those reservoirs without creating or destroying it. `snapshot().sediment.drift` checks the total against the initialized baseline.

### Water accounting boundary

Hydrology transactions also journal modeled `PRECIPITATE`, `FLOW`, and `EVAPORATE` fluxes, but v6 deliberately sets:

```text
waterAccounting.conservationClaim = false
```

The pre-existing browser water solver is an open reduced-order model with semi-Lagrangian numerical damping and implicit ocean moisture source terms. Those fluxes are useful causal diagnostics, but v6 does **not** misrepresent them as a closed global water-mass budget.

This distinction is intentional: sediment is a closed writable conservation contract in v6; water is not yet.

### Hydrology -> ecology feedback

The hydrology contract wraps `waterCycle.sample()` with local erosion and sediment state. The existing seasonal resource field now reads that state:

- recent deposition modestly increases coarse vegetation fertility,
- active erosion modestly reduces near-term fertility.

That creates a real causal path:

```text
weather / runoff
      -> erosion
      -> sediment transport
      -> deposition
      -> substrate fertility
      -> vegetation productivity
      -> ecology
```

The coefficients remain model-level approximations, not soil-chemistry measurements.

## Browser API

```js
await window.realitySandboxKernelReady;
const kernel = window.realitySandboxRealityKernel;

console.log(kernel.snapshot());
console.log(kernel.realityTransactions.snapshot());
console.log(kernel.hydrologyErosion.snapshot());
console.log(kernel.ecologicalEnergy.snapshot());
console.log(kernel.ecologicalNutrients.snapshot());
```

A point observation now returns local hydrology/sediment state as well as ecological state.

## Checks

```bash
npm run check:kernel
npm run check:kernel-browser
```

The headless suite covers:

```text
multiscale kernel invariants
Eidolon adapter / observer resolution
ecological transaction classification
energy transfer
nutrient conservation
real water-cycle-driven erosion / sediment transport / deposition
hydrology transaction journaling
sediment conservation drift
```

`hydrology-erosion-contract-check.mjs` runs the real existing water cycle in headless mode, attaches the shared transaction bus, advances multiple hydrology solves, verifies all five hydrology event types, verifies that sediment actually changes reservoirs, and rejects conservation drift.

The Chromium test verifies the shared cross-domain transaction layer, sediment contract, ecological ledgers, and camera-driven reality refinement in the production build while retaining the existing iPhone, unified-runtime, renderer, performance, WebGL-recovery, Surface Mode, and long-run diagnostics.

## Fidelity boundary

This is not a claim that Eidolon performs molecular dynamics, complete thermodynamics, Navier-Stokes fluid dynamics, or elemental geochemistry. Energy, nutrients, water flux, and sediment deliberately use separate model units unless and until a physically defensible conversion is introduced.

Cross-scale authority expands only where units, conservation rules, handoff semantics, and tests are explicit.

## Repository boundary: extraction criterion met

v5 intentionally waited for a non-ecological contract before deciding whether the generic core deserved its own repository. v6 provides that evidence: hydrology/erosion uses the same kernel and transaction API without requiring an ecology-specific scheduler or journal redesign.

The generic core is therefore ready to be extracted at the next clean checkpoint.

A dedicated repository/package should contain only domain-neutral machinery:

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
      generic transaction registration / dispatch
  tests/
  package.json
```

This Eidolon repository should keep:

```text
Eidolon kernel adapter
camera / inspector bridge
ECS organism-mutation capture
hydrology / erosion adapter and sediment model
ecological energy ledger
ecological nutrient cycle
browser integration tests
renderers and UI
```

Use a normal package or Git dependency rather than a Git submodule.

## Next experiment

After the v6 branch is checkpointed, the best architectural move is to extract the generic kernel + generic transaction journal into its own repository/package while preserving this branch as the integration reference implementation.

After extraction, the next scientific extension could close the **water** budget itself: replace implicit ocean source/numerical moisture loss with explicit atmosphere/ocean/soil/surface reservoirs and conservation-tested phase/transport transactions.
