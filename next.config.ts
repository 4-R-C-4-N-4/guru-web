import type { NextConfig } from "next";

// `output: "standalone"` was removed because Next 16.2.4's standalone
// collector errors with `ENOENT: middleware.js.nft.json` when the
// active middleware lives in src/proxy.ts (Next 16's renamed
// convention). Without standalone we run via `next start` against
// the release dir directly — see deploy/deploy.sh and
// deploy/guru-web.service.
// Comma-separated LAN origins for dev (e.g. NEXT_ALLOWED_DEV_ORIGINS=192.168.1.173,10.0.0.5).
// Needed when hitting `next dev` from another device on the network — Next 16
// blocks cross-origin dev requests by default. Production ignores this.
const allowedDevOrigins = process.env.NEXT_ALLOWED_DEV_ORIGINS
  ?.split(',')
  .map(s => s.trim())
  .filter(Boolean) ?? [];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  compress: false,
  allowedDevOrigins,
};

export default nextConfig;
