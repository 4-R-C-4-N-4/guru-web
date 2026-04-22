#!/usr/bin/env bash
#
# deploy/backup.sh — nightly Postgres backup to Backblaze B2.
#
# Installed by vps-bootstrap.sh to /etc/cron.daily/guru-backup. Cron.daily
# scripts run as root; the script drops to the postgres user for pg_dump and
# back to root for the b2 upload (b2 reads its own creds from /etc/backup-b2.env).
#
# Pruning:
#   This script does NOT delete old backups. Configure a B2 bucket lifecycle
#   rule in the Backblaze dashboard:
#     Buckets → <your bucket> → Lifecycle Settings →
#       "Keep prior versions for N days" (recommended: 30)
#   B2 then auto-deletes versions older than that on its own schedule. This
#   keeps the script simple and removes a class of "we accidentally deleted
#   live backups" failure modes.

set -euo pipefail

CONFIG=/etc/backup-b2.env

if [[ ! -f $CONFIG ]]; then
    echo "guru-backup: $CONFIG not found — backups disabled" >&2
    exit 1
fi
# shellcheck source=/dev/null
source "$CONFIG"

: "${B2_ACCOUNT_ID:?B2_ACCOUNT_ID required in $CONFIG}"
: "${B2_APPLICATION_KEY:?B2_APPLICATION_KEY required in $CONFIG}"
: "${B2_BUCKET:?B2_BUCKET required in $CONFIG}"

# Authorize. Cached across runs in /root/.b2_account_info (root-only readable),
# so this is effectively a no-op after the first run unless creds change.
b2 account authorize "$B2_ACCOUNT_ID" "$B2_APPLICATION_KEY" >/dev/null

NAME="guru-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"

# Stream pg_dump → gzip → b2 upload. No temp file on disk, no buffering of
# the full dump in memory. -Fc is Postgres custom format (smaller + parallel
# restore-friendly than plain SQL).
sudo -u postgres pg_dump -Fc guru \
    | gzip \
    | b2 file upload "$B2_BUCKET" - "$NAME"

echo "guru-backup: uploaded $NAME to b2://$B2_BUCKET/"
