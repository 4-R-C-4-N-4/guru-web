/**
 * src/instrumentation.ts
 *
 * Next.js calls register() once per server start (per worker, in clustered
 * setups). We use it to run boot-time assertions from src/lib/boot.ts.
 *
 * Throwing here aborts startup, which is exactly what we want for misconfigs:
 * the systemd unit fails, journalctl shows the error, no half-broken server
 * accepting traffic.
 *
 * Edge runtime is skipped — boot checks make node-only network/env calls.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { boot } = await import('@/lib/boot');
    await boot();
  }
}
