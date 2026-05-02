#!/bin/bash
# deploy/sync-pricing-runner.sh
#
# Wrapper that resolves the latest release and invokes
# scripts/sync-pricing.ts against the live DB. Fired by
# sync-pricing.service.
#
# Why a wrapper: Next.js standalone build excludes scripts/, so
# /srv/guru-web/current (which symlinks to .../standalone) doesn't
# include the script. The full clone lives at
# /srv/guru-web/releases/<sha>/. We grab the most recent release
# and exec there.
#
# Idempotent. Safe to run by hand:
#   sudo systemctl start sync-pricing
# or:
#   sudo -u guru /usr/local/bin/sync-pricing
#
# See deploy/README.md "Pricing sync".

set -euo pipefail

ROOT=/srv/guru-web
LATEST_SHA=$(ls -1t "$ROOT/releases" | head -1)

if [[ -z "$LATEST_SHA" ]]; then
    echo "sync-pricing: no release found under $ROOT/releases" >&2
    exit 1
fi

RELEASE="$ROOT/releases/$LATEST_SHA"
SCRIPT="$RELEASE/scripts/sync-pricing.ts"

if [[ ! -f "$SCRIPT" ]]; then
    echo "sync-pricing: script missing at $SCRIPT" >&2
    exit 1
fi

cd "$RELEASE"
exec /usr/bin/npx tsx "$SCRIPT"
