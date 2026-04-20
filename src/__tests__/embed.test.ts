/**
 * src/__tests__/embed.test.ts
 *
 * Unit tests for the Ollama-backed embed() — global fetch mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { embed, EmbedError } from '@/lib/embed';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const okResponse = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as Response;

describe('embed', () => {
  it('returns the first vector from /api/embed', async () => {
    const vec = Array.from({ length: 768 }, (_, i) => i / 768);
    fetchMock.mockResolvedValueOnce(okResponse({ embeddings: [vec] }));

    const out = await embed('hello');

    expect(out).toEqual(vec);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/embed$/);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ model: 'nomic-embed-text:v1.5', input: 'hello' });
  });

  it('throws EmbedError when Ollama is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(embed('x')).rejects.toBeInstanceOf(EmbedError);
  });

  it('throws EmbedError on non-200 response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'boom',
    } as Response);
    await expect(embed('x')).rejects.toThrow(/500/);
  });

  it('throws EmbedError on malformed payload', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ embeddings: [] }));
    await expect(embed('x')).rejects.toThrow(/malformed/);
  });
});
