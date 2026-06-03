/**
 * src/app/page.tsx
 *
 * Homepage — an async server component that fetches the latest published
 * essays and hands them to the client <Landing> (the interactive hero + the
 * signed-in→/chat redirect live there). Server-rendered so it can read the DB;
 * force-dynamic for the same reason the /blog pages are (live published rows,
 * never statically prerendered).
 */

import { listPublished } from '@/lib/blog-public';
import Landing from '@/components/landing';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const posts = await listPublished(3);
  return <Landing posts={posts} />;
}
