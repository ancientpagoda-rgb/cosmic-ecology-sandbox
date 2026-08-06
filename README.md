# Reality Sandbox

Reality Sandbox is a deterministic browser simulation of **Nysa**, a fictional procedural living planet. The public experience deliberately concentrates on one causal system:

```text
terrain → water and climate → vegetation → animals → selection and speciation
```

Nysa is not Earth and does not use measured Earth data. Every quantity labeled `model` or `index` is an internal approximation rather than an observation.

## Public experience

https://ancientpagoda-rgb.github.io/reality-sandbox/

The public root provides:

- one procedural spherical planet;
- one PixiJS renderer and one authoritative fixed simulation clock;
- terrain generated from spherical plate and noise fields;
- evaporation, clouds, precipitation, soil water, runoff, rivers, lakes, floods, droughts, tides, and seasons;
- vegetation whose growth and spread respond to terrain and water;
- herbivores, predators, and apex predators whose movement, feeding, reproduction, and survival occur in the same world;
- inherited animal traits, climate stress, disease, population change, extinction, and branching species;
- a regional inspector that reports the exact terrain, hydrology, weather, and nearby life state used by the simulation;
- defined global statistics, with normalized model indices labeled as indices;
- pause, single-step, speed, camera, touch, and keyboard controls.

The globe renderer reads `core/planet.js`, `core/living-systems.js`, `core/water-cycle.js`, `core/world.js`, and `core/biosphere.js` directly. It does not replace the canvas, monkey-patch a second renderer, or draw an unrelated Earth surface over the simulated planet.

## Scope freeze

Civilizations, spaceflight, relativistic missions, galaxies, cosmology, and Phase 12 are frozen. Their source and legacy experiments remain in repository history and compatibility pages, but the public root does not import, initialize, test, or advertise them.

The standalone V6.9 compatibility page remains available at:

https://ancientpagoda-rgb.github.io/reality-sandbox/reality-engine-v6-9.html

It is preserved as an archived experimental surface and is not the product direction of the public root.

## Root module chain

```text
procedural orbit, seasons, and tides
→ coupled water cycle
→ plants, animals, and evolution
→ climate and terrain feedbacks
→ one PixiJS living-planet renderer and inspector
```

The module host is the only authoritative simulation clock. PixiJS renders manually with `autoStart: false` and `sharedTicker: false`.

## Statistics and units

- Entity counts are counts of current simulated entities.
- Temperature, elevation, and annual rainfall are explicitly marked as model quantities.
- Soil moisture, flood risk, and trait spread are normalized indices, not physical measurements.
- Region coordinates are procedural latitude and longitude.
- Hovering or focusing a global statistic exposes its exact definition.

## Validation

```bash
npm ci
npm run audit:integration
npm run build
```

Browser validation additionally checks:

- production boot with no page errors;
- exactly one visible root canvas;
- absence of Earth, Three.js, Phase 8–12, galaxy, civilization, and cosmology resources from the root;
- fixed-clock behavior;
- camera and region-inspection interactions;
- terrain/water/inspector coupling at the same world coordinate;
- visible and defined statistics;
- desktop and iPhone screenshots.

No new phase should be added until these experience checks are green and the visual artifacts have been reviewed.

## Scientific boundary

The models are deterministic, causal approximations intended for an interactive sandbox. They are not research solvers and do not predict real Earth conditions. A future Earth mode must use versioned real datasets, explicit units, reference epochs, provenance, uncertainty, and validation before it may be called Earth.
