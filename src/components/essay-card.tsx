/**
 * src/components/essay-card.tsx
 *
 * Shared presentational card for a published essay — title + italic dek,
 * linking to /blog/<slug>. Hook-free and free of server-only imports, so it
 * renders in both the server-rendered /blog index (src/app/blog/page.tsx) and
 * the client landing feed (src/components/landing.tsx). Keeps the two surfaces
 * visually in lockstep.
 */

import Link from 'next/link';
import type { PublishedListItem } from '@/lib/blog-public';
import { tokens } from '@/styles/tokens';

export default function EssayCard({ post }: { post: PublishedListItem }) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      style={{ textDecoration: 'none', display: 'block' }}
    >
      <h2
        style={{
          fontFamily: tokens.font.display,
          fontSize: 26,
          fontWeight: 600,
          color: tokens.text.primary,
          margin: '0 0 8px',
          lineHeight: 1.3,
        }}
      >
        {post.title}
      </h2>
      {post.dek && (
        <p
          style={{
            fontFamily: tokens.font.display,
            fontSize: 16,
            color: tokens.text.secondary,
            margin: 0,
            lineHeight: 1.6,
            fontStyle: 'italic',
          }}
        >
          {post.dek}
        </p>
      )}
    </Link>
  );
}
