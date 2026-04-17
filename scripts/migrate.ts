/**
 * scripts/migrate.ts
 *
 * Run all SQL migrations in migrations/ in filename order against DATABASE_URL.
 * Idempotent — all migrations use IF NOT EXISTS.
 *
 * Usage:
 *   npx tsx scripts/migrate.ts
 *   npm run migrate
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { Pool } from 'pg';

async function migrate() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const pool = new Pool({ connectionString: url });

  const migrationsDir = join(process.cwd(), 'migrations');
  const files = (await readdir(migrationsDir))
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('No migration files found.');
    await pool.end();
    return;
  }

  console.log(`Running ${files.length} migration(s)…`);

  for (const file of files) {
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    console.log(`  → ${file}`);
    await pool.query(sql);
  }

  console.log('Migrations complete.');
  await pool.end();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
