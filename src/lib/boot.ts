/**
 * src/lib/boot.ts
 *
 * Runs once at server startup (loaded via instrumentation.ts → register()).
 * Asserts critical environment + reachability so misconfigs fail fast at
 * boot rather than at the first user request.
 *
 * Throws BootError on any required check failure → Next.js startup fails →
 * systemd reports the unit as failed → operator gets a clear signal.
 *
 * What we check:
 *   - Required env vars are present (and non-empty) — includes the
 *     Clerk + Stripe webhook secrets, since a missing secret silently
 *     500s every webhook with no operator-visible signal at boot
 *   - Ollama is reachable and serves the expected embedding model
 *   - Embedding dimension matches what the corpus was built with (768)
 *
 * What we do NOT check:
 *   - Database connection: implicit via systemd Requires=postgresql.service.
 *   - Stripe / Clerk / OpenRouter API reachability: SDKs lazy-init on first
 *     use; pre-flight pings would burn quota and add boot latency.
 */

const REQUIRED_ENV = [
  'DATABASE_URL',
  'OPENROUTER_API_KEY',
  'CLERK_SECRET_KEY',
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'CLERK_WEBHOOK_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_PRO_PRICE_ID',
  'STRIPE_WEBHOOK_SECRET',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_APP_URL',
] as const;

// MUST match the model used by guru-pipeline when embedding the corpus.
// nomic-embed-text:v1.5 produces 768-dimensional vectors. If this mismatches,
// vector queries against the chunks table return wrong/no results.
const EMBED_MODEL = 'nomic-embed-text:v1.5';
const EXPECTED_EMBED_DIM = 768;

// MUST match SCHEMA_VERSION in scripts/export.py (guru repo). Bump in
// the same deploy as schema/corpus-schema.sql changes.
// v3 (2026-05-27): concept hierarchy — domains → families → concepts + alias
// tables (todo:30dca55e; handoff §1, §5.2). Lockstep: the export raises if the
// corpus's schema_version != 3, so this must advance in the same deploy.
export const EXPECTED_SCHEMA_VERSION = '3';

export class BootError extends Error {
  constructor(message: string) {
    super(`[boot] ${message}`);
    this.name = 'BootError';
  }
}

function checkEnv(): void {
  const missing = REQUIRED_ENV.filter(k => !process.env[k]);
  if (missing.length > 0) {
    throw new BootError(`Missing required env: ${missing.join(', ')}`);
  }
}

async function checkOllama(): Promise<void> {
  const url = process.env.OLLAMA_URL ?? 'http://localhost:11434';

  let response: Response;
  try {
    response = await fetch(`${url}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input: 'boot-check' }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new BootError(
      `Ollama unreachable at ${url}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new BootError(
      `Ollama /api/embed returned ${response.status}: ${body.slice(0, 200)}`
    );
  }

  const json = (await response.json()) as { embeddings?: number[][] };
  const vec = json.embeddings?.[0];

  if (!Array.isArray(vec) || vec.length === 0) {
    throw new BootError(
      `Ollama returned malformed payload — model ${EMBED_MODEL} not pulled?`
    );
  }

  if (vec.length !== EXPECTED_EMBED_DIM) {
    throw new BootError(
      `Embedding dim mismatch: expected ${EXPECTED_EMBED_DIM} (model ${EMBED_MODEL}), got ${vec.length}. ` +
      `If you changed the embedding model, the corpus needs to be re-embedded by guru-pipeline.`
    );
  }

  console.log(`[boot] Ollama OK at ${url} (model=${EMBED_MODEL}, dim=${vec.length})`);
}

export async function checkCorpus(): Promise<void> {
  const { one } = await import('./db');
  // Fully qualified `corpus.corpus_metadata` (not relying on search_path)
  // so a missing schema fails with a clear "schema not found" error
  // even if the Pool's search_path option is misconfigured.
  const row = await one<{ value: string }>(
    `SELECT value FROM corpus.corpus_metadata WHERE key = 'schema_version'`
  );
  if (!row) {
    throw new BootError('Corpus schema not found. Load a corpus export first.');
  }
  if (row.value !== EXPECTED_SCHEMA_VERSION) {
    throw new BootError(
      `Corpus schema version mismatch: expected ${EXPECTED_SCHEMA_VERSION}, got ${row.value}`
    );
  }
  console.log(`[boot] Corpus OK (schema_version=${row.value})`);
}

let _booted = false;

export async function boot(): Promise<void> {
  if (_booted) return;
  _booted = true;

  checkEnv();
  await checkOllama();
  await checkCorpus();

  console.log('[boot] all checks passed');
}
