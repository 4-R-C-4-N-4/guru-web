/**
 * src/lib/search.ts
 *
 * Public corpus search for /read/search (todo:3c342f3b) — the reader's
 * "semantic ctrl-F". Reuses the chat retriever's vector + lexical legs and
 * additive rerank verbatim, minus the graph walk and quality filter (this
 * surface finds passages, it doesn't assemble prompts):
 *
 *   embed query (local Ollama, no API cost)
 *     → pgvector cosine leg + websearch-OR lexical leg, both scoped by the
 *       same buildScopeFilter SQL the chat scope uses
 *     → mergeAndRerank with the per-tradition cap DISABLED (a searcher who
 *       filtered to one tradition wants depth, not diversity)
 *
 * Degrades gracefully: if Ollama is down (EmbedError) the lexical leg still
 * answers, flagged so the page can say "exact-word matches only".
 */

import { EmbedError } from './embed';
import { vectorSearch, lexicalSearch, mergeAndRerank } from './retriever';
import type { RetrievedChunk, UserPreferences } from './types';

export interface SearchFilters {
  tradition?: string;
  text?: string;
}

export interface SearchResult {
  chunks: RetrievedChunk[];
  /** true when the vector leg was unavailable and only lexical ran. */
  lexicalOnly: boolean;
}

export const SEARCH_TOP_K = 20;
/** Per-leg oversample so the rerank has something to blend. */
const LEG_LIMIT = 40;

/** Express the page's filters in the retriever's own scoping language. */
export function filtersToPrefs(f: SearchFilters): UserPreferences {
  const scoped = Boolean(f.tradition || f.text);
  return {
    scopeMode: scoped ? 'whitelist' : 'all',
    blockedTraditions: [],
    blockedTexts: [],
    whitelistedTraditions: f.tradition ? [f.tradition] : [],
    whitelistedTexts: f.text ? [f.text] : [],
    preferredModel: null,
    preferredVoice: 'scholar',
  };
}

export async function searchCorpus(
  q: string,
  filters: SearchFilters = {},
  topK: number = SEARCH_TOP_K,
): Promise<SearchResult> {
  const prefs = filtersToPrefs(filters);

  const lexicalP = lexicalSearch(q, prefs, LEG_LIMIT);
  let vector: RetrievedChunk[] = [];
  let lexicalOnly = false;
  try {
    vector = await vectorSearch(q, prefs, LEG_LIMIT);
  } catch (e) {
    if (!(e instanceof EmbedError)) throw e;
    lexicalOnly = true; // Ollama down — serve exact-word matches, say so.
  }
  const lexical = await lexicalP;

  const chunks = mergeAndRerank(vector, [], topK, {
    lexicalResults: lexical,
    perTraditionCap: 0,
  });
  return { chunks, lexicalOnly };
}
