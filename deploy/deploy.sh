#!/usr/bin/env bash
#
# deploy/deploy.sh — VPS-side deploy script (per §7.8).
#
# Invoked from CI as:    /srv/guru-web/deploy.sh <git-sha>
# Runs as user `deploy`. Needs sudo to restart guru-web (granted by
# /etc/sudoers.d/deploy, installed by vps-bootstrap.sh).
#
# Behaviour: idempotent, atomic-ish (symlink swap), keeps last 5 releases
# for rollback.

set -euo pipefail

if [[ $# -ne 1 ]]; then
    echo "usage: deploy.sh <git-sha>" >&2
    exit 1
fi

SHA="$1"
ROOT=/srv/guru-web
RELEASE="$ROOT/releases/$SHA"
CURRENT="$ROOT/current"
REPO_URL=https://github.com/4-R-C-4-N-4/guru-web.git   # public clone, no auth needed

log() { printf '\n\033[1;34m==>\033[0m deploy.sh: %s\n' "$*"; }

# 1. Fetch the SHA into releases/<sha> (idempotent)
log "fetching $SHA"
if [[ -d "$RELEASE/.git" ]]; then
    git -C "$RELEASE" fetch --depth=1 origin "$SHA"
    git -C "$RELEASE" checkout --quiet "$SHA"
else
    git clone --depth=1 --no-single-branch "$REPO_URL" "$RELEASE"
    git -C "$RELEASE" fetch --depth=1 origin "$SHA"
    git -C "$RELEASE" checkout --quiet "$SHA"
fi

# 2. Install prod deps + build (Next.js standalone output → .next/standalone/)
log "npm ci + build"
cd "$RELEASE"
npm ci
npm run build

# Next.js standalone bundles only the necessary node_modules into
# .next/standalone/. The systemd unit's WorkingDirectory points at
# $CURRENT, with ExecStart=/usr/bin/node server.js — which lives at
# .next/standalone/server.js. Symlink that path so 'current' resolves
# correctly without changing the unit.
log "stage runtime tree"
# Copy static + public into standalone (Next.js standalone doesn't include them)
cp -a "$RELEASE/.next/static" "$RELEASE/.next/standalone/.next/static"
if [[ -d "$RELEASE/public" ]]; then
    cp -a "$RELEASE/public" "$RELEASE/.next/standalone/public"
fi

# 3. Apply app-schema migrations BEFORE swapping the symlink. If a migration
#    fails the old release stays live. Each file runs in a single transaction
#    (-1) so partial application is impossible. Migrations use IF NOT EXISTS
#    patterns so re-running on an already-migrated DB is a no-op.
#
#    Scope: app tables only (users, sessions, queries, user_preferences, quota).
#    Never touches corpus tables (chunks, traditions, texts, concepts, edges) —
#    those come from guru-pipeline's pg_restore separately.
log "apply migrations"
shopt -s nullglob
for f in "$RELEASE"/migrations/*.sql; do
    log "  → $(basename "$f")"
    sudo -u postgres /usr/bin/psql -d guru -1 -f "$f"
done
shopt -u nullglob

# 4. Atomic symlink swap. `current` points at the standalone dir so
# WorkingDirectory in the unit (/srv/guru-web/current) sees server.js.
log "symlink swap"
ln -sfn "$RELEASE/.next/standalone" "$CURRENT.new"
mv -Tf "$CURRENT.new" "$CURRENT"

# 5. Restart the app (sudoers permits this single command)
log "restart guru-web"
sudo /bin/systemctl restart guru-web

# Wait briefly + verify (is-active is a read-only query — no sudo needed,
# and adding it to sudoers just expands the attack surface.)
sleep 2
if ! /bin/systemctl is-active --quiet guru-web; then
    echo "deploy.sh: guru-web failed to start — check 'journalctl -u guru-web -n 50'" >&2
    exit 1
fi

# 6. Prune old releases — keep newest 5 by mtime
log "prune to last 5 releases"
cd "$ROOT/releases"
# shellcheck disable=SC2012
ls -1t | tail -n +6 | xargs -r -I{} rm -rf -- "{}"

log "done — $SHA live"
