/**
 * src/app/api/admin/user-params.ts
 *
 * Shared URL-param parser for the users JSON list endpoint, the CSV
 * endpoint, and the page itself. Single source of truth for what
 * filter / sort params look like, so a CSV download with the same
 * URL params returns the same row set.
 *
 * Spec: BRD-admin-ui §1.3, §1.6, §1.18.
 */

import type { UserListFilters, UserListSort } from '@/lib/admin-queries';

export const PAGE_SIZE = 50;

export function parseUserListSearchParams(sp: URLSearchParams): {
  filters: UserListFilters;
  sort:    UserListSort;
  page:    number;
} {
  const tier = sp.get('tier');
  const created = sp.get('created');
  const queried = sp.get('queried');
  const search = sp.get('q');
  const sortBy = sp.get('sort');
  const sortDir = sp.get('dir');
  const pageRaw = sp.get('page');

  const filters: UserListFilters = {
    tier: tier === 'free' || tier === 'pro' ? tier : 'all',
    createdAfter: createdToIso(created),
    queriedWithinDays: queriedToDays(queried),
    search: search || null,
  };

  const validSorts: UserListSort['by'][] = ['email', 'created_at', 'last_query_at', 'queries_7d', 'spend_7d'];
  const sort: UserListSort = {
    by:  (validSorts as string[]).includes(sortBy ?? '') ? (sortBy as UserListSort['by']) : 'last_query_at',
    dir: sortDir === 'asc' ? 'asc' : 'desc',
  };

  const page = Math.max(0, Number.isFinite(Number(pageRaw)) ? Math.floor(Number(pageRaw)) : 0);

  return { filters, sort, page };
}

function createdToIso(v: string | null): string | null {
  if (!v) return null;
  const now = Date.now();
  const dayMs = 86_400_000;
  if (v === 'today') return new Date(now - dayMs).toISOString();
  if (v === '7d')    return new Date(now - 7  * dayMs).toISOString();
  if (v === '30d')   return new Date(now - 30 * dayMs).toISOString();
  return null;
}

function queriedToDays(v: string | null): number | null {
  if (!v || v === 'all') return null;
  if (v === 'today') return 1;
  if (v === '7d')    return 7;
  if (v === '30d')   return 30;
  if (v === 'never') return -1;
  return null;
}
