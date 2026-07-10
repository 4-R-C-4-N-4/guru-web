#!/usr/bin/env bash
#
# deploy/deploy.sh — VPS-side deploy script (per §7.8).
#
# Invoked from CI as:    /srv/guru-web/deploy.sh <git-sha>
# Runs as user `deploy`. Needs sudo to restart guru-web (granted by
# /etc/sudoers.d/deploy, installed by vps-bootstrap.sh).
#
# Supply-chain posture (todo:3ec0c41d): the release arrives PRE-BUILT as a
# tarball from CI (deploy.yml packs source + pruned node_modules + .next and
# scps it to releases/.incoming/ over the tailnet). This script never talks
# to GitHub or the npm registry — it unpacks, migrates, swaps, restarts.
# There is deliberately NO fallback to git clone + npm ci: a missing tarball
# is a loud failure, not a quiet rebuild from the public internet.
#
# Behaviour: idempotent, atomic-ish (symlink swap), keeps last 5 releases
# for rollback (roll back with: ln -sfn releases/<old-sha> current && sudo
# systemctl restart guru-web).
#
# Self-updating: after unpacking the new release, this script compares
# itself to $RELEASE/deploy/deploy.sh and re-execs with the repo version
# if they differ.  That means changes to deploy.sh in the repo take
# effect on the *first* deploy after the change — no need to re-run
# vps-bootstrap.sh just to push a deploy-script update. (This is also the
# migration path that got us here: the last clone-based deploy.sh fetched
# the release, saw this file differ, and re-exec'd into it.)

set -euo pipefail

if [[ $# -ne 1 ]]; then
    echo "usage: deploy.sh <git-sha>" >&2
    exit 1
fi

SHA="$1"
ROOT=/srv/guru-web
RELEASE="$ROOT/releases/$SHA"
CURRENT="$ROOT/current"
INCOMING="$ROOT/releases/.incoming"
TARBALL="$INCOMING/release-$SHA.tar.gz"

log() { printf '\n\033[1;34m==>\033[0m deploy.sh: %s\n' "$*"; }

# 0. Self-heal ownership in case a prior run left root-owned files in
#    releases/ (e.g., emergency `sudo /srv/guru-web/deploy.sh` instead of
#    `sudo -u deploy …`). chown is idempotent — no-op when ownership is
#    already correct. The `|| true` lets the deploy proceed even on a VPS
#    where /etc/sudoers.d/deploy hasn't been patched yet for this rule;
#    we just lose self-heal until the operator updates sudoers.
log "self-heal ownership"
sudo /bin/chown -R deploy:deploy "$ROOT/releases" || true

# 1. Unpack the CI-built artifact into releases/<sha>.
#
#    Idempotent: wipe + re-extract. A retried deploy (or the self-update
#    re-exec below, or a leftover git clone from the pre-tarball flow)
#    leaves a partial/foreign $RELEASE — rm -rf guarantees the tree is
#    exactly the tarball's contents.
#
#    Deploying without CI (registry outage, lost artifact): build the
#    tarball anywhere with the same steps deploy.yml runs (npm ci, source
#    /etc/guru-web.public.env, npm run build, npm prune --omit=dev,
#    tar --exclude=.git -czf release-<sha>.tar.gz .) and scp it to
#    $INCOMING/ yourself, then re-run this script.
if [[ ! -f "$TARBALL" ]]; then
    echo "deploy.sh: $TARBALL not found — CI ships it before invoking this script." >&2
    echo "deploy.sh: no git/npm fallback by design (supply-chain hardening); see comment above for the manual path." >&2
    exit 1
fi
log "unpacking release-$SHA.tar.gz"
rm -rf "$RELEASE"
mkdir -p "$RELEASE"
tar -xzf "$TARBALL" -C "$RELEASE"

# 1a. Self-update.  vps-bootstrap.sh installs deploy.sh once and never
# refreshes it, so changes to deploy/deploy.sh in the repo wouldn't reach
# the VPS without this — every CI deploy would keep running the
# bootstrap-era script.  After unpacking the new release, compare its
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

# (No install/build step: the tarball already contains the production
# build. `next build` baked NEXT_PUBLIC_* into the client bundle in CI —
# deploy.yml fetches /etc/guru-web.public.env from this box first, so that
# file remains the single source of truth for those values. The bundler
# rationale — webpack over Turbopack, no standalone output — lives in
# package.json's build script comment history and deploy/README.md.)

# 2. Apply app-schema migrations BEFORE swapping the symlink. If a migration
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

# 3. Atomic symlink swap. `current` points at the release dir; the
# systemd unit runs `next start` from there using the in-tree
# node_modules/.bin/next binary.
log "symlink swap"
ln -sfn "$RELEASE" "$CURRENT.new"
mv -Tf "$CURRENT.new" "$CURRENT"

# 4. Restart the app (sudoers permits this single command)
log "restart guru-web"
sudo /bin/systemctl restart guru-web

# Wait briefly + verify (is-active is a read-only query — no sudo needed,
# and adding it to sudoers just expands the attack surface.)
sleep 2
if ! /bin/systemctl is-active --quiet guru-web; then
    echo "deploy.sh: guru-web failed to start — check 'journalctl -u guru-web -n 50'" >&2
    exit 1
fi

# 5. Clean up shipped tarballs — the unpacked releases/ dirs are the
# rollback surface, so consumed tarballs have no further use. Only after
# the restart verified, so a failed deploy keeps its tarball for retry.
log "clean incoming tarballs"
rm -f "$INCOMING"/release-*.tar.gz

# 6. Prune old releases — keep newest 5 by mtime. (`ls -1t` skips
# dotfiles, so releases/.incoming survives the prune.)
log "prune to last 5 releases"
cd "$ROOT/releases"
# shellcheck disable=SC2012
ls -1t | tail -n +6 | xargs -r -I{} rm -rf -- "{}"

log "done — $SHA live"
