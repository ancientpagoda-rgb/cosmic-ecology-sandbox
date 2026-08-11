# Multiscale Reality Kernel v0

This experiment adds a headless orchestration layer for one deterministic world that can be represented at different spatial and temporal resolutions. It is intentionally not imported by the public living-planet root yet.

## What v0 proves

- A single node tree can span arbitrary orders of magnitude using physical scale values in metres rather than hard-coded game LOD numbers.
- An observer can request a finer spatial and temporal resolution.
- Refinement is deterministic from the universe seed and the node/refinement history.
- A refined subtree can be coarsened without deleting its microstate, then restored exactly instead of inventing new detail when the observer returns.
- Parent/child refinement boundaries are rejected if declared conserved quantities do not reconcile.
- Different solvers can own different scale ranges and timestep limits.
- The scheduler reports when a requested timestep would exceed the configured computation budget (`degraded: true`) instead of silently pretending full fidelity.

## Core model

```text
observer request
      |
      v
RealityKernel
  |-- resolution tree (coarse <-> fine)
  |-- deterministic refinement
  |-- conservation checks
  |-- solver registry
  `-- temporal scheduler
           |
           v
      active leaf states
```

Only active leaves advance. A coarse parent stops being the authoritative evolving representation while one or more refined children are active below it. Sibling regions may remain coarse while an observed branch is refined further.

## Scale is continuous

The kernel does not require fixed labels such as "planet" or "cell". Each node declares `scale` in metres and an optional characteristic timescale in seconds. A test hierarchy currently spans:

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

v0 is a kernel, not a claim that the project now performs molecular dynamics, stellar evolution, or cosmology. Real scientific solvers can be attached later through `registerSolver()`. The current public Eidolon simulation remains unchanged.

## Next experiment

The next useful step is a read-only adapter around the existing Eidolon world. It should expose the current planetary/ecological state as one kernel node and refine a selected region into the already-existing creature/resource state, while the renderer continues to read the same authoritative world. That will test the kernel against a real simulation without creating a second clock or renderer.

## Check

```bash
node scripts/multiscale-kernel-check.mjs
```

The check verifies deterministic deep refinement, temporal scheduling, exact collapse/restore of microstate, and rejection of a deliberately non-conservative refinement.
