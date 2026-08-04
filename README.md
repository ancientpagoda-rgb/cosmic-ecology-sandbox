# Reality Sandbox

Reality Sandbox is a deterministic browser simulation connecting planetary formation, ecology, evolution, civilizations, industry, colonies, machine lineages, relativistic travel, stellar evolution, galaxy evolution, cosmology, and the audiovisual systems originally developed for Reality Engine V6.9.

## Live experiences

- **Unified root universe:** https://ancientpagoda-rgb.github.io/reality-sandbox/
- **Reality Engine V6.9 compatibility page:** https://ancientpagoda-rgb.github.io/reality-sandbox/reality-engine-v6-9.html

The root now uses one authoritative world state and fixed timestep while exposing multiple presentation modes. The standalone V6.9 page remains available during compatibility and parity verification.

## Unified root universe

The root page contains the complete living planet and Phase 8–11 progression:

1. planetary weather, geology, hydrology, ecology, and abiogenesis;
2. embodied evolution with Three.js creatures, Yuka steering, and local Rapier physics;
3. cultures, languages, settlements, Graphology networks, and institutions;
4. industry, science, cities, epidemiology, economies, transport, and spaceflight;
5. persistent colonies, autonomous machines, closed-loop habitats, interplanetary logistics, and first contact;
6. relativistic interstellar missions, stellar evolution, galactic civilizations, astroengineering, and cosmic archaeology;
7. FLRW cosmology, galaxy mergers, AGN activity, causal horizons, gravitational waves, cosmological signals, and observable-universe archaeology;
8. root-level PixiJS presentation, Howler.js generative sound, Astronomy Engine Earth-reference validation, and same-origin REBOUND orbital physics.

The root runtime uses a capability-based module host. Current order is:

```text
galaxy → orbital system → origin → rendering/physics/scientific adapters
→ hydrology/ecology/planet dynamics → ground and surface visuals
→ embodied evolution → civilization graph
→ Phase 8 → Phase 9 → Phase 10 → Phase 11
→ unified Pixi / Howler / Astronomy / REBOUND runtime
```

The root module host remains the only simulation clock. PixiJS renders manually from that clock and does not start its own ticker. Howler.js mixes from root weather, life, civilization, mission, galaxy, and cosmology state. Astronomy Engine is used as a pinned Earth-reference ephemeris validator while the procedural generated system remains authoritative for non-Earth worlds. REBOUND receives orbital-day steps from the root clock and is loaded only for selected high-fidelity orbital work.

## Root view modes

The unified control panel provides four views without resetting simulation history:

- **Living world** — normal Three.js globe and close-up exploration;
- **Pixel presentation** — PixiJS weather, life, settlement, and event overlay;
- **Orbital system** — procedural or selected REBOUND orbital state;
- **Galaxy / universe** — Phase 10–11 galaxies, horizons, signals, and causal history.

The panel also controls Howler sound, volume, pixel effects, palette, orbital backend, and ephemeris preference. Keyboard shortcuts include `M` for sound and `V` to cycle views.

## Reality Engine V6.9 compatibility

The standalone V6.9 page remains independently deployable and tested. It preserves:

- CesiumJS planetary globe;
- the original PixiJS fixed-timestep presentation;
- the original Howler.js deterministic and spatial soundscape;
- Astronomy Engine seasons, ephemerides, eclipses, tides, and climate coupling;
- Three.js multi-system universe;
- REBOUND 5.0.0 WebAssembly N-body physics;
- weather, politics, orbital, sound, and time controls.

Legacy V6.9 audio volume, mute, palette, and pixel-effect preferences are migrated into the unified root module and written back to the compatibility keys.

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
- Mobile devices use smaller populations, histories, Pixi samples, audio sample rates, and REBOUND asteroid counts.
- Cesium remains on the compatibility page instead of running simultaneously with the root Three.js and PixiJS canvases.

### Save state

The unified root stores the world tick, camera state, and every module's versioned state under `reality-sandbox-globe-v1`. The unified module stores active view, Pixi state, palette, audio preferences, orbital backend, ephemeris preference, and master-clock counters.

V6.9 keeps its legacy save keys, and the unified module preserves the shared audiovisual preferences for compatibility.

## Debugging and inspection

Open the root with the debug panel:

```text
https://ancientpagoda-rgb.github.io/reality-sandbox/?debug=1
```

The root exposes:

```js
window.realitySandboxDebug
window.realitySandboxModules
window.realitySandboxPhase8
window.realitySandboxPhase9
window.realitySandboxPhase10
window.realitySandboxPhase11
window.realitySandboxUnified
window.realitySandboxFactories
```

Unified debug methods include:

```js
realitySandboxDebug.seedUnifiedScenario('shared-clock')
realitySandboxDebug.seedUnifiedScenario('view-switch')
realitySandboxDebug.seedUnifiedScenario('audio-coupling')
realitySandboxDebug.seedUnifiedScenario('astronomy')
realitySandboxDebug.seedUnifiedScenario('rebound')
realitySandboxDebug.seedUnifiedScenario('save-migration')
realitySandboxDebug.setUnifiedView('orbital')
```

## Validation

```bash
npm ci
npm run audit:integration
npm run build
npm run dev
```

The integration audit protects the Phase 8–11 chain, unified module order, shared-clock marker, root Pixi/Howler/Astronomy/REBOUND imports, save migration, debug scenarios, standalone V6.9 compatibility page, dependency declarations, notices, and CI hooks.

GitHub Actions performs:

- production Vite build;
- Phase 8–11 deterministic Chromium diagnostics;
- unified shared-clock, view, audio, astronomy, REBOUND, save-migration, and mobile-LOD scenarios;
- Playwright screenshots, video, traces, and state artifacts;
- Spector.js WebGL capture;
- pinned REBOUND source and Emscripten build validation;
- GitHub Pages deployment;
- live V6.9 and Phase 8–11 verification;
- live unified browser verification requiring the actual deployed REBOUND WASM backend.

## Scientific boundaries

- The generated planetary system remains the authority for its own non-Earth orbital climate. Astronomy Engine supplies an Earth-reference validation mode, not a claim that arbitrary generated planets follow the real Solar System.
- REBOUND integrates a selected deterministic orbital system under the root clock; distant systems continue using statistical or analytic LOD.
- Planetary climate, ecology, society, economies, stellar evolution, galaxies, and cosmology remain scientifically motivated approximations rather than precision research solvers.
- Cesium is not rendered concurrently with the root Three.js and PixiJS views to avoid excessive WebGL contexts and mobile resource use.

## Known non-fatal tooling warnings

Rapier 0.19.x may emit an upstream wasm-bindgen initialization deprecation warning while functioning normally. Spector.js may emit deleted-shader inspection and `ReadPixels` stall warnings during capture. These are distinct from page errors, failed requests, or invariant failures.

## Project references

- Unified runtime issue: [#25](https://github.com/ancientpagoda-rgb/reality-sandbox/issues/25)
- Integration roadmap: [`INTEGRATION_ROADMAP.md`](./INTEGRATION_ROADMAP.md)
- Third-party notices: [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)
- Next scientific phase: [Phase 12 issue #23](https://github.com/ancientpagoda-rgb/reality-sandbox/issues/23)
