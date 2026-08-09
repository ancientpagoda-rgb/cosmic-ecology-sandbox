# Computree Worker

Cloudflare Worker backend for the shared Computree forest.

Endpoints:

- `GET /health`
- `GET /events?limit=50`
- `POST /events` with `x-write-token`

Storage:

- Workers KV namespace binding: `computree_events`
- Stored key: `events`

Deploy:

```sh
npx wrangler secret put WRITE_TOKEN
npx wrangler deploy
```

Deployed backend:

```text
https://computree-backend.ancientpagoda.workers.dev
```

## Eidolon Atlas relay

The same KV-backed worker now also serves the public read / curator-write relay used by Eidolon’s future shared Atlas:

- `GET /eidolon/health`
- `GET /eidolon/sightings?seed=<planet-seed>&limit=48` (public, seed-scoped)
- `POST /eidolon/sightings` with `x-write-token` (curator only)

The browser does not receive the write token. This deliberately keeps the current Phase 3 relay authoritative rather than allowing anonymous clients to forge ecology history. To test an eventual deployment without baking a URL into the app, open Eidolon with `?atlasRelay=https://<worker-host>/`.
