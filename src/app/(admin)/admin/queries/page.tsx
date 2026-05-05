/**
 * src/app/(admin)/admin/queries/page.tsx
 *
 * Index page for /admin/queries — exists solely as the GET target
 * for the JumpById form in the admin sidebar (todo:4670ef9d). Same
 * shape as the sessions index.
 */

import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/admin';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function AdminQueriesIndex({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const result = await requireAdmin();
  if (result instanceof Response) notFound();

  const { id } = await searchParams;
  const trimmed = id?.trim();
  if (trimmed) redirect(`/admin/queries/${encodeURIComponent(trimmed)}`);
  redirect('/admin');
}
