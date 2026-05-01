# guru-web — Incident Response Runbook

Operational playbook for the production VPS. Read this before paging anyone; most incidents map to one of the scenarios below.

---

## Quick reference

| Thing | Where |
|---|---|
| VPS | Hetzner CX32, Debian 13 trixie. Public IP in Hetzner console. |
| Tailnet hostname | `guru-web-prod` (MagicDNS) |
| Domain | `guru-ai.org`, proxied through Cloudflare |
| App systemd unit | `guru-web.service` (runs as `guru` user) |
| App working dir | `/srv/guru-web/current` → symlink → `/srv/guru-web/releases/<sha>/.next/standalone/` |
| App env (secrets, runtime-only) | `/etc/guru-web.env` (mode 600, root:guru) |
| App env (`NEXT_PUBLIC_*`, build + runtime) | `/etc/guru-web.public.env` (mode 644, root:root) |
| Bootstrap config | `/etc/guru-bootstrap.env` (mode 600, root:root) |
| Backup config | `/etc/backup-b2.env` (mode 600, root:root) |
| DB password | `/etc/guru-db-password` (mode 600, root:root) |
| TLS certs | `/etc/ssl/cloudflare/{origin.pem,origin.key,authenticated_origin_pull_ca.pem}` |
| Reverse proxy | Caddy, `/etc/caddy/Caddyfile` |
| Embeddings | Ollama on `127.0.0.1:11434`, model `nomic-embed-text:v1.5` |

SSH access is **tailnet only** — UFW closes public 22. Get on Tailscale, then `ssh root@guru-web-prod`. Break-glass: Hetzner web console.

---

## Env file split

The app's environment lives in two files, separated by trust boundary:

| File | Mode | Owner | Contents | Read by |
|---|---|---|---|---|
| `/etc/guru-web.env` | `600` | `root:guru` | secrets only | runtime (`guru` user) |
| `/etc/guru-web.public.env` | `644` | `root:root` | `NEXT_PUBLIC_*` only | build (`deploy` user) **and** runtime |

**Why split.** `next build` inlines `NEXT_PUBLIC_*` into the client JS that ships to every browser — those values are public the moment they ship, regardless of file permissions. `deploy.sh` runs as the `deploy` user, which has no read access to the secrets file (and shouldn't). The public file lets the build inline the publishable keys without expanding `deploy`'s read scope to your `STRIPE_SECRET_KEY` etc.

**What goes where:**

```
# /etc/guru-web.public.env   (mode 644)
NEXT_PUBLIC_APP_URL=https://guru-ai.org
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

```
# /etc/guru-web.env          (mode 600 root:guru)
DATABASE_URL=postgresql://guru:...@localhost:5432/guru
OPENROUTER_API_KEY=sk-or-v1-...
CLERK_SECRET_KEY=sk_test_...
CLERK_WEBHOOK_SECRET=whsec_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
# OLLAMA_URL defaults to http://localhost:11434 — set only to override
```

systemd merges both via two `EnvironmentFile=` lines in `guru-web.service`. `deploy.sh` sources only the public file before `npm run build`.

If you ever see the app boot cleanly but Clerk/Stripe silently broken in the browser, that's the public file missing or unreadable when the build ran — see the troubleshooting note in the 502 incident section.

---

## Incident: site returns 502 from the edge

User-facing symptom: blank page, "Bad Gateway", or timeout.

```
ssh root@guru-web-prod
systemctl status guru-web --no-pager -n 10
```

Decision tree based on what you see:

| State | Diagnosis | Fix |
|---|---|---|
| `Active: active (running)` | App up; Caddy can't reach it | `ss -tlnp \| grep :3000` — if nothing listening, restart unit |
| `Active: failed` | App crashed | `journalctl -u guru-web -n 50 --no-pager` — read the trace |
| `Active: activating (auto-restart)` | App is in a crash-loop | Same as failed; check journal |
| `Loaded: not-found` | Unit file gone | Re-run `vps-bootstrap.sh` or scp from repo |

Common crash causes (paste the relevant fix):

- **`Failed to load environment files`** → one of the env files is missing or unreadable. Check `ls -la /etc/guru-web.env /etc/guru-web.public.env`. Should be `600 root:guru` and `644 root:root` respectively.
- **App boots but sign-in/checkout silently broken (empty `publishableKey` in HTML)** → `/etc/guru-web.public.env` was missing or unreadable when `deploy.sh` ran `npm run build`. `NEXT_PUBLIC_*` are baked in at build time, so a runtime fix can't help; you must rebuild. Verify with `curl -s https://guru-ai.org/ | grep -oE 'publishableKey":"[^"]*"'` — empty string means the bundle is broken. Re-run `deploy.sh <last-good-sha>` after fixing the file.
- **`Check failed: 12 == errno` (V8 panic)** → systemd unit has `MemoryDenyWriteExecute=true`. V8 JIT needs writable+executable memory. Edit `/etc/systemd/system/guru-web.service`, remove that line, `systemctl daemon-reload && systemctl restart guru-web`. (Source unit in repo is correct — only an issue if the unit on disk is from before the fix.)
- **Database connection refused** → Postgres down. `systemctl status postgresql`. Restart with `systemctl restart postgresql`.
- **`relation "users" does not exist`** → migrations weren't applied. `for f in /srv/guru-web/releases/*/migrations/*.sql; do sudo -u postgres psql -d guru -f "$f"; done`

---

## Incident: site returns 520 from the edge

CF can connect to origin but the response is malformed. Almost always a TLS handshake failure between CF and Caddy.

Two checks in order:

1. **Caddy serving locally?** `openssl s_client -connect localhost:443 -servername guru-ai.org </dev/null 2>&1 | grep -E 'Cipher|Acceptable'` — should show a cipher and "Acceptable client certificate CA names". If not, Caddy is down: `systemctl status caddy`.
2. **AOP enabled in Cloudflare?** Dashboard → SSL/TLS → Origin Server → Authenticated Origin Pulls toggle. If off, flip on, wait 30s, retry. Without it, CF doesn't present the client cert and Caddy drops the connection.

Other 520 causes:
- **Cert perms wrong** — Caddy log shows "permission denied" reading `origin.pem` or `origin.key`. Fix: `chmod 755 /etc/ssl/cloudflare && chown root:caddy /etc/ssl/cloudflare/origin.key && chmod 640 /etc/ssl/cloudflare/origin.key && systemctl restart caddy`.
- **Cert expired** — `openssl x509 -in /etc/ssl/cloudflare/origin.pem -noout -dates`. Origin certs are 15-year by default; if it's the AOP CA bundle that's stale, re-fetch from `https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem`.

---

## Incident: Ollama down → `/api/query` returns EmbedError

Embeddings server is on `127.0.0.1:11434`, runs as the `ollama` user under `ollama.service` (loopback-only unit, NOT Ollama installer's default).

```
systemctl status ollama --no-pager -n 10
curl -s http://127.0.0.1:11434/api/tags | grep nomic-embed-text
```

If service is down:
```
systemctl restart ollama
```

If service is up but model isn't listed:
```
sudo -u ollama ollama pull nomic-embed-text:v1.5
```

If `127.0.0.1:11434` is unreachable but service shows running, the unit may have reverted to `0.0.0.0` binding. Verify `/etc/systemd/system/ollama.service` matches the repo version (`Environment="OLLAMA_HOST=127.0.0.1:11434"`).

---

## Incident: Postgres unreachable

```
systemctl status postgresql --no-pager
sudo -u postgres psql -c "SELECT 1"
```

If service is down: `systemctl restart postgresql`. If the data dir is corrupt (rare — check `journalctl -u postgresql`), restore from latest backup (see "Routine: restore from backup" below).

---

## Incident: Cloudflare edge down

Symptoms: users can't reach the site at all; CF dashboard shows widespread issues.

**DNS flip to direct origin** (gives up TLS termination at edge but restores access):

1. Cloudflare dashboard → DNS → click the A record for `guru-ai.org`.
2. **Disable proxy** (orange cloud → grey cloud) on the A and AAAA records.
3. Wait for TTL (usually 1–5 min).
4. Users now hit the VPS public IP directly.

**Caveat**: while proxy is off, every request hits origin TLS directly (Caddy uses your CF-issued origin cert, which browsers don't trust → users see cert warnings unless you also flip Caddy to a Let's Encrypt cert temporarily). For most short outages, just wait for CF to recover instead of flipping. Only flip if you'd rather have cert warnings than complete unreachability.

**To revert**: re-enable proxy on the records (orange cloud).

---

## Routine: VPS rebuild from scratch

If the box is unrecoverable (corrupted disk, compromised, etc.):

1. Provision a new Hetzner CX32 (Debian 13).
2. SSH in as root with your initial key.
3. Clone or scp `deploy/` from the repo to `/root/guru-web/`.
4. Create `/etc/guru-bootstrap.env` (mode 600) with:
   ```
   DOMAIN=guru-ai.org
   TS_AUTHKEY=tskey-auth-...
   DEPLOY_PUBKEY="ssh-ed25519 AAAA... github-actions@guru-web"
   ```
5. Place CF origin cert files in `/etc/ssl/cloudflare/` (perms set automatically by bootstrap).
6. Run `bash /root/guru-web/deploy/vps-bootstrap.sh`.
7. Update Cloudflare DNS to point at the new VPS public IP.
8. Create the two env files — easiest path: scp from a known-good source. See "Env file split" below for which keys go where.
   - `/etc/guru-web.env`        — secrets only — `chown root:guru && chmod 600`
   - `/etc/guru-web.public.env` — `NEXT_PUBLIC_*` only — `chown root:root && chmod 644`
9. Create `/etc/backup-b2.env` (mode 600) with B2 creds.
10. Restore corpus from latest pipeline output: `gunzip -c guru-corpus.sql.gz | sudo -u postgres pg_restore -d guru` (or restore from B2 backup if pipeline output is unavailable — see below).
11. Push any commit to `main` to trigger first deploy.

Total time: ~30 min if you have all the secrets and certs handy.

---

## Routine: restore from backup

Backups are in Backblaze B2 as `guru-YYYYMMDDTHHMMSSZ.sql.gz`, custom format (`pg_dump -Fc | gzip`).

```
b2 file download b2://<bucket>/guru-<timestamp>.sql.gz /tmp/restore.sql.gz
gunzip /tmp/restore.sql.gz
sudo -u postgres pg_restore -d guru --clean --if-exists /tmp/restore.sql
```

`--clean --if-exists` drops and re-creates each object. If you want to restore into a fresh DB instead, create one and target it: `sudo -u postgres createdb guru_new && sudo -u postgres pg_restore -d guru_new /tmp/restore.sql`.

---

## Routine: secret rotation

### Postgres password
```
NEW_PW=$(openssl rand -base64 32 | tr -d '\n=+/')
sudo -u postgres psql -c "ALTER ROLE guru WITH PASSWORD '$NEW_PW';"
printf '%s' "$NEW_PW" > /etc/guru-db-password
chmod 600 /etc/guru-db-password
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://guru:$NEW_PW@localhost:5432/guru|" /etc/guru-web.env
sudo systemctl restart guru-web
```

### Tailscale auth key (CI)
- Tailscale admin → Settings → Keys → revoke old key.
- Generate a new one (reusable + ephemeral + pre-approved + `tag:ci`, 90-day expiry).
- GitHub repo → Settings → Secrets → update `TAILSCALE_AUTHKEY`.
- No VPS-side change needed (the VPS uses its own non-CI auth from when it joined).

### Deploy SSH key
- On laptop: `ssh-keygen -t ed25519 -f ~/.ssh/guru-deploy-new -N ''`
- Copy public key to `/home/deploy/.ssh/authorized_keys` on VPS (append, then remove old line).
- GitHub repo → Settings → Secrets → update `DEPLOY_SSH_KEY` with new private key.
- Test by re-running a workflow.
- Delete the old key from `authorized_keys` on the VPS.

### Stripe / Clerk / OpenRouter keys
- Generate new keys in each provider's dashboard.
- **Secret keys** (`*_SECRET_KEY`, `*_WEBHOOK_SECRET`, `OPENROUTER_API_KEY`, `STRIPE_PRO_PRICE_ID`) → update `/etc/guru-web.env`. `systemctl restart guru-web` is enough.
- **Publishable keys** (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`) → update `/etc/guru-web.public.env`, then **trigger a redeploy** (push any no-op commit to `main`, or re-run `deploy.sh <sha>`). A restart alone won't help — these are baked into the client bundle at build time.
- `systemctl restart guru-web`.
- For Stripe + Clerk webhooks: also update the webhook endpoint's signing secret in the dashboard if you regenerated it; copy back to `/etc/guru-web.env`.

### Cloudflare Origin Certificate
Origin certs are 15-year by default — rotation is rare. If you do rotate:
- CF dashboard → SSL/TLS → Origin Server → "Create Certificate" → copy pem + key.
- Replace `/etc/ssl/cloudflare/{origin.pem,origin.key}` (re-apply perms: `chmod 644 origin.pem; chmod 640 origin.key; chown root:caddy origin.key`).
- `systemctl reload caddy`.
- Revoke the old cert in CF dashboard.

---

## Routine: Deploy new corpus

The corpus (traditions, texts, concepts, chunks, edges) lives in a dedicated
Postgres `corpus` schema. This isolates it from app tables (users, sessions,
queries, etc.) in the `public` schema. The web app's Pool config sets
`search_path=public,corpus` so unqualified table names resolve correctly.

### How corpus updates work

The guru pipeline (Python repo) produces `export/guru-corpus.sql.gz` — a
self-contained, atomic SQL artifact. When loaded, it:

1. Creates a `corpus_new` staging schema
2. Runs CREATE TABLE + COPY FROM STDIN (fast, no per-row INSERT overhead)
3. Builds HNSW + btree indexes
4. Validates schema_version and chunk count inline
5. Swaps `corpus_new` → `corpus` via `ALTER SCHEMA … RENAME` (~10ms)

If any step fails, the entire transaction rolls back. The live `corpus`
schema and all `public.*` tables are untouched.

### Loading a new corpus on the VPS

On your laptop:

```bash
cd ~/Work/guru
python scripts/export.py          # produces export/guru-corpus.sql.gz
scp export/guru-corpus.sql.gz guru-web-prod:/tmp/
```

On the VPS:

```bash
gunzip -c /tmp/guru-corpus.sql.gz | \
  sudo -u postgres psql -d guru -v ON_ERROR_STOP=1
rm -f /tmp/guru-corpus.sql.gz
```

The app will pick up the new tables on the next query (Postgres resolves
schema names at parse time, not connection time). No restart needed.

### First-time corpus load (fresh VPS)

If `corpus` does not exist yet, the artifact creates it automatically.
The app will fail to boot until a corpus is loaded — this is intentional
fail-fast behaviour in `src/lib/boot.ts`.

---

## Tailnet admin listener

The `/admin` and `/api/admin/*` surface is reachable **only** via the
VPS's Tailscale hostname (`guru-web-prod.tailb5626e.ts.net`). The public
Cloudflare-fronted hostname rewrites `/admin*` to a Next-rendered 404
page. Spec: `docs/admin-ui/BRD-admin-ui.md` §0.1, §0.3.

This is a one-time hand-patch. `vps-bootstrap.sh` does not install it
because bootstrap is one-shot and admin install is deliberate.

### Prereqs

- Tailscale running on the VPS (already true post-bootstrap).
- VPS node's MagicDNS hostname is `guru-web-prod`. Verify with
  `tailscale status | head -1` — the first column is the hostname.
- The Caddy `caddy` group exists (created by the Caddy package).

### Install

On the VPS, as root:

```bash
# 1. Copy the renewal script and units out of the latest release.
SHA=$(ls -1t /srv/guru-web/releases | head -1)
install -m 0755 /srv/guru-web/releases/$SHA/deploy/tailnet-cert-renew.sh \
                /usr/local/bin/tailnet-cert-renew
install -m 0644 /srv/guru-web/releases/$SHA/deploy/tailnet-cert-renew.service \
                /etc/systemd/system/tailnet-cert-renew.service
install -m 0644 /srv/guru-web/releases/$SHA/deploy/tailnet-cert-renew.timer \
                /etc/systemd/system/tailnet-cert-renew.timer

# 2. First cert issuance — also creates /etc/ssl/tailnet/ with the
#    right ownership/perms.
/usr/local/bin/tailnet-cert-renew

# 3. Wire up the Caddyfile. Diff against the repo to be sure both
#    site blocks (public + tailnet) are present and the @admin
#    rewrite is on the public block.
diff /etc/caddy/Caddyfile /srv/guru-web/releases/$SHA/deploy/Caddyfile
$EDITOR /etc/caddy/Caddyfile     # bring it into line with the repo
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy

# 4. Enable the daily renewal timer.
systemctl daemon-reload
systemctl enable --now tailnet-cert-renew.timer
systemctl list-timers tailnet-cert-renew.timer    # confirm active
```

### Validation

From a public client (laptop on cellular, etc.):

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://guru-ai.org/admin/
# → 404   (response shape is the Next 404 page, not Caddy's bare one)
```

From a tailnet device:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  https://guru-web-prod.tailb5626e.ts.net/
# → 200   (or 404 if /admin doesn't exist yet — normal pre-auth-gate)
```

### Recovery — admin UI returns TLS error

Likely cause: cert renewal has been silently failing and the on-disk
cert expired.

```bash
# Look at what the timer's been doing.
systemctl list-timers tailnet-cert-renew.timer
journalctl -u tailnet-cert-renew.service --no-pager -n 50

# Re-run by hand. Same script the timer fires.
/usr/local/bin/tailnet-cert-renew

# Verify the on-disk cert is fresh.
openssl x509 -in /etc/ssl/tailnet/guru-web-prod.tailb5626e.ts.net.crt \
  -noout -dates
```

If `tailscale cert` itself fails: check `tailscale status` — the node
must be online and tagged appropriately for cert issuance. The
Tailscale admin console's HTTPS feature must be enabled for the
tailnet (it is, but verify if reinstalling on a new tailnet).

### Recovery — Tailscale down, can't reach admin UI

This is by design. There is no env-flag fallback to expose the admin
surface publicly. For genuine emergencies (kill-switch-style mutation),
SSH to the VPS and run `psql` directly. Same path you'd use for any
mutation outside this UI.

---

## Lessons learned (gotchas to remember)

- **`MemoryDenyWriteExecute=true` breaks V8.** Don't add it back to the systemd unit. The other hardening directives are JIT-safe.
- **Caddy can't read 600 root:root files** — it runs as the `caddy` user. Origin key needs `640 root:caddy`, dir needs `755`.
- **AOP toggle is required, not optional.** Origin cert files alone aren't enough; CF won't present a client cert until you flip the toggle in the SSL/TLS → Origin Server tab.
- **Stripe + OpenAI SDK constructors throw on missing API keys at module load.** All clients in `src/lib/` and `src/app/api/` must use the lazy-init pattern (construct on first call inside a function, not at module top level), or `next build` fails during page-data collection.
- **Next.js standalone build excludes `scripts/` and `migrations/`.** That's why `deploy.sh` runs migrations from `$RELEASE/migrations/` (the full clone) instead of from the symlinked `current` (the standalone subset).
- **Cloudflare DNS records: never gray-cloud them**, even briefly. Once your origin IP is in passive DNS databases, it's there forever and the "only allow CF IPs on 443" model has a hole.
- **Tailscale node key expires every ~180 days by default.** Disable expiry on the VPS node in the admin console after bootstrap, or it'll silently fall off the tailnet.
- **Never run `deploy.sh` as plain `sudo`** — git refuses operations on the deploy-owned repos with "dubious ownership", and any files created under that run end up root-owned, which the next prune can't remove. Always `sudo -u deploy /srv/guru-web/deploy.sh <sha>`. The script now self-heals via `sudo chown -R deploy:deploy /srv/guru-web/releases` at the top, so existing root-owned damage gets fixed on the next deploy — but only if `/etc/sudoers.d/deploy` includes the new chown rule (added by `vps-bootstrap.sh`; existing VPSes need the one-time hand-patch below).

### One-time sudoers patch (existing VPSes)

`vps-bootstrap.sh` only runs once. On already-bootstrapped VPSes, the sudoers file needs hand-patching to match the current state of the script. Final form:

```
deploy ALL=(root) NOPASSWD: /bin/systemctl restart guru-web, /bin/systemctl status guru-web
deploy ALL=(root) NOPASSWD: /bin/chown -R deploy\:deploy /srv/guru-web/releases
deploy ALL=(guru)  NOPASSWD: /usr/bin/psql -d guru -1 -v ON_ERROR_STOP=1
```

```bash
ssh root@guru-web-prod
visudo -f /etc/sudoers.d/deploy
# Edit to match the three lines above. visudo validates syntax before saving.
```

Three things to know:

- The chown line is what enables the self-heal step in `deploy.sh`. Without it, the chown silently no-ops (`|| true`) and old root-owned releases accumulate.
- The psql line target is `guru`, not `postgres`. Migrations run as the `guru` DB owner now (peer auth via the `guru` OS user that the systemd unit also uses), so the migration runner has no access to corpus tables — only what the runtime app already has. Old form was `(postgres) NOPASSWD: /usr/bin/psql -d guru -1 -f *` which gave full superuser DDL on every schema.
- The trailing `-v ON_ERROR_STOP=1` makes psql exit non-zero on the first SQL error. Without it psql exits 0 even when a transaction (`-1`) rolled back, and `set -e` in `deploy.sh` doesn't catch silent migration failures (you only find out weeks later that an index never got created). Sudo arg matching is exact — the sudoers entry must include this flag verbatim or sudo will fall through to "password required".

### Self-updating deploy.sh

`/srv/guru-web/deploy.sh` self-updates from the repo on every run. After `git fetch/checkout`, the script compares itself to `$RELEASE/deploy/deploy.sh` and re-execs the new version if they differ. Changes to `deploy/deploy.sh` in the repo take effect on the **first** CI deploy after merge — no need to re-run `vps-bootstrap.sh` or hand-copy the script.

**One-time exception**: if the on-disk script is from before the self-update mechanism existed, the first deploy after merging it won't pick it up — the *old* script is what's running and it doesn't know to refresh itself. You need to copy the new version into place by hand once:

```bash
ssh guru-web-prod 'sudo -u deploy bash -c "
  SHA=\$(ls -1t /srv/guru-web/releases | head -1)
  cp /srv/guru-web/releases/\$SHA/deploy/deploy.sh /srv/guru-web/deploy.sh
  chmod +x /srv/guru-web/deploy.sh
"'
```

After that, future updates flow automatically.

### One-time app-table ownership reset (existing VPSes)

`vps-bootstrap.sh` now (via todo:56e5b545) ALTERs any non-guru-owned table in `public` to `guru` — defensive against stale paths (an emergency `sudo -u postgres psql -f migration.sql` without `SET ROLE guru` leaves the table owned by postgres, and the next migration's `CREATE INDEX` fails with "must be owner of relation X").

Existing VPSes that pre-date this step need a one-shot:

```bash
ssh root@guru-web-prod
sudo -u postgres psql -d guru -v ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT schemaname, tablename
        FROM pg_tables
        WHERE schemaname = 'public' AND tableowner <> 'guru'
    LOOP
        EXECUTE format('ALTER TABLE %I.%I OWNER TO guru', r.schemaname, r.tablename);
        RAISE NOTICE 'reset owner of %.% to guru', r.schemaname, r.tablename;
    END LOOP;
END $$;
SQL
```

Idempotent — already-owned-by-`guru` tables are skipped. Verify after:

```bash
sudo -u postgres psql -d guru -c "
  SELECT tablename, tableowner
  FROM pg_tables
  WHERE schemaname='public'
  ORDER BY tablename;
"
# Every row should show tableowner = guru. Any showing 'postgres' means
# the DO block didn't catch it — check for typos in the SQL above.
```
