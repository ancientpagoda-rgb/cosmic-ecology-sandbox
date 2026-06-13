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
