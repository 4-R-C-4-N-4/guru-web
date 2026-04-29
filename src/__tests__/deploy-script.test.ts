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
});
