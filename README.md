# Reality Sandbox

Reality Sandbox is a deterministic browser simulation that connects planetary formation, ecology, evolution, civilizations, industry, colonies, machine lineages, relativistic travel, stellar evolution, galaxy evolution, and cosmology.

## Live experiences

- **Root Phase 11 universe:** https://ancientpagoda-rgb.github.io/reality-sandbox/
- **Reality Engine V6.9:** https://ancientpagoda-rgb.github.io/reality-sandbox/reality-engine-v6-9.html

These are intentionally separate maintained surfaces.

### Root Phase 11 universe

The root page is the current continuous simulation. It contains the living planet and the Phase 8–11 progression:

1. planetary weather, geology, hydrology, ecology, and abiogenesis;
2. embodied evolution with Three.js creatures, Yuka steering, and local Rapier physics;
3. cultures, languages, settlements, Graphology networks, and institutions;
4. industry, science, cities, epidemiology, economies, transport, and spaceflight;
5. persistent colonies, autonomous machines, closed-loop habitats, interplanetary logistics, and first contact;
6. relativistic interstellar missions, stellar evolution, galactic civilizations, astroengineering, and cosmic archaeology;
7. FLRW cosmology, galaxy mergers, AGN activity, causal horizons, gravitational waves, cosmological signals, and observable-universe archaeology.

The root runtime uses a capability-based module host. Current module order is:

```text
galaxy → orbital system → origin → rendering/physics/scientific adapters
→ hydrology/ecology/planet dynamics → ground and surface visuals
→ embodied evolution → civilization graph
→ Phase 8 → Phase 9 → Phase 10 → Phase 11
```

Phase 10 remains dormant until a Phase 9 civilization exists, and Phase 11 remains dormant until Phase 10 has begun. Deterministic debug scenarios may explicitly activate later phases for testing.

### Reality Engine V6.9

V6.9 preserves the earlier integrated audiovisual engine and remains independently deployable and tested. It contains:

- CesiumJS planetary globe;
- PixiJS fixed-timestep presentation and pixel effects;
- Howler.js deterministic generative and spatial soundscape;
- Astronomy Engine seasons, ephemerides, eclipses, lunar state, tides, and climate coupling;
- Three.js multi-system universe;
- same-origin REBOUND 5.0.0 WebAssembly N-body physics;
- mobile simplification and interactive sound, orbit, weather, politics, and time controls.

PixiJS, Howler.js, Astronomy Engine, and CesiumJS are therefore preserved in the V6.9 surface rather than duplicated inside the Phase 11 root renderer.

## Core architecture

### Module host

`core/module-host.js` provides deterministic module registration, capability dependencies, topological ordering, fixed-step updates, rendering hooks, save serialization, and migration-aware loading.

Each module follows this general contract:

```js
{
  id,
  version,
  execution,
  provides: [],
  requires: [],
  after: [],
  async initialize(context) {},
  step(dt) {},
  render(frame) {},
  save() {},
  async load(state) {}
}
```

### Simulation levels of detail

- Viewed and selected systems receive explicit simulation.
- Nearby organisms, settlements, missions, galaxies, and events receive higher fidelity.
- Distant or expensive populations use deterministic statistical LOD.
- Mobile devices use smaller populations, grids, histories, and integration counts.

### Save state

The root universe stores the world tick, camera state, and every module's versioned state in local storage under `reality-sandbox-globe-v1`. Modules without saved data initialize from deterministic seeds. Older phase saves are loaded only into modules that recognize their stored module id.

V6.9 maintains its own compatible legacy save keys for the living world, orbital climate, sound and presentation settings.

## Debugging and inspection

Open the root project with the debug panel:

```text
https://ancientpagoda-rgb.github.io/reality-sandbox/?debug=1
```

The root runtime exposes:

```js
window.realitySandboxDebug
window.realitySandboxModules
window.realitySandboxPhase8
window.realitySandboxPhase9
window.realitySandboxPhase10
window.realitySandboxPhase11
window.realitySandboxFactories
```

The debug bridge supports pause/resume, deterministic stepping, time scaling, scenario injection, snapshots, Phase 8–11 invariants, error capture, downloadable diagnostics, and on-demand Spector.js WebGL capture.

## Validation

Install and run locally:

```bash
npm ci
npm run audit:integration
npm run build
npm run dev
```

Run the combined static integration and production-build check:

```bash
npm run check
```

The permanent integration audit verifies that the root Phase 11 chain and preserved V6.9 systems remain present and connected. It checks the Phase 8–11 runtime imports and registration order, save/load host, debug scenarios, Three.js, PixiJS, Howler.js, Astronomy Engine, Rapier, REBOUND, GDAL, dependency declarations, notices, and CI hooks.

GitHub Actions additionally performs:

- production Vite build;
- deterministic Chromium boot and stepping;
- all Phase 8–11 numerical and causal invariants;
- seven Phase 11 browser scenarios;
- Playwright trace, screenshot, and video recording;
- Spector.js WebGL capture;
- REBOUND source and Emscripten build validation;
- artifact integrity checks;
- GitHub Pages deployment;
- live V6.9 and Phase 8–11 bundle verification.

## Current scientific boundaries

Reality Sandbox uses scientifically motivated deterministic approximations, not precision research solvers.

- Planetary climate, ecology, societies, economies, and demographics are aggregate models.
- Interplanetary and interstellar travel use constrained approximations with REBOUND-compatible validation where practical.
- Relativistic missions use special-relativistic straight-line relationships rather than full general relativity.
- Stellar and galaxy evolution use analytic or reservoir models rather than stellar-structure, hydrodynamic, or cosmological N-body solvers.
- Phase 11 uses an explicitly labeled flat wCDM FLRW approximation.
- Speculative physics and machine civilizations are simulation states, not claims about reality or consciousness.

## Known non-fatal tooling warnings

Rapier 0.19.x may emit an upstream wasm-bindgen initialization deprecation warning while functioning normally. Spector.js may emit deleted-shader inspection warnings and a `ReadPixels` stall warning while capturing a frame. These warnings are capture/tooling behavior and are distinct from simulation invariant failures, page errors, or failed network requests.

## Project references

- Integration roadmap: [`INTEGRATION_ROADMAP.md`](./INTEGRATION_ROADMAP.md)
- Third-party notices: [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)
- Current next phase: [Phase 12 issue #23](https://github.com/ancientpagoda-rgb/reality-sandbox/issues/23)
