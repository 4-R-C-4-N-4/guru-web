/**
 * src/__tests__/boot.test.ts
 *
 * Unit tests for boot.ts startup checks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  one: vi.fn(),
  query: vi.fn(),
  exec: vi.fn(),
}));

import { one } from '@/lib/db';
const oneMock = one as ReturnType<typeof vi.fn>;

import { checkCorpus, BootError, EXPECTED_SCHEMA_VERSION } from '@/lib/boot';

describe('checkCorpus', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('throws BootError when corpus metadata is missing', async () => {
    oneMock.mockResolvedValue(null);

    await expect(checkCorpus()).rejects.toBeInstanceOf(BootError);
    await expect(checkCorpus()).rejects.toThrow(/Corpus schema not found/);
  });

  it('throws BootError when corpus schema version is wrong', async () => {
    oneMock.mockResolvedValue({ value: '999' });

    await expect(checkCorpus()).rejects.toBeInstanceOf(BootError);
    await expect(checkCorpus()).rejects.toThrow(/schema version mismatch/);
  });

  it('passes when corpus schema version matches EXPECTED_SCHEMA_VERSION', async () => {
    oneMock.mockResolvedValue({ value: EXPECTED_SCHEMA_VERSION });

    await expect(checkCorpus()).resolves.toBeUndefined();
  });
});
