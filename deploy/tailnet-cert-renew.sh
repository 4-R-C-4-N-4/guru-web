#!/bin/bash
# deploy/tailnet-cert-renew.sh
#
# Regenerate the Tailscale-issued TLS pair for the tailnet admin
# listener and reload Caddy. Fired daily by tailnet-cert-renew.timer.
#
# Tailscale-issued certs are 90 days; daily renewal gives ~89 days of
# headroom against any one failed run. The script reloads Caddy only
# on a successful issuance — if `tailscale cert` fails, the previous
# cert stays on disk and the admin listener keeps serving until that
# cert expires. The timer's status (and journalctl -u
# tailnet-cert-renew.service) is the diagnostic surface.
#
# See BRD-admin-ui §0.3 and deploy/README.md "Tailnet admin listener".

set -euo pipefail

HOST="guru-web-prod.tailb5626e.ts.net"
DIR="/etc/ssl/tailnet"
CRT="${DIR}/${HOST}.crt"
KEY="${DIR}/${HOST}.key"

mkdir -p "$DIR"
chown root:caddy "$DIR"
chmod 0750 "$DIR"

# Issue into temp paths first so a partial write can't leave Caddy
# pointing at a half-written file. `tailscale cert` is atomic per file
# but two files together aren't — the temp+mv dance is the simplest
# way to make the swap atomic from Caddy's perspective.
TMP_CRT="$(mktemp "${CRT}.XXXXXX")"
TMP_KEY="$(mktemp "${KEY}.XXXXXX")"
trap 'rm -f "$TMP_CRT" "$TMP_KEY"' EXIT

tailscale cert --cert-file "$TMP_CRT" --key-file "$TMP_KEY" "$HOST"

chown root:caddy "$TMP_CRT" "$TMP_KEY"
chmod 0644 "$TMP_CRT"
chmod 0640 "$TMP_KEY"

mv "$TMP_CRT" "$CRT"
mv "$TMP_KEY" "$KEY"
trap - EXIT

systemctl reload caddy

echo "tailnet cert renewed for $HOST; caddy reloaded"
