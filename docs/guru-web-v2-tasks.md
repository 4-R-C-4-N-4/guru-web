# guru-web — v2 Alignment Tasks

Source: `guru-v2-proposal-revised.md` (post-Vercel-breach revision).
Target repo: https://github.com/4-R-C-4-N-4/guru-web.git

The current scaffold is pre-revision. App Router, Clerk middleware, Stripe, the query/sessions/preferences/quota routes, and the retriever/graph/prompt/budget/compress libs are all in place. Gaps are almost entirely things the revision added: self-hosted runtime posture, embedding model change, Postgres 17 / HNSW, and the deploy surface.

Tasks are grouped into phases that can be merged as self-contained PRs. Suggested order: A → B → C → F (20, 21) → D → E → G.

**Status note (2026-04-20):** Phase B is now "local Ollama running `nomic-embed-text:v1.5`" — deviates from proposal §4's Google `text-embedding-005`. Same 768 dim, so corpus stays binary-compatible. See Phase B for trade-offs and downstream impact on D11/D14/D16.

---

## Phase A — Configuration & docs drift

Small, safe, do first.

### A1. `next.config.ts` → match §5.2
Currently empty (just a placeholder export). Set:
- `output: 'standalone'`
- `poweredByHeader: false`
- `compress: false`

Keep `.ts` extension; no need to rename to `.js`.

### A2. `docker-compose.yml` → Postgres 17
Bump image from `pgvector/pgvector:pg16` to `pgvector/pgvector:pg17` to match prod (§7.4 installs `postgresql-17`). Document that volumes need a wipe on bump.

### A3. `README.md` → update dev section
- Reflect pg17.
- Add a "Deployment" pointer to the new `deploy/` dir (Phase D).

### A4. `.env.example` → add production vars
Current file only has dev values. Add:
- Commented-out `NEXT_PUBLIC_APP_URL` (already referenced in `src/lib/model.ts` headers).
- Note that in prod these live in `/etc/guru-web.env` mode 0600, not in the repo.

### A5. `docs/guru-web-build-plan.md` is pre-revision
Either mark it "v1 historical" at the top or replace with the revised proposal's content. Leaving it unflagged will confuse future-you.

---

## Phase B — Embedding via local Ollama

**Deviation from proposal.** Proposal §4 pinned Google `text-embedding-005` (768-dim). We're using local Ollama running `nomic-embed-text:v1.5` (768-dim, same dimension, Apache 2.0, free, no gateway). Same model family as the current OpenRouter-hosted one, so corpus embeddings stay binary-compatible if the pipeline uses the same Ollama model.

Trade-offs:
- ✅ Free, no rate limits, no API key to rotate, fully auditable.
- ✅ Sub-20ms embed time on localhost vs. ~200ms OpenRouter round-trip.
- ⚠️ Adds a runtime dependency on the VPS (Ollama systemd unit, ~300MB resident RAM on CX22's 4GB). Ollama must be up for queries to work.
- ⚠️ Updates proposal §7.1 (trust surface), §7.4 (VPS setup), §12 (risk register). Document these deltas when updating the proposal (Task A5).

### B6. `src/lib/embed.ts` → point at local Ollama
Replace the OpenAI SDK / OpenRouter client with a plain `fetch` to `http://localhost:11434/api/embed`. No SDK needed — Ollama's embed endpoint is a single `POST` with `{ model, input }`.

```ts
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const EMBEDDING_MODEL = 'nomic-embed-text:v1.5';  // MUST MATCH guru-pipeline embed_corpus.py
// POST `${OLLAMA_URL}/api/embed` with { model, input: text } → { embeddings: [[...768 floats]] }
```

Notes:
- Use `/api/embed` (newer, returns `embeddings: number[][]`), not the deprecated `/api/embeddings` (returns `embedding: number[]`).
- Pin the tag (`:v1.5`), not `:latest` — version drift here silently breaks retrieval.
- Add a typed error when Ollama returns non-200 or malformed JSON. Currently a bad response would throw deep in `vectorSearch`.
- Leave the `// MUST MATCH guru-pipeline embed_corpus.py` comment.

### B6a. `.env.example` → add `OLLAMA_URL`
Default `http://localhost:11434` (the Ollama default port). Note in comments that prod uses localhost, dev can point at a remote Ollama if useful. Keep `OPENROUTER_API_KEY` — `src/lib/model.ts` still uses it for completions.

### B6b. `docker-compose.yml` → add Ollama service (dev)
For a smooth `docker compose up` dev experience, add an `ollama` service alongside Postgres. Use `ollama/ollama:latest`, mount a volume for models so they don't re-download, expose `11434`. Dev bootstrap then becomes `docker compose up -d && docker exec ollama ollama pull nomic-embed-text:v1.5`. Document in README (A3).

### B6c. VPS: add Ollama to deploy surface
Impacts Phase D:
- `deploy/vps-bootstrap.sh` (D14) → install Ollama (`curl -fsSL https://ollama.com/install.sh | sh`), `ollama pull nomic-embed-text:v1.5`.
- `deploy/ollama.service` (new file) → ensure Ollama runs as a systemd unit bound to `127.0.0.1:11434` only (not `0.0.0.0` — the default binds to all interfaces on some installs). Set via `OLLAMA_HOST=127.0.0.1:11434`.
- `deploy/guru-web.service` (D11) → add `After=ollama.service` and `Requires=ollama.service` so Next.js doesn't start before embeddings are available.
- `deploy/README.md` (D16) → add Ollama to incident-response list (restart, re-pull model, verify port).

### B7. Dimension + reachability assertion at boot
Add to `src/lib/boot.ts` (C10):
1. First corpus chunk's embedding has length 768.
2. Ollama is reachable (`GET /api/tags` returns 200 and lists `nomic-embed-text:v1.5`).

Fail fast on either. A dimension mismatch at query time returns a useless pgvector error deep in a SQL query — catching at boot is much friendlier.

---

## Phase C — Schema & boot

Per §5.1, §11 Phase 3.

### C8. Create `schema/corpus-schema.sql`
Proposal §5.1 calls for this file — vendored from the Python pipeline's export, checked in, verified by CI. Currently missing.

Once the pipeline's `export.py` exists, copy the `CREATE TABLE` statements for `chunks`, `traditions`, `texts`, `concepts`, `edges` here. A placeholder `schema/README.md` noting where it comes from is enough for now.

### C9. HNSW index, not ivfflat
Per §15 changelog. When the schema is vendored, ensure the vector column has an HNSW index.

### C10. Create `src/lib/boot.ts`
Per §11 Phase 3. Runs on first DB touch:
1. Verifies corpus schema version matches a constant.
2. Verifies embedding dimension matches (see B7).
3. Fails fast with a loud error on mismatch.

Wire it in on the DB module, not in a layout — layouts shouldn't hit the DB.

---

## Phase D — Self-hosted deploy surface

Per §7.4–7.8. Nothing in this section exists in the repo yet. Create `deploy/` at repo root.

### D11. `deploy/guru-web.service`
systemd unit from §7.6 verbatim. Working dir: `/srv/guru-web/current`. Environment file: `/etc/guru-web.env`.

### D12. `deploy/Caddyfile`
Reverse proxy config from §7.5. Must include Authenticated Origin Pulls trust bundle and `localhost:3000` upstream.

### D13. `deploy/deploy.sh`
Five-step script from §7.8:
1. Clone into `releases/<sha>`
2. `npm ci --omit=dev`
3. Symlink swap `/srv/guru-web/current` → `releases/<sha>`
4. `systemctl restart guru-web`
5. Prune to last 5 releases

Idempotent, safe to re-run.

### D14. `deploy/vps-bootstrap.sh`
The one-time setup from §7.4 as a runnable script, not just prose in a doc. Version-controlled because you want it when you rebuild the box on an incident.

### D15. `deploy/backup.sh`
Nightly `pg_dump | gzip | b2 upload` from §7.7. Installed to `/etc/cron.daily/guru-backup` by `vps-bootstrap.sh`.

### D16. `deploy/README.md`
Incident-response playbook from §9.3:
- Cloudflare outage → DNS flip to direct origin
- VPS rebuild
- Secret rotation

Run-at-3am doc.

---

## Phase E — CI/CD

Per §7.8, §11 Phase 7.

### E17. `.github/workflows/deploy.yml`
Exact workflow from §7.8. Required secrets: `VPS_HOST`, `DEPLOY_SSH_KEY`. Steps: lint → type-check → test → build → `appleboy/ssh-action` runs `deploy.sh <sha>`.

### E18. `.github/workflows/ci.yml`
Lint + type-check + test on PRs. Separate from deploy so PRs don't try to SSH anywhere.

### E19. Schema validation in CI
Validate `schema/corpus-schema.sql` against whatever the Python pipeline currently emits. Proposal §5.1 says "verified by CI." Low priority until the pipeline export exists — stub it with a TODO.

---

## Phase F — Security & hardening

Per §9.

### F20. Audit `src/app/api/query/route.ts` for auth
§8 step 4a requires Clerk auth on every request. Middleware covers most of it, but confirm the route handler also calls `auth()` / `requireUser()` directly rather than relying solely on middleware for the user record lookup.

### F21. Confirm quota check is atomic
§8 step 4c. Look at `src/lib/quota.ts` and `migrations/004_quota.sql`. If the increment is read-then-write, rewrite as a single `UPDATE … RETURNING` under a transaction. Race conditions here are free-tier bypasses.

### F22. `fail2ban` jail config in `deploy/`
§7.4 installs fail2ban but doesn't ship a jail. A minimal jail for SSH is fine.

---

## Phase G — Nice-to-haves / flagged for later

### G23. Verify streaming through Caddy + Cloudflare
§12 risk register calls this out. No code change — a note to actually exercise it on a real staging VPS before launch.

### G24. Remove unused Vercel assets
`public/vercel.svg`, `public/next.svg`. Thematically relevant given the "post-Vercel" framing.

### G25. Vendor the revised proposal
Drop `guru-v2-proposal-revised.md` into `docs/` so the repo carries its own north star. A5 can reference it.
