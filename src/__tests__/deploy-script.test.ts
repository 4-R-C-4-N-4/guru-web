/**
 * src/__tests__/deploy-script.test.ts
 *
 * Source-level guard for deploy/deploy.sh (todo:ac54f095).
 *
 * The CI prune step ('xargs -r -I{} rm -rf -- {}') silently fails on
 * root-owned files left over from earlier emergency 'sudo deploy.sh'
 * runs, which let old releases accumulate forever and eventually fill
 * the disk. The self-heal chown at the top of deploy.sh fixes that —
 * lock in that it stays present and runs BEFORE the prune.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  resolve(__dirname, '../../deploy/deploy.sh'),
  'utf8',
);

describe('deploy.sh self-heal', () => {
  it('runs sudo chown -R deploy:deploy on the releases tree', () => {
    expect(SRC).toMatch(
      /sudo\s+\S*chown\s+-R\s+deploy:deploy\s+["']?\$\{?ROOT\}?\/releases["']?/,
    );
  });

  it('tolerates a missing sudoers entry (|| true)', () => {
    // Without the trailing `|| true`, a fresh VPS without the new
    // sudoers line would crash every deploy.
    expect(SRC).toMatch(
      /sudo\s+\S*chown\s+-R\s+deploy:deploy[^\n]*\|\|\s*true/,
    );
  });

  it('runs before the prune step', () => {
    const chownIdx = SRC.search(/sudo\s+\S*chown\s+-R\s+deploy:deploy/);
    const pruneIdx = SRC.search(/prune to last/);
    expect(chownIdx).toBeGreaterThan(-1);
    expect(pruneIdx).toBeGreaterThan(-1);
    expect(chownIdx).toBeLessThan(pruneIdx);
  });
});

describe('deploy.sh self-update', () => {
  it('compares $SELF against the in-repo copy and re-execs on diff', () => {
    expect(SRC).toMatch(/cmp\s+-s\s+["']?\$SELF["']?\s+["']?\$NEW_SCRIPT["']?/);
    expect(SRC).toMatch(/exec\s+["']?\$SELF["']?\s+["']?\$@["']?/);
  });

  it('runs after git fetch (so $RELEASE has the new version) and before npm ci', () => {
    const fetchIdx = SRC.indexOf('git -C "$RELEASE" fetch');
    const selfUpdateIdx = SRC.search(/cmp\s+-s\s+["']?\$SELF["']?/);
    const npmCiIdx = SRC.indexOf('npm ci');
    expect(fetchIdx).toBeGreaterThan(-1);
    expect(selfUpdateIdx).toBeGreaterThan(-1);
    expect(npmCiIdx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeLessThan(selfUpdateIdx);
    expect(selfUpdateIdx).toBeLessThan(npmCiIdx);
  });

  it('canonicalizes $0 via readlink -f so symlink invocations still resolve', () => {
    expect(SRC).toMatch(/readlink\s+-f\s+["']?\$0["']?/);
  });
});

describe('vps-bootstrap.sh sudoers stanza', () => {
  const BOOTSTRAP = readFileSync(
    resolve(__dirname, '../../deploy/vps-bootstrap.sh'),
    'utf8',
  );

  it('grants deploy NOPASSWD for the chown self-heal', () => {
    expect(BOOTSTRAP).toMatch(
      /deploy\s+ALL=\(root\)\s+NOPASSWD:\s*\/bin\/chown\s+-R\s+deploy\\?:deploy\s+\/srv\/guru-web\/releases/,
    );
  });

  it('runs migrations as guru, not postgres (todo:d5b272a3)', () => {
    // Sudoers: target user must be (guru), not (postgres). The form must
    // match the stdin-pipe shape deploy.sh actually uses (no `-f *`).
    expect(BOOTSTRAP).toMatch(
      /deploy\s+ALL=\(guru\)\s+NOPASSWD:\s*\/usr\/bin\/psql\s+-d\s+guru\s+-1\s*$/m,
    );
    expect(BOOTSTRAP).not.toMatch(/deploy\s+ALL=\(postgres\)\s+NOPASSWD/);
  });

  it('resets app-table ownership to guru in step_postgres (todo:56e5b545)', () => {
    // The DO block scans pg_tables for non-guru-owned tables in public
    // and ALTERs them. Idempotent. Targets public only — corpus.* stays
    // postgres-owned (refreshed by the export pipeline).
    expect(BOOTSTRAP).toMatch(/schemaname\s*=\s*'public'\s+AND\s+tableowner\s*<>\s*'guru'/);
    expect(BOOTSTRAP).toMatch(/ALTER TABLE %I\.%I OWNER TO guru/);
  });
});

describe('deploy.sh migration runner', () => {
  it('runs migrations as guru via sudo -u guru, not as postgres superuser', () => {
    expect(SRC).toMatch(/sudo\s+-u\s+guru\s+\/usr\/bin\/psql\s+-d\s+guru\s+-1/);
    expect(SRC).not.toMatch(/sudo\s+-u\s+postgres\s+\/usr\/bin\/psql/);
  });

  it('drops the SET ROLE guru prefix (no longer needed when running as guru)', () => {
    // Old form: { echo "SET ROLE guru;"; cat $f; } | sudo -u postgres psql
    // New form: sudo -u guru psql -d guru -1 < $f
    // Match the bash command form, not stray comments referring to it.
    expect(SRC).not.toMatch(/echo\s+["']SET\s+ROLE\s+guru/);
  });
});
