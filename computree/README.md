# Computree Forest

Online prototype of Da Computree: a digital plant whose body is made of information and whose metabolism runs on computation.

## Modes

- **B — full evolving forest:** trees grow by earning Compute Energy from real browser-side computation.
- **C — shared forest:** publish worldseeds to a tiny `/events` backend, then load them into another forest.
- **D — AI-powered:** the **AI flower** button can call local Ollama or an OpenAI-compatible endpoint and publish the resulting flower artifact.
- **Organism mode:** roots, trunk, leaves, flowers, pollinators, seasons, resources, and Worldseeds are represented as one living system.
- **Real Resource Mode:** opt in to capped browser CPU work, allocated RAM blocks, browser storage writes, and measured shared-backend bandwidth.

## Mechanics

Each turn:

1. Roots discover generated data streams.
2. Leaves run computation over those streams.
3. Compression score, prediction score, entropy, and hash search create Compute Energy.
4. Growth spends CPU cycles, RAM tissue, storage memory, and bandwidth nutrients.
5. If da plant cannot afford growth, it reports insufficient computation and may prune.
6. Seasons change resource abundance and competition.
7. Flowers can compress memory into a Worldseed.

When **real resource mode** is enabled, those meters are backed by capped local resources:

- CPU: measured hash work on the browser thread
- RAM: actual `Uint8Array` megabyte blocks held in memory
- Storage: actual trunk snapshots written into browser storage
- Bandwidth: actual bytes transferred through shared backend reads/writes

Example branch cost:

```text
10,000 CPU cycles
5 MB RAM
1 MB storage
0.6 bandwidth nutrient units
```

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

- a Current Mission loop: load shared, inspect, plant, publish
- opt-in Real Resource Mode with CPU/RAM/storage/bandwidth caps
- computational seasons and starvation/dormancy states
- CPU/RAM/storage/bandwidth metabolism
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
