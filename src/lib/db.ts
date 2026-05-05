import { Pool } from 'pg';

// connectionTimeoutMillis: pg.Pool's default is 0 (wait forever). Under
// pool exhaustion, requests would hang indefinitely instead of erroring,
// so a slow page becomes an indistinguishable hang rather than a 500
// the operator can see. 5s is well above normal acquire latency
// (typically <10ms) and well under typical proxy/Caddy upstream timeouts.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  options: '-c search_path=public,corpus',
});

export async function query<T = unknown>(text: string, params?: unknown[]): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export async function one<T = unknown>(text: string, params?: unknown[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function exec(text: string, params?: unknown[]): Promise<void> {
  await pool.query(text, params);
}
