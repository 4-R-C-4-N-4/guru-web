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
#
# Self-updating: after fetching the new release, this script compares
# itself to $RELEASE/deploy/deploy.sh and re-execs with the repo version
# if they differ.  That means changes to deploy.sh in the repo take
# effect on the *first* deploy after the change — no need to re-run
# vps-bootstrap.sh just to push a deploy-script update.

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

# 0. Self-heal ownership in case a prior run left root-owned files in
#    releases/ (e.g., emergency `sudo /srv/guru-web/deploy.sh` instead of
#    `sudo -u deploy …`). chown is idempotent — no-op when ownership is
#    already correct. The `|| true` lets the deploy proceed even on a VPS
#    where /etc/sudoers.d/deploy hasn't been patched yet for this rule;
#    we just lose self-heal until the operator updates sudoers.
log "self-heal ownership"
sudo /bin/chown -R deploy:deploy "$ROOT/releases" || true

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

# 1a. Self-update.  vps-bootstrap.sh installs deploy.sh once and never
# refreshes it, so changes to deploy/deploy.sh in the repo wouldn't reach
# the VPS without this — every CI deploy would keep running the
# bootstrap-era script.  After fetching the new release, compare its
# deploy.sh against $0; if they differ, copy it over and re-exec so this
# run uses the new logic.  The re-exec lands here again, finds the files
# identical, and proceeds — no infinite loop.
SELF="$(readlink -f "$0")"
NEW_SCRIPT="$RELEASE/deploy/deploy.sh"
if [[ -f "$NEW_SCRIPT" ]] && ! cmp -s "$SELF" "$NEW_SCRIPT"; then
    log "deploy.sh changed in repo — refreshing $SELF and re-execing"
    cp "$NEW_SCRIPT" "$SELF"
    chmod +x "$SELF"
    exec "$SELF" "$@"
fi

# 2. Install prod deps + build.
#
# `next build` bakes NEXT_PUBLIC_* into the client bundle. Those vars must
# be in env at build time — systemd's EnvironmentFile only feeds the
# runtime process, not this build step. They live in
# /etc/guru-web.public.env (mode 0644 — values are public anyway, they
# ship in client JS) so the `deploy` user can read them without needing
# read access to the secrets file (/etc/guru-web.env, mode 0600 root:guru).
#
# Bundler / output mode (post 2026-05-10 admin-on-tailnet outage):
# - Build runs `next build --webpack`. Next 16's Turbopack does not
#   reliably compile src/middleware.ts — the deployed manifest came
#   back with a Clerk-default matcher even when our source had custom
#   exclusions, and Turbopack treats proxy.ts as an SSR module rather
#   than installing it as middleware. Webpack handles middleware.ts
#   correctly. The flag is wired in package.json's "build" script.
# - `output: "standalone"` is removed from next.config.ts — the
#   standalone collector is incompatible with the proxy.ts convention
#   (ENOENT on middleware.js.nft.json), and we don't need it now that
#   the runtime tree is the whole release dir.
log "npm ci + build"
cd "$RELEASE"
if [[ ! -r /etc/guru-web.public.env ]]; then
    echo "deploy.sh: /etc/guru-web.public.env not readable — NEXT_PUBLIC_* would compile to empty strings" >&2
    exit 1
fi
set -a
# shellcheck disable=SC1091
source /etc/guru-web.public.env
set +a
npm ci
npm run build

# 3. Apply app-schema migrations BEFORE swapping the symlink. If a migration
#    fails the old release stays live. Each file runs in a single transaction
#    (-1) so partial application is impossible. Migrations use IF NOT EXISTS
#    patterns so re-running on an already-migrated DB is a no-op.
#
#    Run as the `guru` postgres role (peer auth — the guru OS user maps to
#    the guru DB role).  guru owns the database (CREATE DATABASE guru OWNER
#    guru in vps-bootstrap.sh), so newly-created tables are owned by guru
#    automatically — no SET ROLE needed.
#
#    This used to run as the postgres superuser with a SET ROLE guru prefix.
#    That gave the migration runner full DDL/DML on every schema (corpus
#    included) for no reason; switching to guru directly keeps the blast
#    radius limited to what guru can already do at runtime.  todo:d5b272a3
#
#    Scope: app tables only (users, sessions, queries, user_preferences,
#    quota, rate_limits).  Never touches corpus tables — those come from
#    guru-pipeline's pg_restore separately.
log "apply migrations"
shopt -s nullglob
for f in "$RELEASE"/migrations/*.sql; do
    log "  → $(basename "$f")"
    # -v ON_ERROR_STOP=1 makes psql exit non-zero on the first SQL error.
    # Without it psql exits 0 even when the transaction (-1) rolled back —
    # set -e doesn't catch silent migration failures, and you find out
    # weeks later that an index never got created (todo:df25768e).
    sudo -u guru /usr/bin/psql -d guru -1 -v ON_ERROR_STOP=1 < "$f"
done
shopt -u nullglob

# 4. Atomic symlink swap. `current` points at the release dir; the
# systemd unit runs `next start` from there using the in-tree
# node_modules/.bin/next binary.
log "symlink swap"
ln -sfn "$RELEASE" "$CURRENT.new"
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
