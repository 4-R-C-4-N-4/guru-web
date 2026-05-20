# guru-web — TypeScript / Next.js front-end for the Guru esoteric research platform.

## Local development

### Prerequisites

- Docker (postgres container)
- A host-level Ollama on `:11434` with `nomic-embed-text:v1.5` pulled
  (or run the optional `ollama` service in `docker-compose.yml`)
- A corpus dump at `../guru/export/guru-corpus.sql.gz`
  (produced by `guru-pipeline/scripts/export.py`)
- `.env` populated — copy `.env.example` and fill in keys

### Run

```bash
npm run dev
# → http://localhost:3000
```

`predev` runs `scripts/dev-setup.ts`, which is idempotent and:
1. Starts the postgres container if it isn't already up.
2. Loads the corpus dump if `corpus.corpus_metadata.schema_version` is missing/stale.
3. Runs app migrations (`migrations/*.sql`, all `IF NOT EXISTS`).
4. Seeds `model_pricing` via `sync-pricing` if the table is empty.

Fast path (everything already set up) is ~400ms.

### Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server (runs `dev-setup` first via `predev`) |
| `npm run dev:setup` | Run `dev-setup` standalone |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run type-check` | TypeScript check |
| `npm run migrate` | Run SQL migrations |
| `npm run seed-dev` | Load minimal synthetic corpus (alternative to the dump) |
| `npm run sync-pricing` | Refresh `model_pricing` from OpenRouter |

## Integration contract

This repo consumes a Postgres database populated by `guru-pipeline` (Python).
The pipeline produces `guru-corpus.sql.gz` — load it into the same Postgres instance.
The TypeScript app never writes to corpus tables (`chunks`, `traditions`, `texts`, `concepts`, `edges`).

## Deployment

Production runs self-hosted on a Hetzner VPS behind Caddy + Cloudflare (no Vercel).
See `deploy/` for systemd units, Caddyfile, deploy script, and incident-response runbook.
