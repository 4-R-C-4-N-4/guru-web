/**
 * src/lib/slug.ts
 *
 * Slug helper for blog_posts, factored out of blog-generate so the lighter
 * callers (admin-blog's manual-post create) don't transitively pull the
 * retrieval/LLM stack just to slugify a title.
 */

import { one } from './db';

/**
 * Slugify a title and guarantee uniqueness against the blog_posts.slug UNIQUE
 * constraint by appending -2, -3, … on collision (BRD §10.4, KISS).
 */
export async function uniqueSlug(title: string): Promise<string> {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'post';

  let candidate = base;
  let n = 1;
  // Loop until a slug not already taken. Bounded in practice by collisions.
  for (;;) {
    const existing = await one<{ id: string }>(
      `SELECT id FROM blog_posts WHERE slug = $1`,
      [candidate],
    );
    if (!existing) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}
