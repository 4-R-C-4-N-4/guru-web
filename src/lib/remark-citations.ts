/**
 * src/lib/remark-citations.ts
 *
 * Inline citation linkifier. The model writes inline citations as literal
 * bracket text — `[Tradition | Text | Section]` (CommonMark treats it as a
 * plain text node when no `(url)` follows). This remark plugin factory takes
 * the message's authoritative citation set (the same rows that render the
 * References cards, which carry chunk/summary ids) and turns each bracket
 * whose (text, section) resolves against that set into a link to the reader.
 *
 * Resolution is deliberately conservative: exact normalized (text, section)
 * match, else a unique normalized text match, else the bracket is left as
 * literal text — a wrong link is worse than no link. Ids that don't map to
 * a reader path (citationHref → null) also stay unlinked.
 *
 * Hand-rolled mdast walk instead of unist-util-visit: node splicing during
 * iteration is the whole job here, and doing it directly keeps the plugin
 * dependency-free.
 */

import { citationHref } from './read-path';

export interface CiteRef {
  id?: string;
  text: string;
  section: string;
}

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
}

/** `[A | B | C]` where A/B contain no pipes/brackets; C may contain pipes
 *  (the model sometimes appends `| TIER: …` inline — only C's first pipe
 *  segment is the section). */
const CITE_RE = /\[([^\][|]+)\|([^\][|]+)\|([^\][]+)\]/g;

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildResolver(citations: CiteRef[]): (text: string, section: string) => string | null {
  const bySection = new Map<string, string>();
  const byText = new Map<string, string | null>(); // null = ambiguous
  for (const c of citations) {
    const href = citationHref(c.id);
    if (!href) continue;
    bySection.set(`${norm(c.text)}|${norm(c.section)}`, href);
    const t = norm(c.text);
    byText.set(t, byText.has(t) && byText.get(t) !== href ? null : href);
  }
  return (text, section) =>
    bySection.get(`${norm(text)}|${norm(section)}`) ?? byText.get(norm(text)) ?? null;
}

function splitTextNode(node: MdNode, resolve: (t: string, s: string) => string | null): MdNode[] | null {
  const value = node.value ?? '';
  CITE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  let last = 0;
  const out: MdNode[] = [];
  while ((match = CITE_RE.exec(value)) !== null) {
    const [full, , text, sectionRaw] = match;
    const section = sectionRaw.split('|')[0];
    const href = resolve(text, section);
    if (!href) continue;
    if (match.index > last) out.push({ type: 'text', value: value.slice(last, match.index) });
    out.push({ type: 'link', url: href, children: [{ type: 'text', value: full }] });
    last = match.index + full.length;
  }
  if (out.length === 0) return null;
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}

/** Factory: returns a remark plugin bound to one message's citation set. */
export function remarkCiteLinks(citations: CiteRef[]) {
  const resolve = buildResolver(citations);

  return function plugin() {
    return (tree: MdNode) => {
      const walk = (node: MdNode) => {
        if (!node.children) return;
        // Never linkify inside existing links or code.
        if (node.type === 'link' || node.type === 'linkReference') return;
        const next: MdNode[] = [];
        for (const child of node.children) {
          if (child.type === 'text') {
            const replaced = splitTextNode(child, resolve);
            if (replaced) { next.push(...replaced); continue; }
          }
          walk(child);
          next.push(child);
        }
        node.children = next;
      };
      walk(tree);
    };
  };
}
