/**
 * src/app/page.tsx
 *
 * Homepage — an async server component that fetches the latest published
 * essays and hands them to the client <Landing> (the interactive hero + the
 * signed-in→/chat redirect live there). Server-rendered so it can read the DB;
 * force-dynamic for the same reason the /blog pages are (live published rows,
 * never statically prerendered).
 */

import type { Metadata } from 'next';
import { listPublishedCached } from '@/lib/blog-public';
import { listTraditionsCached } from '@/lib/corpus';
import Landing from '@/components/landing';

export const dynamic = 'force-dynamic';

// Title/description inherit from the root layout; the canonical is here
// because alternates don't belong in a layout (they'd apply to every page
// that forgets its own — todo:17621cef).
export const metadata: Metadata = { alternates: { canonical: '/' } };

export default async function HomePage() {
  // Cached reads: the page still renders per request (force-dynamic for the
  // tailnet/Clerk host check in the root layout), but the data is shared across
  // requests so bot traffic on / doesn't re-run these queries every hit.
  const [posts, traditions] = await Promise.all([
    listPublishedCached(3),
    listTraditionsCached(),
  ]);
  return <Landing posts={posts} traditions={traditions} />;
}
