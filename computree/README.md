# Computree Forest

Online prototype of a computational plant/forest.

## Modes

- **B — full evolving forest:** trees grow by earning Compute Energy from real browser-side computation.
- **C — shared forest:** publish worldseeds to a tiny `/events` backend, then load them into another forest.
- **D — AI-powered:** the **AI flower** button can call local Ollama or an OpenAI-compatible endpoint and publish the resulting flower artifact.

## Mechanics

Each turn:

1. Roots discover generated data streams.
2. Leaves run computation over those streams.
3. Compression score, prediction score, entropy, and hash search create Compute Energy.
4. Energy buys leaves, branches, roots, and flowers.
5. Flowers can compress memory into a worldseed.

## Files

- `index.html` — UI and canvas shell.
- `app.js` — forest simulation engine.
- `shared.js` — shared forest sync via the Computree backend or localStorage fallback.

## Shared Backend

Cloudflare Worker backend:

`https://computree-backend.ancientpagoda.workers.dev`

Open **shared settings** in the forest and paste:

- Backend URL: the Worker URL
- Write token: the configured `WRITE_TOKEN`

The original Express backend still exists in `computree-backend/` for hosts such as Render or Railway.

The live app shows:

- shared backend connection status
- latest shared forest events
- one-click publish/load controls
- a Worldseed inspector for the selected tree
- clickable shared events that copy their seed into the seed box
- a **plant selected** control for planting a shared event
- visual publish/load pulses and lineage lines

Click a tree on the canvas to inspect its current genome, anatomy, memory, and latest flower.

## Live URL

If GitHub Pages is enabled for this repo, the app should be available at:

`https://ancientpagoda-rgb.github.io/reality-sandbox/computree/`
