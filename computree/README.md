# Computree Forest

Online prototype of a computational plant/forest.

## Modes

- **B — full evolving forest:** trees grow by earning Compute Energy from real browser-side computation.
- **C — multiplayer-lite:** click **copy worldseed**, send it to someone, and they can paste/plant it into their forest.
- **D — AI-powered:** the **AI flower** button is currently a stub/hook. The next step is wiring it to a backend or local LLM so flowers can become real generated artifacts.

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

## Live URL

If GitHub Pages is enabled for this repo, the app should be available at:

`https://ancientpagoda-rgb.github.io/reality-sandbox/computree/`
