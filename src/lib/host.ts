import { headers } from 'next/headers';

/**
 * Hostname of the VPS's tailnet listener (deploy/Caddyfile). Must match
 * exactly — deploy/Caddyfile needs updating in lockstep if the tailnet suffix
 * changes. Lives here (rather than only in the root layout) so the layout's
 * ClerkProvider gate and any feature that depends on Clerk being mounted read
 * the same source of truth.
 */
export const TAILNET_HOST = 'guru-web-prod.tailb5626e.ts.net';

/**
 * Whether ClerkProvider is mounted for the current request. The root layout
 * skips ClerkProvider on the tailnet host (Clerk's server-side init triggers a
 * protect-rewrite that 404s there — see src/app/layout.tsx), so any client
 * component that calls a Clerk hook (useUser, useAuth, …) will throw on that
 * host. Server components can await this to decide whether to render such a
 * client island. Reads headers(), so the calling route becomes dynamic.
 */
export async function clerkEnabled(): Promise<boolean> {
  return (await headers()).get('host') !== TAILNET_HOST;
}
