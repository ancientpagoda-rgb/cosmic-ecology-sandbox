# Reality Sandbox Scientific Integration Roadmap

Reality Sandbox uses a modular adapter host. Browser-native systems run locally; suitable C/C++/Rust projects can be compiled to WebAssembly; heavyweight Python/C++ scientific models run as optional server workers and exchange compact snapshots with the browser.

## Execution targets

- `browser`: JavaScript modules that run on the main thread.
- `browser-worker`: JavaScript modules moved to Web Workers.
- `browser-gpu`: WebGL/WebGPU compute or shader modules.
- `wasm`: C/C++/Rust engines compiled for the browser.
- `server`: scientific workers accessed through a versioned API.
- `wasm-or-server`: selected at runtime based on device capability.

## Integration order

1. **Rapier physics adapter** — browser/WASM rigid bodies and collisions.
2. **REBOUND orbital adapter** — N-body star-system simulation, initially server-side with a future WASM option.
3. **GDAL adapter** — import/export raster and vector world layers through GDAL WASM or a server worker.
4. **Recast/Detour adapter** — generated navigation meshes for organisms and settlements.
5. **GPU fluids and volumetric clouds** — WebGPU primary implementation with WebGL fallback.
6. **Landlab adapter** — erosion, drainage networks, sediment, and landscape evolution worker.
7. **GPlates adapter** — plate polygons, rotation models, boundaries, and reconstruction datasets.
8. **PlaSim/ExoPlaSim adapter** — low-frequency global climate snapshots feeding the real-time atmosphere.
9. **ParFlow/RHESSys adapters** — groundwater, catchment hydrology, vegetation, and carbon feedback.
10. **goSPL adapter** — long-timescale global landscape evolution.

## Adapter contract

Each module exposes a stable subset of these hooks:

```js
{
  id,
  version,
  execution,
  provides: [],
  requires: [],
  async initialize(context) {},
  step(dt) {},
  render(frame) {},
  save() {},
  async load(state) {}
}
```

Modules communicate through named capabilities rather than importing each other directly. This allows a lightweight browser hydrology engine to be replaced later by a ParFlow worker without changing vegetation, rendering, or civilization code.

## Fidelity strategy

Scientific engines do not need to run every visual frame. Heavy modules produce periodic state snapshots. The browser interpolates between snapshots and runs lightweight local approximations for immediate interaction. Distant planets and inactive regions use statistical simulation; the viewed region receives the highest fidelity.

## Licensing

Every imported dependency, dataset, shader, model, and adapted code section must be reviewed before integration. Attribution and redistribution requirements belong in `THIRD_PARTY_NOTICES.md`. Projects are integrated only when their licenses are compatible with the repository's distribution model.
