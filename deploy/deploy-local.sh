#!/usr/bin/env bash
#
# deploy/deploy-local.sh — manual local deploy (todo:368e954f).
#
# Builds and ships a release from this machine over the tailnet, skipping
# the GitHub Actions queue. STRICTLY ADDITIVE: .github/workflows/deploy.yml
# remains the canonical pipeline and the fallback — this script mirrors its
# steps exactly and ships to the same VPS contract (deploy.sh consumes a
# pre-built tarball from releases/.incoming/; it never builds).
#
# Gates, in order — every one is a hard stop:
#   1. sudo -v            — deliberate human-presence authorization (this
#                           script must never run unattended; the sudo
#                           prompt is the operator's signature).
#   2. node major == 20   — deploy.yml pins 20 to match the VPS runtime.
#   3. sha == origin/main — freshly fetched; local-only commits refused.
#   4. CI green           — every GitHub check-run for the sha successful.
#   5. explicit confirm   — sha + subject echoed; operator types 'deploy'.
#
# Build hygiene: the release is built in a DETACHED GIT WORKTREE of the
# exact sha, never the working tree — the pack step tars the whole build
# dir, and a working-tree build would ship stray local files.
#
# Usage:   deploy/deploy-local.sh
# Config:  DEPLOY_HOST (default guru-web-prod) — ssh alias reachable on the
#          tailnet as the deploy user (your ~/.ssh/config, not the CI key).

set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-guru-web-prod}"
WANT_NODE_MAJOR=20      # keep in lockstep with deploy.yml setup-node
SMOKE_PORT=3210         # same as deploy.yml's smoke-boot

say()  { printf '\033[1m[deploy-local]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[deploy-local]\033[0m %s\n' "$*" >&2; exit 1; }

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# ── gate 1: human-presence authorization ────────────────────────────────────
say "gate 1/5 — sudo authorization (human presence)"
sudo -v || fail "sudo authorization refused"

# ── gate 2: toolchain parity ────────────────────────────────────────────────
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" = "$WANT_NODE_MAJOR" ] \
  || fail "node $node_major found; deploy.yml/VPS runtime is $WANT_NODE_MAJOR (nvm use $WANT_NODE_MAJOR)"
say "gate 2/5 — node $node_major ok"

# ── gate 3: sha is origin/main HEAD ─────────────────────────────────────────
git fetch --quiet origin main
SHA="$(git rev-parse origin/main)"
SUBJECT="$(git log -1 --format=%s "$SHA")"
say "gate 3/5 — deploying origin/main: ${SHA:0:12} — $SUBJECT"

# ── gate 4: CI green for exactly this sha ───────────────────────────────────
checks="$(gh api "repos/{owner}/{repo}/commits/$SHA/check-runs" \
  --jq '[.check_runs[] | {name, status, conclusion}]')"
total="$(printf '%s' "$checks" | jq 'length')"
green="$(printf '%s' "$checks" | jq '[.[] | select(.status == "completed" and .conclusion == "success")] | length')"
[ "$total" -gt 0 ]        || fail "no check-runs found for $SHA — has CI run?"
[ "$green" = "$total" ]   || fail "CI not green for $SHA ($green/$total successful): $(printf '%s' "$checks" | jq -c '[.[] | select(.conclusion != "success") | .name]')"
say "gate 4/5 — CI green ($green/$total check-runs)"

# ── gate 5: explicit confirm ────────────────────────────────────────────────
printf '\n  target : %s\n  sha    : %s\n  commit : %s\n\n' "$DEPLOY_HOST" "$SHA" "$SUBJECT"
read -r -p "[deploy-local] type 'deploy' to ship: " answer
[ "$answer" = "deploy" ] || fail "aborted by operator"

# ── clean build tree: detached worktree of the sha ──────────────────────────
BUILD_DIR="$(mktemp -d /tmp/guru-web-release.XXXXXX)"
cleanup() {
  cd "$REPO_ROOT"
  git worktree remove --force "$BUILD_DIR" 2>/dev/null || rm -rf "$BUILD_DIR"
}
trap cleanup EXIT
git worktree add --detach --quiet "$BUILD_DIR" "$SHA"
cd "$BUILD_DIR"
say "building in clean worktree $BUILD_DIR"

# ── mirror deploy.yml step for step ─────────────────────────────────────────
say "npm ci"
npm ci --no-audit --no-fund >/dev/null

say "fetching public build env from VPS"
scp -q "$DEPLOY_HOST:/etc/guru-web.public.env" "$BUILD_DIR/.public.env"

say "production build (telemetry disabled)"
(
  set -a; source "$BUILD_DIR/.public.env"; set +a
  NEXT_TELEMETRY_DISABLED=1 npm run build >/dev/null
)

say "pruning to production dependencies"
npm prune --omit=dev >/dev/null

say "smoke-booting the pruned artifact on :$SMOKE_PORT"
! curl -s -o /dev/null "http://127.0.0.1:$SMOKE_PORT/" \
  || fail "port $SMOKE_PORT already in use — stop whatever is on it first"
(
  set -a; source "$BUILD_DIR/.public.env"; set +a
  ./node_modules/.bin/next start -p "$SMOKE_PORT" &
  boot_pid=$!
  code=000
  for _ in $(seq 1 30); do
    code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$SMOKE_PORT/" || true)
    [ "$code" != "000" ] && break
    sleep 1
  done
  kill "$boot_pid" 2>/dev/null || true
  say "smoke-boot HTTP status: $code"
  [ "$code" != "000" ]
)

# .public.env must not ship: it is fetched fresh by this script only —
# the runtime env lives on the VPS (guru-web.service EnvironmentFile).
rm -f "$BUILD_DIR/.public.env"

say "packing release artifact"
TARBALL="/tmp/release-$SHA.tar.gz"
tar -C "$BUILD_DIR" --exclude=.git --exclude=.next/cache --exclude=node_modules/.cache \
  -czf "$TARBALL" .

say "shipping to $DEPLOY_HOST"
ssh "$DEPLOY_HOST" 'mkdir -p /srv/guru-web/releases/.incoming'
scp -q "$TARBALL" "$DEPLOY_HOST:/srv/guru-web/releases/.incoming/"
rm -f "$TARBALL"

say "running deploy.sh on the VPS"
ssh "$DEPLOY_HOST" "/srv/guru-web/deploy.sh $SHA"

say "deployed ${SHA:0:12} — verify: curl -s https://guru-ai.org/ | head -c 200"
