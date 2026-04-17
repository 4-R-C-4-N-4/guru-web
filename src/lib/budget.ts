/**
 * src/lib/budget.ts
 *
 * TokenBudget — tracks available token capacity for prompt assembly.
 * Ensures retrieved chunks fit within the model's context window after
 * reserving space for the system prompt and expected response.
 */

import type { RetrievedChunk } from './types';

/** Rough token estimator: ~4 chars per token (good enough for budgeting). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class TokenBudget {
  private remaining: number;

  /**
   * @param contextWindow  Total context window size in tokens.
   * @param systemReserve  Tokens reserved for system prompt + instructions.
   * @param responseReserve Tokens reserved for the model's response.
   */
  constructor(
    contextWindow: number,
    systemReserve: number,
    responseReserve: number
  ) {
    this.remaining = contextWindow - systemReserve - responseReserve;
  }

  /** Returns how many tokens are still available. */
  get available(): number {
    return this.remaining;
  }

  /** Returns true if `tokens` fits in the remaining budget. */
  fits(tokens: number): boolean {
    return tokens <= this.remaining;
  }

  /** Consume `tokens` from the budget. Throws if over budget. */
  consume(tokens: number): void {
    if (tokens > this.remaining) {
      throw new Error(
        `TokenBudget exceeded: tried to consume ${tokens}, only ${this.remaining} remaining`
      );
    }
    this.remaining -= tokens;
  }

  /**
   * Filter a list of chunks to those that fit within the remaining budget.
   * Consumes budget for each accepted chunk.
   * Chunks are accepted in order — pass them pre-ranked.
   */
  fitChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
    const accepted: RetrievedChunk[] = [];
    for (const chunk of chunks) {
      const tokens = chunk.token_count ?? estimateTokens(chunk.body);
      if (this.fits(tokens)) {
        this.consume(tokens);
        accepted.push(chunk);
      }
    }
    return accepted;
  }
}

// ---------------------------------------------------------------------------
// Tier defaults (free vs pro)
// ---------------------------------------------------------------------------

const CONTEXT_WINDOWS = {
  free: 8_192,
  pro:  32_768,
} as const;

const SYSTEM_RESERVE  = 512;
const RESPONSE_RESERVE = 2_048;

export function makeBudget(tier: 'free' | 'pro'): TokenBudget {
  return new TokenBudget(CONTEXT_WINDOWS[tier], SYSTEM_RESERVE, RESPONSE_RESERVE);
}
