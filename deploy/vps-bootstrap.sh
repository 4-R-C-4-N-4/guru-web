#!/usr/bin/env bash
#
# deploy/vps-bootstrap.sh — one-time VPS setup for guru-web.
#
# Target:       Debian 13 (trixie) on Hetzner, kernel 6.12+, ~8GB RAM tier.
# Source spec:  §7.4 of docs/guru-v2-proposal-revised.md
# Idempotency:  per-step guards; safe to re-run on incident rebuilds.
#
# PREREQUISITES (manual, before running):
#
#   1. You can SSH in as root via key auth (Hetzner provisions this at create).
#
#   2. /etc/guru-bootstrap.env exists, mode 0600, root:root, containing:
#
#        DOMAIN=guru.example.com
#        TS_AUTHKEY=tskey-auth-xxxxxxxxxxxxxxxxxxxxxx
#        DEPLOY_PUBKEY="ssh-ed25519 AAAA... github-actions@guru"   # optional
#
#      TS_AUTHKEY: generate in Tailscale admin console as non-reusable,
#      non-ephemeral, pre-authorized. Remember to disable key expiry for the
#      node after it joins.
#
#   3. Cloudflare zone configured: DNS record proxied (orange), SSL/TLS mode
#      Full (Strict), Authenticated Origin Pulls toggle ON at the zone level
#      (SSL/TLS → Origin Server → Authenticated Origin Pulls). Without the
#      toggle CF won't present a client cert and Caddy will drop the
#      handshake → 520 at the edge.
#
#   4. Cloudflare Origin Certificate generated and the three files placed at:
#        - /etc/ssl/cloudflare/origin.pem                          (CF-issued cert)
#        - /etc/ssl/cloudflare/origin.key                          (matching private key)
#        - /etc/ssl/cloudflare/authenticated_origin_pull_ca.pem    (AOP CA bundle, fetch from
#          https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem)
#
#      The script sets ownership + permissions automatically (dir 755, pem/CA
#      644 root:root, key 640 root:caddy so the caddy user can read it).
#      If files are missing the script completes anyway but Caddy won't start
#      until they're in place.
#
# NOT DONE BY THIS SCRIPT:
#   - Loading the corpus (guru-pipeline produces guru-corpus.sql.gz — restore
#     is a separate manual step once the DB is set up).
#   - First deploy of the app (handled by deploy/deploy.sh, invoked from CI).
#   - Creating /etc/guru-web.env (holds runtime secrets — hand-populated).

set -euo pipefail

# ---------------------------------------------------------------------------
# Config + preflight
# ---------------------------------------------------------------------------

CONFIG=/etc/guru-bootstrap.env

if [[ $EUID -ne 0 ]]; then
    echo "bootstrap: must run as root" >&2
    exit 1
fi

if [[ ! -f "$CONFIG" ]]; then
    cat >&2 <<EOF
bootstrap: $CONFIG not found. Create it first:

  cat > $CONFIG <<'E'
  DOMAIN=guru.example.com
  TS_AUTHKEY=tskey-auth-xxxxxxxxxxxxxxxxxxxxxxxx
  # DEPLOY_PUBKEY="ssh-ed25519 AAAA... github-actions@guru"
  E
  chmod 600 $CONFIG

EOF
    exit 1
fi

# shellcheck source=/dev/null
source "$CONFIG"

: "${DOMAIN:?DOMAIN required in $CONFIG}"
: "${TS_AUTHKEY:?TS_AUTHKEY required in $CONFIG}"

REPO_DIR="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!! \033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m!! \033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Steps
# ---------------------------------------------------------------------------

step_os_update() {
    log "apt update + upgrade"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get -y -o Dpkg::Options::="--force-confold" upgrade
}

step_base_packages() {
    log "base packages"
    apt-get install -y \
        ufw fail2ban unattended-upgrades \
        curl git ca-certificates gnupg lsb-release \
        cron sudo openssl
}

step_unattended_upgrades() {
    log "unattended-upgrades"
    cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
}

step_timezone() {
    log "timezone UTC"
    timedatectl set-timezone UTC
}

step_swap() {
    log "swap (2GB)"
    if ! grep -q '^/swapfile' /etc/fstab; then
        if [[ ! -f /swapfile ]]; then
            fallocate -l 2G /swapfile
            chmod 600 /swapfile
            mkswap /swapfile
            swapon /swapfile
        fi
        echo '/swapfile none swap sw 0 0' >> /etc/fstab
    fi
}

step_ssh_harden() {
    log "SSH hardening (drop-in)"
    cat > /etc/ssh/sshd_config.d/99-guru.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
    sshd -t
    systemctl reload ssh
}

step_tailscale() {
    log "Tailscale"
    if ! command -v tailscale &>/dev/null; then
        curl -fsSL https://tailscale.com/install.sh | sh
    fi
    if ! tailscale status --json 2>/dev/null | grep -q '"BackendState":"Running"'; then
        tailscale up --authkey="$TS_AUTHKEY" --hostname=guru-web-prod --ssh=false
    fi
    # Wait briefly for tailscale0 to appear before firewall step uses it
    for _ in 1 2 3 4 5; do
        ip link show tailscale0 &>/dev/null && break
        sleep 1
    done
}

step_firewall() {
    # `ufw allow` is naturally idempotent (existing rules are skipped with a
    # message). Earlier versions of this script had a "skip if tailscale0 rule
    # exists" guard that was too coarse — it caused the CF 443 rules to be
    # silently skipped on boxes where the operator had set up tailnet SSH
    # manually before running bootstrap. Now: just always apply.
    log "ufw (deny default, SSH via tailnet, 443 from Cloudflare)"
    ufw default deny incoming  >/dev/null
    ufw default allow outgoing >/dev/null
    ufw allow in on tailscale0 to any port 22 proto tcp comment 'SSH via tailnet' >/dev/null
    for ip in $(curl -fsSL https://www.cloudflare.com/ips-v4); do
        ufw allow from "$ip" to any port 443 proto tcp comment 'cloudflare-v4' >/dev/null
    done
    # IPv6 list may be empty on a v4-only box; harmless if so.
    for ip in $(curl -fsSL https://www.cloudflare.com/ips-v6 || true); do
        ufw allow from "$ip" to any port 443 proto tcp comment 'cloudflare-v6' >/dev/null
    done
    ufw --force enable >/dev/null
    ufw reload >/dev/null
}

step_node() {
    log "Node.js 20 LTS (NodeSource)"
    if ! command -v node &>/dev/null || [[ $(node -v | sed 's/v//;s/\..*//') -lt 20 ]]; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
    fi
}

step_postgres() {
    log "Postgres 17 + pgvector (PGDG APT)"
    if ! dpkg -l postgresql-17 &>/dev/null 2>&1; then
        install -d -m 0755 /etc/apt/keyrings
        curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
            | gpg --dearmor -o /etc/apt/keyrings/pgdg.gpg
        echo "deb [signed-by=/etc/apt/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
            > /etc/apt/sources.list.d/pgdg.list
        apt-get update
        apt-get install -y postgresql-17 postgresql-17-pgvector
    fi
    systemctl enable --now postgresql

    local pw_file=/etc/guru-db-password
    if [[ ! -f "$pw_file" ]]; then
        openssl rand -base64 32 | tr -d '\n=+/' > "$pw_file"
        chmod 600 "$pw_file"
    fi
    local pw
    pw="$(cat "$pw_file")"

    sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='guru'" | grep -q 1 \
        || sudo -u postgres psql -c "CREATE ROLE guru WITH LOGIN PASSWORD '$pw'"
    sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='guru'" | grep -q 1 \
        || sudo -u postgres psql -c "CREATE DATABASE guru OWNER guru"
    sudo -u postgres psql -d guru -c "CREATE EXTENSION IF NOT EXISTS vector"

    # Debian's Postgres defaults: listen on localhost only, scram-sha-256 for
    # host 127.0.0.1/32 via pg_hba.conf. No config edits needed.
}

step_caddy() {
    log "Caddy (cloudsmith APT)"
    if ! dpkg -l caddy &>/dev/null 2>&1; then
        apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
            | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
            > /etc/apt/sources.list.d/caddy-stable.list
        apt-get update
        apt-get install -y caddy
    fi

    # Inject DOMAIN into caddy's systemd env (Caddyfile uses {$DOMAIN})
    install -d -m 0755 /etc/systemd/system/caddy.service.d
    cat > /etc/systemd/system/caddy.service.d/env.conf <<EOF
[Service]
Environment="DOMAIN=$DOMAIN"
EOF

    install -m 0644 "$REPO_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile

    # Cert dir + perms. Caddy runs as user `caddy`, so it needs to traverse
    # the directory (755) and read all three files. The key is the only
    # secret of the three — set group caddy + 640 so the process can read
    # but other unprivileged users can't.
    mkdir -p /etc/ssl/cloudflare
    chmod 0755 /etc/ssl/cloudflare
    chown root:root /etc/ssl/cloudflare

    local missing=0
    for f in origin.pem origin.key authenticated_origin_pull_ca.pem; do
        if [[ ! -f "/etc/ssl/cloudflare/$f" ]]; then
            warn "/etc/ssl/cloudflare/$f missing — place it before starting Caddy"
            missing=1
        fi
    done

    if [[ -f /etc/ssl/cloudflare/origin.pem ]]; then
        chown root:root /etc/ssl/cloudflare/origin.pem
        chmod 0644      /etc/ssl/cloudflare/origin.pem
    fi
    if [[ -f /etc/ssl/cloudflare/authenticated_origin_pull_ca.pem ]]; then
        chown root:root /etc/ssl/cloudflare/authenticated_origin_pull_ca.pem
        chmod 0644      /etc/ssl/cloudflare/authenticated_origin_pull_ca.pem
    fi
    if [[ -f /etc/ssl/cloudflare/origin.key ]]; then
        chown root:caddy /etc/ssl/cloudflare/origin.key
        chmod 0640       /etc/ssl/cloudflare/origin.key
    fi

    systemctl daemon-reload
    systemctl enable caddy
    if [[ $missing -eq 0 ]]; then
        systemctl reload caddy 2>/dev/null || systemctl restart caddy
    else
        warn "skipping caddy start — origin cert files missing"
    fi
}

step_ollama() {
    log "Ollama (loopback-only, nomic-embed-text:v1.5)"
    if ! command -v ollama &>/dev/null; then
        curl -fsSL https://ollama.com/install.sh | sh
    fi
    systemctl disable --now ollama 2>/dev/null || true
    install -m 0644 "$REPO_DIR/deploy/ollama.service" /etc/systemd/system/ollama.service
    systemctl daemon-reload
    systemctl enable --now ollama

    sudo -u ollama ollama pull nomic-embed-text:v1.5

    sleep 2
    if ! curl -fs http://127.0.0.1:11434/api/tags | grep -q 'nomic-embed-text'; then
        die "Ollama not serving embedding model — check 'systemctl status ollama' and 'journalctl -u ollama -n 50'"
    fi
}

step_app_users_and_dirs() {
    log "guru + deploy users, /srv/guru-web structure"

    if ! id guru &>/dev/null; then
        useradd --system --no-create-home --shell /usr/sbin/nologin guru
    fi

    if ! id deploy &>/dev/null; then
        useradd --system --create-home --home-dir /home/deploy --shell /bin/bash deploy
    fi

    # Minimal sudo for deploy.sh — restart the app + run app-schema migrations.
    # The psql entry is gated to -d guru (won't open other DBs) and -f (file
    # input only, no inline -c) so blast radius is "the deploy user can apply
    # arbitrary SQL files to the guru DB as the postgres superuser." That's
    # already implied by the deploy user's ability to run npm-built code that
    # connects to the DB — making it explicit here for migrations.
    cat > /etc/sudoers.d/deploy <<'EOF'
deploy ALL=(root) NOPASSWD: /bin/systemctl restart guru-web, /bin/systemctl status guru-web
deploy ALL=(postgres) NOPASSWD: /usr/bin/psql -d guru -1 -f *
EOF
    chmod 440 /etc/sudoers.d/deploy

    if [[ -n "${DEPLOY_PUBKEY:-}" ]]; then
        install -d -o deploy -g deploy -m 0700 /home/deploy/.ssh
        printf '%s\n' "$DEPLOY_PUBKEY" \
            | install -o deploy -g deploy -m 0600 /dev/stdin /home/deploy/.ssh/authorized_keys
    else
        warn "DEPLOY_PUBKEY not set in $CONFIG — CI will not be able to SSH in as deploy until you add its public key to /home/deploy/.ssh/authorized_keys."
    fi

    install -d -o deploy -g deploy -m 0755 /srv/guru-web
    install -d -o deploy -g deploy -m 0755 /srv/guru-web/releases

    # Install deploy.sh as a fixed surface at /srv/guru-web/deploy.sh.
    # CI invokes `./deploy.sh <sha>` from /srv/guru-web/ on each push; this
    # script doesn't change between deploys (only when bootstrap re-runs).
    if [[ -f "$REPO_DIR/deploy/deploy.sh" ]]; then
        install -o deploy -g deploy -m 0755 \
            "$REPO_DIR/deploy/deploy.sh" /srv/guru-web/deploy.sh
    else
        warn "deploy/deploy.sh not present yet (D13) — CI deploys will fail until installed"
    fi
}

step_systemd_unit() {
    log "guru-web systemd unit"
    install -m 0644 "$REPO_DIR/deploy/guru-web.service" /etc/systemd/system/guru-web.service
    systemctl daemon-reload
    systemctl enable guru-web
    # Don't start — /srv/guru-web/current doesn't exist until first deploy.
    warn "guru-web.service enabled but NOT started — first CI deploy will start it."
}

step_backups() {
    log "Backblaze B2 backup cron"
    if [[ ! -f "$REPO_DIR/deploy/backup.sh" ]]; then
        warn "deploy/backup.sh not present yet — skipping cron install"
        return
    fi

    # Install b2 CLI via pipx (system package python3-b2sdk doesn't ship the
    # CLI; pipx is the cleanest way to get the latest 'b2' command available
    # to root for cron.daily). Idempotent: skips if already installed.
    apt-get install -y pipx
    if ! command -v b2 &>/dev/null; then
        pipx install --global b2
    fi

    install -m 0755 "$REPO_DIR/deploy/backup.sh" /etc/cron.daily/guru-backup

    if [[ ! -f /etc/backup-b2.env ]]; then
        warn "/etc/backup-b2.env not present — backups will fail until you create it. Required keys:"
        warn "  B2_ACCOUNT_ID=..."
        warn "  B2_APPLICATION_KEY=..."
        warn "  B2_BUCKET=..."
        warn "  (chmod 600 /etc/backup-b2.env, chown root:root)"
        warn "Also: set a B2 bucket lifecycle rule to keep prior versions ~30 days."
    fi
}

step_summary() {
    log "summary"
    echo
    echo "  Debian:       $(lsb_release -ds)"
    echo "  Node:         $(node -v)"
    echo "  Postgres:     $(sudo -u postgres psql -tAc 'SELECT version()' | head -1 | awk '{print $1, $2}')"
    echo "  Caddy:        $(caddy version 2>/dev/null | head -1)"
    echo "  Ollama:       $(ollama --version 2>/dev/null | head -1)"
    echo "  Tailscale:    $(tailscale --version | head -1) — tailnet IP: $(tailscale ip -4)"
    echo
    echo "  DB password:  /etc/guru-db-password (mode 600)"
    echo "  DATABASE_URL: postgresql://guru:$(cat /etc/guru-db-password)@localhost:5432/guru"
    echo
    echo "  UFW:"
    ufw status verbose | sed 's/^/    /'
    echo
    echo "  See deploy/README.md for post-bootstrap checklist (origin certs, /etc/guru-web.env, corpus load, first deploy)."
}

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

step_os_update
step_base_packages
step_unattended_upgrades
step_timezone
step_swap
step_ssh_harden
step_tailscale
step_firewall
step_node
step_postgres
step_caddy
step_ollama
step_app_users_and_dirs
step_systemd_unit
step_backups
step_summary
