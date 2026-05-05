/**
 * src/app/(admin)/admin/sessions/page.tsx
 *
 * Index page for /admin/sessions — exists solely as the GET target
 * for the JumpById form in the admin sidebar (todo:4670ef9d). The
 * form submits with name=id, so this page reads searchParams.id and
 * redirects to /admin/sessions/<id>. With no id, redirect to /admin
 * since there is no list view.
 */

import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/admin';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function AdminSessionsIndex({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const result = await requireAdmin();
  if (result instanceof Response) notFound();

  const { id } = await searchParams;
  const trimmed = id?.trim();
  if (trimmed) redirect(`/admin/sessions/${encodeURIComponent(trimmed)}`);
  redirect('/admin');
}
