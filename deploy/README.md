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
| App working dir | `/srv/guru-web/current` → symlink → `/srv/guru-web/releases/<sha>/` (pre-built release, unpacked from the CI tarball) |
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

**Why split.** `next build` inlines `NEXT_PUBLIC_*` into the client JS that ships to every browser — those values are public the moment they ship, regardless of file permissions. The build runs in CI (deploy.yml), which fetches the public file over the tailnet as the `deploy` user — a user with no read access to the secrets file (and shouldn't have it). The public file lets the build inline the publishable keys without expanding that read scope to your `STRIPE_SECRET_KEY` etc.

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

systemd merges both via two `EnvironmentFile=` lines in `guru-web.service`. CI (deploy.yml) scps only the public file and sources it before `npm run build`; the built release then ships to the VPS as a tarball — `deploy.sh` never installs or builds anything (supply-chain hardening, todo:479c221f).

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
- **App boots but sign-in/checkout silently broken (empty `publishableKey` in HTML)** → `/etc/guru-web.public.env` was missing or unreadable when CI fetched it for `npm run build` (deploy.yml fails loudly on the scp now, so this mostly means someone shipped a hand-built tarball without sourcing it). `NEXT_PUBLIC_*` are baked in at build time, so a runtime fix can't help; you must rebuild. Verify with `curl -s https://guru-ai.org/ | grep -oE 'publishableKey":"[^"]*"'` — empty string means the bundle is broken. Fix the file, then redeploy (re-run the Deploy workflow for the last good SHA).
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
- **Publishable keys** (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`) → update `/etc/guru-web.public.env`, then **trigger a redeploy** (push any no-op commit to `main`, or re-run the Deploy workflow from the Actions tab — the build happens in CI, so re-running `deploy.sh` alone just re-unpacks the old bundle). A restart alone won't help — these are baked into the client bundle at build time.
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

### Trust model (post 2026-05-09 cutover)

Admin auth is **not** Clerk-gated — Clerk's production keys are
domain-locked to `guru-ai.org` and refuse to operate on the tailnet
hostname (`Production Keys are only allowed for domain "guru-ai.org"`).
Multi-domain / satellite-domain unlocks additional hosts but is paid.

The Caddy tailnet listener injects `X-Tailnet-Trust: 1` on every
request it forwards to Next; the public listener strips any inbound
copy of that header so a malicious caller can't forge it. The in-app
`requireAdmin()` helper (`src/lib/admin.ts`) reads the header and
either returns a synthetic operator (`id="tailnet"`,
`email="admin@tailnet"`) or a 404 Response.

**The tailnet site block also `bind`s to the tailnet hostname** so
Caddy only listens on the tailnet interface for that block. Without
the bind, Caddy's default `0.0.0.0:443` listener accepts public-IP
connections that present `SNI=guru-web-prod.<tailnet>.ts.net` and
routes them into the tailnet block — which would let an internet
attacker reach `/admin` and have `X-Tailnet-Trust` injected on
their behalf. The `bind` closes that path at the network layer.

For Caddy to resolve the bind hostname on a cold boot, the systemd
drop-in installed by `vps-bootstrap.sh` (`step_caddy`) orders Caddy
`After=tailscaled.service`. Existing VPS installs predating this
change should patch the drop-in by hand and `systemctl
daemon-reload`:

```bash
sudo tee /etc/systemd/system/caddy.service.d/env.conf >/dev/null <<EOF
[Unit]
After=tailscaled.service
Wants=tailscaled.service

[Service]
Environment="DOMAIN=$(grep '^DOMAIN=' /etc/guru-bootstrap.env | cut -d= -f2)"
EOF
sudo systemctl daemon-reload
sudo systemctl reload caddy
```

**This means everyone with access to your tailnet is effectively an
admin.** Tailscale ACLs are the source of truth for that set — if you
share tailnet access with anyone (family device, contractor, second
laptop), they get admin too. Tighten by tagging admin-capable devices
explicitly:

```jsonc
// Tailscale admin → Access Controls (ACL JSON)
{
  "tagOwners": {
    "tag:admin-device": ["your-email@example.com"]
  },
  "acls": [
    {
      "action": "accept",
      "src":    ["tag:admin-device"],
      "dst":    ["guru-web-prod:443"]
    }
    // …default deny everything else to guru-web-prod:443
  ]
}
```

Then assign `tag:admin-device` to specific machines in the Tailscale
admin → Machines view. Devices without that tag will fail to reach
the tailnet hostname at the network level, before Caddy even sees
the connection.

The `ADMIN_USER_IDS` env var in `/etc/guru-web.env` is **vestigial**
post-cutover — `requireAdmin()` no longer reads it. Safe to remove
on next env edit (no app reload required just to drop a stale line).

### Prereqs

- Tailscale running on the VPS (already true post-bootstrap).
- VPS node's MagicDNS hostname is `guru-web-prod`. Verify with
  `tailscale status | head -1` — the first column is the hostname.
- The Caddy `caddy` group exists (created by the Caddy package).
- **MagicDNS is enabled tailnet-wide.** Tailscale admin → DNS →
  scroll down → MagicDNS section → Enable. If the toggle is greyed
  out, set a global nameserver first (e.g. `1.1.1.1`) and the
  toggle becomes active. `tailscale cert` will succeed without this
  (cert issuance goes via the control plane, not DNS), but no
  device will be able to *resolve* the tailnet hostname until
  MagicDNS is on. Verify after toggling:

  ```bash
  tailscale dns status   # bottom should say "MagicDNS: enabled tailnet-wide"
  ```

- **Tailnet suffix matches the Caddyfile.** The repo hardcodes
  `tailb5626e.ts.net` as the suffix. If you're deploying onto a
  different tailnet, find your suffix and substitute it in three
  places before running the install steps:

  ```bash
  tailscale dns status | grep MagicDNSSuffix   # or check `tailscale status --json | jq '.MagicDNSSuffix'`
  ```

  Then `sed` it across the files: `deploy/Caddyfile`,
  `deploy/tailnet-cert-renew.sh`, and any reference in this
  runbook. (Future follow-up: read the suffix from
  `tailscale status --json` at install time so this doesn't
  require a code edit.)

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

If the tailnet curl returns `000` (no connection at all), it's
almost always one of three things — see "Device-side DNS" below.

### Device-side DNS

The tailnet hostname only resolves on devices that route DNS
queries to Tailscale's resolver at `100.100.100.100`. This works
out of the box on most platforms but can quietly fail on Linux.
Diagnostic ladder:

```bash
# 1. Tailscale connected?
tailscale status | head -3

# 2. MagicDNS resolver reachable?  (queries 100.100.100.100 directly)
nslookup guru-web-prod.tailb5626e.ts.net 100.100.100.100
#  → Address: 100.x.y.z   means Tailscale knows the name
#  → NXDOMAIN              means MagicDNS isn't enabled — see Prereqs

# 3. System resolver actually using Tailscale's resolver?
getent hosts guru-web-prod.tailb5626e.ts.net
#  → returns IP   working
#  → empty        system resolver doesn't include 100.100.100.100
```

If step 2 works but step 3 doesn't, the OS is the problem. Two
common cases:

- **Linux without `systemd-resolved`** (Arch with no resolved
  service, minimal containers). Tailscale's standard integration
  hooks systemd-resolved; without it, glibc's resolver doesn't see
  Tailscale's nameserver.

  Fix — pick one:

  ```bash
  # Preferred: enable systemd-resolved + symlink resolv.conf.
  sudo systemctl enable --now systemd-resolved
  sudo ln -sf /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf
  sudo systemctl restart tailscaled

  # Hack: just prepend Tailscale's resolver to /etc/resolv.conf.
  #   nameserver 100.100.100.100
  # Reverts the next time something rewrites resolv.conf.

  # One-shot for a single device, no DNS work needed:
  echo '100.x.y.z guru-web-prod.tailb5626e.ts.net' | sudo tee -a /etc/hosts
  # Use the IP from step 2.  Survives reboots.  Doesn't pick up
  # Tailscale IP changes — fine for a stable VPS.
  ```

- **macOS / iOS / Android with the Tailscale app paused.** The OS
  resolver routes via Tailscale only while the app is connected.
  Reconnect and retry.

The negative resolve gets cached, so after fixing the resolver:

```bash
sudo resolvectl flush-caches   # systemd-resolved
# or just open a new terminal / browser private window
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

## Pricing sync

`scripts/sync-pricing.ts` keeps the `model_pricing` table current
against the live OpenRouter rates. The live query path
(`/api/query` → `computeCost`) **throws** if no pricing row covers
the resolved model — so this script must run before any new model
id is reachable from the picker. Spec:
`docs/model-selection/BRD-model-selection.md` §8.

Three layers:

1. **Daily systemd timer** — drift catcher (this section).
2. **PR-time sync** — operator runs `npm run sync-pricing` against
   prod before merging a `CURATED_MODELS` bump. See the
   model-selection runbook below.
3. **CI guard** — `src/__tests__/curated-models-coverage.test.ts`
   fails the build if a slug lacks a `FALLBACK_PRICING` entry.
   Catches "I forgot the fallback" at PR review time.

### Install

One-time hand-patch on the VPS, mirroring the tailnet-cert-renew
install. As root:

```bash
ssh root@guru-web-prod
SHA=$(ls -1t /srv/guru-web/releases | head -1)
install -m 0755 /srv/guru-web/releases/$SHA/deploy/sync-pricing-runner.sh \
                /usr/local/bin/sync-pricing
install -m 0644 /srv/guru-web/releases/$SHA/deploy/sync-pricing.service \
                /etc/systemd/system/sync-pricing.service
install -m 0644 /srv/guru-web/releases/$SHA/deploy/sync-pricing.timer \
                /etc/systemd/system/sync-pricing.timer

# First run via systemd to validate. Don't run /usr/local/bin/sync-pricing
# directly under `sudo -u guru` — /etc/guru-web.env is mode 600
# root:guru so the `guru` user can't read it without going through
# systemd's EnvironmentFile resolution. The wrapper would fail with
# "DATABASE_URL is not set" because the env file never loads.
systemctl daemon-reload
systemctl start sync-pricing
journalctl -u sync-pricing -n 30 --no-pager
# Expect a final line like '[sync-pricing] done: seeded=N updated=M
# unchanged=K'.

systemctl enable --now sync-pricing.timer
systemctl list-timers sync-pricing.timer    # confirm active
```

### Validation

After enabling, the next scheduled run logs to journald:

```bash
journalctl -u sync-pricing -n 50 --no-pager
# Expect a final line like:
#   [sync-pricing] done: seeded=N updated=M unchanged=K
```

`seeded` = first time we've seen this model id; `updated` = price
changed on OpenRouter side; `unchanged` = no-op (the typical
case).

### Manual run

```bash
sudo systemctl start sync-pricing
journalctl -u sync-pricing -n 30 --no-pager
```

Idempotent. Safe to re-run.

Don't bypass systemd with `sudo -u guru /usr/local/bin/sync-pricing`:
that path skips the `EnvironmentFile=/etc/guru-web.env` directive
(systemd reads the env file as root and injects into the service
running as `guru`; a direct shell invocation runs without the env
loaded and fails with "DATABASE_URL is not set"). The env file is
mode 600 root:guru so the `guru` user can't read it directly.

### Failure modes

- **OpenRouter unreachable** — falls back to `FALLBACK_PRICING` in
  `scripts/sync-pricing.ts` for the curated models only. Other ids
  not in fallback get skipped. The next successful network sync
  fills them in.
- **Timer silently failing** — `systemctl list-timers
  sync-pricing.timer` is the diagnostic surface. If `LAST` is more
  than a few days old, look at the journal.
- **`/api/query` 500s with "No model_pricing row for X"** —
  pricing for X is missing. Either OpenRouter never had it
  (verify with `curl https://openrouter.ai/api/v1/models | jq
  '.data[].id' | grep X`), or sync hasn't run. Manual sync should
  fix it; if not, the model id is dead and `CURATED_MODELS` needs
  to be bumped to a live one.

---

## Admin UI runbook

The admin UI is the read-only observability surface at
`https://guru-web-prod.tailb5626e.ts.net/admin` (overview, users,
sessions, queries). Spec: `docs/admin-ui/BRD-admin-ui.md`.

This section covers the operator actions that aren't covered above
(tailnet ingress) or below (lessons-learned). Quick links:

- Bring the listener up: see "Tailnet admin listener" above.
- Add or remove an admin: below.
- Reach the admin UI from a device: below.
- Audit who can see the admin UI: below.
- Smoke-check after a deploy: below.

### Add or remove an admin

Admin identity is an env var, not a DB column or Clerk metadata.
Spec: BRD-admin-ui §1.1.

```bash
ssh root@guru-web-prod
$EDITOR /etc/guru-web.env
# Find the line:
#   ADMIN_USER_IDS=user_xxx,user_yyy
# Add or remove a Clerk user ID. Order doesn't matter; whitespace is
# tolerated. Empty value (or unset) → admin surface is closed.

systemctl restart guru-web
```

To find a Clerk user ID, the easiest path is the Clerk dashboard
(Users → click user → ID copy button) or `psql`:

```bash
sudo -u guru psql -d guru -c "SELECT id, email FROM users WHERE email = 'op@example.com';"
```

The deploy is the audit trail for this: there's no add-admin button,
and rotating an admin requires a deploy on purpose. The forcing
function is the point — adding the second admin should make you stop
and ask "do I actually want a second admin."

### Reach the admin UI

From any device on your tailnet (laptop, phone with the Tailscale app
connected):

```
https://guru-web-prod.tailb5626e.ts.net/admin
```

If the device isn't on the tailnet, it can't resolve the hostname.
That's correct behaviour. Connect Tailscale and retry.

If Tailscale itself is down, there is **no** admin UI access by
design. The fallback for genuine emergencies (kill-switch, manual
mutation) is `ssh root@guru-web-prod` + `psql -U guru -d guru`. Same
path used for any mutation outside this UI; see also
"Recovery — Tailscale down, can't reach admin UI" above.

Session ceiling: admin sessions older than 1 hour bounce to
`/sign-in`. After re-auth you're returned to whatever admin URL you
came from. This is enforced by `src/middleware.ts` against the
session token's `iat` claim. Spec: BRD-admin-ui §1.13.

### Tailscale ACL state — audit who can see admin

The tailnet listener trusts MagicDNS resolution: any device on this
tailnet can reach `guru-web-prod.tailb5626e.ts.net:443`. There's no
in-app fence beyond `ADMIN_USER_IDS`, so device sprawl on the tailnet
matters. Audit periodically.

```
Tailscale admin console → Machines tab.
```

Things to look for:
- Devices you don't recognise. Each device that can resolve the
  tailnet hostname can attempt the TLS handshake and reach Caddy.
  They still need a session in `ADMIN_USER_IDS` to get past Next,
  but the layered model means device hygiene matters.
- Expired or about-to-expire node keys. The VPS itself should have
  expiry disabled (see "Lessons learned"); other devices should
  rotate normally.
- Stale auth keys (Settings → Keys). Revoke any unused ones.

If a device should not be able to reach the admin listener:

- Remove the device from the tailnet (Machines tab → ⋯ → Delete).
- Or refine the Tailscale ACL to deny that device's tag from
  reaching the VPS on port 443. The default policy is "everyone on
  the tailnet can reach everyone"; tightening to "only `tag:admin`
  devices reach the VPS:443" is a one-line ACL change in the
  admin console.

### Post-deploy smoke checks

Run after every deploy that touched the admin surface. Spec:
BRD-admin-ui §1.17.

```bash
# 1. Public listener rejects /admin with a Next-shape 404 (not bare Caddy).
curl -sS -o /dev/null -w "%{http_code}\n" https://guru-ai.org/admin/
# → 404
curl -sS -o /dev/null -w "%{http_code}\n" https://guru-ai.org/api/admin/overview
# → 404

# 2. Tailnet listener serves the admin surface.
#    From a tailnet device:
curl -sS -o /dev/null -w "%{http_code}\n" \
  https://guru-web-prod.tailb5626e.ts.net/admin
# → 200 if you're an admin and your session is fresh; 404 otherwise.

# 3. /api/admin/overview round-trip (browser cookie or session token in headers).
#    Open /admin in the browser and check the network tab — every
#    /api/admin/* request should be 200 to admins, 404 to non-admins.
```

Failure modes mapped to fixes:

| Symptom                                              | Likely cause                              | Fix                                                            |
|------------------------------------------------------|-------------------------------------------|-----------------------------------------------------------------|
| Public `/admin/` returns 200 instead of 404          | `@admin` matcher missing from Caddyfile   | Compare to repo Caddyfile, restore, `caddy validate && reload`  |
| Tailnet hostname returns TLS error                   | Cert expired / renewal failing            | "Recovery — admin UI returns TLS error" above                   |
| Admin UI returns 404 even for an admin               | `ADMIN_USER_IDS` unset or wrong           | Edit `/etc/guru-web.env`, `systemctl restart guru-web`          |
| Session-age redirect after <1h                       | Server clock drift                        | `timedatectl status`; fix NTP                                   |

### Cross-references

- Tailnet cert renewal: "Tailnet admin listener" above (§0.3 of
  BRD-admin-ui).
- Migration 008 indexes: applied automatically by `deploy.sh` on the
  next deploy after merge. Re-running is the test (`IF NOT EXISTS`).
- Soft-delete of users / quota resets / tier flips / corpus content
  removal: deliberately not in the admin UI. See the deferred
  `BRD-operator-mutations.md` for psql snippets when those land.

---

## Bumping a curated model (slug rollover)

`CURATED_MODELS` in `src/lib/model.ts` is the source of truth for
which OpenRouter id each provider slug points at. Bumping an entry
is how we silently roll users forward when a new version ships
(e.g. Sonnet 4.6 → Sonnet 5). Spec:
`docs/model-selection/BRD-model-selection.md` §5.1, §8.2.

The throw-on-missing-pricing behaviour means this is a careful
sequence — skip a step and the next pro user query 500s. Process:

```bash
# 1. Confirm the new id exists on OpenRouter.
curl -sS https://openrouter.ai/api/v1/models | jq -r '.data[].id' | grep <pattern>

# 2. Edit src/lib/model.ts CURATED_MODELS — bump one entry.
$EDITOR src/lib/model.ts

# 3. Edit scripts/sync-pricing.ts FALLBACK_PRICING — add the new id
#    with current rates from OpenRouter (pull from the curl above).
#    The CI guard (curated-models-coverage.test.ts) fails without this.
$EDITOR scripts/sync-pricing.ts

# 4. Update docs/model-selection/BRD-model-selection.md §3 pricing
#    table to reflect the new pinned model.

# 5. Run sync against PROD DB before merging — seeds the new
#    model_pricing row so /api/query doesn't throw on first
#    user query post-deploy.
ssh root@guru-web-prod
sudo systemctl start sync-pricing
journalctl -u sync-pricing -n 20 --no-pager   # expect "seeded=1"

# 6. Open PR; merge after CI green.

# 7. Spot-check: hit /admin/users/<your-id> after a query, look at
#    the queries deep dive — model_used should be the new id with
#    a fresh pricing_effective_from in admin model_pricing table.
```

If you skip step 5 and merge: the daily sync timer catches it
within 24h, but until then the new picker option 500s on selection.
If you spot the issue, run sync manually on the VPS and the next
attempt succeeds.

### Cross-references

- Pricing sync (timer install + manual run): "Pricing sync" above.
- USD cap math + tier limits: BRD-model-selection §3, §6.2.
- Picker UX + chat attribution surface: BRD-model-selection §7.

---

## Lessons learned (gotchas to remember)

- **`MemoryDenyWriteExecute=true` breaks V8.** Don't add it back to the systemd unit. The other hardening directives are JIT-safe.
- **Caddy can't read 600 root:root files** — it runs as the `caddy` user. Origin key needs `640 root:caddy`, dir needs `755`.
- **AOP toggle is required, not optional.** Origin cert files alone aren't enough; CF won't present a client cert until you flip the toggle in the SSL/TLS → Origin Server tab.
- **Stripe + OpenAI SDK constructors throw on missing API keys at module load.** All clients in `src/lib/` and `src/app/api/` must use the lazy-init pattern (construct on first call inside a function, not at module top level), or `next build` fails during page-data collection.
- **Next.js standalone build excludes `scripts/` and `migrations/`.** Historical: that's why `deploy.sh` runs migrations from `$RELEASE/migrations/`. Moot twice over now — standalone output is off, and the CI tarball ships the whole workspace including `migrations/` — but the path stays `$RELEASE/migrations/` and works.
- **Cloudflare DNS records: never gray-cloud them**, even briefly. Once your origin IP is in passive DNS databases, it's there forever and the "only allow CF IPs on 443" model has a hole.
- **Tailscale node key expires every ~180 days by default.** Disable expiry on the VPS node in the admin console after bootstrap, or it'll silently fall off the tailnet.
- **Never run `deploy.sh` as plain `sudo`** — files created under that run end up root-owned, which the next prune can't remove (pre-tarball, git also refused with "dubious ownership"). Always `sudo -u deploy /srv/guru-web/deploy.sh <sha>`. The script now self-heals via `sudo chown -R deploy:deploy /srv/guru-web/releases` at the top, so existing root-owned damage gets fixed on the next deploy — but only if `/etc/sudoers.d/deploy` includes the new chown rule (added by `vps-bootstrap.sh`; existing VPSes need the one-time hand-patch below).

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

## Local manual deploy (deploy-local.sh)

`deploy/deploy-local.sh` ships a release from your workstation over the
tailnet, skipping the Actions queue. It is strictly additive — deploy.yml
stays canonical — and strictly manual: it stops at five gates (sudo
human-presence auth with the cached-timestamp escape closed, node parity
with deploy.yml's setup-node at the deployed sha, sha == origin/main, CI
green — the `check` run must have passed; the Actions `deploy` run is
excluded from the count but a deploy in flight is a refusal — and a typed
`deploy` confirmation). It builds in a detached worktree of the sha so
working-tree files can never leak into the artifact, re-runs the full
deploy.yml verify chain on that worktree (`npm audit signatures`, lint,
type-check, tests — on the runtime node major, which CI's node-22 run
doesn't cover), and keeps the fetched env + tarball in a 0700 staging dir
outside the build tree so neither can ship in or linger after a crash.

One-time setup:
1. `~/.ssh/config` entry (your key, not the CI secret):
   ```
   Host guru-web-prod
     User deploy
     IdentityFile ~/.ssh/id_ed25519
   ```
2. Authorize that key on the VPS: append its .pub to
   `/home/deploy/.ssh/authorized_keys` (via your admin access).
3. `nvm install 20` — the script refuses any major other than the one
   deploy.yml's setup-node pins (currently 20; parsed at run time from the
   deployed sha, so this stays correct across VPS runtime bumps).

Then: `deploy/deploy-local.sh` (optionally `DEPLOY_HOST=<alias>`).
