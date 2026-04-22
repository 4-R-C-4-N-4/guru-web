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
| App env | `/etc/guru-web.env` (mode 600, root:root) |
| Bootstrap config | `/etc/guru-bootstrap.env` (mode 600, root:root) |
| Backup config | `/etc/backup-b2.env` (mode 600, root:root) |
| DB password | `/etc/guru-db-password` (mode 600, root:root) |
| TLS certs | `/etc/ssl/cloudflare/{origin.pem,origin.key,authenticated_origin_pull_ca.pem}` |
| Reverse proxy | Caddy, `/etc/caddy/Caddyfile` |
| Embeddings | Ollama on `127.0.0.1:11434`, model `nomic-embed-text:v1.5` |

SSH access is **tailnet only** — UFW closes public 22. Get on Tailscale, then `ssh root@guru-web-prod`. Break-glass: Hetzner web console.

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

- **`Failed to load environment files`** → `/etc/guru-web.env` missing or unreadable. Check `ls -la /etc/guru-web.env`. Should be `600 root:root`.
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
8. Create `/etc/guru-web.env` (mode 600) with runtime secrets — easiest path: scp from a known-good source.
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
- Update `/etc/guru-web.env`.
- `systemctl restart guru-web`.
- For Stripe + Clerk webhooks: also update the webhook endpoint's signing secret in the dashboard if you regenerated it; copy back to `/etc/guru-web.env`.

### Cloudflare Origin Certificate
Origin certs are 15-year by default — rotation is rare. If you do rotate:
- CF dashboard → SSL/TLS → Origin Server → "Create Certificate" → copy pem + key.
- Replace `/etc/ssl/cloudflare/{origin.pem,origin.key}` (re-apply perms: `chmod 644 origin.pem; chmod 640 origin.key; chown root:caddy origin.key`).
- `systemctl reload caddy`.
- Revoke the old cert in CF dashboard.

---

## Lessons learned (gotchas to remember)

- **`MemoryDenyWriteExecute=true` breaks V8.** Don't add it back to the systemd unit. The other hardening directives are JIT-safe.
- **Caddy can't read 600 root:root files** — it runs as the `caddy` user. Origin key needs `640 root:caddy`, dir needs `755`.
- **AOP toggle is required, not optional.** Origin cert files alone aren't enough; CF won't present a client cert until you flip the toggle in the SSL/TLS → Origin Server tab.
- **Stripe + OpenAI SDK constructors throw on missing API keys at module load.** All clients in `src/lib/` and `src/app/api/` must use the lazy-init pattern (construct on first call inside a function, not at module top level), or `next build` fails during page-data collection.
- **Next.js standalone build excludes `scripts/` and `migrations/`.** That's why `deploy.sh` runs migrations from `$RELEASE/migrations/` (the full clone) instead of from the symlinked `current` (the standalone subset).
- **Cloudflare DNS records: never gray-cloud them**, even briefly. Once your origin IP is in passive DNS databases, it's there forever and the "only allow CF IPs on 443" model has a hole.
- **Tailscale node key expires every ~180 days by default.** Disable expiry on the VPS node in the admin console after bootstrap, or it'll silently fall off the tailnet.
