/**
 * src/lib/embed.ts
 *
 * Query embedding via local Ollama running nomic-embed-text:v1.5.
 * Dimension: 768. MUST MATCH guru-pipeline embed_corpus.py — dimension or
 * tokenizer drift here silently breaks retrieval (cosine distance comparing
 * vectors from different models is meaningless).
 */

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const EMBEDDING_MODEL = 'nomic-embed-text:v1.5'; // MUST MATCH guru-pipeline embed_corpus.py

export class EmbedError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'EmbedError';
  }
}

interface OllamaEmbedResponse {
  embeddings: number[][];
}

export async function embed(text: string): Promise<number[]> {
  let response: Response;
  try {
    response = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
    });
  } catch (err) {
    throw new EmbedError(`Ollama unreachable at ${OLLAMA_URL}`, err);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new EmbedError(
      `Ollama /api/embed returned ${response.status}: ${body.slice(0, 200)}`,
    );
  }

  let json: OllamaEmbedResponse;
  try {
    json = (await response.json()) as OllamaEmbedResponse;
  } catch (err) {
    throw new EmbedError('Ollama /api/embed returned non-JSON body', err);
  }

  const vec = json.embeddings?.[0];
  if (!Array.isArray(vec) || vec.length === 0) {
    throw new EmbedError(
      `Ollama /api/embed returned malformed payload (model ${EMBEDDING_MODEL} not pulled?)`,
    );
  }
  return vec;
}
