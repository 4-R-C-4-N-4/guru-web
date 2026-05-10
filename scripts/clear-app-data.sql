-- scripts/clear-app-data.sql
--
-- Wipe all app-side user data so the deployment can go to prod with a
-- clean slate. The corpus (traditions, texts, concepts, chunks, edges,
-- corpus_metadata) and the model_pricing price history are preserved.
--
-- Tables truncated:
--   users, sessions, queries, user_preferences,
--   quota_usage, rate_limits, user_budgets
--
-- All FKs are ON DELETE CASCADE, but listing every table explicitly
-- in a single TRUNCATE makes the blast radius auditable and avoids
-- needing CASCADE.
--
-- Usage on the VPS (as postgres user — mirrors the corpus restore
-- pattern). Stdin redirection runs in your shell before sudo, so the
-- postgres user doesn't need read access to the repo checkout:
--   sudo -u postgres psql guru -v ON_ERROR_STOP=1 < scripts/clear-app-data.sql
--
-- Usage with a connection string (local, CI, or anywhere DATABASE_URL
-- is exported):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/clear-app-data.sql
--
-- Dry run:
--   Replace the final COMMIT with ROLLBACK; the SELECTs still print so
--   you can see what would have happened.

\echo
\echo '=== Database: ' :DBNAME ' ==='
\echo

BEGIN;

\echo '--- Row counts BEFORE ---'
SELECT 'users'             AS table_name, COUNT(*) FROM users
UNION ALL SELECT 'sessions',           COUNT(*) FROM sessions
UNION ALL SELECT 'queries',            COUNT(*) FROM queries
UNION ALL SELECT 'user_preferences',   COUNT(*) FROM user_preferences
UNION ALL SELECT 'quota_usage',        COUNT(*) FROM quota_usage
UNION ALL SELECT 'rate_limits',        COUNT(*) FROM rate_limits
UNION ALL SELECT 'user_budgets',       COUNT(*) FROM user_budgets
UNION ALL SELECT 'model_pricing (kept)', COUNT(*) FROM model_pricing;

TRUNCATE TABLE
    queries,
    sessions,
    user_preferences,
    quota_usage,
    rate_limits,
    user_budgets,
    users;

\echo
\echo '--- Row counts AFTER ---'
SELECT 'users'             AS table_name, COUNT(*) FROM users
UNION ALL SELECT 'sessions',           COUNT(*) FROM sessions
UNION ALL SELECT 'queries',            COUNT(*) FROM queries
UNION ALL SELECT 'user_preferences',   COUNT(*) FROM user_preferences
UNION ALL SELECT 'quota_usage',        COUNT(*) FROM quota_usage
UNION ALL SELECT 'rate_limits',        COUNT(*) FROM rate_limits
UNION ALL SELECT 'user_budgets',       COUNT(*) FROM user_budgets
UNION ALL SELECT 'model_pricing (kept)', COUNT(*) FROM model_pricing;

COMMIT;
