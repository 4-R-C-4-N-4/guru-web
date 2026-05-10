/**
 * src/app/(admin)/layout.tsx
 *
 * Wraps every admin page. Renders:
 *   - amber 2px bar (label "ADMIN — observability" + operator email)
 *   - left rail (200px, 5 items, mono font, no icons)
 *   - content pane (max 1280px, fluid)
 *
 * Spec: BRD-admin-ui §1.10, BRD-admin-ui-design §3.1, §2.1–§2.3.
 *
 * Trust model (post 2026-05-09 cutover): the Caddy tailnet listener
 * is the gate; requireAdmin() returns the synthetic tailnet operator
 * when the X-Tailnet-Trust header is present, otherwise a 404
 * Response. See src/lib/admin.ts for rationale.
 */

import Link from 'next/link';
import { tokens } from '@/styles/tokens';
import { requireAdmin } from '@/lib/admin';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const result = await requireAdmin();
  if (result instanceof Response) notFound();
  const operator = result;

  return (
    <div style={{ background: tokens.bg.deep, minHeight: '100vh', color: tokens.text.primary, fontSize: 13 }}>
      {/* Amber bar */}
      <div
        style={{
          height: 2,
          background: tokens.text.accent,
          width: '100%',
        }}
      />
      <div
        style={{
          padding: '4px 16px',
          background: tokens.bg.surface,
          borderBottom: `1px solid ${tokens.border.subtle}`,
          display: 'flex',
          justifyContent: 'space-between',
          fontFamily: tokens.font.mono,
          fontSize: 11,
          color: tokens.text.accent,
          letterSpacing: 0.5,
        }}
      >
        <span>ADMIN — observability</span>
        <span style={{ color: tokens.text.muted }}>{operator.email}</span>
      </div>

      {/* Two-pane */}
      <div style={{ display: 'flex', maxWidth: 1480, margin: '0 auto' }}>
        <nav
          style={{
            width: 200,
            flexShrink: 0,
            padding: '24px 16px',
            borderRight: `1px solid ${tokens.border.subtle}`,
            fontFamily: tokens.font.mono,
            fontSize: 12,
          }}
        >
          <NavItem href="/admin">Overview</NavItem>
          <NavItem href="/admin/users">Users</NavItem>
          <SectionLabel>Sessions</SectionLabel>
          <JumpById prefix="/admin/sessions/" placeholder="session id" />
          <SectionLabel>Queries</SectionLabel>
          <JumpById prefix="/admin/queries/" placeholder="query id" />
        </nav>
        <main style={{ flex: 1, minWidth: 0, padding: 24 }}>{children}</main>
      </div>
    </div>
  );
}

function NavItem({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <Link href={href} style={{ color: tokens.text.primary, textDecoration: 'none' }}>
        {children}
      </Link>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 16,
        marginBottom: 4,
        color: tokens.text.muted,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        fontSize: 10,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Plain HTML form that GETs to /admin/<prefix>?id=<input>. The
 * destination index page (admin/sessions/page.tsx,
 * admin/queries/page.tsx) reads searchParams.id and redirects to
 * /admin/<prefix>/<id>, which 404s if the id doesn't exist.
 * No client JS required.
 */
function JumpById({ prefix, placeholder }: { prefix: string; placeholder: string }) {
  return (
    <form action={prefix} method="get" style={{ display: 'flex', gap: 4 }}>
      <input
        name="id"
        type="text"
        placeholder={placeholder}
        style={{
          flex: 1,
          minWidth: 0,
          background: tokens.bg.surface,
          border: `1px solid ${tokens.border.subtle}`,
          color: tokens.text.primary,
          fontFamily: tokens.font.mono,
          fontSize: 11,
          padding: '2px 4px',
        }}
      />
    </form>
  );
}
