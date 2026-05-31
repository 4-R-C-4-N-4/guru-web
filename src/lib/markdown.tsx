/**
 * src/lib/markdown.tsx
 *
 * Shared react-markdown component map. Extracted verbatim from
 * chat-view.tsx (IMPL T5) so the chat surface and the public blog page
 * render markdown identically.
 *
 * This is a STATIC module-level const — it does NOT vary on `mobile`.
 * (chat-view's mobile-conditional sizing lives in its surrounding layout
 * JSX, not in this component map.) So there is no factory and no `mobile`
 * param: a server component like the blog page can import it directly.
 *
 * Assistant/essay markdown comes back as standard markdown (headings,
 * **bold**, lists, code fences, blockquotes, GFM tables). The overrides
 * match the token system — display font for prose, mono for code, accent
 * for links. `remark-gfm` is wired by the caller at the <ReactMarkdown>
 * site, not here.
 */

import { type Components } from 'react-markdown';
import { tokens } from '@/styles/tokens';

export const MD_COMPONENTS: Components = {
  h1: (p) => <h2 style={{ fontFamily: tokens.font.display, fontSize: 22, fontWeight: 600, color: tokens.text.primary, margin: '14px 0 8px', letterSpacing: 1 }} {...p} />,
  h2: (p) => <h3 style={{ fontFamily: tokens.font.display, fontSize: 19, fontWeight: 600, color: tokens.text.primary, margin: '12px 0 6px' }} {...p} />,
  h3: (p) => <h4 style={{ fontFamily: tokens.font.display, fontSize: 16, fontWeight: 600, color: tokens.text.primary, margin: '10px 0 4px' }} {...p} />,
  h4: (p) => <h5 style={{ fontFamily: tokens.font.mono,    fontSize: 11, color: tokens.text.muted,   margin: '10px 0 4px', letterSpacing: 1, textTransform: 'uppercase' }} {...p} />,
  p:  (p) => <p style={{ margin: '0 0 10px', lineHeight: 1.7 }} {...p} />,
  strong: (p) => <strong style={{ fontWeight: 600, color: tokens.text.primary }} {...p} />,
  em:     (p) => <em style={{ fontStyle: 'italic', color: tokens.text.secondary }} {...p} />,
  ul: (p) => <ul style={{ margin: '4px 0 10px', paddingLeft: 22, lineHeight: 1.7 }} {...p} />,
  ol: (p) => <ol style={{ margin: '4px 0 10px', paddingLeft: 22, lineHeight: 1.7 }} {...p} />,
  li: (p) => <li style={{ marginBottom: 2 }} {...p} />,
  blockquote: (p) => <blockquote style={{ margin: '8px 0', padding: '4px 12px', borderLeft: `2px solid ${tokens.text.accent}`, color: tokens.text.secondary, fontStyle: 'italic' }} {...p} />,
  a: (p) => <a target="_blank" rel="noreferrer" style={{ color: tokens.text.link, textDecoration: 'underline', textDecorationColor: 'rgba(122,158,194,0.4)' }} {...p} />,
  code: ({ className, children, ...rest }) => {
    // Block-level code (```lang) gets a className; inline code does not.
    const inline = !className;
    if (inline) {
      return (
        <code style={{
          fontFamily: tokens.font.mono, fontSize: '0.9em',
          background: tokens.bg.raised, padding: '1px 5px', borderRadius: 2,
          color: tokens.text.primary,
        }} {...rest}>{children}</code>
      );
    }
    return <code className={className} style={{ fontFamily: tokens.font.mono }} {...rest}>{children}</code>;
  },
  pre: (p) => (
    <pre style={{
      background: tokens.bg.raised,
      border: `1px solid ${tokens.border.subtle}`,
      borderRadius: 3, padding: 12, margin: '8px 0',
      overflowX: 'auto',
      fontFamily: tokens.font.mono, fontSize: 12, lineHeight: 1.5,
    }} {...p} />
  ),
  hr: () => <hr style={{ border: 'none', borderTop: `1px solid ${tokens.border.subtle}`, margin: '14px 0' }} />,
  table: (p) => <table style={{ borderCollapse: 'collapse', margin: '8px 0', fontSize: 13 }} {...p} />,
  th:    (p) => <th style={{ borderBottom: `1px solid ${tokens.border.subtle}`, padding: '4px 8px', textAlign: 'left', color: tokens.text.muted, fontFamily: tokens.font.mono, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }} {...p} />,
  td:    (p) => <td style={{ borderBottom: `1px solid ${tokens.border.subtle}`, padding: '4px 8px' }} {...p} />,
};
