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
#   1. sudo prompt        — deliberate human-presence authorization (sudo -k
#                           first: a cached timestamp must not skip the
#                           prompt; this script must never run unattended).
#   2. node major parity  — parsed from the deployed sha's own deploy.yml
#                           setup-node, so a VPS runtime bump can't drift.
#   3. sha == origin/main — freshly fetched; local-only commits refused.
#   4. CI green           — every check-run for the sha successful, and a
#                           successful `check` (ci.yml) run must exist. The
#                           Actions `deploy` run is excluded from the count —
#                           it IS the queue this script skips — but one in
#                           flight is a refusal: never race an Actions deploy.
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
SMOKE_PORT=3210         # same as deploy.yml's smoke-boot

say()  { printf '\033[1m[deploy-local]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[deploy-local]\033[0m %s\n' "$*" >&2; exit 1; }

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# ── gate 1: human-presence authorization ────────────────────────────────────
say "gate 1/5 — sudo authorization (human presence)"
sudo -k   # drop any cached timestamp so the prompt actually fires
sudo -v || fail "sudo authorization refused"

# ── gate 2: toolchain parity ────────────────────────────────────────────────
git fetch --quiet origin main
SHA="$(git rev-parse origin/main)"
# Read the required major out of the deployed sha's own deploy.yml so a VPS
# runtime bump can't leave this script pinned to a stale hardcoded value.
WANT_NODE_MAJOR="$(git show "$SHA:.github/workflows/deploy.yml" \
  | sed -n 's/^ *node-version: *\([0-9][0-9]*\).*$/\1/p' | head -1)"
[ -n "$WANT_NODE_MAJOR" ] || fail "could not parse setup-node node-version from deploy.yml at ${SHA:0:12}"
node_major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$node_major" = "$WANT_NODE_MAJOR" ] \
  || fail "node $node_major found; deploy.yml/VPS runtime is $WANT_NODE_MAJOR (nvm use $WANT_NODE_MAJOR)"
say "gate 2/5 — node $node_major ok"

# ── gate 3: sha is origin/main HEAD ─────────────────────────────────────────
SUBJECT="$(git log -1 --format=%s "$SHA")"
say "gate 3/5 — deploying origin/main: ${SHA:0:12} — $SUBJECT"

# ── gate 4: CI green for exactly this sha ───────────────────────────────────
# deploy.yml triggers on every push to main, so its `deploy` job reports a
# check-run on this sha too. It never counts toward green — a fresh merge
# would otherwise be undeployable until Actions had already deployed it,
# which defeats this script's purpose. But a deploy run still in flight
# means Actions is mid-ship on this sha: refuse rather than race it.
checks="$(gh api "repos/{owner}/{repo}/commits/$SHA/check-runs?per_page=100" \
  --jq '[.check_runs[] | {name, status, conclusion}]')"
in_flight="$(printf '%s' "$checks" | jq '[.[] | select(.name == "deploy" and .status != "completed")] | length')"
[ "$in_flight" = 0 ] || fail "an Actions deploy is in flight for $SHA — let it finish (or cancel it), don't race it"
gated="$(printf '%s' "$checks" | jq '[.[] | select(.name != "deploy")]')"
total="$(printf '%s' "$gated" | jq 'length')"
green="$(printf '%s' "$gated" | jq '[.[] | select(.status == "completed" and .conclusion == "success")] | length')"
[ "$total" -gt 0 ]        || fail "no CI check-runs found for $SHA — has CI run?"
[ "$green" = "$total" ]   || fail "CI not green for $SHA ($green/$total successful): $(printf '%s' "$gated" | jq -c '[.[] | select(.conclusion != "success") | .name]')"
printf '%s' "$gated" | jq -e 'any(.[]; .name == "check" and .conclusion == "success")' >/dev/null \
  || fail "no successful \`check\` run for $SHA — ci.yml hasn't passed this sha"
say "gate 4/5 — CI green ($green/$total check-runs, deploy excluded)"

# ── gate 5: explicit confirm ────────────────────────────────────────────────
printf '\n  target : %s\n  sha    : %s\n  commit : %s\n\n' "$DEPLOY_HOST" "$SHA" "$SUBJECT"
read -r -p "[deploy-local] type 'deploy' to ship: " answer
[ "$answer" = "deploy" ] || fail "aborted by operator"

# ── clean build tree: detached worktree of the sha ──────────────────────────
BUILD_DIR="$(mktemp -d /tmp/guru-web-release.XXXXXX)"
# Everything that must never end up inside the tarball (fetched env, step
# logs, the tarball itself) lives here — outside the build tree, same role
# as deploy.yml's $RUNNER_TEMP. mktemp -d is 0700, so nothing is
# world-readable in /tmp either.
STAGE_DIR="$(mktemp -d /tmp/guru-web-stage.XXXXXX)"
cleanup() {
  cd "$REPO_ROOT"
  git worktree remove --force "$BUILD_DIR" 2>/dev/null || rm -rf "$BUILD_DIR"
  rm -rf "$STAGE_DIR"
}
trap cleanup EXIT
git worktree add --detach --quiet "$BUILD_DIR" "$SHA"
cd "$BUILD_DIR"
say "building in clean worktree $BUILD_DIR"

# ── mirror deploy.yml step for step ─────────────────────────────────────────
say "npm ci"
npm ci --no-audit --no-fund >/dev/null

# Same supply-chain gate deploy.yml runs — and it must run HERE, on this
# machine's install: CI's signature pass covered a different install on a
# different runner, not the node_modules that ships in this tarball.
say "verifying registry signatures"
npm audit signatures >/dev/null

# deploy.yml lints and tests the artifact on the runtime major before
# shipping it; skipping these locally would ship a tree whose suite only
# ever ran on CI's node 22.
for step in lint type-check test; do
  say "$step"
  npm run --silent "$step" >"$STAGE_DIR/$step.log" 2>&1 \
    || { cat "$STAGE_DIR/$step.log" >&2; fail "$step failed on the release worktree"; }
done

say "fetching public build env from VPS"
# Fetched OUTSIDE the build tree (deploy.yml uses $RUNNER_TEMP the same way)
# so the pack step structurally cannot tar it — no rm-before-tar ordering to
# trust. The runtime env lives on the VPS (guru-web.service EnvironmentFile).
ENV_FILE="$STAGE_DIR/guru-web.public.env"
scp -q "$DEPLOY_HOST:/etc/guru-web.public.env" "$ENV_FILE"

say "production build (telemetry disabled)"
(
  set -a; source "$ENV_FILE"; set +a
  NEXT_TELEMETRY_DISABLED=1 npm run build >/dev/null
)

say "pruning to production dependencies"
npm prune --omit=dev >/dev/null

say "smoke-booting the pruned artifact on :$SMOKE_PORT"
! curl -s -o /dev/null "http://127.0.0.1:$SMOKE_PORT/" \
  || fail "port $SMOKE_PORT already in use — stop whatever is on it first"
(
  set -a; source "$ENV_FILE"; set +a
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

say "packing release artifact"
TARBALL="$STAGE_DIR/release-$SHA.tar.gz"
tar -C "$BUILD_DIR" --exclude=.git --exclude=.next/cache --exclude=node_modules/.cache \
  -czf "$TARBALL" .

say "shipping to $DEPLOY_HOST"
ssh "$DEPLOY_HOST" 'mkdir -p /srv/guru-web/releases/.incoming'
scp -q "$TARBALL" "$DEPLOY_HOST:/srv/guru-web/releases/.incoming/"

say "running deploy.sh on the VPS"
ssh "$DEPLOY_HOST" "/srv/guru-web/deploy.sh $SHA"

say "deployed ${SHA:0:12} — verify: curl -s https://guru-ai.org/ | head -c 200"
