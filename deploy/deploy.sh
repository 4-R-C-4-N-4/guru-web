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
# for rollback. Roll back with the same two-step idiom the script uses
# (plain `ln -sfn` onto an existing dir symlink drops the link *inside*
# the target dir):
#   ln -sfn /srv/guru-web/releases/<old-sha> /srv/guru-web/current.new
#   mv -Tf /srv/guru-web/current.new /srv/guru-web/current
#   sudo systemctl restart guru-web
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

# $SHA names paths we rm -rf and arrives from a workflow_dispatch input via
# a remote shell — insist it looks like a commit sha before building paths
# from it. Rejects ../ traversal, shell metacharacters, and branch names
# (which checkout would accept but which would mint oddly-named releases).
if [[ ! "$SHA" =~ ^[0-9a-f]{7,40}$ ]]; then
    echo "deploy.sh: '$SHA' is not a commit sha (expected 7-40 lowercase hex chars)" >&2
    exit 1
fi

ROOT=/srv/guru-web
RELEASE="$ROOT/releases/$SHA"
CURRENT="$ROOT/current"
INCOMING="$ROOT/releases/.incoming"
TARBALL="$INCOMING/release-$SHA.tar.gz"
STAGING="$INCOMING/stage-$SHA"

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
#    Extract into a staging dir first, then swap it into place. Extracting
#    straight into $RELEASE would mean rm -rf'ing it for the duration of
#    the unpack — and when the deployed SHA is the one `current` already
#    points at (redeploy of last-good after an env fix, retried run), that
#    is the tree the live app is lazily loading chunks from. The staging
#    swap shrinks that window from "full extract" to a single rename.
#
#    Idempotent: staging is wiped before extract, $RELEASE is replaced
#    wholesale — a retried deploy, the self-update re-exec below, or a
#    leftover git clone from the pre-tarball flow all end up with exactly
#    the tarball's contents. Staging lives under $INCOMING (a dotdir) so
#    the `ls -1t` release-prune never sees it.
#
#    Deploying without CI (registry outage, lost artifact): build the
#    tarball anywhere with the same steps deploy.yml runs (npm ci, source
#    /etc/guru-web.public.env, npm run build, npm prune --omit=dev,
#    tar --exclude=.git --exclude=.next/cache --exclude=node_modules/.cache
#    -czf release-<sha>.tar.gz .) and scp it to $INCOMING/ yourself, then
#    re-run this script.
if [[ ! -f "$TARBALL" ]]; then
    echo "deploy.sh: $TARBALL not found — CI ships it before invoking this script." >&2
    echo "deploy.sh: no git/npm fallback by design (supply-chain hardening); see comment above for the manual path." >&2
    exit 1
fi
log "unpacking release-$SHA.tar.gz"
rm -rf "$STAGING"
mkdir -p "$STAGING"
tar -xzf "$TARBALL" -C "$STAGING"
rm -rf "$RELEASE"
mv "$STAGING" "$RELEASE"

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

# 1b. Fix ownership. The tarball is built in CI (root-owned or whatever the
#    GitHub Actions runner extracted as) and may land with files not owned
#    by `deploy`. The top-level chown at line 66 only covers files that
#    existed BEFORE the tarball landed — it runs before unpack. After unpack,
#    files extracted from the tarball keep the tarball's ownership. This is
#    idempotent: chown -R on already-correct ownership is a no-op.
#
#    We chown the whole releases/ tree, not just "$RELEASE": the sudoers grant
#    (vps-bootstrap.sh /etc/sudoers.d/deploy) is an EXACT-command rule —
#    `NOPASSWD: /bin/chown -R deploy:deploy /srv/guru-web/releases`. Passing a
#    subpath like /srv/guru-web/releases/<sha> doesn't match it, so sudo
#    prompts for a password and the non-interactive deploy dies (observed on
#    the first post-merge deploy after this chown was added). `-R` over
#    releases/ still recurses into the freshly-unpacked <sha> dir.
log "fix release ownership"
sudo /bin/chown -R deploy:deploy "$ROOT/releases"

# 1c. Point this release's Next.js runtime cache at the persistent, guru-owned
#    dir OUTSIDE the release. `next start` runs as guru (guru-web.service
#    User=guru) — NOT deploy — but the release is deploy-owned (above) and the
#    CI tarball excludes .next/cache, so the runtime would mkdir .next/cache
#    inside a deploy-owned .next/ and hit EACCES on the first dynamic request.
#    That is what 500'd guest /ask (observed live after merge of 3cae5ea).
#    Symlinking makes guru write THROUGH to a dir it owns (/srv/guru-web/
#    next-cache — created guru:guru by vps-bootstrap.sh, listed in the unit's
#    ReadWritePaths). Created AFTER the ownership chown, and `chown -R` does
#    not follow symlinks (-P default), so neither this deploy's chown of
#    releases/ nor a later one ever rewrites the guru-owned target. .next
#    itself is always present (the tarball excludes only .next/cache), so no
#    mkdir is needed.
#
#    Behavior change vs. pre-PR: the cache was formerly cold each deploy
#    (excluded from the tarball, recreated empty in-release); it now persists
#    across deploys. Next's data cache (unstable_cache/fetch) is keyed
#    independent of build id, so entries survive a deploy and can serve stale
#    up to each entry's own `revalidate` TTL (blog 60s, corpus 1h) — this is
#    Next's intended data-cache model, and code needing an immediate refresh
#    already calls revalidateTag. The full-route/ISR cache is build-id-keyed,
#    so stale pages from an old build are ignored. todo:4f515e43
log "link .next/cache → /srv/guru-web/next-cache (persistent, guru-owned)"
rm -rf "$RELEASE/.next/cache"
ln -sfn /srv/guru-web/next-cache "$RELEASE/.next/cache"

# 1d. Guard the cache invariant NOW — before migrations and the symlink swap —
#    so a failure leaves the previous release FULLY live (current still points
#    at it, service not restarted). This is the regression test for the EACCES
#    that 500'd guest /ask (todo:4f515e43); `systemctl is-active` (below) can't
#    catch it — the process boots fine and only 500s per-request. Everything
#    checked is known at this point: the link must resolve to $CACHE_DIR, and
#    $CACHE_DIR must be a directory owned by guru and owner-writable. (`stat`
#    needs only search on the world-readable parents, not read on the 0750 dir.)
CACHE_DIR=/srv/guru-web/next-cache
CACHE_LINK="$RELEASE/.next/cache"
log "verify runtime cache is guru-writable"
if [[ ! -L "$CACHE_LINK" || "$(readlink -f "$CACHE_LINK")" != "$CACHE_DIR" ]]; then
    echo "deploy.sh: $CACHE_LINK is not a symlink to $CACHE_DIR (target may be missing) — guru would EACCES writing .next/cache and guest /ask would 500. Aborting before swap." >&2
    exit 1
fi
cache_owner="$(stat -c '%U' "$CACHE_DIR" 2>/dev/null || true)"
cache_mode="$(stat -c '%A' "$CACHE_DIR" 2>/dev/null || true)"
if [[ ! -d "$CACHE_DIR" || "$cache_owner" != guru || "${cache_mode:2:1}" != w ]]; then
    echo "deploy.sh: $CACHE_DIR must be a directory owned by guru and owner-writable (found owner='${cache_owner:-?}' mode='${cache_mode:-?}'); runtime writes as guru would EACCES. Fix: sudo install -d -o guru -g guru -m 0750 $CACHE_DIR (see vps-bootstrap.sh). Aborting before swap." >&2
    exit 1
fi
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

# 5. Clean up the consumed tarball — the unpacked releases/ dirs are the
# rollback surface, so it has no further use. Only after the restart
# verified, so a failed deploy keeps its tarball for retry. Delete ONLY
# $TARBALL, not release-*.tar.gz: workflow_dispatch runs on different refs
# aren't serialized by the concurrency group, so a glob here could eat a
# parallel deploy's freshly-shipped artifact before its deploy.sh runs.
# Week-old strays (failed runs never retried, abandoned staging dirs) get
# swept separately.
log "clean incoming tarball"
rm -f "$TARBALL"
find "$INCOMING" -maxdepth 1 -name 'release-*.tar.gz' -mtime +7 -delete 2>/dev/null || true
find "$INCOMING" -maxdepth 1 -type d -name 'stage-*' -mtime +7 -exec rm -rf {} + 2>/dev/null || true

# 6. Prune old releases — keep newest 5 by mtime. (`ls -1t` skips
# dotfiles, so releases/.incoming survives the prune.)
log "prune to last 5 releases"
cd "$ROOT/releases"
# shellcheck disable=SC2012
ls -1t | tail -n +6 | xargs -r -I{} rm -rf -- "{}"

log "done — $SHA live"
