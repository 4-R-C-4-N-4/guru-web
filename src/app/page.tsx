import Link from 'next/link';
import Citation from '@/components/citation';
import { tokens } from '@/styles/tokens';

export default function LandingPage() {
  const traditionKeys = Object.keys(tokens.tradition) as (keyof typeof tokens.tradition)[];

  return (
    <div style={{
      minHeight: '100vh', background: tokens.bg.deep,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden',
      padding: '40px 20px',
    }}>
      {/* Radial glow */}
      <div style={{
        position: 'absolute', width: 600, height: 600, borderRadius: '50%',
        top: '30%', left: '50%', transform: 'translate(-50%, -50%)',
        background: `radial-gradient(circle, ${tokens.text.accent}08 0%, transparent 70%)`,
        filter: 'blur(60px)', pointerEvents: 'none',
      }} />

      {/* Grid */}
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.03,
        backgroundImage: `linear-gradient(0deg, ${tokens.text.primary} 1px, transparent 1px),
                          linear-gradient(90deg, ${tokens.text.primary} 1px, transparent 1px)`,
        backgroundSize: '80px 80px',
      }} />

      <div style={{ textAlign: 'center', position: 'relative', zIndex: 1, width: '100%', maxWidth: 560 }}>
        {/* Logo */}
        <div style={{
          fontFamily: tokens.font.display, fontSize: 72, fontWeight: 300,
          color: tokens.text.accent, letterSpacing: 16, marginBottom: 8,
        }}>GURU</div>

        <div style={{
          fontFamily: tokens.font.mono, fontSize: 11, color: tokens.text.muted,
          letterSpacing: 4, marginBottom: 48, textTransform: 'uppercase',
        }}>Cross-Tradition Esoteric Analysis</div>

        {/* Tradition badges */}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginBottom: 48 }}>
          {traditionKeys.map(t => (
            <span key={t} style={{
              fontFamily: tokens.font.mono, fontSize: 9, color: tokens.tradition[t],
              padding: '3px 8px', border: `1px solid ${tokens.tradition[t]}33`,
              borderRadius: 2, textTransform: 'uppercase', letterSpacing: 1,
            }}>{t}</span>
          ))}
        </div>

        {/* Tagline */}
        <p style={{
          fontFamily: tokens.font.display, fontSize: 18, color: tokens.text.secondary,
          maxWidth: 480, margin: '0 auto', marginBottom: 40, lineHeight: 1.7,
          fontStyle: 'italic',
        }}>
          Discover the hidden threads between Gnostic aeons, Kabbalistic sefirot,
          Neoplatonic emanations, and Vedantic consciousness — traced to their sources,
          every claim cited.
        </p>

        {/* CTAs */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/sign-up" style={{
            fontFamily: tokens.font.mono, fontSize: 12, padding: '12px 32px',
            background: tokens.text.accent, color: tokens.bg.deep,
            border: 'none', borderRadius: 2, cursor: 'pointer',
            fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase',
            textDecoration: 'none', display: 'inline-block',
          }}>Begin</Link>
          <Link href="/sign-in" style={{
            fontFamily: tokens.font.mono, fontSize: 12, padding: '12px 32px',
            background: 'none', color: tokens.text.secondary,
            border: `1px solid ${tokens.border.medium}`, borderRadius: 2,
            letterSpacing: 1, textDecoration: 'none', display: 'inline-block',
          }}>Sign In</Link>
        </div>

        {/* Sample query preview */}
        <div style={{
          marginTop: 64, background: tokens.bg.surface,
          border: `1px solid ${tokens.border.subtle}`,
          borderRadius: 4, padding: 20, textAlign: 'left',
        }}>
          <div style={{
            fontFamily: tokens.font.mono, fontSize: 10, color: tokens.text.muted,
            marginBottom: 10, letterSpacing: 1,
          }}>SAMPLE QUERY</div>

          <div style={{
            fontFamily: tokens.font.display, fontSize: 15, color: tokens.text.primary,
            marginBottom: 14, lineHeight: 1.6,
          }}>
            &ldquo;How does the concept of divine spark appear across traditions?&rdquo;
          </div>

          <Citation
            tradition="Gnosticism" text="Gospel of Thomas" section="Logion 77"
            quote="I am the light that is over all things."
            tier="verified"
          />
          <Citation tradition="Vedanta" text="Chandogya Upanishad" section="6.8.7" tier="verified" />
          <Citation tradition="Hermeticism" text="Corpus Hermeticum" section="Tractate I.6" tier="proposed" />

          <div style={{
            fontFamily: tokens.font.mono, fontSize: 9, color: tokens.text.muted,
            marginTop: 10, display: 'flex', gap: 16, flexWrap: 'wrap',
          }}>
            <span>◆ 4 verified</span><span>◇ 2 proposed</span><span>5 traditions</span>
          </div>
        </div>
      </div>
    </div>
  );
}
