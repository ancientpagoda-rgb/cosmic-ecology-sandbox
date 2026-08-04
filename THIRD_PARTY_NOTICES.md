# Third-Party Notices

Reality Sandbox has two actively maintained browser surfaces:

- the root Phase 11 observable-universe simulation; and
- the preserved Reality Engine V6.9 experience, which contains the PixiJS presentation layer, Howler.js soundscape, Astronomy Engine orbital climate, CesiumJS globe, and the locally built REBOUND WebAssembly system.

## Tectonics.js

Reality Sandbox includes a rewritten, mobile-oriented tectonic plate adapter based on the plate segmentation and boundary concepts demonstrated by **Tectonics.js**.

- Original project: https://github.com/davidson16807/tectonics.js
- Original author: Andrew Davidson / davidson16807
- License: Creative Commons Attribution 4.0 International (CC BY 4.0)
- Modifications: rewritten as ES modules; reduced to a deterministic spherical sampler; adapted to Reality Sandbox's climate, terrain, biome, and WebGL systems; original user interface and legacy global application architecture were not included.

## Three.js

Reality Sandbox uses Three.js for WebGL rendering, procedural bodies, civilization rendering, planetary scenes, and the V6.9 multi-system universe.

- Project: https://github.com/mrdoob/three.js
- Version: 0.184.0
- License: MIT

## PixiJS

Reality Engine V6.9 uses PixiJS for its fixed-timestep pixel presentation, overlays, palettes, and presentation effects.

- Project: https://github.com/pixijs/pixijs
- Package: pixi.js
- Version: 8.19.0
- License: MIT

## Howler.js

Reality Engine V6.9 uses Howler.js for its deterministic generative soundscape, spatial audio, environmental layers, mute controls, and volume controls.

- Project: https://github.com/goldfire/howler.js
- Package: howler
- Version: 2.2.4
- License: MIT

## Astronomy Engine

Reality Engine V6.9 uses Astronomy Engine for solar and lunar ephemerides, seasons, lunar phase and distance, eclipse searches, tides, and orbital-climate coupling.

- Project: https://github.com/cosinekitty/astronomy
- Package: astronomy-engine
- Version: 2.1.19
- License: MIT
- Runtime delivery: version-pinned ES module from jsDelivr in the V6.9 orbital-climate module.

## CesiumJS

Reality Engine V6.9 uses CesiumJS for its globe and planetary surface presentation.

- Project: https://github.com/CesiumGS/cesium
- Version: 1.143.0
- License: Apache-2.0
- Runtime delivery: version-pinned CesiumJS assets from jsDelivr.

## Yuka 0.7.8

Reality Sandbox uses Yuka, an open-source JavaScript game-AI library by Mugen87, for creature steering and entity management in the embodied-evolution phase.

- Project: https://github.com/Mugen87/yuka
- Version: 0.7.8
- License: MIT
- Runtime modules are loaded from version-pinned jsDelivr and unpkg URLs, with the second source used as a fallback.

Yuka remains subject to its MIT license. Reality Sandbox-specific morphology, inheritance, ecology integration, rendering, and simulation code remain subject to this project's license.

## Rapier 3D

Reality Sandbox uses Rapier's JavaScript/WebAssembly bindings for local creature-ground contacts, gravity, collision bodies, friction, and mobile-aware nearby physics.

- Project: https://github.com/dimforge/rapier.js
- Package: @dimforge/rapier3d-compat
- Version: 0.19.3
- License: Apache-2.0

Rapier 0.19.x currently emits an upstream wasm-bindgen initialization deprecation warning in some browsers. The simulation remains functional; the warning is tracked upstream and is not treated as a physics failure.

## REBOUND 5.0.0

Reality Sandbox builds REBOUND from source with Emscripten for same-origin N-body orbital physics in Reality Engine V6.9. The root universe also exposes a REBOUND adapter and uses REBOUND-compatible validation paths for later orbital and interstellar systems.

- Project: https://github.com/hannorein/rebound
- Version/tag: 5.0.0
- License: GNU GPL v3 or later
- Build script: `scripts/build-rebound-wasm.sh`
- Bundled license: `public/rebound-v6-6/LICENSE.txt`

## GDAL3.js and GDAL

Reality Sandbox includes a lazy, worker-based GDAL adapter for raster, vector, projection, translation, warping, rasterization, and coordinate transformation tasks.

- Project: https://github.com/bugra9/gdal3.js
- Package: gdal3.js
- Version: 2.8.1
- Wrapper license: MIT
- GDAL license: MIT/X-style, with bundled upstream third-party notices applying

## Graphology 0.26.0

Reality Sandbox uses Graphology to represent and update settlement contacts, trade routes, alliances, conflicts, migration links, knowledge exchange, and federations in Phase 7.

- Project: https://github.com/graphology/graphology
- Version: 0.26.0
- License: MIT
- Runtime modules are loaded from version-pinned jsDelivr and esm.sh URLs, with a deterministic internal graph fallback when neither source is available.

## XState 5.32.5

Reality Sandbox uses XState state machines and actors to represent institutional organization, reform, crisis, revolution, collapse, and recovery in Phase 8.

- Project: https://github.com/statelyai/xstate
- Version: 5.32.5
- License: MIT
- Runtime modules are loaded from version-pinned jsDelivr and esm.sh URLs, with deterministic internal transitions as a fallback.

## Playwright 1.62.0

Reality Sandbox uses Playwright in GitHub Actions to open the built simulation in Chromium, control deterministic time stepping, record screenshots and video, create replayable traces, capture browser errors, and archive diagnostics.

- Project: https://github.com/microsoft/playwright
- Version: 1.62.0
- License: Apache-2.0
- Playwright is installed only in the browser-diagnostics workflow and is not shipped in the production bundle.

## Spector.js 0.9.30

Reality Sandbox can load Spector.js through the debug bridge to capture WebGL frames, command streams, shaders, textures, buffers, and render state from the Three.js and PixiJS canvases.

- Project: https://github.com/BabylonJS/Spector.js
- Version: 0.9.30
- License: MIT
- Spector.js loads only when explicitly requested through the debug interface.
