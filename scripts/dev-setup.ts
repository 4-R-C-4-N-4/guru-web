/**
 * scripts/dev-setup.ts
 *
 * One-shot, idempotent local-dev setup. Runs automatically before
 * `npm run dev` via the `predev` hook. Safe to re-run.
 *
 * Steps (each skipped when already satisfied — fast path is ~1 SELECT):
 *   1. Postgres reachable? If not, `docker compose up -d postgres` and wait.
 *   2. Corpus loaded? Check corpus.corpus_metadata.schema_version; if
 *      missing or stale, pipe ../guru/export/guru-corpus.sql.gz through psql.
 *      The dump is a single transaction that does its own atomic swap.
 *   3. App migrations: run npm run migrate (all use IF NOT EXISTS).
 *   4. model_pricing populated? If empty, run sync-pricing.
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

const CORPUS_DUMP = join(process.cwd(), '..', 'guru', 'export', 'guru-corpus.sql.gz');
const EXPECTED_SCHEMA_VERSION = '2';

function run(cmd: string, args: string[], opts: { stdio?: 'inherit' | 'pipe'; input?: string } = {}): { code: number; stdout: string } {
  const res = spawnSync(cmd, args, {
    stdio: opts.stdio ?? 'inherit',
    encoding: 'utf8',
    input: opts.input,
  });
  return { code: res.status ?? 1, stdout: res.stdout ?? '' };
}

async function ensurePostgres(): Promise<Pool> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (check .env)');

  const tryConnect = async (): Promise<Pool | null> => {
    const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 2000 });
    try {
      await pool.query('SELECT 1');
      return pool;
    } catch {
      await pool.end().catch(() => {});
      return null;
    }
  };

  let pool = await tryConnect();
  if (pool) return pool;

  console.log('[dev-setup] Postgres unreachable — starting via docker compose…');
  const up = run('docker', ['compose', 'up', '-d', 'postgres']);
  if (up.code !== 0) throw new Error('docker compose up failed');

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    pool = await tryConnect();
    if (pool) {
      console.log('[dev-setup] Postgres ready.');
      return pool;
    }
  }
  throw new Error('Postgres did not become ready within 30s');
}

async function ensureCorpus(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ value: string }>(`
    SELECT value FROM corpus.corpus_metadata WHERE key = 'schema_version'
  `).catch(() => ({ rows: [] as { value: string }[] }));

  if (rows[0]?.value === EXPECTED_SCHEMA_VERSION) return;

  if (!existsSync(CORPUS_DUMP)) {
    throw new Error(
      `Corpus dump not found at ${CORPUS_DUMP}. ` +
      `Export it from the guru repo (scripts/export.py) or symlink the file.`
    );
  }

  console.log(`[dev-setup] Loading corpus from ${CORPUS_DUMP}…`);
  const zcat = spawnSync('zcat', [CORPUS_DUMP], { encoding: 'buffer' });
  if (zcat.status !== 0) throw new Error('zcat failed on corpus dump');
  const psql = spawnSync(
    'docker',
    ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'guru', '-d', 'guru', '-v', 'ON_ERROR_STOP=1'],
    { input: zcat.stdout, stdio: ['pipe', 'inherit', 'inherit'] }
  );
  if (psql.status !== 0) throw new Error('Loading corpus dump failed');
  console.log('[dev-setup] Corpus loaded.');
}

async function ensureMigrations(): Promise<void> {
  console.log('[dev-setup] Running app migrations…');
  const res = run('npm', ['run', '--silent', 'migrate']);
  if (res.code !== 0) throw new Error('migrate failed');
}

async function ensurePricing(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{ count: string }>(`SELECT count(*) FROM model_pricing`);
  if (Number(rows[0]?.count ?? '0') > 0) return;

  console.log('[dev-setup] model_pricing empty — running sync-pricing…');
  const res = run('npm', ['run', '--silent', 'sync-pricing']);
  if (res.code !== 0) throw new Error('sync-pricing failed');
}

async function main(): Promise<void> {
  const pool = await ensurePostgres();
  try {
    await ensureCorpus(pool);
    await ensureMigrations();
    await ensurePricing(pool);
    console.log('[dev-setup] OK.');
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('[dev-setup] FAILED:', err.message);
  process.exit(1);
});
