# Reality Sandbox

Reality Sandbox is a deterministic browser simulation connecting planetary formation, ecology, evolution, civilizations, spaceflight, stellar evolution, galaxies, and cosmology through one fixed timestep.

## Live experiences

- **Lo-fi living root:** https://ancientpagoda-rgb.github.io/reality-sandbox/
- **Reality Engine V6.9 compatibility page:** https://ancientpagoda-rgb.github.io/reality-sandbox/reality-engine-v6-9.html

## Lo-fi living root

The root experience is deliberately small and quiet:

- one living-world view;
- one low-resolution PixiJS canvas, rendered at no more than 256×144 pixels and scaled with hard pixel edges;
- mouse-wheel, trackpad, touch-pinch, drag, and keyboard camera navigation;
- no sound;
- no view selector, settings panel, volume control, status feed, palette switcher, or orbital buttons;
- no Three.js renderer, globe, ground explorer, 3D creature scene, or 3D civilization layer;
- no private presentation ticker or second simulation clock.

The deeper simulation still runs underneath the simple scene. Weather, water, ecology, natural selection, cultures, settlements, institutions, economies, colonies, machine lineages, relativistic missions, galaxies, gravitational waves, and FLRW cosmology remain part of the deterministic world state. Headless adapters preserve those systems without creating additional renderers or interfaces.

The root module order is:

```text
galaxy → orbital system → cosmic and biological origin
→ hydrology, ecology, and planet dynamics
→ headless surface → headless evolution → headless civilizations
→ Phase 8 → Phase 9 → Phase 10 → Phase 11
→ lo-fi PixiJS living presentation
```

The module host is the only authoritative simulation clock. PixiJS renders manually from the root render hook with `autoStart: false` and `sharedTicker: false`.

REBOUND 5.0.0 remains available as a hidden same-origin WebAssembly verification backend. It is not exposed as another visible view or control.

## Reality Engine V6.9 compatibility

Three.js stays available on the standalone V6.9 and legacy laboratory pages; it is not loaded by the root entry.

The standalone V6.9 page remains independently deployable and tested. It preserves the larger experimental interface, including:

- CesiumJS planetary globe;
- PixiJS presentation;
- Howler.js deterministic and spatial soundscape;
- Astronomy Engine ephemerides and climate coupling;
- Three.js multi-system universe;
- REBOUND WebAssembly N-body physics;
- weather, orbital, sound, and time controls.

The simplified root does not inherit V6.9 sound or interface preferences.

## Core architecture

`core/module-host.js` provides deterministic module registration, capability dependencies, topological ordering, fixed-step updates, rendering hooks, save serialization, and loading.

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

The root presentation lives in `core/lofi-living-runtime.js`. It draws a deterministic coarse terrain field, weather cells, resources, organisms, predators, and apex life as small pixel blocks.

The renderer-free simulation adapters are:

- `core/headless-ground-level.js` — geological and hydrological surface sampling;
- `core/headless-evolution.js` — lineages, natural selection, culture, and settlement formation;
- `core/headless-civilization-engine.js` — communities, languages, cultures, routes, technology, and history.

### Save state

The root stores the world tick and module states under `reality-sandbox-globe-v1`. The lo-fi runtime persists its camera and fixed-clock counters; there are no root view, palette, or audio settings.

### Level of detail

- Desktop presentation: 256×144 logical pixels.
- Mobile presentation: 160×90 logical pixels.
- Entity and weather samples are capped.
- Expensive scientific systems retain deterministic statistical or analytic LOD when not directly inspected.
- Three.js and Cesium remain confined to standalone compatibility and laboratory pages.

## Debugging and inspection

Open the root with debug mode:

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

Relevant simplified-runtime scenarios include:

```js
realitySandboxDebug.seedUnifiedScenario('shared-clock')
realitySandboxDebug.seedUnifiedScenario('scene')
realitySandboxDebug.seedUnifiedScenario('camera')
realitySandboxDebug.seedUnifiedScenario('view-switch')
realitySandboxDebug.seedUnifiedScenario('rebound')
realitySandboxDebug.seedUnifiedScenario('mobile-lod')
```

`setUnifiedView()` always resolves to `living` on the root.

## Validation

```bash
npm ci
npm run audit:integration
npm run build
npm run dev
```

The permanent audit verifies:

- the complete Phase 8–11 registration chain;
- one authoritative fixed clock;
- the single-view and zero-control root contract;
- audio absence on the root;
- no Three.js import or module registration in the root;
- exactly one visible low-resolution PixiJS canvas;
- interactive camera behavior and save/load;
- standalone V6.9 compatibility;
- pinned REBOUND source and deployed WebAssembly verification;
- dependency notices and CI hooks.

GitHub Actions performs production builds, deterministic Phase 8–11 Chromium scenarios, simplified-root browser checks, a Pixi-only resource audit, Playwright screenshots and traces, Spector.js WebGL capture, REBOUND compilation, GitHub Pages deployment, and live browser verification.

## Scientific boundaries

- Planetary climate, ecology, societies, economies, stellar evolution, galaxies, and cosmology are scientifically motivated approximations rather than precision research solvers.
- The generated planetary system remains authoritative for its own non-Earth orbital climate.
- REBOUND integrates a selected deterministic orbital system under the root clock; distant systems continue using analytic or statistical LOD.
- The simple pixel presentation is an intentionally abstract visualization of the deeper state.

## Project references

- Unified runtime issue: [#25](https://github.com/ancientpagoda-rgb/reality-sandbox/issues/25)
- Integration roadmap: [`INTEGRATION_ROADMAP.md`](./INTEGRATION_ROADMAP.md)
- Third-party notices: [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)
- Phase 12 issue: [#23](https://github.com/ancientpagoda-rgb/reality-sandbox/issues/23)
