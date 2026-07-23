'use client';

/**
 * src/components/landing.tsx
 *
 * The signed-out marketing landing (moved out of src/app/page.tsx so that file
 * can be an async server component that fetches posts). Renders the GURU hero +
 * Begin/Sign In CTA, then a "Latest Essays" feed of real published posts below
 * the fold. Signed-in visitors are bounced to /chat from an effect (never see
 * this) — the redirect must stay in useEffect, not render (todo:08fd0a9a); the
 * landing-page-redirect guard pins that contract to this file.
 */

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import EssayCard from '@/components/essay-card';
import type { PublishedListItem } from '@/lib/blog-public';
import { tokens } from '@/styles/tokens';
import { useIsMobile } from '@/hooks/use-is-mobile';

export default function Landing(
  { posts, traditions }: { posts: PublishedListItem[]; traditions: string[] },
) {
  const mobile = useIsMobile();
  const { isLoaded, isSignedIn } = useUser();
  const router = useRouter();

  // Redirect signed-in users to /chat. Must run from an effect, not during
  // render — calling router.replace() inline triggers React's "Cannot update a
  // component while rendering a different component" warning under React 19 /
  // Next 16.
  useEffect(() => {
    if (isLoaded && isSignedIn) router.replace('/chat');
  }, [isLoaded, isSignedIn, router]);

  if (isLoaded && isSignedIn) return null;

  return (
    <div style={{ background: tokens.bg.deep, minHeight: '100vh' }}>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section style={{
        minHeight: '88vh',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        position: 'relative', overflow: 'hidden',
        padding: mobile ? '40px 20px' : '60px 24px',
      }}>
        {/* Radial glow */}
        <div style={{
          position: 'absolute', width: mobile ? 300 : 600, height: mobile ? 300 : 600, borderRadius: '50%',
          top: '30%', left: '50%', transform: 'translate(-50%, -50%)',
          background: `radial-gradient(circle, ${tokens.text.accent}08 0%, transparent 70%)`,
          filter: 'blur(60px)', pointerEvents: 'none',
        }} />

        <div style={{ textAlign: 'center', position: 'relative', zIndex: 1, width: '100%', maxWidth: 560 }}>
          {/* Logo */}
          <div style={{
            fontFamily: tokens.font.display, fontSize: mobile ? 48 : 72, fontWeight: 300,
            color: tokens.text.accent, letterSpacing: mobile ? 10 : 16, marginBottom: 8,
          }}>GURU</div>

          {/* Corpus spectrum echo — the same tradition-hue band the scope
              page uses, rendered from the live tradition list (prominence
              order). No corpus → no strip; absence stays visible. */}
          {traditions.length > 0 && (
            <div aria-hidden style={{
              display: 'flex', gap: 1, height: 2, width: mobile ? 180 : 260,
              margin: '0 auto 14px', borderRadius: 1, overflow: 'hidden',
            }}>
              {traditions.map(t => (
                <div key={t} style={{
                  flex: 1,
                  background: tokens.tradition[t as keyof typeof tokens.tradition] ?? tokens.text.secondary,
                  opacity: 0.8,
                }} />
              ))}
            </div>
          )}

          <div style={{
            fontFamily: tokens.font.mono, fontSize: mobile ? 10 : 11, color: tokens.text.muted,
            letterSpacing: mobile ? 2 : 4, marginBottom: mobile ? 32 : 48, textTransform: 'uppercase',
          }}>Cross-Tradition Esoteric Analysis</div>

          {/* Tradition badges — dynamic from the corpus (most-represented
              first). No hardcoded fallback: if the corpus is empty the row is
              simply omitted, surfacing the missing data rather than masking it. */}
          {traditions.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: mobile ? 4 : 6, marginBottom: mobile ? 32 : 48 }}>
              {traditions.map(t => {
                const color = tokens.tradition[t as keyof typeof tokens.tradition] ?? tokens.text.secondary;
                return (
                  <span key={t} style={{
                    fontFamily: tokens.font.mono, fontSize: mobile ? 8 : 9, color,
                    padding: mobile ? '2px 5px' : '3px 8px', border: `1px solid ${color}33`,
                    borderRadius: 2, textTransform: 'uppercase', letterSpacing: 1,
                  }}>{t.replace(/_/g, ' ')}</span>
                );
              })}
            </div>
          )}

          {/* Tagline */}
          <p style={{
            fontFamily: tokens.font.display, fontSize: mobile ? 15 : 18, color: tokens.text.secondary,
            maxWidth: 480, margin: '0 auto', marginBottom: mobile ? 28 : 40, lineHeight: 1.7,
            fontStyle: 'italic', padding: mobile ? '0 8px' : 0,
          }}>
            Discover the hidden threads between Gnostic aeons, Kabbalistic sefirot,
            Neoplatonic emanations, and Taoist non-being — traced to their sources,
            every claim cited.
          </p>

          {/* CTAs */}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexDirection: mobile ? 'column' : 'row', padding: mobile ? '0 24px' : 0 }}>
            <Link href="/sign-up" className="btn btn-primary" style={{
              padding: mobile ? '14px 32px' : '12px 32px',
              letterSpacing: 1, textTransform: 'uppercase',
              textDecoration: 'none', display: 'inline-block', textAlign: 'center',
            }}>Begin</Link>
            <Link href="/sign-in" className="btn btn-ghost" style={{
              padding: mobile ? '14px 32px' : '12px 32px',
              letterSpacing: 1, textDecoration: 'none', display: 'inline-block', textAlign: 'center',
            }}>Sign in</Link>
          </div>
        </div>
      </section>

      {/* ── Latest Essays ────────────────────────────────────────────── */}
      {posts.length > 0 && (
        <section style={{
          position: 'relative', zIndex: 1,
          padding: mobile ? '8px 20px 64px' : '8px 24px 96px',
        }}>
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            <div style={{
              fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.muted,
              letterSpacing: 3, marginBottom: 28, textTransform: 'uppercase',
            }}>Latest Essays</div>

            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {posts.map(post => (
                <li key={post.slug} style={{ marginBottom: 36 }}>
                  <EssayCard post={post} />
                </li>
              ))}
            </ul>

            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <Link href="/blog" className="text-link" style={{
                fontFamily: tokens.font.mono, fontSize: 12,
                letterSpacing: 1, textTransform: 'uppercase',
              }}>Read all essays →</Link>
              <Link href="/read" className="text-link" style={{
                fontFamily: tokens.font.mono, fontSize: 12,
                letterSpacing: 1, textTransform: 'uppercase',
              }}>Browse the source library →</Link>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
