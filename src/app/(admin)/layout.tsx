/**
 * src/app/(admin)/layout.tsx
 *
 * Minimal admin layout — replaced by the full <AdminLayout> (amber
 * banner, left rail, content pane) when ticket 4 lands. Spec:
 * BRD-admin-ui-design §3.1.
 */

export default function AdminLayoutShell({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
