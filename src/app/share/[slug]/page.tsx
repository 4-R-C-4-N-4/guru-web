/**
 * src/app/share/[slug]/page.tsx
 *
 * Public read-only view of a shared chat (todo:47067537). Server-rendered,
 * no auth — modeled on blog/[slug]/page.tsx: query-layer gate
 * (getShareBySlug returns only non-revoked shares), notFound() on miss,
 * force-dynamic so a revoke takes effect immediately.
 *
 * Everything renders from the session_shares snapshot — no sessions,
 * queries, or corpus reads. Assistant text gets its CITATIONS tail
 * stripped and citation cards come from the snapshot's rich objects,
 * falling back to the parsed tail block when retrieval attached none —
 * the exact rule chat-view applies to live history.
 *
 * robots noindex: share links are unlisted-by-obscurity; without it,
 * any crawled link would put private-ish conversations in search results.
 */

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getShareBySlug } from '@/lib/chat-public';
import { parseCitationsBlock } from '@/lib/citations';
import { remarkCiteLinks } from '@/lib/remark-citations';
import { MD_COMPONENTS } from '@/lib/markdown';
import Citation from '@/components/citation';
import ContinueButton from '@/components/continue-button';
import { clerkEnabled } from '@/lib/host';
import { tokens } from '@/styles/tokens';

export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const share = await getShareBySlug(slug);
  return {
    title: share?.title ? `${share.title} — Guru` : 'Shared conversation — Guru',
    robots: { index: false, follow: false },
  };
}

export default async function SharePage(
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const share = await getShareBySlug(slug);
  if (!share) notFound();

  // Continue-conversation needs Clerk (useUser + the sign-in bounce);
  // on the tailnet host there's no ClerkProvider, so the button is
  // simply absent — same gate as the layout's home button.
  const clerk = await clerkEnabled();

  return (
    <main
      style={{
        minHeight: '100vh',
        background: tokens.bg.deep,
        padding: '64px 24px',
      }}
    >
      <article style={{ maxWidth: 680, margin: '0 auto' }}>
        <p
          style={{
            fontFamily: tokens.font.mono,
            fontSize: 11,
            color: tokens.text.muted,
            letterSpacing: 2,
            textTransform: 'uppercase',
            margin: '0 0 8px',
          }}
        >
          Shared conversation
        </p>
        <h1
          style={{
            fontFamily: tokens.font.display,
            fontSize: 32,
            fontWeight: 600,
            color: tokens.text.primary,
            margin: '0 0 40px',
            lineHeight: 1.2,
          }}
        >
          {share.title ?? 'Untitled conversation'}
        </h1>

        {share.messages.map((m, i) => {
          const parsed = parseCitationsBlock(m.response_text ?? '');
          const cards = m.citations.length > 0 ? m.citations : parsed.citations;
          return (
            <section key={i} style={{ marginBottom: 40 }}>
              <p
                style={{
                  fontFamily: tokens.font.display,
                  fontSize: 17,
                  color: tokens.text.secondary,
                  fontStyle: 'italic',
                  lineHeight: 1.6,
                  margin: '0 0 16px',
                  paddingLeft: 16,
                  borderLeft: `2px solid ${tokens.border.subtle}`,
                }}
              >
                {m.query_text}
              </p>
              <div
                style={{
                  fontFamily: tokens.font.display,
                  fontSize: 17,
                  color: tokens.text.primary,
                  lineHeight: 1.8,
                }}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkCiteLinks(cards.map(c => ({ id: 'id' in c ? c.id : undefined, text: c.text, section: c.section })))]} components={MD_COMPONENTS}>
                  {parsed.body}
                </ReactMarkdown>
              </div>
              {cards.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  {cards.map((c, j) => (
                    <Citation
                      key={'id' in c ? `${c.id}-${j}` : `${i}-${j}`}
                      id={'id' in c ? c.id : undefined}
                      tradition={c.tradition}
                      text={c.text}
                      section={c.section}
                      quote={'quote' in c ? c.quote : undefined}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {clerk && <ContinueButton slug={share.slug} />}
      </article>
    </main>
  );
}
