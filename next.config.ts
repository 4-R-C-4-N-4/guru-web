import type { NextConfig } from "next";

// `output: "standalone"` was removed because Next 16.2.4's standalone
// collector errors with `ENOENT: middleware.js.nft.json` when the
// active middleware lives in src/proxy.ts (Next 16's renamed
// convention). Without standalone we run via `next start` against
// the release dir directly — see deploy/deploy.sh and
// deploy/guru-web.service.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  compress: false,
};

export default nextConfig;
