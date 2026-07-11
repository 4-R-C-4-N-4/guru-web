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

  it('runs after the tarball unpack (so $RELEASE has the new version) and before migrations', () => {
    // Since todo:3ec0c41d the release arrives pre-built from CI — the
    // self-update source is the unpacked tarball, not a git checkout.
    const unpackIdx = SRC.search(/tar\s+-xzf\s+["']?\$TARBALL["']?/);
    const selfUpdateIdx = SRC.search(/cmp\s+-s\s+["']?\$SELF["']?/);
    const migrateIdx = SRC.indexOf('apply migrations');
    expect(unpackIdx).toBeGreaterThan(-1);
    expect(selfUpdateIdx).toBeGreaterThan(-1);
    expect(migrateIdx).toBeGreaterThan(-1);
    expect(unpackIdx).toBeLessThan(selfUpdateIdx);
    expect(selfUpdateIdx).toBeLessThan(migrateIdx);
  });

  it('canonicalizes $0 via readlink -f so symlink invocations still resolve', () => {
    expect(SRC).toMatch(/readlink\s+-f\s+["']?\$0["']?/);
  });
});

describe('deploy.sh supply-chain contract (todo:3ec0c41d)', () => {
  // Comments legitimately mention git/npm (documenting what the script
  // deliberately does NOT do) — match against comment-stripped code only.
  const CODE = SRC.split('\n').filter(l => !l.trim().startsWith('#')).join('\n');

  it('never talks to GitHub or npm — no git clone/fetch, no npm commands', () => {
    expect(CODE).not.toMatch(/\bgit\s+(clone|fetch|checkout)\b/);
    expect(CODE).not.toMatch(/\bnpm\s+(ci|install|run|prune)\b/);
  });

  it('fails loudly when the CI tarball is missing instead of rebuilding', () => {
    const guardIdx = CODE.search(/\[\[\s*!\s*-f\s*["']?\$TARBALL["']?\s*\]\]/);
    expect(guardIdx).toBeGreaterThan(-1);
    const unpackIdx = CODE.search(/tar\s+-xzf\s+["']?\$TARBALL["']?/);
    expect(guardIdx).toBeLessThan(unpackIdx);
  });

  it('validates $SHA as hex before building any rm -rf paths from it', () => {
    // The sha arrives from a workflow_dispatch input via a remote shell —
    // reject traversal/metacharacters before RELEASE/TARBALL are derived.
    const validateIdx = CODE.search(/\[0-9a-f\]\{7,40\}/);
    const firstRmIdx = CODE.search(/rm\s+-rf/);
    expect(validateIdx).toBeGreaterThan(-1);
    expect(firstRmIdx).toBeGreaterThan(-1);
    expect(validateIdx).toBeLessThan(firstRmIdx);
  });

  it('extracts into $STAGING then swaps, so a live $RELEASE is never gutted mid-unpack', () => {
    // Redeploying the SHA `current` points at must not rm -rf the tree the
    // running app is serving from for the duration of the extract — the
    // wipe happens only in the instant before the mv rename.
    const stageWipeIdx = CODE.search(/rm\s+-rf\s+["']?\$STAGING["']?/);
    const unpackIdx = CODE.search(/tar\s+-xzf\s+["']?\$TARBALL["']?\s+-C\s+["']?\$STAGING["']?/);
    const releaseWipeIdx = CODE.search(/rm\s+-rf\s+["']?\$RELEASE["']?/);
    const swapIdx = CODE.search(/mv\s+["']?\$STAGING["']?\s+["']?\$RELEASE["']?/);
    expect(stageWipeIdx).toBeGreaterThan(-1);
    expect(unpackIdx).toBeGreaterThan(-1);
    expect(releaseWipeIdx).toBeGreaterThan(-1);
    expect(swapIdx).toBeGreaterThan(-1);
    expect(stageWipeIdx).toBeLessThan(unpackIdx);
    expect(unpackIdx).toBeLessThan(releaseWipeIdx);
    expect(releaseWipeIdx).toBeLessThan(swapIdx);
  });

  it('cleans only its own tarball ($TARBALL, not a release-* glob) after the restart verified', () => {
    // A glob would eat a parallel dispatch-run's freshly-shipped artifact;
    // and cleanup before the is-active check would drop the retry tarball
    // on a failed deploy.
    const verifyIdx = CODE.indexOf('is-active');
    const cleanIdx = CODE.search(/rm\s+-f\s+["']?\$TARBALL["']?/);
    expect(verifyIdx).toBeGreaterThan(-1);
    expect(cleanIdx).toBeGreaterThan(verifyIdx);
    expect(CODE).not.toMatch(/rm\s+-f\s+["']?\$INCOMING["']?\/release-\*\.tar\.gz/);
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
    // Sudoers: target user must be (guru), not (postgres).
    expect(BOOTSTRAP).toMatch(
      /deploy\s+ALL=\(guru\)\s+NOPASSWD:\s*\/usr\/bin\/psql\s+-d\s+guru\s+-1/,
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

  it('sudoers psql line includes -v ON_ERROR_STOP=1 (todo:df25768e)', () => {
    // Sudo arg matching is exact — the sudoers entry must include the
    // exact arg form deploy.sh uses, or sudo falls through to "password
    // required".
    expect(BOOTSTRAP).toMatch(
      /deploy\s+ALL=\(guru\)\s+NOPASSWD:\s*\/usr\/bin\/psql\s+-d\s+guru\s+-1\s+-v\s+ON_ERROR_STOP=1/,
    );
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

  it('passes -v ON_ERROR_STOP=1 so SQL errors halt the deploy (todo:df25768e)', () => {
    // Without ON_ERROR_STOP=1, psql exits 0 even when the transaction
    // (-1) rolled back — set -e in deploy.sh doesn't catch the failure
    // and migrations silently no-op.
    expect(SRC).toMatch(
      /sudo\s+-u\s+guru\s+\/usr\/bin\/psql\s+-d\s+guru\s+-1\s+-v\s+ON_ERROR_STOP=1/,
    );
  });
});
