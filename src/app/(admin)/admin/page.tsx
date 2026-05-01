/**
 * src/app/(admin)/admin/page.tsx
 *
 * Placeholder so the (admin) route group resolves to something real.
 * Replaced by the overview dashboard in ticket 4.
 *
 * Auth gating happens in middleware.ts before this renders — by the
 * time we get here the caller is in ADMIN_USER_IDS. The handler-level
 * requireAdmin() check kicks in once /api/admin/* routes exist.
 */

export default function AdminPlaceholder() {
  return <main>ADMIN</main>;
}
