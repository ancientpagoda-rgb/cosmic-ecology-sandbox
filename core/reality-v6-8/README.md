# Reality Engine V6.8 — PixiJS Presentation

V6.8 adds PixiJS 8.19.0 as a presentation layer above the existing Cesium surface and Three.js/REBOUND universe.

- One transparent PixiJS canvas is moved between the surface and system view, avoiding an extra rendering context.
- A fixed 20 Hz accumulator drives pixel weather, clouds, precipitation, settlement lights, coastal warnings, labels, asteroid dust, body brackets, and impact bursts.
- PixiJS never owns simulation state. Cesium, Astronomy Engine, the persistent living-world model, Three.js, and REBOUND remain the sources of truth.
- The Three.js quality selector still exposes Pixel, Adaptive, High, Ultra, and Cinematic modes.
- Palettes and the Pixi effects toggle are persisted locally.

PixiJS is MIT licensed. REBOUND remains GPLv3 and is built from source by the Pages workflow.
