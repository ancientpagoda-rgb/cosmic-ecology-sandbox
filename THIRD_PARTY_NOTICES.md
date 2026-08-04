# Third-Party Notices

## Tectonics.js

Reality Sandbox includes a rewritten, mobile-oriented tectonic plate adapter based on the plate segmentation and boundary concepts demonstrated by **Tectonics.js**.

- Original project: https://github.com/davidson16807/tectonics.js
- Original author: Andrew Davidson / davidson16807
- License: Creative Commons Attribution 4.0 International (CC BY 4.0)
- Modifications: rewritten as ES modules; reduced to a deterministic spherical sampler; adapted to Reality Sandbox's climate, terrain, biome, and WebGL systems; original user interface and legacy global application architecture were not included.

## Three.js

Reality Sandbox uses Three.js for WebGL rendering and its maintained AnimationMixer/AnimationClip system for procedural breathing and body motion in Phase 6 creatures.

- Project: https://github.com/mrdoob/three.js
- Version: 0.184.0
- License: MIT

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
