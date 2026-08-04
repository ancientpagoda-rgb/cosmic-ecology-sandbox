# Reality Sandbox Scientific Integration Roadmap

Reality Sandbox uses a modular adapter host. Browser-native systems run locally; suitable C/C++/Rust projects can be compiled to WebAssembly; heavyweight Python/C++ scientific models can run as optional server workers and exchange compact snapshots with the browser.

## Maintained simulation surfaces

- **Root Phase 11 universe:** the current continuous planetary-to-cosmological simulation.
- **Reality Engine V6.9:** the preserved PixiJS, Howler.js, Astronomy Engine, CesiumJS, Three.js, and REBOUND audiovisual simulation.

The two surfaces share repository dependencies and scientific concepts but use separate render loops and save namespaces. This avoids forcing the root Phase 11 renderer to duplicate V6.9's fixed-timestep audiovisual presentation.

## Active integrations

| System | Execution | Current role |
| --- | --- | --- |
| Three.js 0.184.0 | Browser | Root globe, organisms, settlements, civilizations, and spatial scenes; V6.9 universe |
| Rapier 0.19.3 | Lazy WASM | Root rigid-body and local creature physics |
| REBOUND 5.0.0 | Emscripten WASM plus adapter | V6.9 N-body system and later-phase validation paths |
| GDAL3.js 2.8.1 | Lazy worker/WASM | Raster, vector, projection, warp, rasterize, and transform adapter |
| Yuka 0.7.8 | Browser with pinned CDN fallback | Embodied creature steering and entity management |
| Graphology 0.26.0 | Browser with deterministic fallback | Civilization, trade, alliance, migration, and conflict graphs |
| XState 5.32.5 | Browser with deterministic fallback | Phase 8 institutional states and transitions |
| PixiJS 8.19.0 | V6.9 browser | Fixed-timestep pixel presentation and overlays |
| Howler.js 2.2.4 | V6.9 browser | Deterministic generative and spatial soundscape |
| Astronomy Engine 2.1.19 | V6.9 browser | Ephemerides, seasons, eclipses, tides, and orbital-climate coupling |
| CesiumJS 1.143.0 | V6.9 browser | Planetary globe presentation |
| Playwright 1.62.0 | CI | Deterministic browser scenarios, trace, video, screenshot, and diagnostics |
| Spector.js 0.9.30 | On-demand browser | WebGL frame capture and rendering diagnostics |

`integrations/catalog.js` is the machine-readable source for active, prototype, research, and planned integration status.

## Execution targets

- `browser`: JavaScript modules that run on the main thread.
- `browser-worker`: JavaScript modules moved to Web Workers.
- `browser-gpu`: WebGL/WebGPU compute or shader modules.
- `wasm`: C/C++/Rust engines compiled for the browser.
- `server`: scientific workers accessed through a versioned API.
- `wasm-or-server`: selected at runtime based on device capability.
- `ci`: validation-only tools that are not shipped in the production bundle.
- `legacy-v6.9-browser`: an active integration preserved in the V6.9 surface.

## Future integration order

1. **Recast/Detour adapter** — generated navigation meshes for organisms and settlements.
2. **GPU fluids and volumetric clouds** — WebGPU primary implementation with WebGL fallback.
3. **Landlab adapter** — erosion, drainage networks, sediment, and landscape evolution worker.
4. **GPlates adapter** — plate polygons, rotation models, boundaries, and reconstruction datasets.
5. **PlaSim/ExoPlaSim adapter** — low-frequency global climate snapshots feeding the real-time atmosphere.
6. **ParFlow/RHESSys adapters** — groundwater, catchment hydrology, vegetation, and carbon feedback.
7. **goSPL adapter** — long-timescale global landscape evolution.
8. **Jolt Physics research path** — optional large-scale rigid-body comparison where it improves fidelity or performance.

## Adapter contract

Each module exposes a stable subset of these hooks:

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

Modules communicate through named capabilities rather than importing each other directly. This allows a lightweight browser hydrology engine to be replaced later by a ParFlow worker without changing vegetation, rendering, or civilization code.

## Fidelity strategy

Scientific engines do not need to run every visual frame. Heavy modules produce periodic state snapshots. The browser interpolates between snapshots and runs lightweight local approximations for immediate interaction. Distant planets and inactive regions use deterministic statistical simulation; the viewed region receives the highest fidelity.

## Integration preservation

Run the permanent repository audit before merging structural changes:

```bash
npm run audit:integration
```

The audit verifies both maintained surfaces, Phase 8–11 module ordering, save/load support, debug scenarios, package dependencies, core adapters, REBOUND build inputs, and third-party notices. GitHub Actions runs it before the production build and deterministic browser suite.

## Licensing

Every imported dependency, dataset, shader, model, and adapted code section must be reviewed before integration. Attribution and redistribution requirements belong in `THIRD_PARTY_NOTICES.md`. Projects are integrated only when their licenses are compatible with the repository's distribution model.
