/**
 * src/app/admin-404/page.tsx
 *
 * Both the public Caddy listener (deploy/Caddyfile) and the admin
 * middleware (src/middleware.ts) rewrite forbidden /admin/* requests
 * to this path so the response shape is identical to "this path does
 * not exist" — Next's standard 404, not a Caddy bare 404 or a custom
 * "you are not authorized" message.
 *
 * Spec: BRD-admin-ui §0.1, §1.1. The BRD names this path "/_admin-404"
 * but Next.js App Router treats top-level _-prefixed folders as
 * private (non-routable), so the underscore was dropped. "/admin-404"
 * does not collide with the @admin matcher on the public Caddy
 * listener — that matcher requires a slash after "admin" (/admin,
 * /admin/*); /admin-404 is a sibling path, not a child.
 *
 * Calling notFound() triggers Next's not-found machinery so the
 * response status is 404 and the body is the same not-found.tsx
 * (or default Next 404) the rest of the app renders for missing paths.
 */

import { notFound } from 'next/navigation';

export default function AdminForbidden() {
  notFound();
}
