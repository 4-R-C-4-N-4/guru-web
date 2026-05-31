/**
 * src/app/blog/[slug]/page.tsx
 *
 * Public blog post (IMPL T8). Server-rendered, no auth. Fetches a single
 * published post by slug; notFound() if the slug is unknown or the post is
 * not published. Renders the markdown body via the shared MD_COMPONENTS
 * (T5) + remark-gfm, with a Sources section built from chunks_used.
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getPublishedBySlug } from '@/lib/blog-public';
import { MD_COMPONENTS } from '@/lib/markdown';
import Citation from '@/components/citation';
import { tokens } from '@/styles/tokens';

export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPublishedBySlug(slug);
  if (!post) return { title: 'Not found — Guru' };
  return {
    title: `${post.title} — Guru`,
    description: post.dek ?? undefined,
  };
}

export default async function BlogPostPage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const post = await getPublishedBySlug(slug);
  if (!post) notFound();

  return (
    <main
      style={{
        minHeight: '100vh',
        background: tokens.bg.deep,
        padding: '64px 24px',
      }}
    >
      <article style={{ maxWidth: 680, margin: '0 auto' }}>
        <Link
          href="/blog"
          style={{
            fontFamily: tokens.font.mono,
            fontSize: 11,
            color: tokens.text.link,
            letterSpacing: 1,
            textDecoration: 'none',
            textTransform: 'uppercase',
          }}
        >
          ← Essays
        </Link>

        <h1
          style={{
            fontFamily: tokens.font.display,
            fontSize: 38,
            fontWeight: 600,
            color: tokens.text.primary,
            margin: '24px 0 8px',
            lineHeight: 1.2,
          }}
        >
          {post.title}
        </h1>
        {post.dek && (
          <p
            style={{
              fontFamily: tokens.font.display,
              fontSize: 18,
              color: tokens.text.secondary,
              fontStyle: 'italic',
              margin: '0 0 32px',
              lineHeight: 1.6,
            }}
          >
            {post.dek}
          </p>
        )}

        <div
          style={{
            fontFamily: tokens.font.display,
            fontSize: 17,
            color: tokens.text.primary,
            lineHeight: 1.8,
          }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
            {post.content}
          </ReactMarkdown>
        </div>

        {post.chunks_used.length > 0 && (
          <section style={{ marginTop: 48 }}>
            <h2
              style={{
                fontFamily: tokens.font.mono,
                fontSize: 11,
                color: tokens.text.muted,
                letterSpacing: 2,
                textTransform: 'uppercase',
                marginBottom: 12,
              }}
            >
              Sources
            </h2>
            {post.chunks_used.map(src => (
              <Citation
                key={src.id}
                tradition={src.tradition}
                text={src.text_name}
                section={src.section}
                tier={src.tier}
              />
            ))}
          </section>
        )}
      </article>
    </main>
  );
}
