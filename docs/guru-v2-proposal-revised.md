# Guru v2 — Architecture Proposal (Revised)

## Codename: Guru
## Scope: Hosted web application, built on v1 foundations
## Revision: Post-Vercel. Self-hosted runtime on Hetzner, Cloudflare at the edge.

---

## 1. Proposal Summary

Guru v2 takes the working v1 pipeline and splits it along a clean seam: Python for the build-time data engineering that already works, TypeScript for the runtime web app that users actually touch. The Python pipeline produces a SQL artifact that gets loaded into production Postgres. The TypeScript app reads from Postgres at runtime and never runs Python in the deploy path.

The entire runtime is self-hosted on a single Hetzner VPS, with Cloudflare at the edge providing TLS termination, WAF, caching, and DDoS protection. No managed PaaS, no SaaS environment-variable storage, no vendor with access to production secrets beyond Cloudflare (which sees only TLS-terminated traffic, not credentials at rest).

The architecture is chosen for **simplicity, cost, solo operability, and auditability** above all else. Every design decision is measured against four questions:

1. Can the sole developer understand and diagnose this alone?
2. Does this cost real money before there are real users?
3. Does this add a vendor, service, or runtime that could be avoided?
4. Can the developer audit the system end-to-end, or does trust have to be extended to an opaque third party?

The launch cost target is under $10/month plus actual LLM usage.

---

## 2. Design Principles

- **Language per job.** Python for batch data engineering, scraping, LLM tagging, and human-in-the-loop review. TypeScript for the web app and production runtime. Each language does what it's best at; neither has to pretend to be the other.
- **Static corpus export as the integration contract.** The Python pipeline emits a SQL file. The TypeScript app consumes a loaded database. That's the entire interface between them.
- **One production runtime, one production host.** Node.js on Hetzner. No Python in production. No polyglot deploys. No inter-service RPC. No managed PaaS.
- **Self-host what you can.** Managed services are convenience; convenience costs money and demands trust. A Postgres and Node process on a cheap VPS is genuinely simpler to operate — and simpler to reason about security-wise — than the billing and secrets dashboards of three vendors.
- **Cloudflare is an optimization, not a dependency.** The system must still work if Cloudflare has an outage: DNS can be flipped to direct origin, traffic flows, app runs. Cloudflare provides CDN, WAF, and DDoS protection on top of a working system, not the system itself.
- **Pay only for what scales with users.** LLM tokens scale with usage; that's fine. Fixed monthly costs are minimized and flat.

---

## 3. System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        BUILD TIME (Python, local)                    │
│                                                                      │
│   raw corpus → chunk → graph_bootstrap → tag → propose_edges →      │
│   human review → embed → export.py                                   │
│                                       │                              │
│                                       ▼                              │
│                          guru-corpus.sql.gz  (artifact)              │
└─────────────────────────────────────────────────────────────────────┘
                                        │
                       ┌ deploy ────────┘
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        RUN TIME (self-hosted)                        │
│                                                                      │
│  Users                                                               │
│    │                                                                 │
│    ▼                                                                 │
│  ┌──────────────────────────────────────────┐                       │
│  │  Cloudflare (DNS + proxy)                │                       │
│  │  ├─ TLS termination (edge cert)          │                       │
│  │  ├─ WAF + rate limits on /api/query      │                       │
│  │  ├─ DDoS protection                      │                       │
│  │  └─ Caching (static assets only)         │                       │
│  └────────────┬─────────────────────────────┘                       │
│               │  HTTPS (Full Strict + Auth Origin Pulls)            │
│               ▼                                                      │
│  ┌──────────────────────────────────────────┐                       │
│  │  Hetzner CX22 VPS                        │                       │
│  │  ├─ Caddy :443                           │                       │
│  │  │    └─ reverse_proxy → Next.js :3000   │                       │
│  │  ├─ Next.js (systemd unit, user: guru)   │                       │
│  │  │    ├─ Web UI                          │                       │
│  │  │    ├─ API routes                      │                       │
│  │  │    ├─ Auth (Clerk)                    │                       │
│  │  │    ├─ Retrieval                       │                       │
│  │  │    ├─ Prompt build                    │                       │
│  │  │    └─ LLM orchestration               │                       │
│  │  ├─ Postgres 17 + pgvector :5432         │                       │
│  │  │    └─ localhost only                  │                       │
│  │  ├─ cron: nightly pg_dump → B2           │                       │
│  │  └─ ufw:                                 │                       │
│  │       ├─ :22 from home IP only           │                       │
│  │       ├─ :443 from Cloudflare IPs only   │                       │
│  │       └─ deny all else                   │                       │
│  └────────────┬─────────────────────────────┘                       │
│               │                                                      │
│               │  pay-per-token                                       │
│               ▼                                                      │
│  ┌──────────────────┐                                               │
│  │   OpenRouter     │                                               │
│  │   (DeepSeek for  │                                               │
│  │    free tier,    │                                               │
│  │    Claude for    │                                               │
│  │    pro tier)     │                                               │
│  └──────────────────┘                                               │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. Build Pipeline (Python, Unchanged)

Unchanged from the original proposal. See the separate `guru-pipeline-migration.md` document for the detailed v1→export migration plan.

Summary:

| Script | Purpose | v2 Status |
|--------|---------|-----------|
| `acquire.py` | Download source texts | Keep |
| `chunk.py` | Split into citation-addressable chunks | Keep |
| `graph_bootstrap.py` | Create SQLite schema, insert nodes | Keep |
| `tag_concepts.py` | LLM-assisted concept tagging | Keep |
| `review_tags.py` | CLI review tool for tags | Keep |
| `propose_edges.py` | Cross-tradition edge proposals | Keep |
| `review_edges.py` | CLI review tool for edges | Keep |
| `embed_corpus.py` | Generate embeddings | Keep (writes to SQLite, not ChromaDB) |
| `backfill_concepts.py` | Sync concepts to vector metadata | **Remove** (redundant once ChromaDB is gone) |
| `scripts/export.py` | Emit `guru-corpus.sql.gz` | **New** |

Embedding model: Google `text-embedding-005` (768 dimensions, native).

Artifact: single `guru-corpus.sql.gz`, idempotent, re-loadable with `gunzip -c ... | psql $DATABASE_URL`.

---

## 5. Runtime Application (TypeScript, Next.js, Self-Hosted)

The production application is a single Next.js app running as a systemd-managed Node process on the same Hetzner VPS as Postgres. One repo (`guru-web`), one deploy pipeline, one runtime.

Next.js is kept as the framework. It runs cleanly as `next start` behind a reverse proxy with no Vercel-specific dependencies, given a few constraints (see §5.6).

### 5.1 Project Structure

```
guru-web/
├── src/
│   ├── app/                       # Next.js App Router
│   │   ├── (auth)/                #   sign in, sign up
│   │   ├── (app)/                 #   chat, settings, history
│   │   │   ├── chat/page.tsx
│   │   │   ├── settings/page.tsx
│   │   │   └── history/page.tsx
│   │   ├── api/
│   │   │   ├── query/route.ts     #   POST /api/query
│   │   │   ├── sessions/route.ts
│   │   │   ├── prefs/route.ts
│   │   │   └── webhooks/
│   │   │       ├── clerk/route.ts
│   │   │       └── stripe/route.ts
│   │   └── layout.tsx
│   │
│   ├── lib/
│   │   ├── db.ts                  # Postgres client (pg)
│   │   ├── retriever.ts           # Hybrid retrieval (vector + graph)
│   │   ├── graph.ts               # Concept graph queries
│   │   ├── compress.ts            # Extractive compression
│   │   ├── budget.ts              # TokenBudget
│   │   ├── prompt.ts              # Prompt assembly
│   │   ├── model.ts               # OpenRouter client
│   │   ├── prefs.ts               # User preferences
│   │   ├── auth.ts                # Auth helpers
│   │   ├── quota.ts               # Rate limiting
│   │   └── boot.ts                # Startup schema version check
│   │
│   └── components/                # React UI components
│
├── schema/
│   └── corpus-schema.sql          # Vendored from guru, verified by CI
├── migrations/                    # SQL migrations for user tables
│   ├── 001_users.sql
│   ├── 002_sessions_queries.sql
│   ├── 003_preferences.sql
│   └── 004_quota.sql
│
├── deploy/
│   ├── guru-web.service           # systemd unit
│   ├── Caddyfile                  # reverse proxy config
│   └── deploy.sh                  # invoked by GitHub Actions over SSH
│
├── .env.example
├── package.json
└── next.config.js
```

### 5.2 Next.js Configuration

```js
// next.config.js
module.exports = {
  output: 'standalone',   // self-contained build, no Vercel assumptions
  poweredByHeader: false,
  compress: false,        // Caddy handles compression
};
```

The `standalone` output mode produces a minimal `server.js` plus only the Node modules actually used at runtime. This is Next.js's official supported deployment target for non-Vercel hosts.

### 5.3 Rewrite Scope

The v1 Python runtime code (retrieval, prompt assembly, model) is rewritten in TypeScript. One-time cost, estimated at 300–500 lines of production code plus tests. Algorithms don't change; only the language does.

(Port mapping unchanged from original proposal. See §5.2 of the previous revision.)

### 5.4 Hybrid Retrieval in TypeScript

(Unchanged from original proposal. Two SQL queries — one vector, one graph walk — merged and reranked in memory.)

### 5.5 Model Layer

(Unchanged from original proposal. Thin OpenRouter wrapper with tier-based model selection.)

### 5.6 Constraints on Next.js Feature Use

To keep the app portable and auditable, the following Next.js features are off-limits unless a specific need is documented:

- **No Server Actions.** They work outside Vercel but add implicit state and magic that's hard to reason about. API routes are explicit.
- **No ISR / `revalidateTag`.** The app has no static content worth revalidating. All pages are either auth-protected dynamic content or a static marketing landing page.
- **No Edge Runtime middleware.** The Clerk middleware runs on the Node runtime, not the edge. This is the default for self-hosted Next.js anyway.
- **No Next.js Image optimization with remote patterns.** Uses basic `<img>` tags or locally-hosted images only. Guru has no image-heavy surface.
- **No Next.js built-in caching.** Postgres is fast enough for our query volume; Cloudflare caches static assets at the edge.

These constraints are deliberate. They keep the app close to the "vanilla Node.js + React" end of the Next.js spectrum, which means less framework magic to debug and no architectural lock-in to a specific host.

---

## 6. Authentication

(Unchanged from original proposal. Clerk handles sign-up, sign-in, sessions, JWTs. Webhooks populate the `users` table. `requireUser()` middleware guards API routes.)

One small clarification for the self-hosted deployment: Clerk's JWT verification uses JWKS fetched from Clerk's API, which means the Hetzner VPS needs outbound HTTPS access to Clerk. This is already covered by default firewall rules (outbound unrestricted).

---

## 7. Infrastructure

### 7.1 Components

| Component | Host | Monthly Cost | Notes |
|-----------|------|--------------|-------|
| Next.js app | Hetzner CX22 VPS (shared with Postgres) | (shared) | systemd unit, localhost only |
| Postgres + pgvector | Hetzner CX22 VPS | €4.51 (~$5) | 2 vCPU, 4 GB RAM, 40 GB SSD |
| Caddy (reverse proxy) | Same VPS | (free) | Auto-provisions Cloudflare Origin Cert |
| CDN + WAF + DDoS | Cloudflare Free | $0 | Already managing the domain |
| Backups | Backblaze B2 | ~$0.50 | Daily `pg_dump` stored as object storage |
| Domain | (already owned, Cloudflare DNS) | $0 | |
| Auth | Clerk free tier | $0 | Until 10K MAU |
| Billing | Stripe | $0 | Transaction fees only |
| LLM inference | OpenRouter | Pay per token | ~$0.0006–0.02 per query |
| **Fixed total** | | **~$5/mo** | Flat, does not scale with users |

Headroom note: if the CX22 runs hot once there's real traffic, CX32 (4 vCPU, 8 GB RAM) is €8.46/mo. Scaling is a one-line change in the Hetzner console and a 30-second reboot.

### 7.2 Topology Rationale: Cloudflare in Front, Not Tunneled

Cloudflare sits in front of the Hetzner origin as a **proxy**, not as a tunnel. This means:

- Cloudflare's edge terminates TLS, runs WAF rules, applies rate limits, and serves cached static assets.
- Traffic flows from Cloudflare to Hetzner over HTTPS (port 443), with a Cloudflare Origin Certificate presented by Caddy.
- The origin is locked down: port 443 accepts connections only from Cloudflare's published IP ranges; port 22 accepts SSH only from the developer's home IP.

**Cloudflare Tunnel was considered and rejected.** Tunnels would eliminate the need for any inbound ports on the VPS, which is genuinely more secure against origin-IP discovery. But tunnels make Cloudflare a hard dependency: if Cloudflare's tunnel infrastructure has an outage, the app is down with no workaround. The current architecture degrades gracefully — a Cloudflare outage means flipping the proxy off and pointing DNS at the origin directly. App keeps running.

This is the "Cloudflare is an optimization, not a dependency" principle made concrete.

### 7.3 TLS Configuration

Two-layer TLS:

1. **Cloudflare ↔ user:** Cloudflare's universal edge certificate. Auto-managed by Cloudflare.
2. **Cloudflare ↔ origin:** Cloudflare Origin Certificate (free, up to 15-year validity), presented by Caddy on the VPS. Only Cloudflare trusts this certificate, so bypass attempts via direct IP get TLS errors.

Cloudflare's encryption mode is set to **Full (Strict)** and **Authenticated Origin Pulls** is enabled. The latter means Cloudflare presents a client certificate when connecting to the origin, and Caddy verifies it. Requests that don't come from Cloudflare's infrastructure are rejected at the TLS layer before any application code runs.

### 7.4 VPS Setup

```bash
# On a fresh Debian 13 (trixie) Hetzner CX22

# System updates
apt update && apt upgrade -y

# Packages
apt install -y \
    postgresql-17 postgresql-17-pgvector \
    caddy \
    ufw fail2ban unattended-upgrades \
    curl git

# Node.js 20 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Application user (no shell, no home)
useradd --system --no-create-home --shell /usr/sbin/nologin guru

# Postgres config:
#   - listen on localhost only (pg_hba.conf: host all all 127.0.0.1/32 scram-sha-256)
#   - create `guru` database and user
#   - CREATE EXTENSION vector;
#   - load corpus

# Firewall
ufw default deny incoming
ufw default allow outgoing
ufw allow from <HOME_IP> to any port 22 proto tcp
# Cloudflare IP ranges loaded from https://www.cloudflare.com/ips-v4
for ip in $(curl -s https://www.cloudflare.com/ips-v4); do
    ufw allow from "$ip" to any port 443 proto tcp
done
ufw enable

# Automatic security updates
dpkg-reconfigure -plow unattended-upgrades

# Cloudflare Origin Cert
# (origin.pem + origin.key generated in CF dashboard;
#  authenticated_origin_pull_ca.pem from
#  https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem)
mkdir -p /etc/ssl/cloudflare
chmod 755 /etc/ssl/cloudflare    # caddy user must traverse
# Place all three files. Then:
chown root:root  /etc/ssl/cloudflare/origin.pem
chmod 644        /etc/ssl/cloudflare/origin.pem
chown root:root  /etc/ssl/cloudflare/authenticated_origin_pull_ca.pem
chmod 644        /etc/ssl/cloudflare/authenticated_origin_pull_ca.pem
chown root:caddy /etc/ssl/cloudflare/origin.key  # caddy reads via group
chmod 640        /etc/ssl/cloudflare/origin.key
# Also: enable Authenticated Origin Pulls toggle in CF dashboard
# (SSL/TLS → Origin Server) — without it, Caddy drops the handshake → 520.

# Caddyfile at /etc/caddy/Caddyfile (see §7.5)
systemctl reload caddy

# systemd unit at /etc/systemd/system/guru-web.service (see §7.6)
systemctl daemon-reload
systemctl enable --now guru-web

# Backups (see §7.7)
```

One evening of work. After that, the box runs.

### 7.5 Caddy Configuration

```
# /etc/caddy/Caddyfile

guru.yourdomain.tld {
    tls /etc/ssl/cloudflare/origin.pem /etc/ssl/cloudflare/origin.key {
        client_auth {
            mode require_and_verify
            trust_pool file /etc/ssl/cloudflare/authenticated_origin_pull_ca.pem
        }
    }

    encode gzip zstd

    reverse_proxy localhost:3000 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
    }

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}
```

Twelve lines. Auto-renewal of any Caddy-managed certs is automatic; the Cloudflare Origin Cert is manually-provisioned but has a 15-year validity, so it's effectively never.

### 7.6 systemd Unit for Next.js

```ini
# /etc/systemd/system/guru-web.service

[Unit]
Description=Guru web app (Next.js)
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=guru
Group=guru
WorkingDirectory=/srv/guru-web/current
EnvironmentFile=/etc/guru-web.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

# Hardening — note MemoryDenyWriteExecute is omitted (V8 JIT requires W+X)
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/guru-web/current
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictNamespaces=true
LockPersonality=true

[Install]
WantedBy=multi-user.target
```

The `EnvironmentFile` at `/etc/guru-web.env` holds DATABASE_URL, OPENROUTER_API_KEY, CLERK_SECRET_KEY, STRIPE_SECRET_KEY, and related credentials. Mode `0600`, owned by root. Only the systemd process reads it; no human logs in and `cat`s this file in day-to-day operation.

### 7.7 Backup Strategy

A nightly cron job:

```bash
# /etc/cron.daily/guru-backup
pg_dump -Fc guru | \
  gzip | \
  b2 upload-file guru-backups - "guru-$(date +%Y%m%d).sql.gz"

# Keep 30 days of daily backups, prune older
b2 ls guru-backups | \
  sort | head -n -30 | \
  xargs -I{} b2 delete-file-version {}
```

Backblaze B2 storage costs ~$0.005/GB/month. Thirty daily backups of a small database is under a dollar a month.

Restore: `b2 download-file-by-name guru-backups guru-YYYYMMDD.sql.gz | gunzip | pg_restore -d guru_new`.

Complementary full-box protection: Hetzner snapshots, configured weekly via the Hetzner console. €0.01/GB/month; a 40GB snapshot is €0.40/mo. Covers the Next.js build, systemd config, Caddy config, and origin cert alongside the database.

### 7.8 Deployment

Deploys run over SSH from GitHub Actions. No Vercel git-integration equivalent — the trade is explicit.

**Access pattern: Tailscale, not public SSH.** The VPS's UFW allows port 22 only on the `tailscale0` interface (see §7.4). GitHub Actions joins the tailnet as an ephemeral node for the duration of each run via `tailscale/github-action`, then SSHes to the VPS's tailnet hostname. This keeps the public SSH surface at zero — no need for per-IP ufw rules that would chase GitHub's rotating runner IPs.

The Tailscale auth key lives in GitHub secrets as `TAILSCALE_AUTHKEY`, generated in the Tailscale admin console as **reusable + ephemeral + pre-approved + tagged `tag:ci`** (the tag is required for reusable+ephemeral keys and lets ACLs restrict `tag:ci` → `tag:server` on port 22 only).

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run lint && npm run type-check && npm run test
      - run: npm run build

      - name: Tailscale
        uses: tailscale/github-action@v3
        with:
          authkey: ${{ secrets.TAILSCALE_AUTHKEY }}
          tags: tag:ci

      - name: Deploy to VPS
        uses: appleboy/ssh-action@v1
        with:
          host: guru-web-prod            # tailnet hostname via MagicDNS
          username: deploy
          key: ${{ secrets.DEPLOY_SSH_KEY }}
          script: |
            cd /srv/guru-web
            ./deploy.sh ${{ github.sha }}
```

Secrets required: `TAILSCALE_AUTHKEY`, `DEPLOY_SSH_KEY`. The auth key's 90-day expiration is the one recurring maintenance cost — rotate on a calendar reminder.

The `deploy.sh` script on the VPS:

1. Clones or fetches the commit into `/srv/guru-web/releases/<sha>/`.
2. Runs `npm ci --omit=dev` in the release dir.
3. Symlinks `/srv/guru-web/current` → `/srv/guru-web/releases/<sha>/`.
4. Runs `systemctl restart guru-web`.
5. Prunes all but the last 5 releases.

Rollback: `ln -snf /srv/guru-web/releases/<old-sha> /srv/guru-web/current && systemctl restart guru-web`. Takes ten seconds.

### 7.9 Preview Environments

Not implemented at launch. When needed: a second CX22 VPS serving `staging.guru.yourdomain.tld`, deployed from a `staging` branch by a parallel GitHub Actions workflow. €4.51/mo when it exists, €0 when it doesn't.

Per-PR preview environments (Vercel's headline feature) are out of scope. Visual regression on individual PRs happens via local `npm run dev`.

### 7.10 What We're Explicitly Not Doing

Things that would add operational complexity for uncertain benefit:

- **No HA Postgres.** One box. If it goes down, we fix it. VPS uptime is ~99.9%; we can live with that.
- **No Kubernetes, no Docker Swarm, no orchestration.** One systemd-managed process per service.
- **No Cloudflare Tunnel.** See §7.2.
- **No separate Redis cache.** Postgres handles everything at our scale.
- **No separate vector DB.** pgvector inside the same Postgres.
- **No multi-region.** Users outside the VPS region pay 100–200ms extra latency, which is invisible next to the LLM response time.
- **No managed secrets store (Vault, Doppler, etc.).** Credentials live in `/etc/guru-web.env` with mode `0600`. Auditable in place, no external dependency, no extra dashboard.
- **No log aggregation service.** `journalctl -u guru-web`, Postgres logs in `/var/log/postgresql/`, Caddy logs in `/var/log/caddy/`. Three places to look, all on one box.

Each of these is a decision we can revisit once there's usage pressure. None of them should happen preemptively.

---

## 8. Data Flow: Query Path End-to-End

```
1. User types query in chat UI → POST /api/query
   Body: { query: string, sessionId: string }

2. Cloudflare edge:
   a. Verify TLS, apply WAF rules, check rate limits
   b. Forward to origin with Authenticated Origin Pulls cert

3. Caddy on VPS:
   a. Verify Cloudflare client cert
   b. Reverse-proxy to Next.js on localhost:3000

4. Next.js route handler (src/app/api/query/route.ts):
   a. Verify auth (Clerk session cookie)
   b. Load user record → get tier, preferences
   c. Atomic quota check: if over daily limit, return 429
   d. Load session history (last N messages) from Postgres (localhost)
   e. Call retriever

5. Retriever (lib/retriever.ts):
   a. Embed query via OpenRouter embedding model
   b. Vector search in pgvector with preference filters
   c. Extract concepts from query
   d. Graph walk in Postgres
   e. Merge, re-rank by tier weight + diversity boost
   f. Return top 15 chunks

6. Prompt builder (lib/prompt.ts + budget.ts + compress.ts):
   a. Initialize TokenBudget
   b. Reserve system prompt and taxonomy
   c. If chunks exceed remaining budget, run extractive compression
   d. Assemble final prompt

7. Model call (lib/model.ts):
   a. Send prompt to OpenRouter with model = tier's configured ID
   b. Stream response back through Caddy → Cloudflare → client

8. Post-response:
   a. Persist query + response + chunks_used to queries table
   b. Increment quota counter
   c. UI renders citations inline
```

Total server-side work: 6 database queries (all localhost, sub-millisecond), 2 OpenRouter calls (embedding + completion), some in-memory string manipulation. No microservice hops. No message queue. No separate workers. Database never leaves the VPS.

---

## 9. Security Posture

A section worth calling out explicitly given the revised architecture.

### 9.1 Trust surface

- **Cloudflare** sees every request and response in plaintext (they terminate TLS). They don't see credentials at rest — those live in `/etc/guru-web.env` on Hetzner.
- **Hetzner** has physical/hypervisor access to the VPS, as is true of any IaaS provider.
- **Clerk** manages user authentication. Compromising Clerk would let an attacker impersonate users but not access corpus data beyond what any user could query.
- **OpenRouter** sees user queries and receives LLM responses. No credentials beyond the API key.
- **GitHub** holds the source code and deploy secrets. Compromising the `DEPLOY_SSH_KEY` secret would let an attacker push malicious code to the VPS.

Every entry on this list is either (a) necessary for the product to function, or (b) already constrained in scope. No managed PaaS stores production env vars.

### 9.2 Secret rotation

- **Clerk, Stripe, OpenRouter keys:** rotate if exposed. Update `/etc/guru-web.env`, `systemctl restart guru-web`.
- **Cloudflare API tokens:** only used for initial setup; rotate as needed in Cloudflare dashboard.
- **Cloudflare Origin Certificate:** 15-year validity; rotate if the private key is ever exposed.
- **SSH keys:** `DEPLOY_SSH_KEY` in GitHub Secrets; rotate if a GitHub compromise is suspected.
- **Postgres password:** used only for localhost connections from the Next.js process; rotation is low-urgency.

All rotation paths are documented procedures, not scrambles.

### 9.3 Incident response

- **Cloudflare outage:** Flip DNS to direct origin (CNAME → A record). App keeps running with reduced edge protection. Recovery: reverse when Cloudflare returns.
- **Hetzner VPS outage:** Provision new VPS, restore from latest Hetzner snapshot (~10 minutes) or rebuild from scratch and restore Postgres from B2 backup (~30 minutes). Update Cloudflare DNS.
- **Suspected compromise of `/etc/guru-web.env`:** Rotate all five secrets above, deploy new env file, restart service.
- **Suspected compromise of GitHub org:** Rotate `DEPLOY_SSH_KEY`, audit deploy logs, audit commits.

---

## 10. Migration Path from v1

Unchanged from original proposal. v1 stays on the developer's laptop as the corpus curation environment; v2 is a from-scratch web app that consumes v1's output. The `scripts/export.py` script is the bridge. See `guru-pipeline-migration.md` for the concrete pipeline migration plan.

---

## 11. Build Phases

### Phase 1: Export Pipeline (Python, 2 days)
See `guru-pipeline-migration.md`.

### Phase 2: VPS Setup (1 evening)
- Provision Hetzner CX22
- Install Postgres 17 + pgvector, Node 20, Caddy, ufw, fail2ban
- Configure Cloudflare DNS and SSL (Full Strict + Authenticated Origin Pulls)
- Install Cloudflare Origin Cert
- Configure Caddy, create `guru` system user
- Load first corpus artifact
- Set up automated daily backups to B2
- Configure Hetzner snapshots (weekly)

### Phase 3: TypeScript Runtime Port (1–2 weeks)
- Next.js project scaffold with `output: 'standalone'`
- Port retrieval logic (retriever, graph, prompt, budget, compress)
- OpenRouter integration with tier-based model selection
- Boot-time corpus schema version check (`lib/boot.ts`)
- Unit tests for the retrieval algorithm (golden queries from v1)

### Phase 4: Auth Integration (2–3 days)
- Clerk dev + prod applications
- `requireUser()` middleware + `lib/auth.ts`
- User provisioning webhook (`/api/webhooks/clerk`)
- Protected route wiring

### Phase 5: Web App (1–2 weeks)
- Chat UI with streaming responses
- Settings page (tradition preferences)
- Session history
- Clerk hosted sign-in/sign-up pages

### Phase 6: Billing & Quota (3–5 days)
- Stripe subscription integration
- Webhook handling for tier updates
- Quota tracking and rate limiting

### Phase 7: Deploy Pipeline (1–2 days)
- systemd unit for Next.js
- Deploy script on VPS (release dirs, symlink swap)
- GitHub Actions deploy workflow
- Smoke test: push to main → deployed to production

### Phase 8: Launch (a few days)
- Load production corpus
- Configure Cloudflare WAF rules + rate limits
- End-to-end smoke test
- Soft launch to a small group

**Realistic total timeline for a solo developer: 5–8 weeks of focused work.** Unchanged from original proposal — self-hosting adds ~1 day (Phase 7) versus Vercel's built-in deploy but removes Vercel-specific wrinkles elsewhere.

---

## 12. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| VPS goes down, no HA | Daily B2 backups + weekly Hetzner snapshots + ~30min recovery procedure. Accept ~99.9% uptime. |
| Cloudflare outage | DNS flip to direct origin (documented procedure). App continues running with reduced edge protection. |
| Postgres version drift between dev and prod | Pin Postgres 17 + pgvector version in both environments. |
| Corpus reload fails mid-deploy | `export.py` produces idempotent SQL wrapped in a transaction. Old corpus intact on failure. |
| Next.js streaming broken behind proxy | Caddy and Cloudflare both support streaming responses natively. Verified in Phase 7 smoke test. |
| Free Cloudflare / Clerk tiers silently degrade | Monitor usage; Clerk's 10K MAU and Cloudflare's Free tier limits are documented upgrade triggers. |
| pgvector performance at scale | Corpus is small (<10K chunks for a long time). Revisit when we cross that threshold. |
| OpenRouter outage | LiteLLM migration or direct provider fallback is a future option. Single point of failure acceptable for v2. |
| Deploy SSH key compromise | Key is write-only to a restricted `deploy` user with `sudo systemctl restart guru-web` permission only. Full shell access requires a separate admin key from home IP. |
| Origin IP leaks (bypassing Cloudflare) | Authenticated Origin Pulls rejects non-Cloudflare TLS. ufw rejects non-Cloudflare IPs on :443. Defense in depth. |

---

## 13. Success Criteria

v2 is successful if all of the following are true at launch:

- Users can sign up, ask questions, get cited cross-tradition answers
- Free tier works and is rate-limited correctly
- Pro tier upgrade via Stripe flows end-to-end
- Corpus can be updated by running `export.py` + one `psql` command
- Monthly infrastructure cost is under $10 (excluding LLM tokens)
- The entire system can be explained in one architecture diagram (§3)
- A single developer can deploy, operate, audit, and debug every layer
- Cloudflare outage does not take down the app (DNS flip procedure works)
- `/etc/guru-web.env` is the single location where production secrets live, and it's on infrastructure the developer owns

---

## 14. Out of Scope for v2

Explicitly deferred:

- Conversational memory with exponential decay
- Semantic response caching
- Community curation UI and token economy
- Self-hosted LLM inference (GPU)
- Multi-region deployment
- HA database / Postgres streaming replication
- Cross-encoder re-ranker
- Per-PR preview environments
- Additional traditions beyond v1 starter corpus (data-only, separate track)
- Cloudflare Access for admin routes (add when admin routes exist)
- Migration to a non-Next.js framework (revisit only if a concrete need surfaces)

---

## 15. Changelog from Original Proposal

For readers comparing against the pre-Vercel-breach version:

| Decision | Was | Now |
|---|---|---|
| Next.js hosting | Vercel Hobby / Pro | Hetzner VPS (self-hosted) |
| TLS termination | Vercel edge | Cloudflare edge + Caddy origin |
| CDN / WAF | Vercel built-in | Cloudflare Free |
| Secrets storage | Vercel env vars | `/etc/guru-web.env` (mode 0600) |
| Deploy pipeline | Vercel git integration | GitHub Actions SSH deploy |
| Preview envs | Vercel per-PR | Deferred; separate staging VPS when needed |
| Postgres version | 16 | 17 (PGDG, longer support window) |
| pgvector index | ivfflat | HNSW (better recall at corpus size) |
| Embedding model | Unspecified | Google `text-embedding-005` (768-dim, native) |
| Framework | Next.js | Next.js (reconfirmed; constraints tightened — see §5.6) |

Monthly cost is approximately unchanged (~$5/mo fixed). Operational surface is slightly larger (one systemd unit, one Caddyfile, one deploy script to own). Trust surface is materially smaller (one fewer SaaS holding production credentials).
