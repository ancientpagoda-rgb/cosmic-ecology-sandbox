# Multiscale Reality Kernel

Portable, domain-neutral primitives extracted from the Eidolon reality-simulation experiment.

## What belongs here

- deterministic multiscale node hierarchy
- observer-driven refinement and coarsening
- solver selection and temporal scheduling
- deterministic archived fine state
- conservation checks at refinement boundaries
- deterministic transaction journal
- priority-ordered transaction handlers
- before/after step hooks supplied by a host simulation

## What does not belong here

This package intentionally does not know about:

- Eidolon
- ECS entities or creature guilds
- Pixi/Three rendering
- camera or inspector controls
- ecology, hydrology, sediment, weather, or terrain-specific event names
- browser globals

A host application supplies its own transaction vocabulary and adapters.

## API

```js
import { RealityKernel, createTransactionJournal } from 'multiscale-reality-kernel';
```

### RealityKernel

```js
const kernel = new RealityKernel({ seed: 'universe-1' });

kernel.registerSolver({
  id: 'regional',
  minScale: 1,
  maxScale: 1e7,
  maxDt: 0.1,
  step({ node, dt }) {
    // host-domain solver
  },
});
```

### Transaction journal

```js
const transactions = createTransactionJournal({
  types: ['TRANSFER', 'REFINE'],
  getTick: () => simulationTick,
});

transactions.register('TRANSFER', event => {
  event.result.accepted = true;
}, 10);

transactions.transact('TRANSFER', {
  from: 'coarse',
  to: 'fine',
}, {
  accepted: false,
});
```

The journal owns deterministic ordering, validation, counters, bounded history, and hooks. It does not infer domain events itself.

## Tests

```bash
npm test
```

The package tests are deliberately synthetic and independent of Eidolon. The parent `cosmic-ecology-sandbox` repository supplies integration tests proving the package against ecology, hydrology, rendering, mobile, performance, and long-run simulation behavior.

## Extraction status

This directory is a repository-ready staging boundary. `cosmic-ecology-sandbox` already imports the implementation from here rather than maintaining a duplicate kernel. The remaining mechanical step is to create a standalone GitHub repository, move this directory there, and replace the current relative imports with a package or Git dependency.
