# guru-web — TypeScript / Next.js front-end for the Guru esoteric research platform.

## Local development

### 1. Start Postgres + Ollama

```bash
docker compose up -d
docker exec guru-ollama ollama pull nomic-embed-text:v1.5
```

This starts:
- `pgvector/pgvector:pg17` on port 5432 (DB `guru`, user `guru`, password `guru_dev`)
- `ollama/ollama:latest` on port 11434 (used by `src/lib/embed.ts` for query embeddings)

The model pull is one-time — it persists in the `ollama_models` volume.

### 2. Copy and fill in environment variables

```bash
cp .env.example .env.local
# edit .env.local — set DATABASE_URL, OPENROUTER_API_KEY, Clerk keys, Stripe keys
```

The default `DATABASE_URL` for local dev:
```
DATABASE_URL=postgresql://guru:guru_dev@localhost:5432/guru
```

### 3. Run migrations

```bash
npm run migrate
```

### 4. Seed sample corpus data

```bash
npm run seed-dev
```

### 5. Start the dev server

```bash
npm run dev
# → http://localhost:3000
```

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run type-check` | TypeScript check |
| `npm run migrate` | Run SQL migrations |
| `npm run seed-dev` | Load sample corpus data |

## Integration contract

This repo consumes a Postgres database populated by `guru-pipeline` (Python).
The pipeline produces `guru-corpus.sql.gz` — load it into the same Postgres instance.
The TypeScript app never writes to corpus tables (`chunks`, `traditions`, `texts`, `concepts`, `edges`).

## Deployment

Production runs self-hosted on a Hetzner VPS behind Caddy + Cloudflare (no Vercel).
See `deploy/` for systemd units, Caddyfile, deploy script, and incident-response runbook.
